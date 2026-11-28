// conflictsOf on a real repository, read-only (plan D3, D13, D33, D36): the last rebase past the reflog
// mark, replayed against the commit it started onto; what git cannot answer reads unknown, never a throw.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { conflictsOf, headReflogLength } from "../src/cli/verbs/code/conflicts.ts";
import { LINES, makeRepo, type Repo } from "./fixtures/worktrees.ts";

let repos: Repo[] = [];
const fresh = (): Repo => {
  const r = makeRepo("swarm-conflicts-");
  repos.push(r);
  return r;
};
afterEach(() => {
  for (const r of repos) r.cleanup();
  repos = [];
});

const edit = (i: number, text: string): string[] => LINES.map((l, k) => (k === i ? text : l));

test("the last of two rebases past the mark is replayed, against the commit it started onto (D33)", () => {
  const r = fresh();
  const mark = headReflogLength(r.wtB)!;
  // the branch edits a.ts, c.ts and old.ts on their first line
  r.commitFile(r.wtB, "src/a.ts", edit(0, "export const one = 'b';"));
  r.commitFile(r.wtB, "src/c.ts", edit(0, "export const one = 'b';"));
  r.commitFile(r.wtB, "src/old.ts", edit(0, "export const one = 'b';"));
  // the first rebase meets a.ts
  r.commitFile(r.repo, "src/a.ts", edit(0, "export const one = 'main';"));
  assert.deepEqual(r.rebaseOntoMain(r.wtB, { "src/a.ts": edit(0, "export const one = 'both';") }).conflicted, ["src/a.ts"]);
  // the second meets c.ts only
  r.commitFile(r.repo, "src/c.ts", edit(0, "export const one = 'main';"));
  assert.deepEqual(r.rebaseOntoMain(r.wtB, { "src/c.ts": edit(0, "export const one = 'both';") }).conflicted, ["src/c.ts"]);
  // main moves on past the second rebase's start: old.ts would conflict against main's tip, not against that start
  r.commitFile(r.repo, "src/old.ts", edit(0, "export const one = 'main';"));
  assert.deepEqual(conflictsOf(r.wtB, "main", mark), { files: ["src/c.ts"] });
});

test("a mark past the reflog's end reads unknown no-reflog (D33)", () => {
  const r = fresh();
  const length = headReflogLength(r.wtB)!;
  assert.deepEqual(conflictsOf(r.wtB, "main", length + 5), { unknown: "no-reflog" });
});

test("it never throws: a folder that is no repository reads unknown (D13)", () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-norepo-"));
  try {
    let answer: ReturnType<typeof conflictsOf> | undefined;
    assert.doesNotThrow(() => {
      answer = conflictsOf(plain, "main", 0);
    });
    assert.ok(answer && "unknown" in answer, JSON.stringify(answer));
    assert.doesNotThrow(() => conflictsOf(path.join(plain, "missing"), "main", 3));
  } finally {
    fs.rmSync(plain, { recursive: true, force: true });
  }
});
