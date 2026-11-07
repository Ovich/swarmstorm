// merge-lock --check: the board rebases, runs the worker's check, fast-forwards and records merged; a conflict alone
// hands the merge back, the lock kept; a failed check gives the lock back, nothing merged.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { LINES, makeRepo, openTwoRunners, type Repo } from "./fixtures/worktrees.ts";

let repos: Repo[] = [];
const fresh = (): Repo => {
  const r = makeRepo();
  repos.push(r);
  openTwoRunners(r);
  return r;
};
afterEach(() => {
  for (const r of repos) r.cleanup();
  repos = [];
});
const edit = (i: number, text: string): string[] => LINES.map((l, k) => (k === i ? text : l));
const onMain = (r: Repo, sha: string): boolean => r.git(r.repo, "branch", "--contains", sha, "main").includes("main");
const ok = 'node -e "process.exit(0)"';

test("a clean merge: rebased, checked, fast-forwarded and recorded in one call", () => {
  const r = fresh();
  r.commitFile(r.wtB, "src/a.ts", edit(4, "export const five = 'b';"));
  r.commitFile(r.repo, "src/a.ts", edit(0, "export const one = 'main';"));
  const out = r.cli(r.wtB, "merge-lock", "--onto", "main", "--check", ok, "--report", "-");
  const sha = r.git(r.wtB, "rev-parse", "HEAD").trim();
  assert.match(out, new RegExp(`^merged ${sha}: lock released`, "m"));
  assert.ok(onMain(r, sha));
  // the lock is free: the other member takes it at once
  assert.match(r.cli(r.wtA, "merge-lock", "--onto", "main"), /^granted/m);
});

test("a conflict stops it with the lock kept; resolved, --continue finishes the merge", () => {
  const r = fresh();
  r.commitFile(r.wtB, "src/a.ts", edit(0, "export const one = 'b';"));
  r.commitFile(r.repo, "src/a.ts", edit(0, "export const one = 'main';"));
  const first = r.swarm(r.wtB, ["merge-lock", "--onto", "main", "--check", ok, "--report", "-"]);
  assert.equal(first.status, 2);
  assert.match(first.stdout, /stopped on a conflict in src\/a\.ts: the lock stays yours.*--continue/);
  assert.match(r.swarm(r.wtA, ["merge-lock", "--onto", "main"]).stdout, /^held by/m);
  fs.writeFileSync(`${r.wtB}/src/a.ts`, edit(0, "export const one = 'both';").join("\n") + "\n");
  r.git(r.wtB, "add", "src/a.ts");
  const done = r.cli(r.wtB, "merge-lock", "--onto", "main", "--check", ok, "--report", "-", "--continue");
  const sha = r.git(r.wtB, "rev-parse", "HEAD").trim();
  assert.match(done, new RegExp(`^merged ${sha}: lock released`, "m"));
  assert.ok(onMain(r, sha));
});

test("a failed check merges nothing and gives the lock back", () => {
  const r = fresh();
  r.commitFile(r.wtB, "src/a.ts", edit(4, "export const five = 'b';"));
  const before = r.git(r.repo, "rev-parse", "main").trim();
  const res = r.swarm(r.wtB, ["merge-lock", "--onto", "main", "--check", 'node -e "console.log(\'1 test failed\');process.exit(1)"', "--report", "-"]);
  assert.equal(res.status, 3);
  assert.match(res.stdout, /the check failed \(exit 1\); nothing merged, the lock released[\s\S]*1 test failed/);
  assert.equal(r.git(r.repo, "rev-parse", "main").trim(), before);
  assert.match(r.cli(r.wtA, "merge-lock", "--onto", "main"), /^granted/m);
});
