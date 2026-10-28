// What a merge's rebase met, known without the member saying so (US4; plan D3, D5, D13, D33, D36, D41):
// `merge-lock` keeps where the worktree's reflog stands at the grant, `merged` replays the last rebase past
// it. Two members of one run, each in a worktree of one real repository; the answers are read from the
// CLI alone: `merged`'s output, and `swarm stats --run <id> --json`.
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

type Mark = { what: string; path?: string };
type Member = { member: string; marks: Mark[]; intervals: { from: string; what: string }[] };
type RunFigures = { plan: { conflicts: { known: number | null; inShared: number | null; unknownMerges: number | null } }; members: Member[] };
const runStats = (r: Repo, id: number): RunFigures => JSON.parse(r.cli(r.repo, "stats", "--run", String(id), "--json")).runs[0];
const conflictMarks = (run: RunFigures, member: string): string[] =>
  run.members.find((m) => m.member === member)!.marks.filter((m) => m.what === "conflict").map((m) => m.path!);

const TELL_S3 = (file: string) => `if you resolved a conflict in ${file}, tell them: swarm post "@review-tool/S3 I resolved ${file}: <how>" --about ${file}`;

/** S5 edits `file` on its branch, main edits the same line, S5 takes the lock, then rebases and resolves the conflict. */
const conflictAfterGrant = (r: Repo, file: string): string => {
  r.commitFile(r.wtB, file, edit(0, "export const one = 'b';"));
  r.commitFile(r.repo, file, edit(0, "export const one = 'main';"));
  r.cli(r.wtB, "merge-lock", "--onto", "main");
  assert.deepEqual(r.rebaseOntoMain(r.wtB, { [file]: edit(0, "export const one = 'both';") }).conflicted, [file]);
  return r.git(r.wtB, "rev-parse", "HEAD").trim();
};

test("a conflicting rebase after the grant records its file and tells its holder (US4, D3, D5)", () => {
  const r = fresh();
  const id = openTwoRunners(r);
  const sha = conflictAfterGrant(r, "src/a.ts");
  const out = r.cli(r.wtB, "merged", sha, "--files", "src/a.ts");
  assert.deepEqual(tellLines(out), [TELL_S3("src/a.ts")]);
  const run = runStats(r, id);
  assert.deepEqual(conflictMarks(run, "review-tool/S5"), ["src/a.ts"]);
  assert.deepEqual(run.plan.conflicts, { known: 1, inShared: 1, unknownMerges: 0 });
});

test("a clean rebase, or none since the grant, records no conflict and prints no tell line (D3, D5)", () => {
  const r = fresh();
  const id = openTwoRunners(r);
  // a clean rebase: both sides edit the shared file, at its two ends
  r.commitFile(r.wtB, "src/a.ts", edit(4, "export const five = 'b';"));
  r.commitFile(r.repo, "src/a.ts", edit(0, "export const one = 'main';"));
  r.cli(r.wtB, "merge-lock", "--onto", "main");
  assert.deepEqual(r.rebaseOntoMain(r.wtB).conflicted, []);
  const clean = r.cli(r.wtB, "merged", r.git(r.wtB, "rev-parse", "HEAD").trim(), "--files", "src/a.ts");
  assert.deepEqual(tellLines(clean), []);
  // none since the grant: S3 merges the file S5 now holds too, without a rebase
  r.commitFile(r.wtA, "src/a.ts", edit(2, "export const three = 'a';"));
  r.cli(r.wtA, "merge-lock", "--onto", "main");
  const none = r.cli(r.wtA, "merged", r.git(r.wtA, "rev-parse", "HEAD").trim(), "--files", "src/a.ts");
  assert.deepEqual(tellLines(none), []);
  const run = runStats(r, id);
  assert.deepEqual(conflictMarks(run, "review-tool/S5"), []);
  assert.deepEqual(conflictMarks(run, "review-tool/S3"), []);
  assert.deepEqual(run.plan.conflicts, { known: 0, inShared: 0, unknownMerges: 0 });
});

/** The second of the rebase's start in the worktree's reflog, from git's own record. */
const rebaseStartSecond = (r: Repo, wt: string): number => {
  const line = r
    .git(wt, "reflog", "show", "--date=unix", "--format=%gd%x09%gs", "HEAD")
    .split(/\r?\n/)
    .find((l) => /\trebase \(start\):/.test(l))!;
  return Number(line.match(/@\{(\d+)\}/)![1]);
};
/** Waits, busily, until a second has just begun. */
const atSecondStart = (): void => {
  while (Date.now() % 1000 > 30) {
    /* the second's start */
  }
};

test("a rebase in the grant's own second, before the grant, is not replayed (D36)", () => {
  // the rebase and the grant must share one second: arranged at a second's start, checked, and tried again otherwise
  for (let attempt = 1; ; attempt++) {
    const r = fresh();
    const id = openTwoRunners(r);
    r.commitFile(r.wtB, "src/a.ts", edit(0, "export const one = 'b';"));
    r.commitFile(r.repo, "src/a.ts", edit(0, "export const one = 'main';"));
    atSecondStart();
    assert.deepEqual(r.rebaseOntoMain(r.wtB, { "src/a.ts": edit(0, "export const one = 'both';") }).conflicted, ["src/a.ts"]);
    r.cli(r.wtB, "merge-lock", "--onto", "main");
    const out = r.cli(r.wtB, "merged", r.git(r.wtB, "rev-parse", "HEAD").trim(), "--files", "src/a.ts");
    const run = runStats(r, id);
    const granted = run.members.find((m) => m.member === "review-tool/S5")!.intervals.find((i) => i.what === "merging")!;
    if (Math.floor(Date.parse(granted.from) / 1000) !== rebaseStartSecond(r, r.wtB)) {
      assert.ok(attempt < 5, "the rebase and the grant never shared a second");
      continue;
    }
    assert.deepEqual(tellLines(out), []);
    assert.deepEqual(conflictMarks(run, "review-tool/S5"), [], "files: []");
    assert.deepEqual(run.plan.conflicts, { known: 0, inShared: 0, unknownMerges: 0 });
    return;
  }
});

test("a conflicted file nobody else held prints no tell line (D5)", () => {
  const r = fresh();
  const id = openTwoRunners(r);
  const sha = conflictAfterGrant(r, "src/old.ts");
  const out = r.cli(r.wtB, "merged", sha, "--files", "src/old.ts");
  assert.deepEqual(tellLines(out), []);
  const run = runStats(r, id);
  assert.deepEqual(conflictMarks(run, "review-tool/S5"), ["src/old.ts"], "the conflict is still recorded");
  assert.deepEqual(run.plan.conflicts, { known: 1, inShared: 0, unknownMerges: 0 });
});

test("an old git records the merge as unknown, `merged` succeeds with today's tell line per shared file (US4, D13, D41)", () => {
  const r = fresh();
  const id = openTwoRunners(r);
  // S3 holds src/a.ts from its join and src/c.ts by a claim; src/old.ts only S5 touches
  r.cli(r.wtA, "claim", "src/c.ts");
  fs.writeFileSync(path.join(r.wtB, "src", "a.ts"), "export const b = 1;\n");
  fs.writeFileSync(path.join(r.wtB, "src", "c.ts"), "export const b = 1;\n");
  r.commitFile(r.wtB, "src/old.ts", edit(0, "export const one = 'b';"));
  const lock = r.swarm(r.wtB, ["merge-lock", "--onto", "main"], { oldGit: true });
  assert.equal(lock.status, 0, lock.stderr);
  const sha = r.git(r.wtB, "rev-parse", "HEAD").trim();
  const merged = r.swarm(r.wtB, ["merged", sha, "--files", "src/a.ts", "src/c.ts", "src/old.ts"], { oldGit: true });
  assert.equal(merged.status, 0, merged.stderr);
  assert.deepEqual(tellLines(merged.stdout), [TELL_S3("src/a.ts"), TELL_S3("src/c.ts")]);
  const run = runStats(r, id);
  assert.deepEqual(run.plan.conflicts, { known: 0, inShared: 0, unknownMerges: 1 });
  assert.deepEqual(conflictMarks(run, "review-tool/S5"), []);
});

test("a merger with no worktree records unknown (D33)", () => {
  const r = fresh();
  const id = openTwoRunners(r);
  const plain = path.join(r.home, "plain");
  fs.mkdirSync(plain);
  assert.notEqual(spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: plain }).status, 0, "setup: the folder is no worktree");
  r.cli(r.repo, "seat", "add", "S7", "--run", String(id), "--title", "the docs");
  r.cli(plain, "join", "--run", String(id), "--seat", "S7", "--doing", "the docs");
  r.cli(plain, "merge-lock", "--onto", "main", "--as", "review-tool/S7");
  const out = r.cli(plain, "merged", "abc123", "--files", path.join(r.repo, "src", "a.ts"), "--as", "review-tool/S7");
  assert.match(out, /^merged abc123: lock released$/m);
  assert.deepEqual(runStats(r, id).plan.conflicts, { known: 0, inShared: 0, unknownMerges: 1 });
});

test("`merged`'s output, human and `--json`, carries no new field or line (D25)", () => {
  const human = fresh();
  openTwoRunners(human);
  const sha = conflictAfterGrant(human, "src/a.ts");
  const out = human.cli(human.wtB, "merged", sha, "--files", "src/a.ts");
  assert.equal(out, `merged ${sha}: lock released\n${TELL_S3("src/a.ts")}\n`);

  const json = fresh();
  openTwoRunners(json);
  const sha2 = conflictAfterGrant(json, "src/a.ts");
  assert.deepEqual(JSON.parse(json.cli(json.wtB, "merged", sha2, "--files", "src/a.ts", "--json")), {
    member: "review-tool/S5",
    sha: sha2,
    files: ["src/a.ts"],
    tell: [TELL_S3("src/a.ts")],
  });
});
