// D13: F14 (--about a new file takes --new), F15 (release several paths), F16 (the unclaimed line explained), F20 (done with no phase).
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

test("F15: release takes several paths and releases each", () => {
  assert.equal(run("claim", "src/a.ts").status, 0);
  assert.equal(run("claim", "src/b.ts").status, 0);
  const r = run("release", "src/a.ts", "src/b.ts");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /released src\/a\.ts/);
  assert.match(r.stdout, /released src\/b\.ts/);
  const again = run("claim", "src/b.ts");
  assert.equal(again.status, 0, "b was released, claimable");
  assert.equal(run("release").status, 1);
});

test("F16: the 'written without a claim' lines are followed by what they mean", () => {
  fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
  const out = run("end");
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /reconciled 1 written without a claim: src\/a\.ts\n\(not a flag: a write without a claim is allowed, and was claimed for you/);
});

const commitAll = (msg: string): void => {
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", msg);
};

test("F24: many unclaimed writes print one summary line: count, first few, …", () => {
  for (const f of ["c", "d", "e", "f"]) fs.writeFileSync(path.join(repo, "src", `${f}.ts`), "x\n");
  const out = run("end");
  assert.equal(out.status, 0, out.stderr);
  const lines = out.stdout.split("\n").filter((l) => l.startsWith("reconciled "));
  assert.deepEqual(lines, ["reconciled 4 written without a claim: src/c.ts, src/d.ts, src/e.ts, …"]);
});

test("rename: unclaimed, one old → new entry; both sides claimed, nothing told", () => {
  git("mv", "src/a.ts", "src/a2.ts");
  const out = run("end");
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /reconciled 1 written without a claim: src\/a\.ts → src\/a2\.ts/);
});

test("rename with both sides claimed passes merge-lock", () => {
  git("branch", "-M", "main");
  git("checkout", "-q", "-b", "work");
  assert.equal(run("claim", "src/a.ts").status, 0);
  assert.equal(run("claim", "src/a2.ts", "--new").status, 0);
  git("mv", "src/a.ts", "src/a2.ts");
  commitAll("mv");
  const out = run("merge-lock", "--onto", "main");
  assert.equal(out.status, 0, out.stderr);
  assert.ok(!out.stdout.includes("written without a claim"), out.stdout);
});

test("F27: release --all releases every claim; roster and status show held files, truncated", () => {
  for (const f of ["c", "d", "e"]) fs.writeFileSync(path.join(repo, "src", `${f}.ts`), "x\n");
  for (const f of ["a", "b", "c", "d", "e"]) assert.equal(run("claim", `src/${f}.ts`).status, 0);
  assert.match(run("roster").stdout, /files: src\/a\.ts, src\/b\.ts, src\/c\.ts \+2 more \(5\)/);
  assert.match(run("status").stdout, /files: src\/a\.ts, src\/b\.ts, src\/c\.ts \+2 more \(5\)/);
  const r = run("release", "--all");
  assert.equal(r.status, 0, r.stderr);
  assert.equal((r.stdout.match(/released /g) ?? []).length, 5);
  assert.doesNotMatch(run("roster").stdout, /files:/);
  assert.match(run("release", "--all").stdout, /holds no claim/);
});

test("F20: done with no phase open exits 0 saying so", () => {
  const r = run("done", "work");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /no phase is open: nothing to mark/);
});
