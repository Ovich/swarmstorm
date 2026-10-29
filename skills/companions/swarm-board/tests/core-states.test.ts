// board-split D36: one core state per member, the same on a code run and a brainstorm run: working, waiting,
// parked, ended; a seat's ready/running/done derived from its member.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board } from "../src/board/board.ts";
import { coreStateOf } from "../src/board/liveness.ts";

const REPO = "/repos/one/.git";
let dir: string;
let board: Board;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-states-"));
  board = await openBoard(path.join(dir, "swarm.sqlite"));
});
afterEach(() => {
  board.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const rosterOf = (group: string) =>
  Object.fromEntries(board.snapshot(REPO).roster.filter((r) => r.plan === group).map((r) => [r.seat, { state: r.state, ...(r.owes ? { owes: r.owes } : {}) }]));

for (const kind of ["plan", "brainstorm"] as const) {
  test(`D36 golden (${kind} run): working owes the phase and its task, waiting owes nothing, parked, ended; seats derived`, () => {
    const group = `g-${kind}`;
    const run = board.openRun({ repo: REPO, kind, group, title: "T", seats: ["a", "b", "c", "d", "e"].map((id) => ({ id, blockers: [] })) });
    const [a, b, c, d] = ["a", "b", "c", "d"].map((seat) => board.join({ run: run.id, seat, doing: "x", files: [] }).member);
    const orch = board.participant(`${group}/orchestrator`)!;
    board.phase(orch, "p1", "go");
    const task = board.post(orch, `@${group}/a do the thing`);
    board.done(b, "p1");
    board.park(orch, "c", "p2");
    board.end(d);
    assert.deepEqual(rosterOf(group), {
      orchestrator: { state: "waiting" },
      a: { state: "working", owes: { phase: "p1", task: task.seq } },
      b: { state: "waiting" },
      c: { state: "parked" },
      d: { state: "ended" },
    });
    assert.deepEqual(
      board.runs().find((r) => r.id === run.id)!.seats.map((s) => [s.id, s.state]),
      [["a", "running"], ["b", "running"], ["c", "running"], ["d", "done"], ["e", "ready"]],
    );
    void a;
    board.closeRun(run.id);
    assert.ok(Object.values(rosterOf(group)).every((m) => m.state === "ended"), "a closed run: every member ended");
  });
}

test("D36: with no phase open, a member in a board wait is waiting, any other is working", () => {
  const base = { orchestrator: false, runOpen: true, ended: false, dormant: false, parked: false, phaseOpen: false, owes: false };
  assert.equal(coreStateOf({ ...base, inBoardWait: true }), "waiting");
  assert.equal(coreStateOf({ ...base, inBoardWait: false }), "working");
  // a phase open decides by the owing alone, a wait while owing is still working
  assert.equal(coreStateOf({ ...base, phaseOpen: true, owes: true, inBoardWait: true }), "working");
  // an idle-ended dormant seat is parked, not ended
  assert.equal(coreStateOf({ ...base, ended: true, dormant: true, inBoardWait: false }), "parked");
});
