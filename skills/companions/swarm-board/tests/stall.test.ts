// simple-states: `stalled` as a pure function of the facts (its one rule), the one reason formatter, and the
// episodes the tick keeps: a badge only once confirmed, one alarm per episode.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board, type Participant, type Presence } from "../src/board/board.ts";
import { STALL_MS_DEFAULT, BADGE_CONFIRM_MS } from "../src/board/liveness.ts";
import { reasonOf, stalledOf, type StallFacts } from "../src/board/stall.ts";
import type { MemberActivity } from "../src/wire.ts";
import { carries, wakes } from "../src/board/events.ts";
import type { Message } from "../src/board/board.ts";

// this file's scenes run on the real confirm (U-F27); the suite's fixture shortens it for the older ones
delete process.env.SWARM_BADGE_CONFIRM_MS;
delete process.env.SWARM_STALL_FLOOR_MS;
const T0 = 1_800_000_000_000;
const MIN = 60_000;
/** A member owing p1, its last sign of progress at T0. */
const facts = (o: Partial<StallFacts> = {}): StallFacts => ({ owes: "p1", progressAt: T0, stallMs: STALL_MS_DEFAULT, ...o });

test("stalledOf: no sign of progress for the stall window, from the last sign", () => {
  assert.equal(stalledOf(facts(), T0 + STALL_MS_DEFAULT - 1), null);
  assert.deepEqual(stalledOf(facts(), T0 + STALL_MS_DEFAULT), { since: T0, fact: "not done p1, no activity" });
});

test("reasonOf: the shown state word, then the fact with its age", () => {
  assert.equal(reasonOf("working", "not done p1, no activity", 90_000), "working, not done p1, no activity 90 s");
  assert.equal(reasonOf("working", "not done p1, no activity", 11 * MIN), "working, not done p1, no activity 11 min");
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
  board.post(orch, "@a your part");
  for (const p of [a, orch]) board.deliver(p);
  board.recordActivity(run.id, "a", act(), new Date());
  return { run: run.id, a };
};

test("a predicate true at one tick only (a blip) shows no badge and raises no alarm", () => {
  const { run } = owing();
  const due = Date.now() + STALL_MS_DEFAULT + 1000;
  board.livenessTick(run, new Date(due), linked);
  assert.equal(badgeAt(run, due), null, "one tick: pending, not shown");
  // the next tick finds it false (the transcript grew): the pending row is dropped, nothing told
  board.recordActivity(run, "a", act({ grewAt: due + 1000 }), new Date(due + 1000));
  board.livenessTick(run, new Date(due + BADGE_CONFIRM_MS), linked);
  assert.equal(badgeAt(run, due + BADGE_CONFIRM_MS), null);
  assert.equal(events("stalled").length, 0);
});

test("one alarm when an episode opens at its second tick, never re-fired by a timer; it closes without a word", () => {
  const { run, a } = owing();
  const due = Date.now() + STALL_MS_DEFAULT + 1000;
  board.livenessTick(run, new Date(due), linked);
  board.livenessTick(run, new Date(due + BADGE_CONFIRM_MS), linked);
  assert.equal(badgeAt(run, due + BADGE_CONFIRM_MS)?.name, "stalled");
  assert.match(badgeAt(run, due + BADGE_CONFIRM_MS)!.reason, /^working, not done p1, no activity \d+ min$/);
  for (const s of [10, 60, 900, 3600]) board.livenessTick(run, new Date(due + s * 1000), linked);
  assert.equal(events("stalled").length, 1, "one alarm per episode");
  // done ends the owing: the episode closes, nothing told
  board.done(a, "p1");
  board.livenessTick(run, new Date(due + 3700_000), linked);
  board.livenessTick(run, new Date(due + 3700_000 + BADGE_CONFIRM_MS), linked);
  assert.equal(badgeAt(run, due + 3700_000 + BADGE_CONFIRM_MS), null);
  assert.equal(events("stalled").length, 1);
});

test("a member working, its transcript grown seconds ago, is never stalled however long it works", () => {
  const { run } = owing();
  const base = Date.now();
  for (let s = 60; s <= 3 * 3600; s += 60) {
    board.recordActivity(run, "a", act({ grewAt: base + (s - 3) * 1000 }), new Date(base + (s - 3) * 1000));
    board.livenessTick(run, new Date(base + s * 1000), linked);
    board.livenessTick(run, new Date(base + s * 1000 + BADGE_CONFIRM_MS), linked);
  }
  assert.equal(events("stalled").length, 0);
  assert.equal(badgeAt(run, base + 3 * 3600_000 + BADGE_CONFIRM_MS), null);
});

test("parking a stalled member closes its episode; its unpark tells nothing (U-F25)", () => {
  const { run } = owing();
  const due = Date.now() + STALL_MS_DEFAULT + 1000;
  board.livenessTick(run, new Date(due), linked);
  board.livenessTick(run, new Date(due + BADGE_CONFIRM_MS), linked);
  assert.equal(events("stalled").length, 1);
  board.park(board.participant("g/orchestrator")!, "a");
  board.livenessTick(run, new Date(due + 10_000), linked);
  board.unpark(board.participant("g/orchestrator")!, "a");
  // U-F25: an unpark opens nothing: no second alarm at the ticks after it
  board.recordActivity(run, "a", act({ grewAt: due + 11_000 }), new Date(due + 11_000));
  board.livenessTick(run, new Date(due + 12_000), linked);
  board.livenessTick(run, new Date(due + 17_000), linked);
  assert.equal(events("stalled").length, 1);
  assert.equal(badgeAt(run, due + 10_000), null, "unparked: a fresh episode needs two ticks again");
});

test("gate G5: a run that stored the old 60 s stall_ms still waits the floor before a silent member reads stalled", () => {
  const run = board.openRun({ repo: REPO, kind: "task", group: "g", title: "g", seats: [{ id: "a", blockers: [] }], stallMs: 60_000 });
  board.join({ run: run.id, seat: "a", doing: "x", files: [] });
  const orch = board.participant("g/orchestrator")!;
  board.phase(orch, "p1", "go");
  board.post(orch, "@a your part");
  for (const p of [board.participant("g/a")!, orch]) board.deliver(p);
  const base = Date.now();
  board.recordActivity(run.id, "a", act(), new Date(base));
  board.livenessTick(run.id, new Date(base + 61_000), linked);
  board.livenessTick(run.id, new Date(base + 62_000 + BADGE_CONFIRM_MS), linked);
  assert.equal(badgeAt(run.id, base + 62_000 + BADGE_CONFIRM_MS), null, "61 s silent: not stalled");
  board.livenessTick(run.id, new Date(base + STALL_MS_DEFAULT + 1000), linked);
  board.livenessTick(run.id, new Date(base + STALL_MS_DEFAULT + 1000 + BADGE_CONFIRM_MS), linked);
  assert.equal(badgeAt(run.id, base + STALL_MS_DEFAULT + 1000 + BADGE_CONFIRM_MS)?.name, "stalled", "past the floor: stalled");
});

test("simple-states: a held board wait is a board call: a member owing p1 in its wait never reads stalled", async () => {
  const { run, a } = owing();
  const stop = new AbortController();
  const held = board.wait(a, { mentionsOnly: true, timeoutMs: 60_000, signal: stop.signal }).catch(() => null);
  const base = Date.now();
  board.recordActivity(run, "a", act({ openTool: { name: "Bash", target: "", since: base, boardWait: true } }), new Date(base));
  const past = base + 3 * STALL_MS_DEFAULT;
  board.livenessTick(run, new Date(past), linked);
  board.livenessTick(run, new Date(past + BADGE_CONFIRM_MS), linked);
  assert.equal(badgeAt(run, past + BADGE_CONFIRM_MS), null);
  stop.abort();
  await held;
});

test("simple-states: an open call with no transcript growth past the stall window reads stalled, from the call's start", () => {
  const { run } = owing();
  const base = Date.now() + 1000;
  board.recordActivity(run, "a", act({ openTool: { name: "Bash", target: "npm test", since: base } }), new Date(base));
  board.livenessTick(run, new Date(base + STALL_MS_DEFAULT - BADGE_CONFIRM_MS - 1000), linked);
  board.livenessTick(run, new Date(base + STALL_MS_DEFAULT - 1000), linked);
  assert.equal(badgeAt(run, base + STALL_MS_DEFAULT - 1000), null);
  board.livenessTick(run, new Date(base + STALL_MS_DEFAULT), linked);
  board.livenessTick(run, new Date(base + STALL_MS_DEFAULT + BADGE_CONFIRM_MS), linked);
  assert.match(badgeAt(run, base + STALL_MS_DEFAULT + BADGE_CONFIRM_MS)!.reason, /^working, not done p1, no activity /);
});

test("U-F27: an episode opens once its predicate held BADGE_CONFIRM_MS by time, and a second out of it tells nothing", () => {
  const { run } = owing();
  const due = Date.now() + STALL_MS_DEFAULT + 1000;
  // 1 s ticks for 9 s: never confirmed
  for (let s = 0; s < BADGE_CONFIRM_MS / 1000; s++) board.livenessTick(run, new Date(due + s * 1000), linked);
  assert.equal(badgeAt(run, due + 9000), null);
  assert.equal(events("stalled").length, 0);
  board.livenessTick(run, new Date(due + BADGE_CONFIRM_MS), linked);
  assert.equal(events("stalled").length, 1, "held 10 s: opened");
  // false for 2 s (growth), then true again: the episode goes on, no second alarm
  board.recordActivity(run, "a", act({ grewAt: due + 11_000 }), new Date(due + 11_000));
  board.livenessTick(run, new Date(due + 12_000), linked);
  board.recordActivity(run, "a", act({ grewAt: due + 11_000 - STALL_MS_DEFAULT }), new Date(due + 13_000));
  board.livenessTick(run, new Date(due + 14_000), linked);
  board.livenessTick(run, new Date(due + 30_000), linked);
  assert.equal(events("stalled").length, 1);
});

test("U-F29: a rejoin keeps the subscriptions the seat's member made", () => {
  const run = board.openRun({ repo: REPO, kind: "task", group: "g", title: "g", seats: [{ id: "a", blockers: [] }] });
  const a = board.join({ run: run.id, seat: "a", doing: "x", files: [] }).member;
  board.subscribe(a, [{ event: "stalled", scope: "run" }]);
  board.end(a);
  const again = board.join({ run: run.id, seat: "a", doing: "y", files: [] }).member;
  assert.deepEqual(again.subscriptions.map((s) => s.event), ["stalled"]);
});

test("u1 #1349: an alarm about a member never wakes that member, though it subscribed; another subscriber wakes", () => {
  const run = board.openRun({ repo: REPO, kind: "task", group: "g", title: "g", seats: [{ id: "a", blockers: [] }, { id: "b", blockers: [] }] });
  const a = board.join({ run: run.id, seat: "a", doing: "x", files: [] }).member;
  const b = board.join({ run: run.id, seat: "b", doing: "x", files: [] }).member;
  for (const p of [a, b]) board.subscribe(p, [{ event: "stalled", scope: "run" }, { event: "lost", scope: "run" }]);
  const subject = { ...board.participant("g/a")! };
  const other = { ...board.participant("g/b")! };
  const alarm = { seq: 1, repo: REPO, from: "g/orchestrator", body: "stalled g/a: waiting, not done p1, in a wait 5 min; phase p1 0/2 done", about: null, kind: "event", mentions: ["g/orchestrator"], at: new Date().toISOString(), run: run.id, endorses: null, event: "stalled" } as unknown as Message;
  assert.equal(wakes(alarm, subject, subject.subscriptions), false);
  assert.equal(carries(alarm, subject, subject.subscriptions), false);
  assert.equal(wakes(alarm, other, other.subscriptions), true);
  const several = { ...alarm, body: "stalled g: 2 members: g/b (owing): working, …; g/a (silent): …; phase p1" } as Message;
  assert.equal(wakes(several, subject, subject.subscriptions), false);
});
