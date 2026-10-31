// simple-states: a member's state from its link, its tokens and what it owed at its drop; the two notifications to
// the orchestrator, `stopped` (no member's tokens moved for the run's window) and `lost`.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board, type Presence } from "../src/board/board.ts";
import type { MemberActivity } from "../src/wire.ts";
import { wakes } from "../src/board/events.ts";
import type { Message } from "../src/board/board.ts";
import { quietMember } from "./fixtures/quiet-member.ts";
import { tick2 } from "./fixtures/tick2.ts";

const REPO = "/repos/stall/.git";
const MIN = 60_000;
/** The run's stall window: `owing`'s runs keep the default, 10 min. */
const WINDOW = 10 * MIN;
let dir: string;
let board: Board;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-stall-"));
  board = await openBoard(path.join(dir, "swarm.sqlite"));
});
afterEach(() => {
  board.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const linked: Presence = () => ({ connected: true, lostAt: null });
const act = (o: Partial<MemberActivity> = {}): MemberActivity => ({ grewAt: null, tokens: 0, context: null, openTool: null, lastTool: null, finished: false, ...o });
const events = (name: string) => board.snapshot(REPO).events.filter((e) => e.event === name);
const stateOf = (seat: string) => board.snapshot(REPO).roster.find((r) => r.member === `g/${seat}`)!.state;

/** A task run with one worker `a`, seated 20 min ago, owing p1, its link up. */
const owing = (): number => {
  const run = board.openRun({ repo: REPO, kind: "task", group: "g", title: "g", seats: [{ id: "a", blockers: [] }] });
  board.join({ run: run.id, seat: "a", doing: "x", files: [] });
  board.phase(board.participant("g/orchestrator")!, "p1", "go");
  quietMember(path.join(dir, "swarm.sqlite"), "a", 20 * MIN);
  board.livenessTick(run.id, new Date(), linked);
  return run.id;
};

test("working while its tokens moved within the window; stopped past it; moving again, working", () => {
  const run = owing();
  board.recordActivity(run, "a", act({ grewAt: Date.now() - 2 * MIN }), new Date());
  assert.equal(stateOf("a"), "working");
  board.recordActivity(run, "a", act({ grewAt: Date.now() - WINDOW - MIN }), new Date());
  assert.equal(stateOf("a"), "stopped");
  board.recordActivity(run, "a", act({ grewAt: Date.now() }), new Date());
  assert.equal(stateOf("a"), "working");
});

test("#51: one call open past the window with no line written reads stopped; its result line brings working back", () => {
  const run = owing();
  const opened = Date.now() - WINDOW - MIN;
  board.recordActivity(run, "a", act({ grewAt: opened, openTool: { name: "PowerShell", target: "Remove-Item x", since: opened } }), new Date());
  assert.equal(stateOf("a"), "stopped");
  board.recordActivity(run, "a", act({ grewAt: Date.now() }), new Date());
  assert.equal(stateOf("a"), "working");
});

test("stopped: once when no member's tokens moved for the window; a move re-arms it; never while paused", () => {
  const run = board.openRun({ repo: REPO, kind: "task", group: "g", title: "g", seats: [{ id: "a", blockers: [] }] }).id;
  board.join({ run, seat: "a", doing: "x", files: [] });
  board.phase(board.participant("g/orchestrator")!, "p1", "go");
  const base = Date.now();
  board.recordActivity(run, "a", act({ grewAt: base }), new Date(base));
  board.livenessTick(run, new Date(base + WINDOW - 1000), linked);
  assert.equal(events("stopped").length, 0);
  board.livenessTick(run, new Date(base + WINDOW + 1000), linked);
  board.livenessTick(run, new Date(base + 3 * WINDOW), linked);
  assert.equal(events("stopped").length, 1, "once per still spell");
  assert.match(events("stopped")[0].body, /^stopped g: no member's tokens moved for \d+ min; phase p1 0\/1 done$/);
  assert.deepEqual(events("stopped")[0].mentions, ["g/orchestrator"]);
  // a move, then still again: told again
  board.recordActivity(run, "a", act({ grewAt: base + 4 * WINDOW }), new Date(base + 4 * WINDOW));
  board.livenessTick(run, new Date(base + 5 * WINDOW + 1000), linked);
  assert.equal(events("stopped").length, 2);
  // paused: never
  board.pause(board.participant("g/orchestrator")!);
  board.recordActivity(run, "a", act({ grewAt: base + 6 * WINDOW }), new Date(base + 6 * WINDOW));
  board.livenessTick(run, new Date(base + 8 * WINDOW), linked);
  assert.equal(events("stopped").length, 2);
});

test("#48: a link dropped owing nothing reads away, and stays away when a phase opens after; dropped owing, lost", () => {
  const run = board.openRun({ repo: REPO, kind: "task", group: "g", title: "g", seats: [{ id: "a", blockers: [] }, { id: "b", blockers: [] }] });
  board.join({ run: run.id, seat: "a", doing: "x", files: [] });
  board.join({ run: run.id, seat: "b", doing: "x", files: [] });
  for (const seat of ["a", "b"]) quietMember(path.join(dir, "swarm.sqlite"), seat, 20 * MIN);
  const orch = board.participant("g/orchestrator")!;
  const base = Date.now();
  const down: Presence = (m) => (m === "a" ? { connected: false, lostAt: base - 2 * MIN } : linked(m));
  // a drops with no phase open: it owes nothing at the drop
  tick2(board, run.id, new Date(base), down);
  assert.equal(stateOf("a"), "away");
  board.phase(orch, "p1", "go");
  tick2(board, run.id, new Date(base + 1000), down);
  assert.equal(stateOf("a"), "away", "a phase opened after the drop leaves it away");
  assert.equal(events("lost").length, 0);
  // b drops owing p1: lost, told once
  const bothDown: Presence = (m) => (m === "a" || m === "b" ? { connected: false, lostAt: base - 2 * MIN } : linked(m));
  tick2(board, run.id, new Date(base + 2000), bothDown);
  assert.equal(stateOf("b"), "lost");
  assert.deepEqual(events("lost").map((e) => e.body), ["lost g/b: its link was lost"]);
  // a's link back: judged afresh at its next drop
  tick2(board, run.id, new Date(base + 3000), (m) => (m === "b" ? { connected: false, lostAt: base - 2 * MIN } : linked(m)));
  tick2(board, run.id, new Date(base + 4000), bothDown);
  assert.equal(stateOf("a"), "lost", "dropped again, now owing p1");
});
