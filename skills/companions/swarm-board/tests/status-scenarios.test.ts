// board-split D48, D49: a member's life through the cases the person named, scripted, its state and badge pinned at
// each step in the snapshot (the card), the roster (`roster`, `status`) and the tick's own states alike. The board's
// own store and API; a link is the presence the server would hand the tick, the agent's end its link going.
import { quietMember } from "./fixtures/quiet-member.ts";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board, type Participant, type Presence } from "../src/board/board.ts";
import { BUSY_MAX_MS, LOST_MS } from "../src/board/liveness.ts";
import type { MemberActivity } from "../src/wire.ts";
import { openRawStore } from "./fixtures/raw-store.ts";
import { tick2 } from "./fixtures/tick2.ts";

const REPO = "/repos/status/.git";
let dir: string;
let board: Board;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-status-"));
  board = await openBoard(path.join(dir, "swarm.sqlite"));
});
afterEach(() => {
  board.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const act = (o: Partial<MemberActivity> = {}): MemberActivity => ({ grewAt: null, tokens: 0, context: null, openTool: null, lastTool: null, finished: false, ...o });
/** Every member's link as the scenario sets it; one not set is up. */
let links: Map<string, { connected: boolean; lostAt: number | null }>;
const presence: Presence = (m) => links.get(m) ?? { connected: true, lostAt: null };
/** The agent behind `seat` ended: its link went `ago` ms back, its transcript says finished. */
const agentEnds = (run: number, seat: string, ago = LOST_MS + 1000) => {
  // D53: an ended agent makes no board call either, since then
  quietMember(path.join(dir, "swarm.sqlite"), seat, ago);
  board.recordActivity(run, seat, act({ grewAt: Date.now() - ago, finished: true }), new Date());
  links.set(seat, { connected: false, lostAt: Date.now() - ago });
};
const tick = (run: number) => tick2(board, run, new Date(), presence);
const events = (name: string) => board.snapshot(REPO).events.filter((e) => e.event === name);

/** What every reader shows of `member` now: one state and one badge, or the readers disagree. */
const shown = (run: number, member: string): { state: string; badge: string | null } => {
  const card = board.snapshot(REPO).roster.find((r) => r.member === member);
  const row = board.roster(REPO).find((r) => r.name === member);
  assert.ok(card, `${member} is on the board`);
  const fromCard = { state: card.state, badge: card.badge?.name ?? null };
  // the roster lists the members still in the run; an ended one is the card's alone
  if (card.state === "ended") assert.equal(row, undefined, `${member}: an ended member leaves the roster`);
  else {
    assert.ok(row, `${member} is on the roster`);
    assert.deepEqual({ state: row.state, badge: row.badge?.name ?? null }, fromCard, `${member}: the roster and the card agree`);
  }
  const ticked = board.memberStates(run, new Date()).find((s) => s.member === member.slice(member.indexOf("/") + 1));
  // the tick's states hold the live members; a parked one's badge is never raised by it (D30)
  if (ticked && !card.parked) assert.equal(ticked.badge?.name ?? null, fromCard.badge, `${member}: the tick's badge and the card agree`);
  return fromCard;
};

const setup = () => {
  links = new Map();
  const run = board.openRun({ repo: REPO, kind: "brainstorm", group: "g", title: "T", stallMs: 5000, seats: [{ id: "a", blockers: [] }, { id: "b", blockers: [] }] });
  const a = board.join({ run: run.id, seat: "a", doing: "x", files: [] }).member;
  const b = board.join({ run: run.id, seat: "b", doing: "x", files: [] }).member;
  const orch = board.participant("g/orchestrator")!;
  for (const p of [a, b, orch]) board.deliver(p);
  return { run, a, b, orch };
};
const waitOf = (p: Participant, ms = 300) => board.wait(p, { mentionsOnly: true, timeoutMs: ms });

test("1: park, then the member's agent ends: still parked, no badge, its unread held, nothing raised", () => {
  const { run, orch } = setup();
  board.park(orch, "b", "p2");
  agentEnds(run.id, "b");
  board.post(orch, "@b for later");
  tick(run.id);
  assert.deepEqual(shown(run.id, "g/b"), { state: "away", badge: null });
  assert.ok(board.roster(REPO).find((r) => r.name === "g/b")!.unread > 0, "the post waits for it");
  assert.deepEqual([...events("lost"), ...events("stalled")].filter((e) => e.body.includes("g/b")), []);
});

test("2: the agent ends owing nothing (done, or no task): away once its link is lost past LOST_MS, nothing raised", async () => {
  const { run, b, orch } = setup();
  board.phase(orch, "p1", "go", { for: ["b"] });
  board.done(b, "p1");
  // its link went just now: still idle
  agentEnds(run.id, "b", 1000);
  tick(run.id);
  assert.deepEqual(shown(run.id, "g/b"), { state: "idle", badge: null });
  // past LOST_MS: away, no lost line
  agentEnds(run.id, "b");
  tick(run.id);
  assert.deepEqual(shown(run.id, "g/b"), { state: "away", badge: null });
  assert.equal(events("lost").length, 0);
  assert.equal(board.runs().find((r) => r.id === run.id)!.seats.find((x) => x.id === "b")!.state, "away");
});

test("2b: the agent ends owing the open phase: lost past LOST_MS, told once", () => {
  const { run, orch } = setup();
  board.phase(orch, "p1", "go", { for: ["b"] });
  agentEnds(run.id, "b");
  tick(run.id);
  assert.deepEqual(shown(run.id, "g/b"), { state: "lost", badge: "lost" });
  assert.equal(events("lost").length, 1);
  assert.equal(board.runs().find((r) => r.id === run.id)!.seats.find((x) => x.id === "b")!.state, "lost");
});

test("3: a background task of its own while in a board wait: busy activity, no badge; owing the open phase past the stall time, never held-wait stalled; stalled only past BUSY_MAX with no growth (D55 amended, O-F3)", async () => {
  const { run, b, orch } = setup();
  board.phase(orch, "p1", "go", { for: ["b"] });
  // board-split D54: the owing clock starts at b's own task, delivered
  board.post(orch, "@b your part", { task: true });
  board.deliver(b);
  const held = waitOf(b, 3000);
  const now = Date.now();
  board.recordActivity(run.id, "b", act({ grewAt: now, openTool: { name: "Bash", target: "swarm wait --mentions", since: now, boardWait: true, shell: true }, background: { target: "npm test", since: now, outputGrewAt: now } }), new Date());
  tick(run.id);
  const early = shown(run.id, "g/b");
  assert.equal(early.badge, null);
  const ticked = board.memberStates(run.id, new Date()).find((s) => s.member === "b")!;
  assert.match(ticked.doing ?? "", /background npm test/);
  // past the stall time, still in the wait, owing p1: busy on its own task, no badge
  const lateAt = new Date(Date.now() + 6000);
  tick2(board, run.id, lateAt, presence);
  const late = board.memberStates(run.id, lateAt).find((s) => s.member === "b")!;
  assert.equal(late.badge, null);
  // its task with no growth past BUSY_MAX: stalled by the busy bound
  const hungAt = new Date(now + BUSY_MAX_MS + 2000);
  tick2(board, run.id, hungAt, presence);
  const hung = board.memberStates(run.id, hungAt).find((s) => s.member === "b")!;
  assert.deepEqual([hung.badge?.name, hung.rule, hung.owes], ["stalled", "call", "p1"]);
  board.post(orch, "@b go");
  await held;
});

test("4: unpark: idle again, its badges from board facts again", async () => {
  const { run, b, orch } = setup();
  board.park(orch, "b");
  assert.equal(shown(run.id, "g/b").state, "away");
  board.unpark(orch, "b");
  const out = shown(run.id, "g/b");
  assert.equal(out.state, "idle");
  assert.equal(out.badge, null);
  // the unpark is for it: read, then its wait is held
  board.deliver(b);
  const held = waitOf(b, 400);
  assert.equal(shown(run.id, "g/b").state, "idle");
  await held;
});

test("5: end --seat: ended, no badge, nothing raised for it", () => {
  const { run, b } = setup();
  board.end(b);
  agentEnds(run.id, "b");
  tick(run.id);
  assert.deepEqual(shown(run.id, "g/b"), { state: "ended", badge: null });
  assert.equal(events("lost").length, 0);
});

test("6: a parked member's own wait leaves it parked: only unpark lifts a park", async () => {
  const { run, b, orch } = setup();
  board.park(orch, "b");
  const held = waitOf(b, 200);
  assert.deepEqual(shown(run.id, "g/b"), { state: "away", badge: null });
  await held;
  board.setDoing(b, "back");
  assert.deepEqual(shown(run.id, "g/b"), { state: "away", badge: null });
});

test("U-F2: a park leaves the member's doing its own; a doing an older server wrote for a park or an unpark is cleared at open (board-split D48)", async () => {
  const { b, orch } = setup();
  board.setDoing(b, "reading the plan");
  board.park(orch, "b", "p2");
  assert.equal(board.snapshot(REPO).roster.find((r) => r.member === "g/b")!.doing, "reading the plan");
  board.unpark(orch, "b");
  assert.equal(board.snapshot(REPO).roster.find((r) => r.member === "g/b")!.doing, "reading the plan");
  board.close();
  const raw = openRawStore(path.join(dir, "swarm.sqlite"));
  try {
    raw.prepare("UPDATE participants SET doing = 'unparked' WHERE seat = 'b'").run();
    raw.prepare("UPDATE participants SET doing = 'parked until its next task' WHERE seat = 'a'").run();
  } finally {
    raw.close();
  }
  board = await openBoard(path.join(dir, "swarm.sqlite"));
  for (const m of ["g/a", "g/b"]) assert.equal(board.snapshot(REPO).roster.find((r) => r.member === m)!.doing, "", m);
});
