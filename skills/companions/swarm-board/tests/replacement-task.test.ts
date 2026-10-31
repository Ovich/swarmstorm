// break-flow T68 (V-25, plan D72): a member joining a seat whose previous member ended or went lost is shown the seat's
// latest task, whatever that member posted after it.
import { quietMember } from "./fixtures/quiet-member.ts";
import { tick2 } from "./fixtures/tick2.ts";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board } from "../src/board/board.ts";

const REPO = "/repos/replace/.git";
let dir: string;
let board: Board;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-replace-"));
  board = await openBoard(path.join(dir, "swarm.sqlite"));
});
afterEach(() => {
  board.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

/** A task run, seat w1 handed a task it read, then asked the orchestrator about it. */
const taskedAndAsked = () => {
  const run = board.openRun({ repo: REPO, kind: "task", group: "g", title: "g", seats: [{ id: "w1", blockers: [] }] });
  const w1 = board.join({ run: run.id, seat: "w1", doing: "x", files: [] }).member;
  const orch = board.participant("g/orchestrator")!;
  const task = board.post(orch, "@w1 do the thing", { task: true });
  board.deliver(w1);
  board.post(w1, "@orchestrator should it also touch c.txt?");
  return { run: run.id, w1, orch, task };
};

const shownSeqs = (member: Parameters<Board["deliver"]>[0]) => board.deliver(member).full.map((m) => m.seq);

test("golden V-25 (D72): after end --seat, the replacement is shown the task though its predecessor posted to the orchestrator", () => {
  const { run, w1, task } = taskedAndAsked();
  // end --seat ends the seat's member as the orchestrator's word
  board.end(w1);
  const again = board.join({ run, seat: "w1", doing: "replacing", files: [] }).member;
  assert.ok(shownSeqs(again).includes(task.seq), "the seat's task is shown to the replacement");
});

test("golden V-25 (D72): a replacement joining a lost member's seat is shown the task too", () => {
  const { run, orch, task } = taskedAndAsked();
  // its question counts as its report: it owes the open phase instead, so its link down is lost, not away
  board.phase(orch, "p", "go");
  const base = Date.now();
  quietMember(path.join(dir, "swarm.sqlite"), "w1", 120_000);
  tick2(board, run, new Date(base), () => ({ connected: false, lostAt: base - 61_000 }));
  assert.equal(board.snapshot(REPO).events.filter((e) => e.event === "lost").length, 1, "w1 lost");
  const again = board.join({ run, seat: "w1", doing: "replacing", files: [] }).member;
  assert.ok(shownSeqs(again).includes(task.seq), "the seat's task is shown to the replacement");
});

test("the same member joining again while seated and not lost is not shown its task again", () => {
  const { run, task } = taskedAndAsked();
  const again = board.join({ run, seat: "w1", doing: "still here", files: [] }).member;
  assert.ok(!shownSeqs(again).includes(task.seq));
});
