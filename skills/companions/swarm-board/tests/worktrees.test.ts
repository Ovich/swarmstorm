// The board owns a code run's worktrees: join makes one per seat under the data home, on swarm/<group>/<seat>
// from the run's base; end, close and `worktree prune` remove it once clean and merged, the branch kept.
// A talk-only kind gets none. One real repository, the CLI spawned on a temporary data home.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
const wt = (group: string, seat: string) => path.join(home, "worktrees", `${group}-${seat}`);
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
  const dir = wt("g", "w1");
  assert.ok(fs.existsSync(path.join(dir, "a.txt")));
  assert.equal(git(dir, "rev-parse", "--abbrev-ref", "HEAD"), "swarm/g/w1");
  assert.match(out, /your worktree: .*g-w1 \(branch swarm\/g\/w1 from main\)\. Work there by absolute paths and git -C/);
  assert.match(join(run, "g", "w1"), /from main, reused\)/);
  // the member is known by --as, and by a call from inside its worktree
  const roster = JSON.parse(spawnSync(process.execPath, [CLI, "roster", "--as", "g/w1", "--json"], { cwd: dir, encoding: "utf8", env: env() }).stdout).roster;
  assert.ok(roster.some((m: { name: string }) => m.name === "g/w1"));
  const talk = open("brainstorm", "idea", ["skeptic"]);
  join(talk, "idea", "skeptic");
  assert.equal(fs.existsSync(wt("idea", "skeptic")), false);
});

test("merged keeps the worktree for the seat's next task", () => {
  const run = open("task", "g", ["w1"]);
  join(run, "g", "w1");
  const sha = commitAndMerge(wt("g", "w1"), "b.txt", "swarm/g/w1");
  const out = ok("merged", sha, "--files", "b.txt", "--report", "-", "--as", "g/w1");
  assert.doesNotMatch(out, /removed/);
  assert.ok(fs.existsSync(wt("g", "w1")));
  assert.ok(hasBranch("swarm/g/w1"));
});

test("end refuses while the worktree holds work not merged, naming it and the merge; once merged, end removes it", () => {
  const run = open("task", "g", ["w1"]);
  join(run, "g", "w1");
  ok("deliver", "--as", "g/w1");
  const dir = wt("g", "w1");
  fs.writeFileSync(path.join(dir, "c.txt"), "c\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "c");
  const refused = swarm("end", "--as", "g/w1");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /holds work not merged: branch swarm\/g\/w1 has commits not merged into main\. .*merge-lock --onto main/);
  git(repo, "merge", "-q", "--ff-only", "swarm/g/w1");
  assert.match(ok("end", "--as", "g/w1"), /worktree .*g-w1 removed \(branch kept\)/);
  assert.equal(fs.existsSync(dir), false);
  assert.ok(hasBranch("swarm/g/w1"));
});

test("close removes the run's clean merged worktrees and names those it kept; worktree prune sweeps them once clean, an open run's left", () => {
  const run = open("task", "g", ["w1", "w2"]);
  join(run, "g", "w1");
  join(run, "g", "w2");
  fs.writeFileSync(path.join(wt("g", "w2"), "dirty.txt"), "d\n");
  const other = open("plan", "p", ["S1"]);
  join(other, "p", "S1");
  const closed = ok("close", "--run", run);
  assert.match(closed, /1 worktree removed/);
  assert.match(closed, /kept .*g-w2 \(g\/w2\): 1 uncommitted change; .*worktree prune/);
  assert.equal(fs.existsSync(wt("g", "w1")), false);
  fs.rmSync(path.join(wt("g", "w2"), "dirty.txt"));
  const pruned = ok("worktree", "prune");
  assert.match(pruned, /^1 worktree removed/);
  assert.match(pruned, /kept .*p-S1: run \d+ is open/);
  assert.equal(fs.existsSync(wt("g", "w2")), false);
  assert.ok(fs.existsSync(wt("p", "S1")));
  assert.match(ok("--help"), /worktree prune/);
});
