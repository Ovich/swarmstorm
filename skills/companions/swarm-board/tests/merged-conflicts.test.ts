// What a merge's rebase met, known without the member saying so (US4; plan D3, D5, D13, D33, D36, D41):
// `merge-lock` keeps where the worktree's reflog stands at the grant, `merged` replays the last rebase past
// it. Two members of one run, each in a worktree of one real repository; the answers are read from the
// CLI alone: `merged`'s output.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { LINES, makeRepo, openTwoRunners, tellLines, type Repo } from "./fixtures/worktrees.ts";

let repos: Repo[] = [];
const fresh = (): Repo => {
  const r = makeRepo();
  repos.push(r);
  return r;
};
afterEach(() => {
  for (const r of repos) r.cleanup();
  repos = [];
});

/** LINES with line `i` replaced. */
const edit = (i: number, text: string): string[] => LINES.map((l, k) => (k === i ? text : l));

const TELL_S3 = (file: string) => `if you resolved a conflict in ${file}, tell them: swarm post "@review-tool/S3 I resolved ${file}: <how>" --about ${file}`;

/** S5 edits `file` on its branch, main edits the same line, S5 takes the lock, then rebases and resolves the conflict. */
const conflictAfterGrant = (r: Repo, file: string): string => {
  r.commitFile(r.wtB, file, edit(0, "export const one = 'b';"));
  r.commitFile(r.repo, file, edit(0, "export const one = 'main';"));
  r.cli(r.wtB, "merge-lock", "--onto", "main");
  assert.deepEqual(r.rebaseOntoMain(r.wtB, { [file]: edit(0, "export const one = 'both';") }).conflicted, [file]);
  return r.git(r.wtB, "rev-parse", "HEAD").trim();
};

test("a conflicting rebase after the grant tells its holder (US4, D3, D5)", () => {
  const r = fresh();
  openTwoRunners(r);
  const sha = conflictAfterGrant(r, "src/a.ts");
  const out = r.cli(r.wtB, "merged", "--report", "-", sha, "--files", "src/a.ts");
  assert.deepEqual(tellLines(out), [TELL_S3("src/a.ts")]);
});

test("a clean rebase, or none since the grant, prints no tell line (D3, D5)", () => {
  const r = fresh();
  openTwoRunners(r);
  // a clean rebase: both sides edit the shared file, at its two ends
  r.commitFile(r.wtB, "src/a.ts", edit(4, "export const five = 'b';"));
  r.commitFile(r.repo, "src/a.ts", edit(0, "export const one = 'main';"));
  r.cli(r.wtB, "merge-lock", "--onto", "main");
  assert.deepEqual(r.rebaseOntoMain(r.wtB).conflicted, []);
  const clean = r.cli(r.wtB, "merged", "--report", "-", r.git(r.wtB, "rev-parse", "HEAD").trim(), "--files", "src/a.ts");
  assert.deepEqual(tellLines(clean), []);
  // none since the grant: S3 merges the file S5 now holds too, without a rebase
  r.commitFile(r.wtA, "src/a.ts", edit(2, "export const three = 'a';"));
  r.cli(r.wtA, "merge-lock", "--onto", "main");
  const none = r.cli(r.wtA, "merged", "--report", "-", r.git(r.wtA, "rev-parse", "HEAD").trim(), "--files", "src/a.ts");
  assert.deepEqual(tellLines(none), []);
});

/** The second of the rebase's start in the worktree's reflog, from git's own record. */
const rebaseStartSecond = (r: Repo, wt: string): number => {
  const line = r
    .git(wt, "reflog", "show", "--date=unix", "--format=%gd%x09%gs", "HEAD")
    .split(/\r?\n/)
    .find((l) => /\trebase \(start\):/.test(l))!;
  return Number(line.match(/@\{(\d+)\}/)![1]);
};
/** Sets every rebase entry of the worktree's HEAD reflog to `second`: the test's own clock for the rebase, so it shares
 *  the grant's second however slow the machine (a reflog line ends `<unix> <tz>` before its tab and subject). */
const rebaseAt = (r: Repo, wt: string, second: number): void => {
  const log = path.resolve(wt, r.git(wt, "rev-parse", "--git-path", "logs/HEAD").trim());
  const lines = fs.readFileSync(log, "utf8").split("\n");
  const dated = lines.map((l) => (/\trebase/.test(l) ? l.replace(/ \d+ ([+-]\d{4})\t/, ` ${second} $1\t`) : l));
  fs.writeFileSync(log, dated.join("\n"));
};

test("a rebase in the grant's own second, before the grant, is not replayed (D36)", () => {
  const r = fresh();
  openTwoRunners(r);
  r.commitFile(r.wtB, "src/a.ts", edit(0, "export const one = 'b';"));
  r.commitFile(r.repo, "src/a.ts", edit(0, "export const one = 'main';"));
  assert.deepEqual(r.rebaseOntoMain(r.wtB, { "src/a.ts": edit(0, "export const one = 'both';") }).conflicted, ["src/a.ts"]);
  // the rebase and the grant share one second: the rebase's entries dated at the grant's second, read just before it
  const grantSecond = Math.floor(Date.now() / 1000);
  r.cli(r.wtB, "merge-lock", "--onto", "main");
  rebaseAt(r, r.wtB, grantSecond);
  assert.equal(rebaseStartSecond(r, r.wtB), grantSecond);
  const out = r.cli(r.wtB, "merged", "--report", "-", r.git(r.wtB, "rev-parse", "HEAD").trim(), "--files", "src/a.ts");
  assert.deepEqual(tellLines(out), []);
});

test("a conflicted file nobody else held prints no tell line (D5)", () => {
  const r = fresh();
  openTwoRunners(r);
  const sha = conflictAfterGrant(r, "src/old.ts");
  const out = r.cli(r.wtB, "merged", "--report", "-", sha, "--files", "src/old.ts");
  assert.deepEqual(tellLines(out), []);
});

test("an old git: `merged` succeeds with today's tell line per shared file (US4, D13, D41)", () => {
  const r = fresh();
  openTwoRunners(r);
  // S3 holds src/a.ts from its join and src/c.ts by a claim; src/old.ts only S5 touches
  r.cli(r.wtA, "claim", "src/c.ts");
  fs.writeFileSync(path.join(r.wtB, "src", "a.ts"), "export const b = 1;\n");
  fs.writeFileSync(path.join(r.wtB, "src", "c.ts"), "export const b = 1;\n");
  r.commitFile(r.wtB, "src/old.ts", edit(0, "export const one = 'b';"));
  const lock = r.swarm(r.wtB, ["merge-lock", "--onto", "main"], { oldGit: true });
  assert.equal(lock.status, 0, lock.stderr);
  const sha = r.git(r.wtB, "rev-parse", "HEAD").trim();
  const merged = r.swarm(r.wtB, ["merged", "--report", "-", sha, "--files", "src/a.ts", "src/c.ts", "src/old.ts"], { oldGit: true });
  assert.equal(merged.status, 0, merged.stderr);
  assert.deepEqual(tellLines(merged.stdout), [TELL_S3("src/a.ts"), TELL_S3("src/c.ts")]);
});

test("a merger with no worktree merges, no tell line (D33)", () => {
  const r = fresh();
  const id = openTwoRunners(r);
  const plain = path.join(r.home, "plain");
  fs.mkdirSync(plain);
  assert.notEqual(spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: plain }).status, 0, "setup: the folder is no worktree");
  r.cli(r.repo, "seat", "add", "S7", "--run", String(id), "--title", "the docs");
  r.cli(plain, "join", "--run", String(id), "--seat", "S7", "--doing", "the docs");
  r.cli(plain, "merge-lock", "--onto", "main", "--as", "review-tool/S7");
  const out = r.cli(plain, "merged", "--report", "-", "abc123", "--files", path.join(r.repo, "src", "a.ts"), "--as", "review-tool/S7");
  assert.match(out, /^merged abc123: lock released$/m);
});

test("`merged`'s output, human and `--json`, carries no new field or line (D25)", () => {
  const human = fresh();
  openTwoRunners(human);
  const sha = conflictAfterGrant(human, "src/a.ts");
  const out = human.cli(human.wtB, "merged", "--report", "-", sha, "--files", "src/a.ts");
  assert.equal(out, `merged ${sha}: lock released\n${TELL_S3("src/a.ts")}\n`);

  const json = fresh();
  openTwoRunners(json);
  const sha2 = conflictAfterGrant(json, "src/a.ts");
  assert.deepEqual(JSON.parse(json.cli(json.wtB, "merged", "--report", "-", sha2, "--files", "src/a.ts", "--json")), {
    member: "review-tool/S5",
    sha: sha2,
    files: ["src/a.ts"],
    tell: [TELL_S3("src/a.ts")],
  });
});
