// One state per member, the same on every kind of run, from its link, its tokens and what it owed at its drop:
// working, stopped, away, lost, ended; a seat reads its member's, or empty.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board } from "../src/board/board.ts";
import { coreStateOf } from "../src/board/liveness.ts";
import { quietMember } from "./fixtures/quiet-member.ts";

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
  Object.fromEntries(board.snapshot(REPO).roster.filter((r) => r.plan === group).map((r) => [r.seat, { state: r.state }]));

for (const kind of ["plan", "brainstorm"] as const) {
  test(`D36, D49 golden (${kind} run): working moves, stopped does not, ended; seats read their member`, () => {
    const group = `g-${kind}`;
    const run = board.openRun({ repo: REPO, kind, group, title: "T", seats: ["a", "b", "c", "d", "e"].map((id) => ({ id, blockers: [] })) });
    const [a, b, c, d] = ["a", "b", "c", "d"].map((seat) => board.join({ run: run.id, seat, doing: "x", files: [] }).member);
    const orch = board.participant(`${group}/orchestrator`)!;
    board.phase(orch, "p1", "go");
    board.done(b, "p1");
    board.end(d);
    // b's tokens last moved 15 min ago, its link up
    quietMember(path.join(dir, "swarm.sqlite"), "b", 20 * 60_000);
    board.recordActivity(run.id, "b", { grewAt: Date.now() - 15 * 60_000, tokens: 0, context: null, openTool: null, lastTool: null, finished: false }, new Date());
    board.livenessTick(run.id, new Date(), () => ({ connected: true, lostAt: null }));
    assert.deepEqual(rosterOf(group), {
      orchestrator: { state: "working" },
      a: { state: "working" },
      b: { state: "stopped" },
      c: { state: "working" },
      d: { state: "ended" },
    });
    assert.deepEqual(
      board.runs().find((r) => r.id === run.id)!.seats.map((s) => [s.id, s.state]),
      [["a", "working"], ["b", "stopped"], ["c", "working"], ["d", "ended"], ["e", "empty"]],
    );
    void a;
    board.closeRun(run.id);
    assert.ok(Object.values(rosterOf(group)).every((m) => m.state === "ended"), "a closed run: every member ended");
  });
}

test("the state: link up working or stopped by its tokens, link down lost or away by what it owed at the drop; ended first", () => {
  const base = { runOpen: true, ended: false, linkDown: false, owedAtDrop: false, moving: false };
  assert.equal(coreStateOf({ ...base, moving: true }), "working");
  assert.equal(coreStateOf(base), "stopped");
  assert.equal(coreStateOf({ ...base, linkDown: true, owedAtDrop: true }), "lost");
  assert.equal(coreStateOf({ ...base, linkDown: true }), "away");
  assert.equal(coreStateOf({ ...base, ended: true }), "ended");
  assert.equal(coreStateOf({ ...base, runOpen: false, moving: true }), "ended");
});
