// board-split D36, D18: `merging` is the code pack's fact, not a core state: the merge lock's holder reads merging in
// the snapshot instead of working or waiting, and its roster row carries it; the lock released, the core state is back.
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

test("the merge lock's holder reads merging; the one refused it keeps its core state; merged, both are back", () => {
  const run = board.openRun({ repo: REPO, kind: "plan", group: "g", title: "T", seats: ["a", "b"].map((id) => ({ id, blockers: [] })) });
  const a = board.join({ run: run.id, seat: "a", doing: "x", files: [] }).member;
  const b = board.join({ run: run.id, seat: "b", doing: "x", files: [] }).member;
  const before = stateOf("g/a");

  assert.deepEqual(codeVerbs(board).lockMerge(a), { granted: true });
  assert.deepEqual(codeVerbs(board).lockMerge(b), { granted: false, holder: "g/a" });
  assert.equal(stateOf("g/a"), "merging");
  assert.equal(factOf("g/a"), "merging");
  assert.notEqual(stateOf("g/b"), "merging");
  assert.equal(factOf("g/b"), undefined);

  codeVerbs(board).merged(a, "abc1234", []);
  assert.equal(stateOf("g/a"), before);
  assert.equal(factOf("g/a"), undefined);
});

test("a parked or ended holder reads its core state, never merging", () => {
  const run = board.openRun({ repo: REPO, kind: "plan", group: "g", title: "T", seats: [{ id: "a", blockers: [] }] });
  const a = board.join({ run: run.id, seat: "a", doing: "x", files: [] }).member;
  codeVerbs(board).lockMerge(a);
  board.end(a);
  assert.equal(stateOf("g/a"), "ended");
});
