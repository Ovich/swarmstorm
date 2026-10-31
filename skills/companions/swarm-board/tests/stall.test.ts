// board-split D55: `stalled` as a pure function of the facts (each branch), the one reason formatter, and the
// episodes the tick keeps: a badge only after two consecutive ticks, one alarm per episode, one recovered.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board, type Participant, type Presence } from "../src/board/board.ts";
import { BUSY_MAX_MS, SILENT_MS, STALL_MS_DEFAULT, BADGE_CONFIRM_MS } from "../src/board/liveness.ts";
import { nextWaitSpell, reasonOf, stalledOf, WAIT_SPELL_BREAK_MS, type StallFacts, type WaitSpell } from "../src/board/stall.ts";
import type { MemberActivity } from "../src/wire.ts";
import { carries, wakes } from "../src/board/events.ts";
import type { Message } from "../src/board/board.ts";

// this file's scenes run on the real confirm (U-F27); the suite's fixture shortens it for the older ones
delete process.env.SWARM_BADGE_CONFIRM_MS;
delete process.env.SWARM_STALL_FLOOR_MS;
const T0 = 1_800_000_000_000;
const MIN = 60_000;
/** A member owing p1, its task delivered at T0, out of any wait, nothing open, its last sign at T0. */
const facts = (o: Partial<StallFacts> = {}): StallFacts => ({
  shownState: "working",
  owes: "p1",
  taskDeliveredAt: T0,
  clockFloorAt: T0 - MIN,
  inHeldWait: false,
  waitSpellSince: null,
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

test("stalledOf, held wait (U-F22): the window counts from the waiting spell, never the work before it", () => {
  // worked 8 min after the task, then a wait: 5 min into the spell, not stalled; at the stall window, stalled from the spell
  const spell = T0 + 8 * MIN;
  const f = facts({ inHeldWait: true, shownState: "waiting", waitSpellSince: spell });
  assert.equal(stalledOf(f, spell + 4 * 1000), null);
  assert.equal(stalledOf(f, spell + STALL_MS_DEFAULT - 1), null);
  assert.deepEqual(stalledOf(f, spell + STALL_MS_DEFAULT), { rule: "owing", since: spell, fact: "not done p1, in a wait" });
  // a spell before the task: the task's delivery is the later start
  assert.equal(stalledOf({ ...f, waitSpellSince: T0 - 30 * MIN }, T0 + STALL_MS_DEFAULT - 1), null);
});

test("nextWaitSpell: a re-arm keeps the spell, 10 s out breaks it, work out of a wait never starts one", () => {
  const s = 1000;
  let spell: WaitSpell | null = nextWaitSpell(null, null, T0);
  assert.equal(spell, null);
  spell = nextWaitSpell(spell, T0 + s, T0 + 2 * s);
  assert.deepEqual(spell, { since: T0 + s, inAt: T0 + 2 * s });
  // the same wait, ticks on
  spell = nextWaitSpell(spell, T0 + s, T0 + 170 * s);
  // out for a second (the re-arm), a new wait: the spell goes on
  spell = nextWaitSpell(nextWaitSpell(spell, null, T0 + 171 * s), T0 + 172 * s, T0 + 172 * s);
  assert.equal(spell!.since, T0 + s);
  // out WAIT_SPELL_BREAK_MS (working), then a wait: a new spell from that wait
  const back = T0 + 172 * s + WAIT_SPELL_BREAK_MS;
  spell = nextWaitSpell(spell, back, back + s);
  assert.deepEqual(spell, { since: back, inAt: back + s });
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
  board.livenessTick(run, new Date(due + BADGE_CONFIRM_MS), linked);
  assert.equal(badgeAt(run, due + BADGE_CONFIRM_MS), null);
  assert.equal(events("stalled").length, 0);
  assert.equal(events("recovered").length, 0);
});

test("one alarm when an episode opens at its second tick, never re-fired by a timer; one recovered when it closes", () => {
  const { run, a } = owing();
  const due = Date.now() + SILENT_MS + 1000;
  board.livenessTick(run, new Date(due), linked);
  board.livenessTick(run, new Date(due + BADGE_CONFIRM_MS), linked);
  assert.equal(badgeAt(run, due + BADGE_CONFIRM_MS)?.name, "stalled");
  assert.match(badgeAt(run, due + BADGE_CONFIRM_MS)!.reason, /^working, not done p1, no activity \d+ min$/);
  for (const s of [10, 60, 900, 3600]) board.livenessTick(run, new Date(due + s * 1000), linked);
  assert.equal(events("stalled").length, 1, "one alarm per episode");
  // done ends the owing: the episode closes, one recovered
  board.done(a, "p1");
  board.livenessTick(run, new Date(due + 3700_000), linked);
  board.livenessTick(run, new Date(due + 3700_000 + BADGE_CONFIRM_MS), linked);
  assert.equal(badgeAt(run, due + 3700_000 + BADGE_CONFIRM_MS), null);
  assert.equal(events("recovered").length, 1);
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

test("parking a stalled member closes its episode without a recovered; its unpark tells none either (U-F25)", () => {
  const { run } = owing();
  const due = Date.now() + SILENT_MS + 1000;
  board.livenessTick(run, new Date(due), linked);
  board.livenessTick(run, new Date(due + BADGE_CONFIRM_MS), linked);
  assert.equal(events("stalled").length, 1);
  board.park(board.participant("g/orchestrator")!, "a");
  board.livenessTick(run, new Date(due + 10_000), linked);
  board.unpark(board.participant("g/orchestrator")!, "a");
  // U-F25: an unpark opens nothing and closes nothing: no recovered at the ticks after it either
  board.recordActivity(run, "a", act({ grewAt: due + 11_000 }), new Date(due + 11_000));
  board.livenessTick(run, new Date(due + 12_000), linked);
  board.livenessTick(run, new Date(due + 17_000), linked);
  assert.equal(events("recovered").length, 0);
  assert.equal(badgeAt(run, due + 10_000), null, "unparked: a fresh episode needs two ticks again");
});

test("gate G5: a run that stored the old 60 s stall_ms still waits the 5 min floor before a held wait reads stalled", async () => {
  const run = board.openRun({ repo: REPO, kind: "task", group: "g", title: "g", seats: [{ id: "a", blockers: [] }], stallMs: 60_000 });
  const a = board.join({ run: run.id, seat: "a", doing: "x", files: [] }).member;
  const orch = board.participant("g/orchestrator")!;
  board.phase(orch, "p1", "go");
  board.post(orch, "@a your part", { task: true });
  for (const p of [a, orch]) board.deliver(p);
  const stop = new AbortController();
  const held = board.wait(a, { mentionsOnly: true, timeoutMs: 60_000, signal: stop.signal }).catch(() => null);
  const base = Date.now();
  board.recordActivity(run.id, "a", act({ openTool: { name: "Bash", target: "", since: base, boardWait: true } }), new Date(base));
  board.livenessTick(run.id, new Date(base + 61_000), linked);
  board.livenessTick(run.id, new Date(base + 62_000), linked);
  assert.equal(badgeAt(run.id, base + 62_000), null, "61 s into the wait: not stalled");
  board.livenessTick(run.id, new Date(base + STALL_MS_DEFAULT + 1000), linked);
  board.livenessTick(run.id, new Date(base + STALL_MS_DEFAULT + 1000 + BADGE_CONFIRM_MS), linked);
  assert.equal(badgeAt(run.id, base + STALL_MS_DEFAULT + 1000 + BADGE_CONFIRM_MS)?.name, "stalled", "past 5 min: stalled");
  stop.abort();
  await held;
});

test("U-F27: an episode opens once its predicate held BADGE_CONFIRM_MS by time, and a second out of it tells no recovered", () => {
  const { run } = owing();
  const due = Date.now() + SILENT_MS + 1000;
  // 1 s ticks for 9 s: never confirmed
  for (let s = 0; s < BADGE_CONFIRM_MS / 1000; s++) board.livenessTick(run, new Date(due + s * 1000), linked);
  assert.equal(badgeAt(run, due + 9000), null);
  assert.equal(events("stalled").length, 0);
  board.livenessTick(run, new Date(due + BADGE_CONFIRM_MS), linked);
  assert.equal(events("stalled").length, 1, "held 10 s: opened");
  // false for 2 s (growth), then true again: the episode goes on, no recovered, no second alarm
  board.recordActivity(run, "a", act({ grewAt: due + 11_000 }), new Date(due + 11_000));
  board.livenessTick(run, new Date(due + 12_000), linked);
  board.recordActivity(run, "a", act({ grewAt: due + 11_000 - SILENT_MS }), new Date(due + 13_000));
  board.livenessTick(run, new Date(due + 14_000), linked);
  board.livenessTick(run, new Date(due + 30_000), linked);
  assert.equal(events("recovered").length, 0);
  assert.equal(events("stalled").length, 1);
});

test("O-F3 (D55 amended): a held wait over its own open background task is busy, never held-wait stalled; the task's hang is BUSY_MAX's", () => {
  const bg = { since: T0, grewAt: null };
  const f = facts({ inHeldWait: true, shownState: "waiting", waitSpellSince: T0, background: bg });
  assert.equal(stalledOf(f, T0 + STALL_MS_DEFAULT + 60_000), null);
  assert.equal(stalledOf(f, T0 + BUSY_MAX_MS - 1), null);
  assert.deepEqual(stalledOf(f, T0 + BUSY_MAX_MS), { rule: "call", since: T0, fact: "not done p1, a background task, no growth" });
  // its output moving keeps it clear
  assert.equal(stalledOf({ ...f, background: { since: T0, grewAt: T0 + 10 * MIN } }, T0 + BUSY_MAX_MS), null);
});

test("U-F28 + O-F3: a held wait over a background task, owing p1, reads working, and stalls only on the busy bound", async () => {
  const run = board.openRun({ repo: REPO, kind: "task", group: "g", title: "g", seats: [{ id: "a", blockers: [] }] });
  const a = board.join({ run: run.id, seat: "a", doing: "x", files: [] }).member;
  const orch = board.participant("g/orchestrator")!;
  board.phase(orch, "p1", "go");
  board.post(orch, "@a your part", { task: true });
  for (const p of [a, orch]) board.deliver(p);
  const stop = new AbortController();
  const held = board.wait(a, { mentionsOnly: true, timeoutMs: 60_000, signal: stop.signal }).catch(() => null);
  const base = Date.now();
  board.recordActivity(run.id, "a", act({ openTool: { name: "Bash", target: "", since: base, boardWait: true }, background: { target: "npm test", since: base, outputGrewAt: null } }), new Date(base));
  const past = base + STALL_MS_DEFAULT + 1000;
  board.livenessTick(run.id, new Date(past), linked);
  board.livenessTick(run.id, new Date(past + BADGE_CONFIRM_MS), linked);
  assert.ok(!badgeAt(run.id, past + BADGE_CONFIRM_MS));
  const card = board.snapshot(REPO).roster.find((m) => m.member === "g/a")!;
  assert.equal(card.state, "working");
  const hung = base + BUSY_MAX_MS + 1000;
  board.livenessTick(run.id, new Date(hung), linked);
  board.livenessTick(run.id, new Date(hung + BADGE_CONFIRM_MS), linked);
  assert.match(badgeAt(run.id, hung + BADGE_CONFIRM_MS)!.reason, /^working, not done p1, a background task, no growth /);
  stop.abort();
  await held;
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
  for (const p of [a, b]) board.subscribe(p, [{ event: "stalled", scope: "run" }, { event: "recovered", scope: "run" }]);
  const subject = { ...board.participant("g/a")! };
  const other = { ...board.participant("g/b")! };
  const alarm = { seq: 1, repo: REPO, from: "g/orchestrator", body: "stalled g/a: waiting, not done p1, in a wait 5 min; phase p1 0/2 done", about: null, kind: "event", mentions: ["g/orchestrator"], at: new Date().toISOString(), run: run.id, endorses: null, event: "stalled" } as unknown as Message;
  assert.equal(wakes(alarm, subject, subject.subscriptions), false);
  assert.equal(carries(alarm, subject, subject.subscriptions), false);
  assert.equal(wakes(alarm, other, other.subscriptions), true);
  const several = { ...alarm, body: "stalled g: 2 members: g/b (owing): working, …; g/a (silent): …; phase p1" } as Message;
  assert.equal(wakes(several, subject, subject.subscriptions), false);
});
