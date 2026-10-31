// A member's one state (liveness.ts coreStateOf), from two facts, link up and owes work: working, idle, lost, away,
// ended; read the same by the snapshot, the roster and `status` (which prints the roster). A park reads away until the
// orchestrator's unpark, and a parked member reads no lost anywhere.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board, type Participant, type Presence } from "../src/board/board.ts";
import { openRawStore } from "./fixtures/raw-store.ts";
import { quietMember } from "./fixtures/quiet-member.ts";
import { codeVerbs } from "../src/packs/code/calls.ts";
import type { MemberActivity } from "../src/wire.ts";
import { tick2 } from "./fixtures/tick2.ts";

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
    roster: row ? [row.state, row.badge?.name ?? null] : null,
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

test("parked reads away, over a lost link, an ended agent and a block; no badge", () => {
  const { run, orch } = setup();
  board.phase(orch, "p1", "go");
  board.park(orch, "a", "p2");
  const base = Date.now();
  board.recordActivity(run.id, "a", act({ grewAt: base - 600_000, finished: true }), new Date(base));
  tick2(board, run.id, new Date(base + 120_000), (m) => (m === "a" ? { connected: false, lostAt: base - 300_000 } : linked(m)));
  pins("g/a", "away", null);
  board.block(orch, "a", "the person picks");
  pins("g/a", "away", null);
});

test("A1-1: a parked member's own wait, doing and post leave it away; only unpark lifts it", async () => {
  const { a, orch } = setup();
  board.phase(orch, "p1", "go");
  board.park(orch, "a");
  const held = heldWait(a);
  board.setDoing(a, "back");
  board.post(a, "@orchestrator here");
  await held;
  board.deliver(a);
  pins("g/a", "away", null);
  board.unpark(orch, "a");
  pins("g/a", "working", null);
});

test("link up: working while it owes the open phase, idle once done or with none open; a held wait changes nothing", async () => {
  const { a, orch } = setup();
  pins("g/a", "idle", null);
  board.phase(orch, "p1", "go");
  pins("g/a", "working", null);
  const held = heldWait(a);
  pins("g/a", "working", null);
  await held;
  board.done(a, "p1");
  pins("g/a", "idle", null);
});

test("link down: lost with its badge while it owes work, away with none while it owes nothing", () => {
  const { run, orch } = setup();
  const base = Date.now();
  quietMember(path.join(dir, "swarm.sqlite"), "a");
  board.recordActivity(run.id, "a", act({ grewAt: base - 600_000 }), new Date(base - 600_000));
  const down: Presence = (m) => (m === "a" ? { connected: false, lostAt: base - 300_000 } : linked(m));
  tick2(board, run.id, new Date(base), down);
  pins("g/a", "away", null);
  board.phase(orch, "p1", "go");
  quietMember(path.join(dir, "swarm.sqlite"), "a");
  tick2(board, run.id, new Date(base), down);
  pins("g/a", "lost", "lost");
});

test("blocked by the orchestrator or a pause on the person: its state, badge blocked", () => {
  const { orch } = setup();
  board.block(orch, "a", "the person picks");
  pins("g/a", "idle", "blocked");
  board.unblock(orch, "a");
  board.pause(orch, "the person decides", { person: true });
  pins("g/a", "idle", "blocked");
});

test("the orchestrator always owes: it reads working", () => {
  setup();
  pins("g/orchestrator", "working", null);
});

test("A1-2: parked after a lost was told: no lost in composition or progress", () => {
  const { run, orch } = setup();
  board.phase(orch, "p1", "go");
  const base = Date.now();
  quietMember(path.join(dir, "swarm.sqlite"), "a");
  board.recordActivity(run.id, "a", act({ grewAt: base - 600_000 }), new Date(base - 600_000));
  tick2(board, run.id, new Date(base), (m) => (m === "a" ? { connected: false, lostAt: base - 300_000 } : linked(m)));
  assert.equal(board.composition(run.id).entries.find((e) => e.seat === "a")!.state, "lost");
  board.park(orch, "a");
  // U-F4: the join answer's head lines (the composition) say away, as the roster does
  assert.equal(board.composition(run.id).entries.find((e) => e.seat === "a")!.state, "away");
  assert.ok(board.composition(run.id).lines.some((l) => l.startsWith("a ") && l.endsWith(": away")));
  assert.deepEqual(board.phaseProgress(run.id)!.gone, []);
  pins("g/a", "away", null);
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
  // D50 amended (U-F8): the run's latest task holds across phases; done with the open phase, it owes nothing
  board.phase(orch, "p2", "next");
  assert.deepEqual(owesOf(), { phase: "p2", task: task.seq });
  board.done(a, "p2");
  assert.equal(owesOf(), undefined);
});

test("D53: a member still calling the board, or a fresh seating, is never lost on its link alone", async () => {
  const { run, a, orch } = setup();
  board.phase(orch, "p1", "go");
  const base = Date.now();
  const linkGone: Presence = (m) => (m === "a" ? { connected: false, lostAt: base - 300_000 } : linked(m));
  // its link long lost, yet it calls the board: not lost
  board.setDoing(a, "still here");
  tick2(board, run.id, new Date(base), linkGone);
  pins("g/a", "working", null);
  // silent long after: lost
  quietMember(path.join(dir, "swarm.sqlite"), "a");
  tick2(board, run.id, new Date(base), linkGone);
  pins("g/a", "lost", "lost");
  // a new agent seated in it (a rejoin): the old link's loss is not its own, and it is calling
  board.join({ run: run.id, seat: "a", doing: "fresh", files: [] });
  tick2(board, run.id, new Date(base), linkGone);
  pins("g/a", "working", null);
});

test("D53, D55: a link-less member whose transcript still grows, as its link last sent it, is not lost", () => {
  const { run, orch } = setup();
  board.phase(orch, "p1", "go");
  quietMember(path.join(dir, "swarm.sqlite"), "a");
  const base = Date.now();
  board.recordActivity(run.id, "a", { grewAt: base - 1000, tokens: 0, context: null, openTool: null, lastTool: null, finished: false }, new Date(base - 1000));
  tick2(board, run.id, new Date(base), (m) => (m === "a" ? { connected: false, lostAt: base - 300_000 } : linked(m)));
  pins("g/a", "working", null);
});

test("D52: a merge lock held past LOCK_HELD_MS badges its holder stalled 'merging, holds the merge lock N min'", () => {
  const { run, a } = setup();
  codeVerbs(board).lockMerge(a);
  assert.equal(board.snapshot(REPO).roster.find((r) => r.member === "g/a")!.fact, "merging");
  pins("g/a", "idle", null);
  const raw = openRawStore(path.join(dir, "swarm.sqlite"));
  try {
    raw.prepare("UPDATE merge_locks SET at = ?").run(new Date(Date.now() - 11 * 60_000).toISOString());
  } finally {
    raw.close();
  }
  tick2(board, run.id, new Date(), linked);
  pins("g/a", "idle", "stalled");
  assert.match(board.snapshot(REPO).roster.find((r) => r.member === "g/a")!.badge!.reason, /^merging, holds the merge lock 11 min$/);
});

test("roster: a parked member carries the phase it is parked until", () => {
  const { orch } = setup();
  board.park(orch, "a", "verify");
  assert.equal(board.roster(REPO).find((r) => r.name === "g/a")!.parkedUntil, "verify");
});

test("U-F20: a badge that comes with time alone is a change the readers redraw on, so the card and the roster read the same", () => {
  const { run, orch } = setup();
  board.phase(orch, "p1", "go");
  quietMember(path.join(dir, "swarm.sqlite"), "a");
  const version = (): number => {
    const raw = openRawStore(path.join(dir, "swarm.sqlite"), { readOnly: true });
    try {
      return Number((raw.prepare("SELECT version FROM changes WHERE repo = ?").get(REPO) as { version: number }).version);
    } finally {
      raw.close();
    }
  };
  const base = Date.now();
  tick2(board, run.id, new Date(base), linked);
  const before = version();
  tick2(board, run.id, new Date(base), linked);
  assert.equal(version(), before, "nothing changed, nothing told");
  // the badge comes with time alone: the version moves
  tick2(board, run.id, new Date(base), (m) => (m === "a" ? { connected: false, lostAt: base - 300_000 } : linked(m)));
  assert.ok(version() > before);
  pins("g/a", "lost", "lost");
});
