// The orchestrators board: every open run, whatever its roles, is told by its `open` and by `status` to register on the
// project's permanent board (group `orchestrators`): the board's open when there is none, else its seat's add and join.
// The board itself is refused a plain close.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { orchestratorsLines } from "../../src/cli/answer/orchestrators.ts";
import { stopServerOf } from "../fixtures/server.ts";
import { normalise, pin } from "./golden.ts";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "cli", "index.ts");
const LINE = /^(register on|your seat is on) the project's orchestrators board/;

/** A scratch project with its board home; `open` opens a task run of `group`, its authority given when not null. */
function scene() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-orchestrators-"));
  const repo = path.join(home, "repo");
  fs.mkdirSync(repo);
  const git = (...argv: string[]) => assert.equal(spawnSync("git", argv, { cwd: repo, encoding: "utf8" }).status, 0);
  git("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(repo, "a.ts"), "export {};\n");
  git("add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "root");
  const env = { ...process.env, SWARM_ROOT: home, SWARMSTORM_HOME: home, SWARM_NO_POLLER: "1" };
  const call = (...argv: string[]) => spawnSync(process.execPath, [CLI, ...argv], { cwd: repo, encoding: "utf8", env });
  const raw = (...argv: string[]): string => {
    const r = call(...argv);
    assert.equal(r.status, 0, `${argv.join(" ")}: ${r.stderr}${r.stdout}`);
    return r.stdout;
  };
  // the seats file is named by a hash of the scratch repository's path: masked, as the home is
  const must = (...argv: string[]): string => normalise(raw(...argv), home, new Map());
  const seats = path.join(home, "seats.json");
  fs.writeFileSync(seats, "[]");
  const line = (out: string) => out.split("\n").filter((l) => LINE.test(l)).join("\n");
  return {
    home,
    call,
    raw,
    line,
    open: (group: string, authority: string | null) => must("open", "--kind", "task", "--group", group, "--title", group, "--seats", seats, "--onto", "main", ...(authority ? ["--authority", authority] : [])),
    status: () => line(must("status")),
    done: () => {
      stopServerOf(home);
      fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

test("a run with no authority alone: its open gives the board's open; once open, the next run's open its seat add and join", () => {
  const s = scene();
  try {
    const first = s.open("alpha", null);
    pin("orchestrators-board.first-open", { status: 0, text: s.line(first) });
    assert.match(first, /open --kind brainstorm --group orchestrators/);
    // AGENTS rule 10: the printed open runs as printed, its seat the run
    const [written] = fs.readdirSync(path.join(s.home, "orchestrators"));
    const seatsFile = path.join(s.home, "orchestrators", written);
    assert.deepEqual(JSON.parse(fs.readFileSync(seatsFile, "utf8")), [{ id: "alpha", blockers: [] }]);
    s.raw("open", "--kind", "brainstorm", "--group", "orchestrators", "--title", "Orchestrators", "--seats", seatsFile);
    assert.equal(s.status(), "", "every open run seated: status says nothing");
    const second = s.open("beta", "architect,tech-lead");
    pin("orchestrators-board.second-open", { status: 0, text: s.line(second) });
    assert.match(second, /seat add beta --run \d+ --role architect,tech-lead ; .* join --run \d+ --seat beta /);
  } finally {
    s.done();
  }
});

test("the orchestrators board refuses a plain close; --force closes it", () => {
  const s = scene();
  try {
    s.open("alpha", null);
    const [written] = fs.readdirSync(path.join(s.home, "orchestrators"));
    const id = s.raw("open", "--kind", "brainstorm", "--group", "orchestrators", "--title", "Orchestrators", "--seats", path.join(s.home, "orchestrators", written)).split("\n")[0];
    const refused = s.call("close", "--run", id);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr + refused.stdout, /orchestrators board, which stays open/);
    s.raw("close", "--run", id, "--force");
  } finally {
    s.done();
  }
});

test("the rule: every run counts, roles or none; another project's board counts not; a seated run is not asked again", () => {
  const cli = "swarm";
  const written: { repo: string; seats: unknown }[] = [];
  const writeSeats = (repo: string, seats: unknown) => (written.push({ repo, seats }), "/home/orchestrators/r.seats.json");
  const a = { id: 1, repo: "/r/.git", group: "a", authority: ["architect"] };
  const b = { id: 2, repo: "/r/.git", group: "b" };
  const needed = orchestratorsLines([a, b], cli, writeSeats);
  assert.ok(needed[0].endsWith("--seats /home/orchestrators/r.seats.json"), needed[0]);
  assert.deepEqual(written.at(-1), { repo: "/r/.git", seats: [{ id: "a", role: "architect", blockers: [] }, { id: "b", blockers: [] }] });
  assert.equal(orchestratorsLines([a, { id: 5, repo: "/other/.git", group: "orchestrators" }], cli, writeSeats).length, 1, "another project's board is not this one's");
  const board = { id: 5, repo: "/r/.git", group: "orchestrators", seats: [{ id: "a" }] };
  const open = orchestratorsLines([a, b, board], cli, writeSeats);
  assert.match(open[0], /run 5, .*: swarm seat add b --run 5 ; swarm join --run 5 --seat b /);
  assert.doesNotMatch(open[0], /seat add a /);
  // a run already seated: its own open is told to take the seat back; status says nothing of it
  assert.match(orchestratorsLines([a, board], cli, writeSeats, 1)[0], /^your seat is on .*run 5; take it back: swarm join --run 5 --seat a /);
  assert.deepEqual(orchestratorsLines([a, board], cli, writeSeats), []);
  assert.deepEqual(orchestratorsLines([board], cli, writeSeats), [], "the board alone registers nothing");
});
