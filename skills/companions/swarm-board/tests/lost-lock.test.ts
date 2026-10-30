// board-split D59 (V-2): a merge lock whose holder goes lost is released by the board at once; the orchestrator and the
// members refused it are told on one line, as a release by its holder would tell them; the work stays on its branch.
import { quietMember } from "./fixtures/quiet-member.ts";
import { tick2 } from "./fixtures/tick2.ts";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board, type Presence } from "../src/board/board.ts";
import { codeVerbs } from "../src/packs/code/calls.ts";

const REPO = "/repos/one/.git";
let dir: string;
let board: Board;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-lost-lock-"));
  board = await openBoard(path.join(dir, "swarm.sqlite"));
});
afterEach(() => {
  board.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const freedLines = () => board.snapshot(REPO).events.filter((e) => e.body.startsWith("the merge lock is free: its holder"));

test("golden V-2 (D59): the lost holder's merge lock is released at once, its waiters and the orchestrator told; a waiter takes it", () => {
  const run = board.openRun({ repo: REPO, kind: "task", group: "g", title: "T", seats: ["w1", "w2"].map((id) => ({ id, blockers: [] })) });
  const w1 = board.join({ run: run.id, seat: "w1", doing: "x", files: [] }).member;
  const w2 = board.join({ run: run.id, seat: "w2", doing: "x", files: [] }).member;
  assert.deepEqual(codeVerbs(board).lockMerge(w2), { granted: true });
  assert.deepEqual(codeVerbs(board).lockMerge(w1), { granted: false, holder: "g/w2" });

  const base = Date.now();
  quietMember(path.join(dir, "swarm.sqlite"), "w2", 120_000);
  const presence: Presence = (m) => (m === "w2" ? { connected: false, lostAt: base - 61_000 } : { connected: true, lostAt: null });
  tick2(board, run.id, new Date(base), presence);

  const freed = freedLines();
  assert.equal(freed.length, 1);
  assert.equal(freed[0].body, "the merge lock is free: its holder g/w2 is lost, its work not merged stays on its branch: @g/w1");
  assert.deepEqual([...(freed[0].mentions ?? [])].sort(), ["g/orchestrator", "g/w1"]);
  // the lock is free: the waiter takes it, nobody waits forever
  assert.deepEqual(codeVerbs(board).lockMerge(w1), { granted: true });
  // the lost seat's next member does not hold it
  const again = board.join({ run: run.id, seat: "w2", doing: "replacement", files: [] }).member;
  assert.equal(board.packCall(again, "held-merge-lock", {}), null);
});

test("a lost member holding no merge lock: no lock line", () => {
  const run = board.openRun({ repo: REPO, kind: "task", group: "g", title: "T", seats: [{ id: "w1", blockers: [] }] });
  board.join({ run: run.id, seat: "w1", doing: "x", files: [] });
  const base = Date.now();
  quietMember(path.join(dir, "swarm.sqlite"), "w1", 120_000);
  tick2(board, run.id, new Date(base), () => ({ connected: false, lostAt: base - 61_000 }));
  assert.equal(board.snapshot(REPO).events.filter((e) => e.event === "lost").length, 1);
  assert.equal(freedLines().length, 0);
});
