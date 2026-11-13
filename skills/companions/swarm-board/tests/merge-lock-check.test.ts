// merge-lock, the delivery: the board rebases, fast-forwards and records merged; only a clean merge passes, a conflict
// handed back with the lock released, the member editing the files and calling again.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { LINES, makeRepo, openTwoRunners, type Repo } from "./fixtures/worktrees.ts";
import { openRawStore } from "./fixtures/raw-store.ts";

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

test("a clean merge: rebased, fast-forwarded and recorded in one call", () => {
  const r = fresh();
  r.commitFile(r.wtB, "src/a.ts", edit(4, "export const five = 'b';"));
  r.commitFile(r.repo, "src/a.ts", edit(0, "export const one = 'main';"));
  const out = r.cli(r.wtB, "merge-lock", "--onto", "main", "--report", "-");
  const sha = r.git(r.wtB, "rev-parse", "HEAD").trim();
  assert.match(out, new RegExp(`^merged ${sha}: lock released`, "m"));
  assert.ok(onMain(r, sha));
  // the lock is free: the other member takes it at once
  assert.match(r.cli(r.wtA, "merge-lock", "--lock-only", "--onto", "main"), /^granted/m);
});

/** Whether anyone holds the merge lock, read from the store. */
const lockHeld = (r: Repo): boolean => {
  const db = openRawStore(r.store, { readOnly: true });
  try {
    return db.prepare("SELECT 1 FROM merge_locks").get() !== undefined;
  } finally {
    db.close();
  }
};
const deliver = ["merge-lock", "--onto", "main", "--report", "-"];

test("only a clean merge passes: a conflict is handed back with the lock released; the files edited, the same call delivers it", () => {
  const r = fresh();
  r.commitFile(r.wtB, "src/a.ts", edit(0, "export const one = 'b';"));
  r.commitFile(r.repo, "src/a.ts", edit(0, "export const one = 'main';"));
  const before = r.git(r.repo, "rev-parse", "main").trim();
  const first = r.swarm(r.wtB, deliver);
  assert.equal(first.status, 2);
  assert.match(first.stdout, /met a conflict in src\/a\.ts: nothing merged, the lock released;.*run no git command, then: .* merge-lock --onto main --report - --as /);
  assert.doesNotMatch(first.stdout, /--continue/);
  assert.equal(lockHeld(r), false, "nobody waits on a member fixing its branch");
  assert.equal(r.git(r.repo, "rev-parse", "main").trim(), before);
  // called again with the markers still there: refused again, before any lock
  const still = r.swarm(r.wtB, deliver);
  assert.equal(still.status, 2);
  assert.match(still.stdout, /^still conflicted: src\/a\.ts carry conflict markers/m);
  assert.equal(lockHeld(r), false);
  // the member's one part: the file, edited; no git add, no rebase --continue
  fs.writeFileSync(`${r.wtB}/src/a.ts`, edit(0, "export const one = 'both';").join("\n") + "\n");
  const done = r.cli(r.wtB, ...deliver);
  const sha = r.git(r.wtB, "rev-parse", "HEAD").trim();
  assert.match(done, new RegExp(`^merged ${sha}: lock released`, "m"));
  assert.ok(onMain(r, sha));
  // S3 holds src/a.ts: the conflict resolved on the way is told to it (D63)
  assert.match(done, /^if you resolved a conflict in src\/a\.ts, tell them: swarm post "@review-tool\/S3 /m);
  assert.equal(lockHeld(r), false);
});

test("work not committed is refused, nothing merged; with no report given, the delivered commits' subjects are the report; nothing to deliver says so", () => {
  const r = fresh();
  r.commitFile(r.wtB, "src/c.ts", edit(4, "export const five = 'b';"));
  r.commitFile(r.repo, "src/old.ts", edit(0, "export const one = 'main';"));
  fs.writeFileSync(`${r.wtB}/src/a.ts`, edit(2, "export const three = 'uncommitted';").join("\n") + "\n");
  const dirty = r.swarm(r.wtB, ["merge-lock", "--onto", "main"]);
  assert.equal(dirty.status, 1);
  assert.match(dirty.stdout, /^rebase onto main failed .*nothing merged, the lock released: commit what is uncommitted/m);
  assert.equal(lockHeld(r), false);
  r.git(r.wtB, "checkout", "--", "src/a.ts");
  // the bare call is the delivery
  const out = r.cli(r.wtB, "merge-lock", "--onto", "main");
  const sha = r.git(r.wtB, "rev-parse", "HEAD").trim();
  assert.match(out, new RegExp(`^merged ${sha}: lock released; reported as #\\d+`, "m"));
  assert.ok(onMain(r, sha));
  const db = openRawStore(r.store, { readOnly: true });
  try {
    const report = db.prepare("SELECT body FROM messages WHERE kind = 'msg' AND body LIKE '@orchestrator merged %' ORDER BY seq DESC LIMIT 1").get() as { body: string };
    assert.equal(report.body, `@orchestrator merged ${sha}: delivered: src/c.ts`);
  } finally {
    db.close();
  }
  // delivered already: a second call has nothing to merge, and holds no lock after saying so
  const none = r.swarm(r.wtB, ["merge-lock", "--onto", "main"]);
  assert.equal(none.status, 0);
  assert.match(none.stdout, /^nothing to deliver: your branch has no commit main lacks; the lock released$/m);
  assert.equal(lockHeld(r), false);
});

/** The body of the latest merged event, as the board stored it. */
const mergedEvent = (r: Repo): string => {
  const db = openRawStore(r.store, { readOnly: true });
  try {
    return String((db.prepare("SELECT body FROM messages WHERE event = 'merged' ORDER BY seq DESC LIMIT 1").get() as { body: string }).body);
  } finally {
    db.close();
  }
};

test("the merged event names the files the branch changed, read from git at the lock's grant, and tells their holder to rebase", () => {
  const r = fresh();
  // S5 changes the file S3 holds and one of its own, in two commits; main moves too, so the merge rebases
  r.commitFile(r.wtB, "src/a.ts", edit(4, "export const five = 'b';"));
  r.commitFile(r.wtB, "src/c.ts", edit(4, "export const five = 'b';"));
  r.commitFile(r.repo, "src/old.ts", edit(0, "export const one = 'main';"));
  r.cli(r.wtB, "merge-lock", "--onto", "main", "--report", "-");
  const body = mergedEvent(r);
  assert.match(body, /^files: src\/a\.ts, src\/c\.ts$/m, "its own two files, never main's src/old.ts");
  assert.match(body, /^@review-tool\/S3: you hold or declared a file it changed\.$/m);
});

test("a merge by hand names the same files: nothing typed, and a typed --files is ignored", () => {
  const r = fresh();
  r.commitFile(r.wtB, "src/a.ts", edit(4, "export const five = 'b';"));
  r.commitFile(r.repo, "src/old.ts", edit(0, "export const one = 'main';"));
  r.cli(r.wtB, "merge-lock", "--lock-only", "--onto", "main");
  assert.deepEqual(r.rebaseOntoMain(r.wtB).conflicted, []);
  const sha = r.git(r.wtB, "rev-parse", "HEAD").trim();
  const merged = JSON.parse(r.cli(r.wtB, "merged", sha, "--files", "src/c.ts", "--report", "-", "--json"));
  assert.deepEqual(merged.files, ["src/a.ts"]);
  assert.match(mergedEvent(r), /^files: src\/a\.ts$/m);
});

test("a delivery handed back and finished names every file of the branch, and one conflict per commit is handed back in turn", () => {
  const r = fresh();
  r.commitFile(r.wtB, "src/a.ts", edit(0, "export const one = 'b';"));
  r.commitFile(r.wtB, "src/c.ts", edit(0, "export const one = 'b';"));
  r.commitFile(r.repo, "src/a.ts", edit(0, "export const one = 'main';"));
  r.commitFile(r.repo, "src/c.ts", edit(0, "export const one = 'main';"));
  // the rebase stops on the first commit, src/a.ts; the second, src/c.ts, conflicts once the first is through
  const first = r.swarm(r.wtB, deliver);
  assert.equal(first.status, 2);
  assert.match(first.stdout, /met a conflict in src\/a\.ts:/);
  fs.writeFileSync(`${r.wtB}/src/a.ts`, edit(0, "export const one = 'both';").join("\n") + "\n");
  const second = r.swarm(r.wtB, deliver);
  assert.equal(second.status, 2);
  assert.match(second.stdout, /met a conflict in src\/c\.ts:/);
  assert.equal(lockHeld(r), false);
  fs.writeFileSync(`${r.wtB}/src/c.ts`, edit(0, "export const one = 'both';").join("\n") + "\n");
  r.cli(r.wtB, ...deliver);
  assert.match(mergedEvent(r), /^files: src\/a\.ts, src\/c\.ts$/m);
});
