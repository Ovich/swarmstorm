// break-flow T55 (plan D64, D65): the orchestrator's idle and stall lines name a question left for it (V-8), a pause
// shows in status/roster and in a phase opened under it (V-10), and the
// task-end notice is told to the orchestrator's background listener alone (V-12).
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board, type Presence } from "../src/board/board.ts";
import { BADGE_CONFIRM_MS, STALL_MS_DEFAULT } from "../src/board/liveness.ts";
import { stalledOf } from "../src/board/stall.ts";
import { answer, eventStep, lostMentionLines } from "../src/cli/answer/index.ts";
import type { Situation } from "../src/cli/answer/situation.ts";
import { WORDING } from "../src/cli/answer/wording.ts";
import type { MemberActivity } from "../src/wire.ts";
import { codeVerbs } from "../src/packs/code/calls.ts";
import { quietMember } from "./fixtures/quiet-member.ts";
import { tick2 } from "./fixtures/tick2.ts";

delete process.env.SWARM_BADGE_CONFIRM_MS;
delete process.env.SWARM_STALL_FLOOR_MS;

const REPO = "/repos/alerts/.git";
let dir: string;
let board: Board;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-alerts-"));
  board = await openBoard(path.join(dir, "swarm.sqlite"));
});
afterEach(() => {
  board.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const linked: Presence = () => ({ connected: true, lostAt: null });
const act = (o: Partial<MemberActivity> = {}): MemberActivity => ({ grewAt: null, tokens: 0, context: null, openTool: null, lastTool: null, finished: false, ...o });
const events = (name: string) => board.snapshot(REPO).events.filter((e) => e.event === name);

/** A task run, no phase, one worker `a` handed a task now, its link spoken. */
const taskedNoPhase = () => {
  const run = board.openRun({ repo: REPO, kind: "task", group: "g", title: "g", seats: [{ id: "a", blockers: [] }] });
  const a = board.join({ run: run.id, seat: "a", doing: "x", files: [] }).member;
  const orch = board.participant("g/orchestrator")!;
  const task = board.post(orch, "@a your task");
  for (const p of [a, orch]) board.deliver(p);
  board.recordActivity(run.id, "a", act(), new Date());
  return { run: run.id, a, orch, taskSeq: task.seq };
};

test("V-8: the idle line names a question to the orchestrator left unanswered; an answer clears it", async () => {
  const run = board.openRun({ repo: REPO, kind: "task", group: "g", title: "g", seats: [{ id: "a", blockers: [] }] });
  const a = board.join({ run: run.id, seat: "a", doing: "x", files: [] }).member;
  const orch = board.participant("g/orchestrator")!;
  const q = board.post(a, "@orchestrator which file do I take?");
  const base = Date.now();
  const w = board.wait(a, { mentionsOnly: true, timeoutMs: 400 });
  board.livenessTick(run.id, new Date(base + 1000), linked);
  assert.deepEqual(events("idle").map((e) => e.body), [`idle 0s: every member is waiting; no phase open; unanswered @orchestrator #${q.seq} from g/a`]);
  await w;
  board.post(orch, "@a take x");
  const w2 = board.wait(a, { mentionsOnly: true, timeoutMs: 400 });
  board.livenessTick(run.id, new Date(base + 16 * 60_000), linked);
  await w2;
  assert.ok(events("idle").every((e, i) => i === 0 || !e.body.includes("unanswered")), "answered: no longer named");
});

test("V-8: the stalled line names the unanswered question too", () => {
  const run = board.openRun({ repo: REPO, kind: "task", group: "g", title: "g", seats: [{ id: "a", blockers: [] }] });
  const a = board.join({ run: run.id, seat: "a", doing: "x", files: [] }).member;
  const orch = board.participant("g/orchestrator")!;
  board.phase(orch, "p1", "go");
  board.post(orch, "@a your part");
  const question = board.post(a, "@orchestrator is p1 x or y?");
  for (const p of [a, orch]) board.deliver(p);
  board.recordActivity(run.id, "a", act(), new Date());
  const due = Date.now() + STALL_MS_DEFAULT + 1000;
  board.livenessTick(run.id, new Date(due), linked);
  board.livenessTick(run.id, new Date(due + BADGE_CONFIRM_MS), linked);
  const stalled = events("stalled").map((e) => e.body);
  assert.equal(stalled.length, 1);
  assert.match(stalled[0], new RegExp(`; phase p1 0/1 done; unanswered @orchestrator #${question.seq} from g/a$`));
});

test("V-10: status/roster show a pause, on the person or with its reason; a phase under a pause says when it is heard", () => {
  assert.equal(WORDING.runPausedShown(null, false), "");
  assert.equal(WORDING.runPausedShown("pick a port", true), "  paused · on you: pick a port");
  assert.equal(WORDING.runPausedShown("rebasing", false), "  paused: rebasing");
  assert.equal(WORDING.runPausedShown("", false), "  paused");
  assert.equal(WORDING.phaseOpenedPaused("p2", 4), "run 4 is paused: phase p2 is open, and its members hear it at resume");
});

const situation = (listens: Situation["listens"]): Situation => ({
  cli: "swarm", as: "g/x", run: 1, seat: listens === "orchestrator" ? "orchestrator" : "a", ended: false, parked: false, listenerRunning: true, listens,
  wholeThread: false, closed: false, pause: null, phase: null, owed: null, phaseFirst: null, owesNothing: false,
});
const woke = { verb: "wait" as const, outcome: "woke" as const, again: "swarm wait", foregroundAgain: "swarm wait", phaseEvent: false, mentionsOnly: true, shown: [], lines: ["#1 a post"] };

test("V-12: the task-end notice is told to the orchestrator's background listener, never on a member's wait", () => {
  assert.ok(answer(woke, situation("orchestrator")).lines.includes(WORDING.delivered));
  assert.ok(!answer(woke, situation("foreground")).lines.includes(WORDING.delivered));
  assert.ok(!answer(woke, situation("background")).lines.includes(WORDING.delivered));
});

test("V-23: the board's lock-freed notice for a lost holder is never taken for a member's question", async () => {
  const run = board.openRun({ repo: REPO, kind: "task", group: "g", title: "g", seats: ["w1", "w2"].map((id) => ({ id, blockers: [] })) });
  const w1 = board.join({ run: run.id, seat: "w1", doing: "x", files: [] }).member;
  const w2 = board.join({ run: run.id, seat: "w2", doing: "x", files: [] }).member;
  codeVerbs(board).lockMerge(w2);
  codeVerbs(board).lockMerge(w1);
  // w2 owes the open phase: a link down owing nothing is only away
  board.phase(board.participant("g/orchestrator")!, "p", "go", { for: ["g/w2"] });
  board.deliver(w2);
  const base = Date.now();
  quietMember(path.join(dir, "swarm.sqlite"), "w2", 120_000);
  const presence: Presence = (m) => (m === "w2" ? { connected: false, lostAt: base - 61_000 } : { connected: true, lostAt: null });
  tick2(board, run.id, new Date(base), presence);
  assert.ok(events("lost").length === 1, "w2 lost, its lock freed");
  const question = board.post(w1, "@orchestrator which file?");
  board.deliver(w1);
  const w = board.wait(w1, { mentionsOnly: true, timeoutMs: 400 });
  board.livenessTick(run.id, new Date(base + 20_000), presence);
  await w;
  const idle = events("idle").map((e) => e.body);
  assert.equal(idle.length, 1);
  assert.match(idle[0], new RegExp(`unanswered @orchestrator #${question.seq} from g/w1$`));
});

test("golden V-47: the orchestrator's post naming a lost member says it is lost, with the move, the post recorded", () => {
  assert.deepEqual(lostMentionLines(["g/w2"], "swarm", "g/orchestrator"), [
    "g/w2 is lost: the post is recorded, but nothing reads it now; its agent is not running: dispatch it again, or end its seat: swarm end --seat w2 --as g/orchestrator",
  ]);
  assert.deepEqual(lostMentionLines([], "swarm", "g/orchestrator"), []);
});
