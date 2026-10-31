// board-split D36, D18: `merging` is the code pack's fact, never a state: the merge lock's holder keeps its state, and
// its snapshot card and roster row carry `fact: merging` beside it; the lock released, the fact is gone.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board } from "../src/board/board.ts";
import { codeVerbs } from "../src/packs/code/calls.ts";

const REPO = "/repos/one/.git";
let dir: string;
let board: Board;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-merging-"));
  board = await openBoard(path.join(dir, "swarm.sqlite"));
});
afterEach(() => {
  board.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const stateOf = (member: string) => board.snapshot(REPO).roster.find((r) => r.member === member)!.state;
const factOf = (member: string) => board.roster(REPO).find((r) => r.name === member)!.fact;
const cardFactOf = (member: string) => board.snapshot(REPO).roster.find((r) => r.member === member)!.fact;

test("the merge lock's holder keeps its state and carries the merging fact; the one refused it carries none; merged, the fact is gone", () => {
  const run = board.openRun({ repo: REPO, kind: "plan", group: "g", title: "T", seats: ["a", "b"].map((id) => ({ id, blockers: [] })) });
  const a = board.join({ run: run.id, seat: "a", doing: "x", files: [] }).member;
  const b = board.join({ run: run.id, seat: "b", doing: "x", files: [] }).member;
  const before = stateOf("g/a");

  assert.deepEqual(codeVerbs(board).lockMerge(a), { granted: true });
  assert.deepEqual(codeVerbs(board).lockMerge(b), { granted: false, holder: "g/a" });
  assert.equal(stateOf("g/a"), before);
  assert.equal(cardFactOf("g/a"), "merging");
  assert.equal(factOf("g/a"), "merging");
  assert.equal(cardFactOf("g/b"), undefined);
  assert.equal(factOf("g/b"), undefined);

  codeVerbs(board).merged(a, "abc1234", []);
  assert.equal(stateOf("g/a"), before);
  assert.equal(cardFactOf("g/a"), undefined);
  assert.equal(factOf("g/a"), undefined);
});

test("an ended holder reads ended, no merging fact", () => {
  const run = board.openRun({ repo: REPO, kind: "plan", group: "g", title: "T", seats: [{ id: "a", blockers: [] }] });
  const a = board.join({ run: run.id, seat: "a", doing: "x", files: [] }).member;
  codeVerbs(board).lockMerge(a);
  board.end(a);
  assert.equal(stateOf("g/a"), "ended");
  assert.equal(cardFactOf("g/a"), undefined);
});
