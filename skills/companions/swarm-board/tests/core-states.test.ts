// One state per member, the same on every kind of run, from two facts (link up, owes work): working, idle, away,
// lost, ended; a seat reads its member's, or empty.
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
  test(`D36, D49 golden (${kind} run): working owes, idle owes nothing, parked is away, ended; seats read their member`, () => {
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
      orchestrator: { state: "working" },
      a: { state: "working", owes: { phase: "p1", task: task.seq } },
      b: { state: "idle" },
      c: { state: "away" },
      d: { state: "ended" },
    });
    assert.deepEqual(
      board.runs().find((r) => r.id === run.id)!.seats.map((s) => [s.id, s.state]),
      [["a", "working"], ["b", "idle"], ["c", "away"], ["d", "ended"], ["e", "empty"]],
    );
    // F1: the roster reads the parked member away, never its last activity
    const listed = Object.fromEntries(board.roster(REPO).filter((m) => m.plan === group).map((m) => [m.seat, [m.state, m.parked, m.activity]]));
    assert.deepEqual(listed.c, ["away", true, null]);
    void a;
    board.closeRun(run.id);
    assert.ok(Object.values(rosterOf(group)).every((m) => m.state === "ended"), "a closed run: every member ended");
  });
}

test("the state: link up working or idle, link down lost or away by what it owes; parked away; ended first", () => {
  const base = { runOpen: true, ended: false, parked: false, linkDown: false, owes: false };
  assert.equal(coreStateOf({ ...base, owes: true }), "working");
  assert.equal(coreStateOf(base), "idle");
  assert.equal(coreStateOf({ ...base, linkDown: true, owes: true }), "lost");
  assert.equal(coreStateOf({ ...base, linkDown: true }), "away");
  assert.equal(coreStateOf({ ...base, parked: true, owes: true }), "away");
  assert.equal(coreStateOf({ ...base, ended: true, parked: true }), "ended");
  assert.equal(coreStateOf({ ...base, runOpen: false, owes: true }), "ended");
});
