// trust-adaptations#D7, #D8: an input git could read as an option is refused before any git runs, and a pid enters
// the PowerShell command only as a positive whole number. One real repository, the CLI spawned on a temporary data home.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { refArg } from "../src/git.ts";
import { commandLine, isProcessId } from "../src/link/link.ts";
import { stopServerOf } from "./fixtures/server.ts";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "cli", "index.ts");
let home: string;
let repo: string;
let gitTrace: string;
// GIT_TRACE: every git the CLI (or a server it starts) runs writes to this file; no file, no git ran
const env = () => ({ ...process.env, SWARM_ROOT: home, SWARMSTORM_HOME: home, SWARM_NO_POLLER: "1", GIT_TRACE: gitTrace });
const swarm = (cwd: string, ...argv: string[]) => spawnSync(process.execPath, [CLI, ...argv], { cwd, encoding: "utf8", env: env() });
const git = (cwd: string, ...argv: string[]): string => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...argv], { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${argv.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-gitargs-"));
  repo = path.join(home, "repo");
  gitTrace = path.join(home, "git-trace.log");
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

const seatsFile = (seats: string[]): string => {
  const file = path.join(home, "seats.json");
  fs.writeFileSync(file, JSON.stringify(seats.map((id) => ({ id, blockers: [] }))));
  return file;
};

test("refArg refuses a value starting with '-' and returns any other unchanged", () => {
  assert.throws(() => refArg("-f", "--onto"), { message: '--onto cannot start with "-": -f' });
  assert.throws(() => refArg("--upload-pack=x", "sha"), { message: 'sha cannot start with "-": --upload-pack=x' });
  assert.equal(refArg("main", "--onto"), "main");
  assert.equal(refArg("refs/heads/a-b", "--onto"), "refs/heads/a-b");
});

test("open --onto -f is refused with the message before any git runs", () => {
  const r = swarm(repo, "open", "--kind", "plan", "--group", "g", "--title", "g", "--seats", seatsFile(["w1"]), "--onto", "-f", "--as", "g/orchestrator");
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /--onto cannot start with "-": -f/);
  assert.equal(fs.existsSync(gitTrace), false, `git ran: ${fs.existsSync(gitTrace) ? fs.readFileSync(gitTrace, "utf8") : ""}`);
});

test("merged with a sha starting with '-' is refused before any git runs", () => {
  const r = swarm(repo, "merged", "-f", "--files", "a.txt", "--report", "r", "--as", "g/w1");
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /merged: the sha cannot start with "-": -f/);
  assert.equal(fs.existsSync(gitTrace), false);
});

test("a worktree made from a normal --onto base still works, its git calls past --end-of-options", () => {
  const opened = swarm(repo, "open", "--kind", "plan", "--group", "g", "--title", "g", "--seats", seatsFile(["w1"]), "--onto", "main");
  assert.equal(opened.status, 0, opened.stderr);
  const run = opened.stdout.split("\n")[0].trim();
  const joined = swarm(repo, "join", "--run", run, "--seat", "w1", "--doing", "x", "--as", "g/w1");
  assert.equal(joined.status, 0, joined.stderr);
  const at = path.join(repo, ".git", "swarm", "worktrees", run, "w1");
  assert.ok(fs.existsSync(path.join(at, "a.txt")), joined.stdout);
  assert.equal(git(at, "rev-parse", "--abbrev-ref", "HEAD"), `swarm/${run}-g/w1`);
  assert.equal(git(at, "rev-parse", "HEAD"), git(repo, "rev-parse", "main"));
  // the trace the refusals above find absent is written here: the proof that no git ran means something
  assert.match(fs.readFileSync(gitTrace, "utf8"), /worktree.*add.*--end-of-options/);
});

test("the pid guard refuses NaN, 0, 1.5, a negative and a string; a live pid passes", () => {
  for (const bad of [NaN, 0, 1.5, -4, "12", "1; Remove-Item x", Infinity] as unknown[]) {
    assert.equal(isProcessId(bad), false, String(bad));
    assert.equal(commandLine(bad as number), null, String(bad));
  }
  assert.equal(isProcessId(process.pid), true);
  assert.ok(commandLine(process.pid), "the command line of this test process");
});
