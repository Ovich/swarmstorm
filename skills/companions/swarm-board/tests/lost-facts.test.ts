// board-split D55: lost is one pure rule over the board's facts, read by memberView for the snapshot, the roster and
// the tick alike: link unseen, sign old, no held wait, server up and member seated, each at least LOST_MS.
import { quietMember } from "./fixtures/quiet-member.ts";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board, type LinkFact, type Presence } from "../src/board/board.ts";
import { LOST_MS } from "../src/board/liveness.ts";
import { tick2 } from "./fixtures/tick2.ts";

const REPO = "/repos/lost/.git";
let dir: string;
let board: Board;
let links: Map<string, LinkFact>;
const presence: Presence = (m) => links.get(m) ?? { connected: false, lostAt: null };
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-lost-"));
  board = await openBoard(path.join(dir, "swarm.sqlite"));
  links = new Map();
});
afterEach(() => {
  board.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const LONG = 10 * 60_000;
const setup = () => {
  const run = board.openRun({ repo: REPO, kind: "brainstorm", group: "g", title: "T", seats: [{ id: "a", blockers: [] }] });
  board.join({ run: run.id, seat: "a", doing: "x", files: [] });
  return run.id;
};
/** The badge every reader shows of g/a after the server ticked at now (two ticks: D55's confirm). */
const badgeOfA = (run: number): string | null => {
  tick2(board, run, new Date(), presence);
  const card = board.snapshot(REPO).roster.find((r) => r.member === "g/a")!.badge?.name ?? null;
  const row = board.roster(REPO).find((r) => r.name === "g/a")!.badge?.name ?? null;
  const ticked = board.memberStates(run, new Date()).find((s) => s.member === "a")!.badge?.name ?? null;
  assert.equal(row, card, "roster and card agree");
  assert.equal(ticked, card, "tick and card agree");
  return card;
};
const lostEvents = () => board.snapshot(REPO).events.filter((e) => e.event === "lost");

test("D55: an agent gone (no link, no call, no growth) LOST_MS after the server is up, owing a task, is lost, told once", () => {
  const run = setup();
  // it owes the open phase: a link down owing nothing is only away
  board.phase(board.participant("g/orchestrator")!, "p1", "do T1");
  board.deliver(board.participant("g/a")!);
  board.recordServerUp(Date.now() - LONG);
  quietMember(path.join(dir, "swarm.sqlite"), "a", LONG);
  links.set("a", { connected: false, lostAt: Date.now() - LONG, seenAt: Date.now() - LONG, cause: "socket" });
  assert.equal(badgeOfA(run), "lost");
  assert.equal(badgeOfA(run), "lost");
  assert.equal(lostEvents().length, 1);
  assert.match(lostEvents()[0].body, /socket/);
});

test("D55: a server restart with live members raises no lost within LOST_MS of its start", () => {
  const run = setup();
  quietMember(path.join(dir, "swarm.sqlite"), "a", LONG);
  // the restarted server drops every saved link at its start (server-restart)
  const up = Date.now() - 5_000;
  board.recordServerUp(up);
  links.set("a", { connected: false, lostAt: up, seenAt: Date.now() - LONG, cause: "server-restart" });
  assert.equal(badgeOfA(run), null);
  assert.equal(lostEvents().length, 0);
});

test("D55: a link that drops and reconnects within LOST_MS is never lost", () => {
  const run = setup();
  board.recordServerUp(Date.now() - LONG);
  quietMember(path.join(dir, "swarm.sqlite"), "a", LONG);
  links.set("a", { connected: false, lostAt: Date.now() - 20_000, seenAt: Date.now() - 20_000, cause: "socket" });
  assert.equal(badgeOfA(run), null, "dropped 20 s ago: not yet");
  links.set("a", { connected: true, lostAt: null, seenAt: Date.now(), cause: null });
  assert.equal(badgeOfA(run), null, "back");
  assert.equal(lostEvents().length, 0);
});

test("D55: a join, or an unpark, is never lost for LOST_MS after it", () => {
  const run = setup();
  board.recordServerUp(Date.now() - LONG);
  // just joined, no link ever came
  assert.equal(badgeOfA(run), null, "a fresh join");
  const orch = board.participant("g/orchestrator")!;
  board.park(orch, "a");
  quietMember(path.join(dir, "swarm.sqlite"), "a", LONG);
  assert.equal(badgeOfA(run), null, "parked: never lost");
  board.unpark(orch, "a");
  assert.equal(badgeOfA(run), null, "just unparked: seated afresh");
  assert.equal(lostEvents().length, 0);
});

test("D55: a member calling the board without a link is never lost", () => {
  const run = setup();
  board.recordServerUp(Date.now() - LONG);
  quietMember(path.join(dir, "swarm.sqlite"), "a", LONG);
  // its link never came, but it calls the board now
  board.setDoing(board.participant("g/a")!, "still here");
  assert.equal(badgeOfA(run), null);
  assert.equal(lostEvents().length, 0);
});

test("D55: a link's heartbeat keeps a member with no board call from lost", () => {
  const run = setup();
  board.recordServerUp(Date.now() - LONG);
  quietMember(path.join(dir, "swarm.sqlite"), "a", LONG);
  links.set("a", { connected: false, lostAt: Date.now() - 2 * LOST_MS, seenAt: Date.now() - 10_000, cause: "socket" });
  assert.equal(badgeOfA(run), null, "seen 10 s ago");
});
