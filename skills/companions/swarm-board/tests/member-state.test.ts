// board-split D48, D49 (a1's audit #909, its truth table rows 1–17): one derivation of a member's state, from board
// facts only, read the same by the snapshot, the roster and `status` (which prints the roster); a park holds until
// the orchestrator's unpark, and a parked member reads no lost anywhere.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board, type Participant, type Presence } from "../src/board/board.ts";
import { codeVerbs } from "../src/packs/code/calls.ts";
import type { MemberActivity } from "../src/wire.ts";

const REPO = "/repos/one/.git";
let dir: string;
let board: Board;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-member-state-"));
  board = await openBoard(path.join(dir, "swarm.sqlite"));
});
afterEach(() => {
  board.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const linked: Presence = () => ({ connected: true, lostAt: null });
const act = (o: Partial<MemberActivity> = {}): MemberActivity => ({ grewAt: null, tokens: 0, context: null, openTool: null, lastTool: null, finished: false, ...o });
const boardWaitCall = (since: number) => ({ name: "Bash", target: "swarm wait --mentions", since, boardWait: true, shell: true });

const setup = () => {
  const run = board.openRun({ repo: REPO, kind: "plan", group: "g", title: "T", seats: [{ id: "a", blockers: [] }] });
  const a = board.join({ run: run.id, seat: "a", doing: "x", files: [] }).member;
  const orch = board.participant("g/orchestrator")!;
  return { run, a, orch };
};

/** What the snapshot and the roster say of `member`, state and badge; the roster (and so `status`) is null once ended. */
const shown = (member: string) => {
  const snap = board.snapshot(REPO).roster.find((r) => r.member === member)!;
  const row = board.roster(REPO).find((r) => r.name === member);
  return {
    snapshot: [snap.state, snap.badge?.name ?? null],
    roster: row ? [row.fact ?? row.state, row.badge?.name ?? null] : null,
  };
};
/** One truth-table row: the snapshot reads `[state, badge]`, and the roster the same while the member is live. */
const pins = (member: string, state: string, badge: string | null, live = true): void =>
  assert.deepEqual(shown(member), { snapshot: [state, badge], roster: live ? [state, badge] : null });

const heldWait = (p: Participant) => board.wait(p, { mentionsOnly: true, timeoutMs: 400 });

test("rows 1, 2: a closed run or an ended member reads ended, no badge", () => {
  const { run, a, orch } = setup();
  board.end(a);
  pins("g/a", "ended", null, false);
  board.closeRun(run.id);
  pins("g/orchestrator", "ended", null, false);
  void orch;
});

test("rows 3, 4, 16: parked holds over a lost link, an ended agent and a block; no badge", () => {
  const { run, orch } = setup();
  board.park(orch, "a", "p2");
  const base = Date.now();
  board.recordActivity(run.id, "a", act({ grewAt: base - 600_000, finished: true }), new Date(base));
  board.livenessTick(run.id, new Date(base + 120_000), (m) => (m === "a" ? { connected: false, lostAt: base - 600_000 } : linked(m)));
  pins("g/a", "parked", null);
  board.block(orch, "a", "the person picks");
  pins("g/a", "parked", null);
});

test("row 5 (A1-1): a parked member's own wait, doing and post leave it parked; only unpark lifts it", async () => {
  const { a, orch } = setup();
  board.park(orch, "a");
  const held = heldWait(a);
  board.setDoing(a, "back");
  board.post(a, "@orchestrator here");
  await held;
  board.deliver(a);
  pins("g/a", "parked", null);
  board.unpark(orch, "a");
  pins("g/a", "working", null);
});

test("row 6: the merge lock's holder reads merging, in or out of a wait", async () => {
  const { a } = setup();
  codeVerbs(board).lockMerge(a);
  pins("g/a", "merging", null);
  const held = heldWait(a);
  pins("g/a", "merging", null);
  await held;
});

test("rows 7, 8: in a held board wait, its open call, waiting; a background task of its own is activity, not a state", async () => {
  const { run, a } = setup();
  const base = Date.now();
  const held = heldWait(a);
  board.recordActivity(run.id, "a", act({ grewAt: base, openTool: boardWaitCall(base) }), new Date(base));
  pins("g/a", "waiting", null);
  board.recordActivity(run.id, "a", act({ grewAt: base, openTool: boardWaitCall(base), background: { target: "npm test", since: base, outputGrewAt: base } }), new Date(base));
  pins("g/a", "waiting", null);
  await held;
});

test("rows 9, 10, 11 (A1-3, A1-5): a background listener alone, out of any wait, or a wait returned: working", async () => {
  const { run, a, orch } = setup();
  board.phase(orch, "p1", "go");
  board.done(a, "p1");
  const base = Date.now();
  // a listener held while its agent runs another call (owing nothing: still working, never from the phase)
  const held = heldWait(a);
  board.recordActivity(run.id, "a", act({ grewAt: base, openTool: { name: "Bash", target: "npm test", since: base, boardWait: false, shell: true } }), new Date(base));
  pins("g/a", "working", null);
  await held;
  // the wait returned: no stale column keeps it waiting
  board.recordActivity(run.id, "a", act({ grewAt: base }), new Date(base));
  pins("g/a", "working", null);
});

test("rows 12, 13: link lost or agent gone, not parked: its state, badge lost", () => {
  const { run } = setup();
  const base = Date.now();
  board.recordActivity(run.id, "a", act({ grewAt: base - 600_000 }), new Date(base - 600_000));
  board.livenessTick(run.id, new Date(base), (m) => (m === "a" ? { connected: false, lostAt: base - 600_000 } : linked(m)));
  pins("g/a", "working", "lost");
});

test("rows 14, 15: blocked by the orchestrator or a pause on the person: its state, badge blocked", () => {
  const { orch } = setup();
  board.block(orch, "a", "the person picks");
  pins("g/a", "working", "blocked");
  board.unblock(orch, "a");
  board.pause(orch, "the person decides", { person: true });
  pins("g/a", "working", "blocked");
});

test("row 17: the orchestrator reads waiting", () => {
  setup();
  pins("g/orchestrator", "waiting", null);
});

test("A1-2: parked after a lost was told: no lost in composition or progress", () => {
  const { run, orch } = setup();
  board.phase(orch, "p1", "go");
  const base = Date.now();
  board.recordActivity(run.id, "a", act({ grewAt: base - 600_000 }), new Date(base - 600_000));
  board.livenessTick(run.id, new Date(base), (m) => (m === "a" ? { connected: false, lostAt: base - 600_000 } : linked(m)));
  assert.equal(board.composition(run.id).entries.find((e) => e.seat === "a")!.state, "lost");
  board.park(orch, "a");
  assert.equal(board.composition(run.id).entries.find((e) => e.seat === "a")!.state, "joined");
  assert.deepEqual(board.phaseProgress(run.id)!.gone, []);
  pins("g/a", "parked", null);
});

test("D50: a task is the orchestrator's post --task to one member, for the open phase; a mention alone never is", () => {
  const { a, orch } = setup();
  board.phase(orch, "p1", "go");
  const owesOf = () => board.snapshot(REPO).roster.find((r) => r.member === "g/a")!.owes;
  assert.deepEqual(owesOf(), { phase: "p1", task: null });
  const task = board.post(orch, "@a do T1", { task: true });
  board.post(orch, "@a judged, go on");
  assert.deepEqual(owesOf(), { phase: "p1", task: task.seq });
  assert.throws(() => board.post(a, "@orchestrator mine", { task: true }), /only the orchestrator/);
  assert.throws(() => board.post(orch, "nobody", { task: true }), /exactly one member/);
  // the next phase has no task until one is posted in it
  board.phase(orch, "p2", "next");
  assert.deepEqual(owesOf(), { phase: "p2", task: null });
});
