// aiview's GET /api/stats against `swarm stats --json` (US3, D34, D40, D41, SL4): one store in a temp
// data home, seeded once through swarm's board, read by the route on a test server and by the swarm
// CLI spawned on the same store from a real repository. Closed runs only: an open run is computed to now.
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { openIndex, type Index } from "../src/core/db.ts";
import { startServer } from "../src/server/index.ts";
// The board is seeded through swarm's board server, which the route's reader and the spawned CLI read.
import { SWARM_CLI, startTestBoard, type TestBoard } from "./fixtures/board-server.ts";
const DAY_MS = 24 * 60 * 60 * 1000;

let home: string;
let repoDir: string;
let repo: string; // the repository's identity, as swarm resolves it from the repository's folder
let index: Index;
let testBoard: TestBoard;
let server: http.Server;
let base: string;
const runs: { plan20: number; plan3: number; idea10: number } = { plan20: 0, plan3: 0, idea10: 0 };

const listening = (s: http.Server): Promise<string> =>
  new Promise((r) => s.on("listening", () => r(`http://127.0.0.1:${(s.address() as AddressInfo).port}`)));

// spawned without blocking: the board server it reads runs in this process
const swarmStats = (...argv: string[]): Promise<string> =>
  new Promise((resolve, reject) =>
    execFile(process.execPath, [SWARM_CLI, "stats", ...argv, "--json"], { cwd: repoDir, encoding: "utf8", env: { ...process.env, SWARM_ROOT: home, SWARMSTORM_HOME: home } }, (err, stdout, stderr) =>
      err ? reject(new Error(`stats ${argv.join(" ")}: ${stderr}`)) : resolve(stdout.trimEnd()),
    ),
  );
const route = async (query: string): Promise<string> => {
  const r = await fetch(`${base}/api/stats?repo=${encodeURIComponent(repo)}&${query}`);
  assert.equal(r.status, 200, `${query}: ${r.status}`);
  return r.text();
};

before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "aiview-stats-server-"));
  repoDir = path.join(home, "repo");
  fs.mkdirSync(repoDir);
  const init = spawnSync("git", ["init", "-q", "-b", "main"], { cwd: repoDir, encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);
  repo = fs.realpathSync.native(path.join(repoDir, ".git"));

  // the board's clock moved back, so runs close 20, 10 and 3 days ago; the records begin before them
  const now = Date.now();
  mock.timers.enable({ apis: ["Date"], now: now - 40 * DAY_MS });
  const at = (daysAgo: number): void => mock.timers.setTime(now - daysAgo * DAY_MS);
  testBoard = await startTestBoard(home);
  const board = testBoard.writer;
  try {
    const seats = [
      { id: "S1", blockers: [] },
      { id: "S2", blockers: [] },
    ];
    const planRun = async (title: string, opened: number, closed: number): Promise<number> => {
      at(opened);
      const run = await board.openRun({ repo, group: title.toLowerCase().replace(/ /g, "-"), title, seats });
      const s1 = (await board.join({ run: run.id, seat: "S1", doing: "the schema", files: [{ path: "src/a.ts", interface: true }] })).member;
      const s2 = (await board.join({ run: run.id, seat: "S2", doing: "the page", files: [] })).member;
      await board.deliver(s1);
      await board.deliver(s2);
      await board.checkEdit(s2, "src/a.ts");
      await board.post(s2, `@${s1.name} I add a helper at the end of src/a.ts`, { about: "src/a.ts" });
      await board.checkEdit(s2, "src/a.ts");
      await board.post(s1, `@${s2.name} S2 adds the helper, S1 the rest`, { about: "src/a.ts", kind: "agreement" });
      at(opened - 0.5);
      await board.lockMerge(s1, "main");
      await board.merged(s1, "abc123", ["src/a.ts"], { files: [] });
      await board.end(s1);
      await board.end(s2);
      at(closed);
      await board.closeRun(run.id);
      return run.id;
    };
    runs.plan20 = await planRun("Old plan", 21, 20);
    runs.plan3 = await planRun("New plan", 4, 3);

    at(11);
    const idea = await board.openRun({
      repo,
      kind: "brainstorm",
      group: "idea",
      title: "An idea",
      seats: [
        { id: "skeptic", role: "skeptic", blockers: [] },
        { id: "builder", role: "builder", blockers: [] },
      ],
    });
    const skeptic = (await board.join({ run: idea.id, seat: "skeptic", doing: "doubting", files: [] })).member;
    const builder = (await board.join({ run: idea.id, seat: "builder", doing: "building", files: [] })).member;
    await board.post(builder, "a cache in front, see src/a.ts:12", { about: "D1" });
    await board.post(skeptic, "how stale can it get?", { about: "D1" });
    const agreed = await board.post(builder, "a cache with a one-minute TTL", { about: "D1", kind: "agreement" });
    await board.endorse(skeptic, agreed.seq);
    await board.end(skeptic);
    await board.end(builder);
    at(10);
    await board.closeRun(idea.id);
    runs.idea10 = idea.id;
  } finally {
    mock.timers.reset();
  }

  index = openIndex(path.join(home, "aiview.sqlite"), repoDir);
  server = startServer(index, { port: 0, open: false, startDoc: null, toolRoot: home, writeState: false, boardDataRoot: home, swarmEntry: SWARM_CLI });
  base = await listening(server);
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  await testBoard.close();
  index.close();
  fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test("the body equals `swarm stats --json`, text for text, for since=30d&closedOnly=1, since=7d&closedOnly=1, since=all&closedOnly=1, kind=brainstorm&since=all&closedOnly=1, and for run=<id> against --run <id> (US3, D34, D40, D41, SL4)", async () => {
  const pairs: [string, string[]][] = [
    ["since=30d&closedOnly=1", ["--since", "30d", "--closed"]],
    ["since=7d&closedOnly=1", ["--since", "7d", "--closed"]],
    ["since=all&closedOnly=1", ["--all", "--closed"]],
    ["kind=brainstorm&since=all&closedOnly=1", ["--kind", "brainstorm", "--all", "--closed"]],
    [`run=${runs.plan20}`, ["--run", String(runs.plan20)]],
    [`run=${runs.idea10}`, ["--run", String(runs.idea10)]],
  ];
  for (const [query, flags] of pairs) assert.equal(await route(query), await swarmStats(...flags), query);
  // the scopes are not all the same answer: the period and the kind narrow
  const runsOf = async (query: string): Promise<number[]> => (JSON.parse(await route(query)) as { runs: { run: number }[] }).runs.map((r) => r.run);
  assert.deepEqual(await runsOf("since=all&closedOnly=1"), [runs.plan20, runs.idea10, runs.plan3]);
  assert.deepEqual(await runsOf("since=7d&closedOnly=1"), [runs.plan3]);
  assert.deepEqual(await runsOf("kind=brainstorm&since=all&closedOnly=1"), [runs.idea10]);
});

test("an unknown repository or run answers 404 with its error, and the server stays up (SL4)", async () => {
  const unknownRepo = await fetch(`${base}/api/stats?repo=${encodeURIComponent("/nowhere/.git")}`);
  assert.equal(unknownRepo.status, 404);
  assert.deepEqual(await unknownRepo.json(), { error: "no repository /nowhere/.git" });
  for (const query of ["run=999", `repo=${encodeURIComponent(repo)}&run=999`]) {
    const unknownRun = await fetch(`${base}/api/stats?${query}`);
    assert.equal(unknownRun.status, 404, query);
    assert.deepEqual(await unknownRun.json(), { error: "no run 999" }, query);
  }
  assert.equal((await fetch(`${base}/api/stats?repo=${encodeURIComponent(repo)}&since=all`)).status, 200, "the server is still up");
});
