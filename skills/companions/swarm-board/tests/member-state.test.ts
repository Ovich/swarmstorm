// A member's one state (liveness.ts coreStateOf), from its link, its tokens and what it owed at its drop: working,
// stopped, lost, away, ended; read the same by the snapshot, the roster and `status` (which prints the roster). A park reads away until the
// orchestrator's unpark, and a parked member reads no lost anywhere.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board, type Participant, type Presence } from "../src/board/board.ts";
import { openRawStore } from "./fixtures/raw-store.ts";
import { quietMember } from "./fixtures/quiet-member.ts";
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

test("link up: working while its tokens moved within the window, stopped past it, owing or not; a held wait changes nothing", async () => {
  const { run, a, orch } = setup();
  pins("g/a", "working", null);
  board.phase(orch, "p1", "go");
  const held = heldWait(a);
  pins("g/a", "working", null);
  await held;
  quietMember(path.join(dir, "swarm.sqlite"), "a", 20 * 60_000);
  board.recordActivity(run.id, "a", act({ grewAt: Date.now() - 15 * 60_000 }), new Date());
  tick2(board, run.id, new Date(), linked);
  pins("g/a", "stopped", null);
  board.done(a, "p1");
  pins("g/a", "stopped", null);
  board.recordActivity(run.id, "a", act({ grewAt: Date.now() }), new Date());
  pins("g/a", "working", null);
});

test("link down: away with none when it dropped owing nothing, and still away once a phase opens; lost with its badge when it dropped owing (#48)", () => {
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
  pins("g/a", "away", null);
  // its link back, then down again while it owes p1: lost
  tick2(board, run.id, new Date(base + 1000), linked);
  tick2(board, run.id, new Date(base + 2000), down);
  pins("g/a", "lost", "lost");
});

test("the orchestrator always owes: it reads working", () => {
  setup();
  pins("g/orchestrator", "working", null);
});

test("D53, fix2: a link down past LOST_MS reads lost owing the phase, its board calls notwithstanding; a fresh seating is never lost", async () => {
  const { run, a, orch } = setup();
  board.phase(orch, "p1", "go");
  const base = Date.now();
  const linkGone: Presence = (m) => (m === "a" ? { connected: false, lostAt: base - 300_000 } : linked(m));
  quietMember(path.join(dir, "swarm.sqlite"), "a");
  // its link long lost: lost, whatever it calls (the state reads the link's own fact, as its age does)
  board.setDoing(a, "still here");
  tick2(board, run.id, new Date(base), linkGone);
  pins("g/a", "lost", "lost");
  // a new agent seated in it (a rejoin): the old link's loss is not its own
  board.join({ run: run.id, seat: "a", doing: "fresh", files: [] });
  tick2(board, run.id, new Date(base), linkGone);
  pins("g/a", "working", null);
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
