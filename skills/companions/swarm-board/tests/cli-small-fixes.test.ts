// D13: F14 (--about a new file takes --new), F20 (done with no phase).
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
const env = () => ({ ...process.env, SWARM_ROOT: toolRoot, SWARMSTORM_HOME: toolRoot, SWARM_NO_POLLER: "1" });
const run = (...argv: string[]) => spawnSync(process.execPath, [CLI, ...argv], { cwd: repo, encoding: "utf8", env: env() });
const git = (...argv: string[]): void => {
  const r = spawnSync("git", argv, { cwd: repo, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
};

beforeEach(() => {
  toolRoot = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-small-"));
  repo = path.join(toolRoot, "repo");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  git("init", "-q");
  for (const f of ["a", "b"]) fs.writeFileSync(path.join(repo, "src", `${f}.ts`), "export {};\n");
  git("add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "root");
  // the member works in a worktree of its own: the board makes none, and knows it by this folder
  git("worktree", "add", "-q", "-b", "s3", path.join(toolRoot, "wt"));
  repo = path.join(toolRoot, "wt");
  const seats = path.join(toolRoot, "seats.json");
  fs.writeFileSync(seats, JSON.stringify([{ id: "S3", blockers: [] }]));
  const open = run("open", "--plan", "p", "--title", "T", "--seats", seats);
  assert.equal(open.status, 0, open.stderr);
  const j = run("join", "--run", open.stdout.split("\n")[0].trim(), "--seat", "S3", "--doing", "x");
  assert.equal(j.status, 0, j.stderr);
});
afterEach(() => {
  stopServerOf(toolRoot);
  fs.rmSync(toolRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test("F14: post and agree --about a path not on disk are refused naming --new, and take it with --new", () => {
  for (const verb of ["post", "agree"]) {
    const refused = run(verb, "text", "--about", "docs/new.md");
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /pass --new if you are creating it \(--about takes a file not yet on disk with --new\)/);
    const ok = run(verb, "text", "--about", "docs/new.md", "--new");
    // --new is taken; a lone member's agreement then has no other party and is refused for that (F25)
    if (verb === "agree") assert.match(ok.stderr, /agree needs another party/);
    else assert.equal(ok.status, 0, ok.stderr);
  }
});

test("F20: done with no phase open exits 0 saying so", () => {
  const r = run("done", "work");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /no phase is open: nothing to mark/);
});
