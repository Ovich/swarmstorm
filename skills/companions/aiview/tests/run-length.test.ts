// A run's length on the page and in `swarm stats`, one rule in both (D46, SL11): runs of lengths around a minute's edge
// seeded through swarm's board, the CLI's run lines read against the page's formatting of the same JSON.
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatDuration, runLength } from "../app/lib/board/analytics.ts";
// The board is seeded through swarm's board server, which the spawned CLI reads too.
import { SWARM_CLI, startTestBoard, type TestBoard } from "./fixtures/board-server.ts";
const SECOND = 1000;
const MINUTE = 60 * SECOND;
/** The lengths seeded: under a minute, under ten minutes with seconds, past ten with seconds, past an hour. */
const LENGTHS = [40 * SECOND, 5 * MINUTE + 30 * SECOND, 14 * MINUTE + 47 * SECOND, 59 * MINUTE + 59 * SECOND, 2 * 60 * MINUTE + 5 * MINUTE + 10 * SECOND];

let home: string;
let repoDir: string;
let board: TestBoard;

// spawned without blocking: the board server it reads runs in this process
const swarmStats = (...argv: string[]): Promise<string> =>
  new Promise((resolve, reject) =>
    execFile(process.execPath, [SWARM_CLI, "stats", "--all", ...argv], { cwd: repoDir, encoding: "utf8", env: { ...process.env, SWARM_ROOT: home, SWARMSTORM_HOME: home } }, (err, stdout, stderr) =>
      err ? reject(new Error(`${err.message}: ${stderr}`)) : resolve(stdout.trimEnd()),
    ),
  );

before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "aiview-run-length-"));
  repoDir = path.join(home, "repo");
  fs.mkdirSync(repoDir);
  const init = spawnSync("git", ["init", "-q", "-b", "main"], { cwd: repoDir, encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);
  const repo = fs.realpathSync.native(path.join(repoDir, ".git"));
  const start = Date.now() - 2 * 24 * 60 * MINUTE;
  mock.timers.enable({ apis: ["Date"], now: start });
  board = await startTestBoard(home);
  try {
    for (const [i, length] of LENGTHS.entries()) {
      mock.timers.setTime(start + i * 3 * 60 * MINUTE);
      const run = await board.writer.openRun({ repo, group: `run-${i}`, title: `Run ${i}`, seats: [{ id: "S1", blockers: [] }] });
      mock.timers.setTime(start + i * 3 * 60 * MINUTE + length);
      await board.writer.closeRun(run.id);
    }
  } finally {
    mock.timers.reset();
  }
});

after(async () => {
  await board.close();
  fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test("the page writes each run's length as the CLI's run line does, floored to the minute (D46, SL11)", async () => {
  const runs = (JSON.parse(await swarmStats("--json")) as { runs: { lengthMs: number }[] }).runs;
  assert.deepEqual(
    runs.map((r) => r.lengthMs),
    LENGTHS,
  );
  // `<code> <title> · <kind> · <length> · <open|closed> · conflicts <n>`, one line per run, oldest first
  const cliLengths = (await swarmStats())
    .split(/\r?\n/)
    .filter((l) => / · plan · /.test(l))
    .map((l) => l.split(" · ")[2]);
  assert.deepEqual(cliLengths, ["40s", "5m", "14m", "59m", "2h 05m"]);
  assert.deepEqual(
    runs.map((r) => runLength(r.lengthMs)),
    cliLengths,
  );
});

test("a duration elsewhere on the page floors, never rounds up: 14m 47s reads 14m, 59m 59s reads 59m (D46, SL11)", () => {
  assert.deepEqual(LENGTHS.map(formatDuration), ["40s", "5m 30s", "14m", "59m", "2h 05m"]);
});
