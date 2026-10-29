// board-split D30, D31, D33, D34: a parked member raises nothing and is not waited on; a member in a board wait over
// a background task of its own is busy; the shown doing follows the latest board fact; a parked seat says until when.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board, type Presence } from "../src/board/board.ts";
import type { MemberActivity } from "../src/wire.ts";
import { eventStep } from "../src/cli/answer/rules.ts";
import { openRawStore } from "./fixtures/raw-store.ts";

const REPO = "/repos/one/.git";
let dir: string;
let board: Board;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-park-"));
  board = await openBoard(path.join(dir, "swarm.sqlite"));
});
afterEach(() => {
  board.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const linked: Presence = () => ({ connected: true, lostAt: null });
const lost = (since: number): Presence => () => ({ connected: false, lostAt: since });
const act = (o: Partial<MemberActivity> = {}): MemberActivity => ({ grewAt: null, tokens: 0, context: null, openTool: null, lastTool: null, finished: false, ...o });
const at = (base: number, s: number): Date => new Date(base + s * 1000);
const eventsOf = (name: string) => board.snapshot(REPO).events.filter((e) => e.event === name);

const setup = () => {
  const run = board.openRun({ repo: REPO, kind: "brainstorm", group: "g", title: "T", stallMs: 5000, seats: [{ id: "a", blockers: [] }, { id: "b", blockers: [] }] });
  const a = board.join({ run: run.id, seat: "a", doing: "x", files: [] }).member;
  const b = board.join({ run: run.id, seat: "b", doing: "x", files: [] }).member;
  const orch = board.participant("g/orchestrator")!;
  for (const p of [a, b, orch]) board.deliver(p);
  return { run, a, b, orch };
};

test("D31 (S37): a board wait over its own un-notified background suite reads busy '<N> min · background <command>', never waiting or idle", async () => {
  const { run, a } = setup();
  const base = Date.now();
  const held = board.wait(a, { mentionsOnly: true, timeoutMs: 400 });
  const waitCall = { name: "Bash", target: "swarm wait --mentions", since: base, boardWait: true, shell: true };
  board.recordActivity(run.id, "a", act({ grewAt: base, openTool: waitCall, background: { target: "npm test", since: base - 3 * 60_000, outputGrewAt: base } }), at(base, 0));
  const st = board.memberStates(run.id, at(base, 1)).find((s) => s.member === "a")!;
  assert.deepEqual([st.state, st.doing, st.badge], ["busy", "3 min · background npm test", null]);
  // the card's activity carries both the open wait and the background task (D32)
  const card = board.snapshot(REPO).roster.find((r) => r.member === "g/a")!;
  assert.deepEqual([card.activity?.open?.boardWait, card.activity?.background?.target], [true, "npm test"]);
  // past BUSY_MAX_MS from the task's start it stays busy and says it may be hung
  const long = board.memberStates(run.id, new Date(base + 13 * 60_000)).find((s) => s.member === "a")!;
  assert.equal(long.state, "busy");
  assert.match(long.badge?.reason ?? "", /background open 15 min, may be long or hung/);
  await held;
});

test("D30: a parked member draws no gone, stalled or idle, all-done does not wait for it; its own call resumes it", async () => {
  const { run, a, b, orch } = setup();
  board.phase(orch, "p1", "go");
  board.deliver(a);
  board.deliver(b);
  const parked = board.park(orch, "b", "p2");
  assert.deepEqual([parked.event, parked.mentions], ["park", ["g/b"]]);
  assert.equal(eventStep(parked, b, "swarm"), "you are parked: end your turn now, without end; the orchestrator resumes you at your next task");
  assert.equal(eventStep(parked, a, "swarm"), null);
  // D34: the parked seat's card says until when
  const card = board.snapshot(REPO).roster.find((r) => r.member === "g/b")!;
  assert.deepEqual([card.doing, card.state, card.parkedUntil], ["dormant until p2", "parked", "p2"]);
  // b's link is lost long ago and its turn ended: no gone, no stalled for it
  const base = Date.now();
  board.recordActivity(run.id, "b", act({ grewAt: base - 600_000, inTurn: false }), at(base, 0));
  board.livenessTick(run.id, at(base, 120), (m) => (m === "b" ? lost(base - 600_000)(m) : linked(m)));
  assert.deepEqual([...eventsOf("lost"), ...eventsOf("stalled"), ...eventsOf("liveness")].filter((e) => e.body.includes("g/b")), []);
  // all-done counts a alone
  const done = board.done(a, "p1");
  assert.deepEqual([done.progress.done, done.progress.of, done.all], [1, 1, true]);
  // D33 (S35): the done is a's latest fact, shown over its older doing
  assert.equal(board.snapshot(REPO).roster.find((r) => r.member === "g/a")!.doing, "done p1");
  // b's own call resumes it: counted again
  board.setDoing(b, "back");
  board.phase(orch, "p2", "next");
  assert.equal(board.phaseProgress(run.id)!.of, 2);
});

test("D30: park and unpark are the orchestrator's, on a live seat; unpark lifts it", () => {
  const { run, a, orch } = setup();
  assert.throws(() => board.park(a, "b"), /only the orchestrator/);
  assert.throws(() => board.park(orch, "zz"), /no live member in seat zz/);
  board.park(orch, "b");
  assert.equal(board.snapshot(REPO).roster.find((r) => r.member === "g/b")!.doing, "dormant until its next task");
  assert.throws(() => board.park(orch, "b"), /already parked/);
  board.unpark(orch, "b");
  assert.throws(() => board.unpark(orch, "b"), /not parked/);
  board.phase(orch, "p1", "go");
  assert.equal(board.phaseProgress(run.id)!.of, 2);
});

test("D30: every member but a parked one waiting is idle; every member parked is not", async () => {
  const { run, a, orch } = setup();
  board.park(orch, "b");
  const base = Date.now();
  const held = board.wait(a, { mentionsOnly: true, timeoutMs: 400 });
  board.recordActivity(run.id, "a", act({ grewAt: base, openTool: { name: "Bash", target: "swarm wait --mentions", since: base, boardWait: true } }), at(base, 0));
  board.livenessTick(run.id, at(base, 1), linked);
  assert.equal(eventsOf("idle").length, 1);
  await held;
});

test("S22 (board-split D25): a fresh agent re-joining a seat joined long ago draws no 'no transcript found' before its link speaks", () => {
  const { run, b } = setup();
  const later = Date.now() + 10 * 60_000;
  // the seat's first member joined ten minutes ago and finished; a fresh one joins it now
  const raw = openRawStore(path.join(dir, "swarm.sqlite"));
  raw.prepare("UPDATE participants SET joined_at = ? WHERE seat = 'b'").run(new Date(Date.now() - 10 * 60_000).toISOString());
  raw.close();
  board.recordActivity(run.id, "b", act({ grewAt: Date.now(), finished: true }), new Date());
  const rejoinedAt = Date.now();
  board.join({ run: run.id, seat: "b", doing: "again", files: [] });
  board.livenessTick(run.id, new Date(rejoinedAt + 1000), linked);
  assert.deepEqual(eventsOf("liveness").filter((e) => e.body.includes("g/b")), [], "measured from the re-join, not the seat's first join");
  board.livenessTick(run.id, new Date(Math.max(later, rejoinedAt + 31_000)), linked);
  assert.equal(eventsOf("liveness").filter((e) => e.body.includes("no transcript found for g/b")).length, 1, "still told once 30 s after the re-join");
  void b;
});

test("D45: the card's activity carries the call's own label and whole command, null from a link that sent none", () => {
  const { run } = setup();
  const base = Date.now();
  const open = { name: "Bash", target: "npm run build", since: base, label: "Build the viewer", command: "cd app && npm run build" };
  board.recordActivity(run.id, "a", act({ grewAt: base, openTool: open, background: { target: "npm test", since: base, outputGrewAt: null } }), at(base, 0));
  const card = board.snapshot(REPO).roster.find((r) => r.member === "g/a")!;
  assert.deepEqual([card.activity?.open?.label, card.activity?.open?.command], ["Build the viewer", "cd app && npm run build"]);
  assert.deepEqual([card.activity?.background?.label, card.activity?.background?.command], [null, null]);
});
