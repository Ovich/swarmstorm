// board-split D55: `stalled` as a pure function of the facts (each branch), the one reason formatter, and the
// episodes the tick keeps: a badge only after two consecutive ticks, one alarm per episode, one recovered.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board, type Participant, type Presence } from "../src/board/board.ts";
import { BUSY_MAX_MS, SILENT_MS, STALL_MS_DEFAULT } from "../src/board/liveness.ts";
import { reasonOf, stalledOf, type StallFacts } from "../src/board/stall.ts";
import type { MemberActivity } from "../src/wire.ts";

const T0 = 1_800_000_000_000;
const MIN = 60_000;
/** A member owing p1, its task delivered at T0, out of any wait, nothing open, its last sign at T0. */
const facts = (o: Partial<StallFacts> = {}): StallFacts => ({
  shownState: "working",
  owes: "p1",
  taskDeliveredAt: T0,
  clockFloorAt: T0 - MIN,
  inHeldWait: false,
  openCallSince: null,
  background: null,
  transcriptGrewAt: null,
  signAt: T0,
  stallMs: STALL_MS_DEFAULT,
  silentMs: SILENT_MS,
  busyMaxMs: BUSY_MAX_MS,
  lockStall: null,
  ...o,
});

test("stalledOf, held wait: owing in a held wait past the stall window from the task, never from the wait's own re-arm", () => {
  const f = facts({ inHeldWait: true, shownState: "waiting" });
  assert.equal(stalledOf(f, T0 + STALL_MS_DEFAULT - 1), null);
  assert.deepEqual(stalledOf(f, T0 + STALL_MS_DEFAULT), { rule: "owing", since: T0, fact: "not done p1, in a wait" });
  // a phase opened or a resume after the task moves the floor
  assert.equal(stalledOf({ ...f, clockFloorAt: T0 + MIN }, T0 + STALL_MS_DEFAULT), null);
});

test("stalledOf, silent: out of a wait, nothing open, no sign and no growth past SILENT_MS", () => {
  assert.equal(stalledOf(facts(), T0 + SILENT_MS - 1), null);
  assert.deepEqual(stalledOf(facts(), T0 + SILENT_MS), { rule: "silent", since: T0, fact: "not done p1, no activity" });
  // growth seconds old: never stalled, however old its last board call
  assert.equal(stalledOf(facts({ signAt: T0 - 60 * MIN, transcriptGrewAt: T0 + SILENT_MS - 3000 }), T0 + SILENT_MS), null);
});

test("stalledOf, call: an open call or a background task with no growth past BUSY_MAX_MS; growth keeps it work", () => {
  const call = facts({ openCallSince: T0, shownState: "busy" });
  assert.equal(stalledOf(call, T0 + BUSY_MAX_MS - 1), null);
  assert.deepEqual(stalledOf(call, T0 + BUSY_MAX_MS), { rule: "call", since: T0, fact: "not done p1, a call open, no growth" });
  assert.equal(stalledOf({ ...call, transcriptGrewAt: T0 + BUSY_MAX_MS - 2000 }, T0 + BUSY_MAX_MS), null);
  const bg = facts({ background: { since: T0, grewAt: T0 + 10 * MIN } });
  assert.equal(stalledOf(bg, T0 + BUSY_MAX_MS), null, "its output grew 10 min in");
  assert.equal(stalledOf(bg, T0 + 10 * MIN + BUSY_MAX_MS)?.rule, "call");
});

test("stalledOf, lock: the merge lock held too long stalls owing or not; owing nothing or no task delivered stalls nothing else", () => {
  const lockStall = { fact: "holds the merge lock", since: T0 };
  assert.deepEqual(stalledOf(facts({ owes: null, lockStall }), T0 + 11 * MIN), { rule: "lock", since: T0, fact: "holds the merge lock" });
  assert.equal(stalledOf(facts({ owes: null }), T0 + 60 * MIN), null);
  assert.equal(stalledOf(facts({ taskDeliveredAt: null, inHeldWait: true }), T0 + 60 * MIN), null);
});

test("reasonOf: the shown state word, then the fact with its age", () => {
  assert.equal(reasonOf("waiting", "not done p1, in a wait", 90_000), "waiting, not done p1, in a wait 90 s");
  assert.equal(reasonOf("merging", "holds the merge lock", 11 * MIN), "merging, holds the merge lock 11 min");
});

// ── episodes, through the board's tick ─────────────────────────────────────────────

const REPO = "/repos/stall/.git";
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
const badgeAt = (run: number, t: number) => board.memberStates(run, new Date(t)).find((s) => s.member === "a")!.badge;

/** A task run with one worker `a` owing p1, its task delivered now, its link spoken (no 'no transcript' line). */
const owing = (): { run: number; a: Participant } => {
  const run = board.openRun({ repo: REPO, kind: "task", group: "g", title: "g", seats: [{ id: "a", blockers: [] }] });
  const a = board.join({ run: run.id, seat: "a", doing: "x", files: [] }).member;
  const orch = board.participant("g/orchestrator")!;
  board.phase(orch, "p1", "go");
  board.post(orch, "@a your part", { task: true });
  for (const p of [a, orch]) board.deliver(p);
  board.recordActivity(run.id, "a", act(), new Date());
  return { run: run.id, a };
};

test("a predicate true at one tick only (a blip) shows no badge and raises no alarm", () => {
  const { run } = owing();
  const due = Date.now() + SILENT_MS + 1000;
  board.livenessTick(run, new Date(due), linked);
  assert.equal(badgeAt(run, due), null, "one tick: pending, not shown");
  // the next tick finds it false (the transcript grew): the pending row is dropped, nothing told
  board.recordActivity(run, "a", act({ grewAt: due + 1000 }), new Date(due + 1000));
  board.livenessTick(run, new Date(due + 5000), linked);
  assert.equal(badgeAt(run, due + 5000), null);
  assert.equal(events("stalled").length, 0);
  assert.equal(events("recovered").length, 0);
});

test("one alarm when an episode opens at its second tick, never re-fired by a timer; one recovered when it closes", () => {
  const { run, a } = owing();
  const due = Date.now() + SILENT_MS + 1000;
  board.livenessTick(run, new Date(due), linked);
  board.livenessTick(run, new Date(due + 5000), linked);
  assert.equal(badgeAt(run, due + 5000)?.name, "stalled");
  assert.match(badgeAt(run, due + 5000)!.reason, /^working, not done p1, no activity \d+ min$/);
  for (const s of [10, 60, 900, 3600]) board.livenessTick(run, new Date(due + s * 1000), linked);
  assert.equal(events("stalled").length, 1, "one alarm per episode");
  // done ends the owing: the episode closes, one recovered
  board.done(a, "p1");
  board.livenessTick(run, new Date(due + 3700_000), linked);
  board.livenessTick(run, new Date(due + 3705_000), linked);
  assert.equal(badgeAt(run, due + 3705_000), null);
  assert.equal(events("recovered").length, 1);
});

test("a member working, its transcript grown seconds ago, is never stalled however long it works", () => {
  const { run } = owing();
  const base = Date.now();
  for (let s = 60; s <= 3 * 3600; s += 60) {
    board.recordActivity(run, "a", act({ grewAt: base + (s - 3) * 1000 }), new Date(base + (s - 3) * 1000));
    board.livenessTick(run, new Date(base + s * 1000), linked);
    board.livenessTick(run, new Date(base + s * 1000 + 5000), linked);
  }
  assert.equal(events("stalled").length, 0);
  assert.equal(badgeAt(run, base + 3 * 3600_000 + 5000), null);
});

test("parking a stalled member closes its episode without a recovered", () => {
  const { run } = owing();
  const due = Date.now() + SILENT_MS + 1000;
  board.livenessTick(run, new Date(due), linked);
  board.livenessTick(run, new Date(due + 5000), linked);
  assert.equal(events("stalled").length, 1);
  board.park(board.participant("g/orchestrator")!, "a");
  board.livenessTick(run, new Date(due + 10_000), linked);
  board.unpark(board.participant("g/orchestrator")!, "a");
  assert.equal(events("recovered").length, 0);
  assert.equal(badgeAt(run, due + 10_000), null, "unparked: a fresh episode needs two ticks again");
});
