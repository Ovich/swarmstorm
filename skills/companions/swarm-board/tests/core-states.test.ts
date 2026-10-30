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
  test(`D36, D49 golden (${kind} run): working owes the phase and its task, waiting owes nothing, parked, ended; seats derived`, () => {
    const group = `g-${kind}`;
    const run = board.openRun({ repo: REPO, kind, group, title: "T", seats: ["a", "b", "c", "d", "e"].map((id) => ({ id, blockers: [] })) });
    const [a, b, c, d] = ["a", "b", "c", "d"].map((seat) => board.join({ run: run.id, seat, doing: "x", files: [] }).member);
    const orch = board.participant(`${group}/orchestrator`)!;
    board.phase(orch, "p1", "go");
    const task = board.post(orch, `@${group}/a do the thing`, { task: true });
    // D50: a post that only mentions a is never its task
    board.post(orch, `@${group}/a judged`);
    board.done(b, "p1");
    board.park(orch, "c", "p2");
    board.end(d);
    assert.deepEqual(rosterOf(group), {
      orchestrator: { state: "waiting" },
      a: { state: "working", owes: { phase: "p1", task: task.seq } },
      // D49: done but in no held wait is working; state never reads the phase
      b: { state: "working" },
      c: { state: "parked" },
      d: { state: "ended" },
    });
    assert.deepEqual(
      board.runs().find((r) => r.id === run.id)!.seats.map((s) => [s.id, s.state]),
      [["a", "running"], ["b", "running"], ["c", "ready"], ["d", "done"], ["e", "ready"]],
    );
    // F1: the roster (what roster and status print) reads the parked member parked, never its last activity
    const listed = Object.fromEntries(board.roster(REPO).filter((m) => m.plan === group).map((m) => [m.seat, [m.state, m.activity]]));
    assert.deepEqual(listed.c, ["parked", null]);
    void a;
    board.closeRun(run.id);
    assert.ok(Object.values(rosterOf(group)).every((m) => m.state === "ended"), "a closed run: every member ended");
  });
}

test("D49: in a held board wait is waiting, any other is working, whatever the phase; ended over parked", () => {
  const base = { orchestrator: false, runOpen: true, ended: false, parked: false };
  assert.equal(coreStateOf({ ...base, inHeldWait: true }), "waiting");
  assert.equal(coreStateOf({ ...base, inHeldWait: false }), "working");
  assert.equal(coreStateOf({ ...base, parked: true, inHeldWait: true }), "parked");
  assert.equal(coreStateOf({ ...base, orchestrator: true, inHeldWait: false }), "waiting");
  // D49: ended (or its run closed) before parked
  assert.equal(coreStateOf({ ...base, ended: true, parked: true, inHeldWait: false }), "ended");
  assert.equal(coreStateOf({ ...base, runOpen: false, inHeldWait: true }), "ended");
});
