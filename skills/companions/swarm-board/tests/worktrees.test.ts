// The board owns a code run's worktrees: join makes one per seat at <data home>/worktrees/<run>/<seat>, on swarm/<run>-<group>/<seat>
// from the run's base; end, close and `worktree prune` remove it once clean and merged, the branch kept.
// A talk-only kind gets none. One real repository, the CLI spawned on a temporary data home.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stopServerOf } from "./fixtures/server.ts";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "cli", "index.ts");
let home: string;
let repo: string;
const env = () => ({ ...process.env, SWARM_ROOT: home, SWARMSTORM_HOME: home, SWARM_NO_POLLER: "1" });
const swarm = (...argv: string[]) => spawnSync(process.execPath, [CLI, ...argv], { cwd: repo, encoding: "utf8", env: env() });
const ok = (...argv: string[]): string => {
  const r = swarm(...argv);
  assert.equal(r.status, 0, `${argv.join(" ")}: ${r.stderr}`);
  return r.stdout;
};
const git = (cwd: string, ...argv: string[]): string => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...argv], { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${argv.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const wt = (run: string, seat: string) => path.join(home, "worktrees", run, seat);
const hasBranch = (b: string) => spawnSync("git", ["rev-parse", "--verify", "-q", `refs/heads/${b}`], { cwd: repo }).status === 0;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-wt-"));
  repo = path.join(home, "repo");
  fs.mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(repo, "a.txt"), "a\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "root");
});
afterEach(() => {
  stopServerOf(home);
  fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const open = (kind: string, group: string, seats: string[]): string => {
  const file = path.join(home, `${group}.json`);
  fs.writeFileSync(file, JSON.stringify(seats.map((id) => ({ id, blockers: [] }))));
  return ok("open", "--kind", kind, "--group", group, "--title", group, "--seats", file).split("\n")[0].trim();
};
const join = (run: string, group: string, seat: string) => ok("join", "--run", run, "--seat", seat, "--doing", "x", "--as", `${group}/${seat}`);
/** A commit in the worker's worktree, merged into main by a fast-forward. */
const commitAndMerge = (dir: string, file: string, branch: string): string => {
  fs.writeFileSync(path.join(dir, file), "x\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", file);
  git(repo, "merge", "-q", "--ff-only", branch);
  return git(dir, "rev-parse", "HEAD");
};

test("join on a code run makes the seat's worktree under the data home, from the run's base; a re-join reuses it; a talk-only kind gets none", () => {
  const run = open("task", "g", ["w1"]);
  const out = join(run, "g", "w1");
  const dir = wt(run, "w1");
  assert.ok(fs.existsSync(path.join(dir, "a.txt")));
  assert.equal(git(dir, "rev-parse", "--abbrev-ref", "HEAD"), `swarm/${run}-g/w1`);
  const shown = wt(run, "w1").split(path.sep).join("/");
  assert.ok(out.includes(`your worktree: ${shown} (branch swarm/${run}-g/w1 from main). Work there by absolute paths and git -C ${shown}, never cd`), out);
  assert.match(join(run, "g", "w1"), /from main, reused\)/);
  // the member is known by --as, and by a call from inside its worktree
  const roster = JSON.parse(spawnSync(process.execPath, [CLI, "roster", "--as", "g/w1", "--json"], { cwd: dir, encoding: "utf8", env: env() }).stdout).roster;
  assert.ok(roster.some((m: { name: string }) => m.name === "g/w1"));
  const talk = open("brainstorm", "idea", ["skeptic"]);
  join(talk, "idea", "skeptic");
  assert.equal(fs.existsSync(wt(talk, "skeptic")), false);
});

test("merged keeps the worktree for the seat's next task", () => {
  const run = open("task", "g", ["w1"]);
  join(run, "g", "w1");
  const sha = commitAndMerge(wt(run, "w1"), "b.txt", `swarm/${run}-g/w1`);
  git(repo, "branch", "-f", "trunk", "main");
  ok("merge-lock", "--onto", "trunk", "--as", "g/w1");
  const out = ok("merged", sha, "--files", "b.txt", "--report", "-", "--as", "g/w1");
  assert.doesNotMatch(out, /removed/);
  assert.ok(fs.existsSync(wt(run, "w1")));
  assert.ok(hasBranch(`swarm/${run}-g/w1`));
});

test("end refuses while the worktree holds work not merged, naming it and the merge; once merged, end removes it", () => {
  const run = open("task", "g", ["w1"]);
  join(run, "g", "w1");
  ok("deliver", "--as", "g/w1");
  const dir = wt(run, "w1");
  fs.writeFileSync(path.join(dir, "c.txt"), "c\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "c");
  const refused = swarm("end", "--as", "g/w1");
  assert.equal(refused.status, 1);
  assert.ok(refused.stderr.includes(`holds work not merged: branch swarm/${run}-g/w1 has commits not merged into main. Merge it: `), refused.stderr);
  assert.match(refused.stderr, /merge-lock --onto main/);
  git(repo, "merge", "-q", "--ff-only", `swarm/${run}-g/w1`);
  assert.match(ok("end", "--as", "g/w1"), /worktree .*w1 removed \(branch kept\)/);
  assert.equal(fs.existsSync(dir), false);
  assert.ok(hasBranch(`swarm/${run}-g/w1`));
});

test("close removes the run's clean merged worktrees and names those it kept; worktree prune sweeps them once clean, an open run's left", () => {
  const run = open("task", "g", ["w1", "w2"]);
  join(run, "g", "w1");
  join(run, "g", "w2");
  fs.writeFileSync(path.join(wt(run, "w2"), "dirty.txt"), "d\n");
  const other = open("plan", "p", ["S1"]);
  join(other, "p", "S1");
  const closed = ok("close", "--run", run);
  assert.match(closed, /1 worktree removed/);
  assert.match(closed, /kept .*w2 \(g\/w2\): 1 uncommitted change; .*worktree prune/);
  assert.equal(fs.existsSync(wt(run, "w1")), false);
  fs.rmSync(path.join(wt(run, "w2"), "dirty.txt"));
  const pruned = ok("worktree", "prune");
  assert.match(pruned, /^1 worktree removed/);
  assert.match(pruned, /kept .*S1: run \d+ is open/);
  assert.equal(fs.existsSync(wt(run, "w2")), false);
  assert.ok(fs.existsSync(wt(other, "S1")));
  assert.match(ok("--help"), /worktree prune/);
});

test("two runs whose group and seat join to the same text get their own folders and branches", () => {
  const one = open("task", "a-b", ["c"]);
  const two = open("task", "a", ["b-c"]);
  join(one, "a-b", "c");
  fs.writeFileSync(path.join(wt(one, "c"), "dirty.txt"), "d\n");
  join(two, "a", "b-c");
  assert.notEqual(wt(one, "c"), wt(two, "b-c"));
  assert.equal(fs.existsSync(path.join(wt(two, "b-c"), "dirty.txt")), false);
  assert.equal(git(wt(one, "c"), "rev-parse", "--abbrev-ref", "HEAD"), `swarm/${one}-a-b/c`);
  assert.equal(git(wt(two, "b-c"), "rev-parse", "--abbrev-ref", "HEAD"), `swarm/${two}-a/b-c`);
});

test("end with uncommitted work says to commit it, then merge it", () => {
  const run = open("task", "g", ["w1"]);
  join(run, "g", "w1");
  ok("deliver", "--as", "g/w1");
  fs.writeFileSync(path.join(wt(run, "w1"), "c.txt"), "c\n");
  const refused = swarm("end", "--as", "g/w1");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /1 uncommitted change\. Commit it, then merge it: /);
});

test("end stops only the link whose pid this data home recorded; a process with the same command line survives", async () => {
  const run = open("task", "g", ["w1"]);
  join(run, "g", "w1");
  ok("deliver", "--as", "g/w1");
  const idle = ["-e", "setInterval(() => {}, 1000)", "link", "--run", run, "--as", "g/w1"];
  const link = spawn(process.execPath, idle, { stdio: "ignore" });
  const decoy = spawn(process.execPath, idle, { stdio: "ignore" });
  try {
    fs.mkdirSync(path.join(home, "links"), { recursive: true });
    fs.writeFileSync(path.join(home, "links", `${run}-g_w1.pid`), String(link.pid));
    const linkGone = new Promise((r) => link.once("exit", r));
    assert.match(ok("end", "--as", "g/w1"), /removed \(branch kept\)/);
    await linkGone;
    assert.equal(decoy.exitCode, null);
    assert.doesNotThrow(() => process.kill(decoy.pid!, 0));
    assert.equal(fs.existsSync(path.join(home, "links", `${run}-g_w1.pid`)), false);
  } finally {
    link.kill();
    decoy.kill();
  }
});
