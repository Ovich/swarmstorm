// Fewer orchestrator wakes, never a real alert lost (run noise-2): a seat re-arming its wait owing nothing is never
// stalled; a stalled is never carried; members stalled at one tick are one wake, repeated only when the set changes;
// a member that acts after the alert draws no repeat; another run's stall stays in its run; a background listener
// returning is not progress that hides a member owing its phase.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board, type Delivery, type Participant, type Presence } from "../src/board/board.ts";
import type { MemberActivity } from "../src/wire.ts";
import { SCENARIOS, play, steps } from "./fixtures/yardstick.ts";
import { SILENT_MS } from "../src/board/liveness.ts";

const SILENT_S = SILENT_MS / 1000;
import { eventStep } from "../src/cli/answer/rules.ts";
const stepOf = (e: import("../src/board/events.ts").EventName) => (m: Parameters<typeof eventStep>[0], me: Parameters<typeof eventStep>[1], cli: string) => eventStep(m, me, cli, e);

const REPO = "/repos/noise/.git";
let dir: string;
let board: Board;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-noise-"));
  board = await openBoard(path.join(dir, "swarm.sqlite"));
});
afterEach(() => {
  board.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const presence: Presence = () => ({ connected: true, lostAt: null });
const act = (o: Partial<MemberActivity> = {}): MemberActivity => ({ grewAt: null, tokens: 0, context: null, openTool: null, lastTool: null, finished: false, ...o });
const at = (base: number, s: number) => new Date(base + s * 1000);
const stalled = (run?: number) => board.snapshot(REPO).events.filter((e) => e.event === "stalled" && (run == null || e.run === run));
const waitOf = (p: Participant, ms = 250): Promise<Delivery> => board.wait(p, { mentionsOnly: true, timeoutMs: ms });
const all = (d: Delivery) => [...d.full.map((x) => x.body), ...d.lines].join("\n");

/** A task run of `ids` in `group`, threshold 5 s, all joined, what was for them already had. */
const setup = (ids: string[], group = "g") => {
  const run = board.openRun({ repo: REPO, kind: "task", group, title: group, stallMs: 5000, seats: ids.map((id) => ({ id, title: id, blockers: [] })) });
  const m = Object.fromEntries(ids.map((id) => [id, board.join({ run: run.id, seat: id, doing: "x", files: [] }).member])) as Record<string, Participant>;
  const orch = board.participant(`${group}/orchestrator`)!;
  for (const p of [...Object.values(m), orch]) board.deliver(p);
  return { run, m, orch };
};

/** board-split D54: `member`'s own task (`post --task`), delivered: its owing clock starts there. */
const taskTo = (orch: Participant, member: Participant) => {
  board.post(orch, `@${member.name.slice(member.name.indexOf("/") + 1)} your part`, { task: true });
  board.deliver(member);
};
/** board-split D49, D54: the open phase `p1`, owed by every member but `done`, each given its task; a stall counts from it.
 *  Out of a wait, a member reads stalled after three stall windows (15 s here) without a board call. */
const oweP1 = (run: number, orch: Participant, done: Participant[] = []) => {
  board.phase(orch, "p1", "your part");
  for (const p of done) board.done(p, "p1");
  for (const p of board.roster(REPO).filter((x) => x.run === run && !x.name.endsWith("/orchestrator") && !done.some((d) => d.name === x.name)))
    taskTo(orch, board.participant(p.name)!);
};

test("a: a seat that only re-arms its wait, owing nothing, never draws stalled", async () => {
  for (const id of ["S11-3", "S6"]) {
    const r = await play(SCENARIOS.find((s) => s.id === id)!);
    assert.equal(r.alerts.length, 0, `${id}: ${r.events}`);
  }
});

test("b: a stalled is never carried: it wakes the orchestrator at once, the carried lines pending riding on it", async () => {
  const { run, orch } = setup(["w1", "w2"]);
  // a seat added mid-run joins: a carried joined event (merged no longer reaches the orchestrator)
  board.addSeat(run.id, { id: "late1", blockers: [] });
  board.addSeat(run.id, { id: "late1-spare", blockers: [] });
  board.join({ run: run.id, seat: "late1", doing: "late1", files: [] }).member;
  assert.equal((await waitOf(orch)).full.length, 0, "the joined alone is carried");
  // board-split D49: w1 alone owes the open phase (`--for`), with no board call
  board.phase(orch, "p1", "your part", { for: ["w1"] });
  taskTo(orch, board.participant("g/w1")!);
  const base = Date.now();
  const held = waitOf(orch, 2000);
  board.livenessTick(run.id, at(base, SILENT_S + 1), presence);
  const d = await held;
  assert.match(all(d), /stalled g\/w1/);
  assert.match(all(d), /late1/, "the carried joined rides on the stalled's wake");
});

test("c: three members stalled at one tick: one wake naming each, its rule and its move; never repeated on a timer (board-split D54)", async () => {
  const { run, m, orch } = setup(["a", "b", "c", "d"]);
  oweP1(run.id, orch, [m.d]);
  const base = Date.now();
  const held = waitOf(orch, 2000);
  board.livenessTick(run.id, at(base, SILENT_S + 1), presence);
  const d = await held;
  assert.equal(d.full.filter((x) => x.body.startsWith("stalled")).length, 1);
  const s = stalled();
  assert.equal(s.length, 1);
  assert.match(s[0].body, /^stalled g: 3 members: g\/a \(silent\).*; g\/b \(silent\).*; g\/c \(silent\)/);
  // the move names each member and its own move, by its rule
  const members = [{ rule: "owing" as const, member: "a", phase: "p1" }, { rule: "silent" as const, member: "b", phase: "p1" }, { rule: "lock" as const, member: "c", lock: "port:1", holder: "OT·w9" }];
  const move = stepOf("stalled")({ ...board.read(s[0].seq), meta: { ...members[0], members } }, orch, "swarm")!;
  assert.match(move, /^a: swarm post .*your part of p1.*; b: ask it: swarm post .*your part of p1.*; c: ask OT·w9 to unlock port:1/);
  // the same set: no repeat within 15 min
  for (const t of [SILENT_S + 5, SILENT_S + 60, SILENT_S + 600]) board.livenessTick(run.id, at(base, t), presence);
  assert.equal(stalled().length, 1);
  // the same three, 15 min on and more: never repeated on a timer (board-split D54: once per episode)
  board.livenessTick(run.id, at(base, SILENT_S + 15 * 60), presence);
  board.livenessTick(run.id, at(base, SILENT_S + 45 * 60), presence);
  assert.equal(stalled().length, 1);
});

test("d: a stalled member that is then mentioned and acts (done) draws no repeat; its own post or transcript does not end the stall (board-split D49)", () => {
  const { run, m, orch } = setup(["a"]);
  oweP1(run.id, orch);
  const base = Date.now();
  board.livenessTick(run.id, at(base, SILENT_S + 1), presence);
  assert.equal(stalled().length, 1);
  board.post(orch, "@a your report?");
  board.deliver(m.a);
  board.post(m.a, "here it is");
  assert.equal(board.memberStates(run.id, at(base, SILENT_S + 2)).find((x) => x.member === "a")?.badge?.name, "stalled", "a self-post is no board call");
  board.done(m.a, "p1");
  for (let s = SILENT_S + 5; s <= SILENT_S + 20 * 60; s += 3) {
    board.recordActivity(run.id, "a", act({ grewAt: base + s * 1000 }), at(base, s));
    board.livenessTick(run.id, at(base, s), presence);
  }
  assert.equal(stalled().length, 1);
});

test("e: another run's stalled member never wakes this run's orchestrator", async () => {
  const one = setup(["a"], "one");
  const two = setup(["b"], "two");
  // board-split D49: only two has a phase open, owed by b
  oweP1(two.run.id, two.orch);
  const base = Date.now();
  // both have a transcript: no liveness line wakes either orchestrator
  board.recordActivity(one.run.id, "a", act({ grewAt: base }), at(base, 0));
  board.recordActivity(two.run.id, "b", act({ grewAt: base }), at(base, 0));
  const held = waitOf(one.orch, 400);
  board.livenessTick(one.run.id, at(base, SILENT_S + 1), presence);
  board.livenessTick(two.run.id, at(base, SILENT_S + 1), presence);
  assert.equal(stalled(two.run.id).length, 1);
  assert.equal(all(await held), "", "one's orchestrator is not woken by two's stall");
  assert.deepEqual(stalled(two.run.id)[0].mentions, ["two/orchestrator"]);
});

test("f: owing its task, a background listener returning then silence: stalled SILENT_MS after its last sign of work, told once, never recovered by the listener's return (board-split D49, D54)", async () => {
  const { work, open, startedInBackground, notifiedAsPrompt, id, WAIT } = steps;
  const a = id();
  const lastSign = 201;
  const r = await play({
    id: "F-listener",
    what: "owes p1 from its task; its background wait --mentions returns at 200 s, then silence",
    // board-split D54: out of a wait, stalled only after SILENT_MS with no sign of work (its transcript last grew at 201 s)
    length: lastSign + SILENT_S + 120,
    stuckAt: lastSign,
    owe: (bd, o) => {
      bd.phase(o, "p1", "go");
      bd.post(o, "@x your part", { task: true });
    },
    steps: [work(0), open(5, a, WAIT, { run_in_background: true }), startedInBackground(6, a, "w.out"), work(7, "listening"), notifiedAsPrompt(200, a), work(lastSign, "nothing for me")],
  });
  assert.equal(r.missed, 0, r.events);
  // told within the bound, once, and no recovered
  assert.ok(r.alerts.length > 0 && r.alerts[0].s >= lastSign + SILENT_S && r.alerts[0].s <= lastSign + SILENT_S + 61, r.events);
  assert.ok(!/recovered/.test(r.events), r.events);
});

test("G39, board-split D31, D49: a member owing its phase that waits on a background task of its own is busy on it, and stalled owing past the stall time from the held wait, never from the task", async () => {
  const { run, m, orch } = setup(["a"]);
  board.phase(orch, "p1", "go");
  taskTo(orch, m.a);
  board.deliver(orch);
  const base = Date.now();
  const held = waitOf(m.a, 3000);
  board.recordActivity(run.id, "a", act({ grewAt: base, inTurn: true, openTool: { name: "Bash", target: "swarm wait", since: base, boardWait: true, shell: true }, background: { target: "npm test", since: base, outputGrewAt: base } }), at(base, 0));
  const early = board.memberStates(run.id, at(base, 2)).find((x) => x.member === "a")!;
  assert.deepEqual([early.state, early.badge], ["busy", null]);
  const late = board.memberStates(run.id, at(base, 90)).find((x) => x.member === "a")!;
  assert.deepEqual([late.state, late.badge?.name, late.rule], ["busy", "stalled", "owing"]);
  // U-F22: the reason names the state the card shows
  assert.match(late.badge?.reason ?? "", /^busy, not done p1, \d+ s$/);
  board.post(orch, "@a go");
  await held;
});

test("G40: the same stalled set, no member progressed since, is never told again (a link blip clears no episode; board-split D54)", () => {
  const { run, orch } = setup(["a"]);
  oweP1(run.id, orch);
  const base = Date.now();
  board.recordActivity(run.id, "a", act({ grewAt: base, inTurn: false, lastTool: "Bash x" }), at(base, 0));
  board.livenessTick(run.id, at(base, SILENT_S + 1), presence);
  assert.equal(stalled(run.id).length, 1);
  // a link blip clears its stalled mark; nothing progressed, the same silence again
  board.livenessTick(run.id, at(base, SILENT_S + 2), () => ({ connected: false, lostAt: base + (SILENT_S + 2) * 1000 }));
  board.livenessTick(run.id, at(base, SILENT_S + 5), presence);
  board.livenessTick(run.id, at(base, SILENT_S + 25 * 60), presence);
  assert.equal(stalled(run.id).length, 1, "not repeated");
});
