// Two runs on one board server (board-split D10): a code task run A (worker w1, --onto main) and a brainstorm B
// (seat s1), their verbs interleaved. Each member's answers are pinned, and checked never to carry the other run's
// plain talk or claims: B's seat never sees A's posts, A's claim never shows in B's thread; the roster alone is the project's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stopServerOf } from "../fixtures/server.ts";
import { normalise, pin, type Answer } from "./golden.ts";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "cli", "index.ts");
const A_ORCH = "ga/orchestrator";
const A_WORKER = "ga/w1";
const B_ORCH = "gb/orchestrator";
const B_SEAT = "gb/s1";
/** Words only run A's talk and claims carry, never an answer of B's. */
const A_ONLY = /ga\/|a-task-only|alpha plain|a\.ts/;
/** Words only run B's talk carries, never an answer of A's member. */
const B_ONLY = /gb\/|beta plain|an idea for b/;

test("two runs on one server answer each its own members: no plain post, claim or phase of one reaches the other's waits, deliveries, thread or done", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-two-runs-"));
  const repo = path.join(home, "repo");
  try {
    fs.mkdirSync(repo);
    const git = (...argv: string[]) => assert.equal(spawnSync("git", argv, { cwd: repo, encoding: "utf8" }).status, 0);
    git("init", "-q", "-b", "main");
    fs.writeFileSync(path.join(repo, "a.ts"), "export {};\n");
    git("add", ".");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "root");
    const env = { ...process.env, SWARM_ROOT: home, SWARMSTORM_HOME: home, SWARM_NO_POLLER: "1" };
    const raw = (argv: string[]) => spawnSync(process.execPath, [CLI, ...argv], { cwd: repo, encoding: "utf8", env });
    const must = (...argv: string[]): string => {
      const r = raw(argv);
      assert.equal(r.status, 0, `${argv.join(" ")}: ${r.stderr}${r.stdout}`);
      return r.stdout;
    };
    const seatsFile = (name: string, id: string): string => {
      const f = path.join(home, `${name}.seats.json`);
      fs.writeFileSync(f, JSON.stringify([{ id, blockers: [] }]));
      return f;
    };
    const runA = must("open", "--kind", "task", "--group", "ga", "--title", "Alpha", "--seats", seatsFile("ga", "w1"), "--onto", "main").split("\n")[0].trim();
    const runB = must("open", "--kind", "brainstorm", "--group", "gb", "--title", "Beta", "--seats", seatsFile("gb", "s1")).split("\n")[0].trim();
    must("join", "--run", runA, "--seat", "w1", "--doing", "x", "--as", A_WORKER);
    must("join", "--run", runB, "--seat", "s1", "--doing", "x", "--as", B_SEAT);
    const nicks = new Map<string, string>();
    // keyed by member, not seat: both runs have an orchestrator seat
    for (const r of (JSON.parse(must("roster", "--json")) as { roster: { nick: string; name: string }[] }).roster) if (r.nick) nicks.set(r.nick, r.name);
    const call = (...argv: string[]): Answer => {
      const r = raw(argv);
      return { status: r.status, text: normalise(r.stdout + (r.stderr ? `--- stderr\n${r.stderr}` : ""), home, nicks) };
    };
    /** Pins `name` and checks it carries none of `foreign`. */
    const pinOwn = (name: string, answer: Answer, foreign: RegExp): void => {
      assert.doesNotMatch(answer.text, foreign, `${name} carries the other run's words`);
      pin(name, answer);
    };

    // interleaved: a phase and plain talk in each, a task mention in A, A's worker claims
    must("phase", "build", "build alpha", "--as", A_ORCH);
    must("phase", "ideas", "ideas for beta", "--as", B_ORCH);
    must("post", "alpha plain talk", "--as", A_ORCH);
    must("post", "beta plain talk", "--as", B_ORCH);
    must("post", "@w1 a-task-only: do it", "--as", A_ORCH);
    must("post", "@s1 an idea for b, please", "--as", B_ORCH);
    must("claim", "a.ts", "--as", A_WORKER);

    pinOwn("two-runs.a-worker.wait", call("wait", "--mentions", "--as", A_WORKER, "--timeout", "2000"), B_ONLY);
    pinOwn("two-runs.b-seat.wait", call("wait", "--mentions", "--as", B_SEAT, "--timeout", "2000"), A_ONLY);
    pinOwn("two-runs.a-worker.deliver", call("deliver", "--as", A_WORKER), B_ONLY);
    pinOwn("two-runs.b-seat.deliver", call("deliver", "--as", B_SEAT), A_ONLY);
    pinOwn("two-runs.a-worker.thread", call("thread", "--as", A_WORKER), B_ONLY);
    pinOwn("two-runs.b-seat.thread", call("thread", "--as", B_SEAT), A_ONLY);
    // the roster is the project's, every run's members and claims in it (the swarm-board skill: claims are the project's)
    // a member's state follows the board's clock, not the scene: pinned as <state>
    const roster = call("roster", "--as", B_SEAT);
    pin("two-runs.b-seat.roster", { ...roster, text: roster.text.replace(/  run (\d+)  (working|busy|waiting|quiet|gone)\b/g, "  run $1  <state>") });
    pinOwn("two-runs.b-seat.done", call("done", "ideas", "--as", B_SEAT), A_ONLY);
    pinOwn("two-runs.a-worker.done", call("done", "build", "--as", A_WORKER), B_ONLY);
  } finally {
    stopServerOf(home);
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
