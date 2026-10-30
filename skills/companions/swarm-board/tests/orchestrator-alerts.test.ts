// break-flow T55 (plan D64, D65): the orchestrator's idle and stall lines name a question left for it (V-8), a no-phase
// task owes its report (V-9), a pause shows in status/roster and in a phase opened under it (V-10), and the
// task-end notice is told to the orchestrator's background listener alone (V-12).
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board, type Presence } from "../src/board/board.ts";
import { BADGE_CONFIRM_MS, STALL_MS_DEFAULT } from "../src/board/liveness.ts";
import { stalledOf } from "../src/board/stall.ts";
import { answer } from "../src/cli/answer/index.ts";
import type { Situation } from "../src/cli/answer/situation.ts";
import { WORDING } from "../src/cli/answer/wording.ts";
import type { MemberActivity } from "../src/wire.ts";

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
  const task = board.post(orch, "@a your task", { task: true });
  for (const p of [a, orch]) board.deliver(p);
  board.recordActivity(run.id, "a", act(), new Date());
  return { run: run.id, a, orch, taskSeq: task.seq };
};

/** Holds `a` in a board wait from `base`, as its link reports it. */
const heldWait = (run: number, a: ReturnType<typeof taskedNoPhase>["a"], base: number) => {
  const stop = new AbortController();
  const held = board.wait(a, { mentionsOnly: true, timeoutMs: 60_000, signal: stop.signal }).catch(() => null);
  board.recordActivity(run, "a", act({ openTool: { name: "Bash", target: "", since: base, boardWait: true } }), new Date(base));
  return async () => {
    stop.abort();
    await held;
  };
};

test("V-9 stalledOf: a no-phase task owes its report: the fact names the task", () => {
  const T0 = 1_800_000_000_000;
  const f = { shownState: "waiting", owes: "task #7", owesReport: true, taskDeliveredAt: T0, clockFloorAt: 0, inHeldWait: true, waitSpellSince: null, openCallSince: null, background: null, transcriptGrewAt: null, signAt: T0, stallMs: STALL_MS_DEFAULT, silentMs: 600_000, busyMaxMs: 900_000, lockStall: null };
  assert.deepEqual(stalledOf(f, T0 + STALL_MS_DEFAULT), { rule: "owing", since: T0, fact: "task #7 delivered, no report, in a wait" });
});

test("V-9: no phase open, a delivered task with no report reads stalled in a held wait past the window, once", async () => {
  const { run, a, taskSeq } = taskedNoPhase();
  const base = Date.now();
  const release = heldWait(run, a, base);
  const due = base + STALL_MS_DEFAULT + 1000;
  board.livenessTick(run, new Date(due), linked);
  board.livenessTick(run, new Date(due + BADGE_CONFIRM_MS), linked);
  const stalled = events("stalled").map((e) => e.body);
  assert.equal(stalled.length, 1);
  assert.match(stalled[0], new RegExp(`^stalled g/a: waiting, task #${taskSeq} delivered, no report, in a wait \\d+ min; no phase open$`));
  board.livenessTick(run, new Date(due + 60_000), linked);
  assert.equal(events("stalled").length, 1, "one alarm per episode");
  await release();
});

test("V-9: a report to the orchestrator after the task ends the owing", async () => {
  const { run, a } = taskedNoPhase();
  board.post(a, "@orchestrator done: here is my report");
  const base = Date.now();
  const release = heldWait(run, a, base);
  const due = base + STALL_MS_DEFAULT + 1000;
  board.livenessTick(run, new Date(due), linked);
  board.livenessTick(run, new Date(due + BADGE_CONFIRM_MS), linked);
  assert.equal(events("stalled").length, 0);
  await release();
});

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

test("V-8: the stalled line names the unanswered question too", async () => {
  const run = board.openRun({ repo: REPO, kind: "task", group: "g", title: "g", seats: [{ id: "a", blockers: [] }] });
  const a = board.join({ run: run.id, seat: "a", doing: "x", files: [] }).member;
  const orch = board.participant("g/orchestrator")!;
  board.phase(orch, "p1", "go");
  board.post(orch, "@a your part", { task: true });
  const question = board.post(a, "@orchestrator is p1 x or y?");
  for (const p of [a, orch]) board.deliver(p);
  board.recordActivity(run.id, "a", act(), new Date());
  const base = Date.now();
  const release = heldWait(run.id, a, base);
  const due = base + STALL_MS_DEFAULT + 1000;
  board.livenessTick(run.id, new Date(due), linked);
  board.livenessTick(run.id, new Date(due + BADGE_CONFIRM_MS), linked);
  const stalled = events("stalled").map((e) => e.body);
  assert.equal(stalled.length, 1);
  assert.match(stalled[0], new RegExp(`; phase p1 0/1 done; unanswered @orchestrator #${question.seq} from g/a$`));
  await release();
});

test("V-10: status/roster show a pause, on the person or with its reason; a phase under a pause says when it is heard", () => {
  assert.equal(WORDING.runPausedShown(null, false), "");
  assert.equal(WORDING.runPausedShown("pick a port", true), "  paused · on you: pick a port");
  assert.equal(WORDING.runPausedShown("rebasing", false), "  paused: rebasing");
  assert.equal(WORDING.runPausedShown("", false), "  paused");
  assert.equal(WORDING.phaseOpenedPaused("p2", 4), "run 4 is paused: phase p2 is open, and its members hear it at resume");
});

const situation = (listens: Situation["listens"]): Situation => ({
  cli: "swarm", as: "g/x", run: 1, seat: listens === "orchestrator" ? "orchestrator" : "a", ended: false, listenerRunning: true, listens,
  wholeThread: false, closed: false, pause: null, phase: null, owed: null, phaseFirst: null,
});
const woke = { verb: "wait" as const, outcome: "woke" as const, again: "swarm wait", foregroundAgain: "swarm wait", phaseEvent: false, mentionsOnly: true, shown: [], lines: ["#1 a post"] };

test("V-12: the task-end notice is told to the orchestrator's background listener, never on a member's wait", () => {
  assert.ok(answer(woke, situation("orchestrator")).lines.includes(WORDING.delivered));
  assert.ok(!answer(woke, situation("foreground")).lines.includes(WORDING.delivered));
  assert.ok(!answer(woke, situation("background")).lines.includes(WORDING.delivered));
});
