// D14: G21 (read with no seq names its usage), G26 (a listener exiting 0 with no output: repro), G30 (a closed run's thread read with --run).
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stopServerOf } from "./fixtures/server.ts";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "cli", "index.ts");
let toolRoot: string;
let repo: string;
let runId: string;
const env = () => ({ ...process.env, SWARM_ROOT: toolRoot, SWARMSTORM_HOME: toolRoot, SWARM_NO_POLLER: "1" });
const run = (...argv: string[]) => spawnSync(process.execPath, [CLI, ...argv], { cwd: repo, encoding: "utf8", env: env() });
const git = (...argv: string[]): void => {
  const r = spawnSync("git", argv, { cwd: repo, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
};

beforeEach(() => {
  toolRoot = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-d14-"));
  repo = path.join(toolRoot, "repo");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  git("init", "-q");
  fs.writeFileSync(path.join(repo, "src", "a.ts"), "export {};\n");
  git("add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "root");
  git("worktree", "add", "-q", "-b", "s3", path.join(toolRoot, "wt"));
  repo = path.join(toolRoot, "wt");
  const seats = path.join(toolRoot, "seats.json");
  fs.writeFileSync(seats, JSON.stringify([{ id: "S3", blockers: [] }]));
  const open = run("open", "--plan", "p", "--title", "T", "--seats", seats);
  assert.equal(open.status, 0, open.stderr);
  runId = open.stdout.split("\n")[0].trim();
  const j = run("join", "--run", runId, "--seat", "S3", "--doing", "x");
  assert.equal(j.status, 0, j.stderr);
});
afterEach(() => {
  stopServerOf(toolRoot);
  fs.rmSync(toolRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test("G21, V1: read with no seq prints its usage and one corrected form, runnable as printed", () => {
  const r = run("read", "--as", "p/S3");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /read: which seq\?/);
  // the real invocation: the data home when not the default, node, this script; never a bare `swarm`
  assert.match(r.stderr, /^usage: (SWARMSTORM_HOME=\S+ )?node \S+index\.ts read <seq> \[--as <member>\]$/m);
  assert.match(r.stderr, /^e\.g\. (SWARMSTORM_HOME=\S+ )?node \S+index\.ts read 12 --as p\/S3$/m);
});

test("V1: the usage header names the real invocation", () => {
  const r = run("--help");
  assert.match(r.stdout + r.stderr, /^usage: (SWARMSTORM_HOME=\S+ )?node \S+index\.ts <verb> /m);
  assert.doesNotMatch(r.stdout + r.stderr, /usage: swarm /);
});

test("V1: done with no phase prints usage and a corrected form", () => {
  const r = run("done", "--as", "p/S3");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /^usage: .* done <phase> --as <member>$/m);
  assert.match(r.stderr, /^e\.g\. .* done build --as p\/S3$/m);
});

test("G30: a closed run's thread is read with --run, every post or one phase; read-only", () => {
  assert.equal(run("phase", "build", "build it", "--as", "p/orchestrator").status, 0);
  assert.equal(run("post", "first word").status, 0);
  assert.equal(run("close", "--run", runId).status, 0);
  const all = run("thread", "--run", runId);
  assert.equal(all.status, 0, all.stderr);
  assert.match(all.stdout, /first word/);
  const phase = run("thread", "--run", runId, "build");
  assert.equal(phase.status, 0, phase.stderr);
  assert.match(phase.stdout, /first word/);
  const unknown = run("thread", "--run", "9999");
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /unknown run 9999/);
});

test("G26 repro: a live member's wait --mentions that times out says what to do; it never exits 0 silent", () => {
  const r = run("wait", "--mentions", "--timeout", "500");
  assert.equal(r.status, 0, r.stderr);
  assert.notEqual(r.stdout.trim(), "", "a live member's listener returned nothing");
});

test("G26: a wait --mentions of a member that has ended says so, never exits 0 silent", () => {
  assert.equal(run("end", "--seat", "S3", "--as", "p/orchestrator").status, 0);
  const r = run("wait", "--mentions", "--timeout", "500", "--as", "p/S3");
  assert.equal(r.status, 0, r.stderr);
  // the one silent path found: the member ended, nothing to re-arm; it now says so and how to come back
  assert.match(r.stdout, /you have ended in run [0-9]+: this listener stops; nothing to re-arm/);
});
