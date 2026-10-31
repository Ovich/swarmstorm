// board-split D51 (U-F11): a board alarm about a member is stored under the orchestrator's row (its run, its wake), but the
// snapshot serves it as the board's, `from: swarm`, with the member it tells of; the orchestrator never reads as its author.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, BOARD_AUTHOR, type Board, type Presence } from "../src/board/board.ts";
import { LOST_MS } from "../src/board/liveness.ts";
import type { MemberActivity } from "../src/wire.ts";
import { tick2 } from "./fixtures/tick2.ts";

const REPO = "/repos/one/.git";
let dir: string;
let board: Board;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-alarms-"));
  board = await openBoard(path.join(dir, "swarm.sqlite"));
});
afterEach(() => {
  board.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const act = (o: Partial<MemberActivity> = {}): MemberActivity => ({ grewAt: null, tokens: 0, context: null, openTool: null, lastTool: null, finished: false, ...o });

test("D51: a lost alarm about a member is served from the board with its subject; the orchestrator's own posts stay its own", () => {
  const run = board.openRun({ repo: REPO, kind: "brainstorm", group: "g", title: "T", stallMs: 5000, seats: [{ id: "a", blockers: [] }] });
  const a = board.join({ run: run.id, seat: "a", doing: "x", files: [] }).member;
  const orch = board.participant("g/orchestrator")!;
  // a task delivered and not reported: it owes work, so its link down is lost
  board.post(orch, "@a go on", { task: true });
  board.deliver(a);
  const base = Date.now();
  board.recordActivity(run.id, "a", act({ grewAt: base }), new Date(base));
  const lostLink: Presence = (m) => (m === "a" ? { connected: false, lostAt: base } : { connected: true, lostAt: null });
  tick2(board, run.id, new Date(base + LOST_MS + 5_000), lostLink);
  const events = board.snapshot(REPO).events;
  const alarms = events.filter((e) => e.kind === "event" && e.event === "lost");
  assert.ok(alarms.length >= 1, "the lost link raises its alarm");
  for (const e of alarms) assert.deepEqual([e.from, e.subject], [BOARD_AUTHOR, "g/a"]);
  const said = events.find((e) => e.body === "@a go on")!;
  assert.deepEqual([said.from, said.subject], ["g/orchestrator", undefined]);
});

test("U-F13: a parked seat's card carries no activity, a background call from before the park included", () => {
  const run = board.openRun({ repo: REPO, kind: "brainstorm", group: "g", title: "T", stallMs: 5000, seats: [{ id: "a", blockers: [] }] });
  board.join({ run: run.id, seat: "a", doing: "x", files: [] });
  const orch = board.participant("g/orchestrator")!;
  const base = Date.now();
  board.recordActivity(run.id, "a", act({ grewAt: base, background: { target: "for i in 1 2 3", since: base, outputGrewAt: base, label: null, command: "for i in 1 2 3" } }), new Date(base));
  const card = () => board.snapshot(REPO).roster.find((r) => r.member === "g/a")!;
  assert.equal(card().activity?.background?.target, "for i in 1 2 3");
  board.park(orch, "a");
  assert.equal(card().activity, undefined);
});
