// The unclaimed writes `end` and `merge-lock` print (D72, F24): one summary line; a rename one `old → new` entry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { unclaimedLines } from "../src/cli/unclaimed.ts";

const many = (folder: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${folder}/f${i}.js`);

test("any number of unclaimed writes print as one line: count, first three, …", () => {
  assert.deepEqual(unclaimedLines(["src/a.ts", ...many("dist", 21)]), ["reconciled 22 written without a claim: src/a.ts, dist/f0.js, dist/f1.js, …"]);
});

test("three or fewer: no ellipsis; none: no line", () => {
  assert.deepEqual(unclaimedLines(["a", "b"]), ["reconciled 2 written without a claim: a, b"]);
  assert.deepEqual(unclaimedLines([]), []);
});

test("a rename with an unclaimed side is one old → new entry; both claimed, nothing", () => {
  assert.deepEqual(unclaimedLines(["old.ts", "new.ts"], [["old.ts", "new.ts"]]), ["reconciled 1 written without a claim: old.ts → new.ts"]);
  assert.deepEqual(unclaimedLines(["new.ts"], [["old.ts", "new.ts"]]), ["reconciled 1 written without a claim: old.ts → new.ts"]);
  assert.deepEqual(unclaimedLines([], [["old.ts", "new.ts"]]), []);
});
