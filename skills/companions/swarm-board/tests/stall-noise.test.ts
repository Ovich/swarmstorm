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
import { EVENTS } from "../src/board/events.ts";
import type { MemberActivity } from "../src/wire.ts";
import { SCENARIOS, play, steps } from "./fixtures/yardstick.ts";

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

test("a: a seat that only re-arms its wait, owing nothing, never draws stalled", async () => {
  for (const id of ["S11-3", "S6"]) {
    const r = await play(SCENARIOS.find((s) => s.id === id)!);
    assert.equal(r.alerts.length, 0, `${id}: ${r.events}`);
  }
});

test("b: a stalled is never carried: it wakes the orchestrator at once, the carried lines pending riding on it", async () => {
  const { run, m, orch } = setup(["w1", "w2"]);
  board.lockMerge(m.w2);
  board.merged(m.w2, "sha1", []);
  assert.equal((await waitOf(orch)).full.length, 0, "the merged alone is carried");
  const base = Date.now() + 60_000;
  board.recordActivity(run.id, "w1", act({ grewAt: base }), at(base, 0));
  board.recordActivity(run.id, "w2", act({ grewAt: base + 100_000 }), at(base, 0));
  const held = waitOf(orch, 2000);
  board.livenessTick(run.id, at(base, 6), presence);
  const d = await held;
  assert.match(all(d), /stalled g\/w1/);
  assert.match(all(d), /sha1/, "the carried merged rides on the stalled's wake");
});

test("c: three members stalled at one tick: one wake naming each, its rule and its move; repeated only when the set changes", async () => {
  const { run, orch } = setup(["a", "b", "c", "d"]);
  const base = Date.now() + 60_000;
  for (const id of ["a", "b", "c"]) board.recordActivity(run.id, id, act({ grewAt: base }), at(base, 0));
  const grewD = (s: number) => board.recordActivity(run.id, "d", act({ grewAt: base + s * 1000 }), at(base, s));
  grewD(0);
  const held = waitOf(orch, 2000);
  grewD(6);
  board.livenessTick(run.id, at(base, 6), presence);
  const d = await held;
  assert.equal(d.full.filter((x) => x.body.startsWith("stalled")).length, 1);
  const s = stalled();
  assert.equal(s.length, 1);
  assert.match(s[0].body, /^stalled g: 3 members: g\/a.*; g\/b.*; g\/c/);
  // with their rules (a transcript read gives them), the move names each member and its own move
  const members = [{ rule: "owing" as const, member: "a", phase: "p1" }, { rule: "ended" as const, member: "b" }, { rule: "in-turn" as const, member: "c" }];
  const move = EVENTS.stalled.next!({ ...board.read(s[0].seq), meta: { ...members[0], members } }, orch, "swarm")!;
  assert.match(move, /^a: swarm post .*your part of p1.*; b: a post does not wake it.*; c: SendMessage it/);
  // the same set: no repeat within 15 min
  for (const t of [10, 60, 600]) {
    grewD(t);
    board.livenessTick(run.id, at(base, t), presence);
  }
  assert.equal(stalled().length, 1);
  // d joins the set: one more line, naming all four
  board.livenessTick(run.id, at(base, 700), presence);
  assert.equal(stalled().length, 2);
  assert.match(stalled()[1].body, /4 members/);
  // the same four, 15 min on: one grouped repeat
  board.livenessTick(run.id, at(base, 700 + 15 * 60), presence);
  assert.equal(stalled().length, 3);
  assert.match(stalled()[2].body, /4 members/);
});

test("d: a stalled member that is then mentioned and acts draws no repeat", () => {
  const { run, m, orch } = setup(["a"]);
  const base = Date.now() + 60_000;
  board.recordActivity(run.id, "a", act({ grewAt: base }), at(base, 0));
  board.livenessTick(run.id, at(base, 6), presence);
  assert.equal(stalled().length, 1);
  board.post(orch, "@a your report?");
  board.deliver(m.a);
  for (let s = 10; s <= 20 * 60; s += 3) {
    board.recordActivity(run.id, "a", act({ grewAt: base + s * 1000 }), at(base, s));
    board.livenessTick(run.id, at(base, s), presence);
  }
  assert.equal(stalled().length, 1);
});

test("e: another run's stalled member never wakes this run's orchestrator", async () => {
  const one = setup(["a"], "one");
  const two = setup(["b"], "two");
  const base = Date.now() + 60_000;
  board.recordActivity(one.run.id, "a", act({ grewAt: base + 100_000 }), at(base, 0));
  board.recordActivity(two.run.id, "b", act({ grewAt: base }), at(base, 0));
  const held = waitOf(one.orch, 400);
  board.livenessTick(one.run.id, at(base, 6), presence);
  board.livenessTick(two.run.id, at(base, 6), presence);
  assert.equal(stalled(two.run.id).length, 1);
  assert.equal(all(await held), "", "one's orchestrator is not woken by two's stall");
  assert.deepEqual(stalled(two.run.id)[0].mentions, ["two/orchestrator"]);
});

test("f: a background listener returning is not progress that hides a stall of a member owing its phase", async () => {
  const { work, open, startedInBackground, notifiedAsPrompt, id, WAIT } = steps;
  const a = id();
  const r = await play({
    id: "F-listener",
    what: "owes p1; its background wait --mentions returns at 200 s, then silence",
    length: 600,
    stuckAt: 7,
    owe: (bd, o) => bd.phase(o, "p1", "@x your part"),
    steps: [work(0), open(5, a, WAIT, { run_in_background: true }), startedInBackground(6, a, "w.out"), work(7, "listening"), notifiedAsPrompt(200, a), work(201, "nothing for me")],
  });
  assert.equal(r.missed, 0, r.events);
  // after the listener returned, the owing member is told again within the threshold, never hidden
  const after = r.alerts.filter((x) => x.s > 201);
  assert.ok(after.length > 0 && after[0].s <= 201 + 61, `told after the return: ${r.events}`);
});
