// board-split D36, D44, S40: trouble is a badge beside the state, never a state: stalled, lost, each with
// its reason; busy is activity, never a badge (D31); the old event names read as
// the new ones.
import { quietMember } from "./fixtures/quiet-member.ts";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board, type Presence } from "../src/board/board.ts";
import { eventOf } from "../src/board/events.ts";
import type { MemberActivity } from "../src/wire.ts";
import { eventStep } from "../src/cli/answer/rules.ts";
import { WORDING } from "../src/cli/answer/wording.ts";
import { tick2 } from "./fixtures/tick2.ts";

const REPO = "/repos/one/.git";
let dir: string;
let board: Board;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-badges-"));
  board = await openBoard(path.join(dir, "swarm.sqlite"));
});
afterEach(() => {
  board.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const linked: Presence = () => ({ connected: true, lostAt: null });
const act = (o: Partial<MemberActivity> = {}): MemberActivity => ({ grewAt: null, tokens: 0, context: null, openTool: null, lastTool: null, finished: false, ...o });
const at = (base: number, s: number): Date => new Date(base + s * 1000);
const eventsOf = (name: string) => board.snapshot(REPO).events.filter((e) => e.event === name);
// board-split D55: a badge shows once two ticks confirmed it, so a read at `t` is the server having ticked there
const badgeIn = (run: number, seat: string, t: Date) => (tick2(board, run, t, linked), board.memberStates(run, t)).find((s) => s.member === seat)!;
const cardOf = (member: string) => board.snapshot(REPO).roster.find((r) => r.member === member)!;

const setup = () => {
  const run = board.openRun({ repo: REPO, kind: "brainstorm", group: "g", title: "T", stallMs: 5000, seats: [{ id: "a", blockers: [] }, { id: "b", blockers: [] }] });
  const a = board.join({ run: run.id, seat: "a", doing: "x", files: [] }).member;
  const b = board.join({ run: run.id, seat: "b", doing: "x", files: [] }).member;
  const orch = board.participant("g/orchestrator")!;
  for (const p of [a, b, orch]) board.deliverMentions(p);
  return { run, a, b, orch };
};

test("golden lost: a member owing work whose link is down past LOST_MS is lost; a finished transcript is not lost; its link back clears it", () => {
  const { run, orch } = setup();
  board.phase(orch, "p1", "go");
  const base = Date.now();
  // the transcript says finished: no badge from it
  board.recordActivity(run.id, "a", act({ grewAt: base - 61_000, finished: true }), at(base, 0));
  tick2(board, run.id, at(base, 1), linked);
  assert.equal(badgeIn(run.id, "a", at(base, 1)).badge, null);
  assert.equal(eventsOf("lost").length, 0);
  const gone: Presence = (m) => (m === "a" ? { connected: false, lostAt: base - 61_000 } : { connected: true, lostAt: null });
  // D53: and no board call of its own since
  quietMember(path.join(dir, "swarm.sqlite"), "a", 120_000);
  tick2(board, run.id, at(base, 1), gone);
  assert.deepEqual(eventsOf("lost").map((e) => e.body), ["lost g/a: its link was lost"]);
  assert.deepEqual([cardOf("g/a").badge?.name, cardOf("g/a").liveness?.badge?.name], ["lost", "lost"]);
  const lost = eventsOf("lost")[0];
  assert.equal(eventStep(lost as never, orch, "swarm"), WORDING.lostMove("swarm", "a", "g/orchestrator"));
  tick2(board, run.id, at(base, 2), linked);
  assert.equal(eventsOf("lost").length, 1);
  assert.equal(badgeIn(run.id, "a", at(base, 2)).badge, null);
});

test("S40, board-split D49: a subagent that ended its turn on a background task of its own is busy on it, never lost or stalled from it, however long", () => {
  const { run } = setup();
  const base = Date.now();
  const bg = { target: "npm test", since: base, outputGrewAt: base };
  for (let s = 0; s < 120; s += 10) {
    board.recordActivity(run.id, "a", act({ grewAt: base, finished: true, background: bg }), at(base, s));
    tick2(board, run.id, at(base, s), linked);
    const st = badgeIn(run.id, "a", at(base, s));
    assert.equal(st.state, "busy");
    assert.equal(st.badge, null);
  }
  assert.equal(eventsOf("lost").length, 0);
  const long = badgeIn(run.id, "a", at(base, 16 * 60));
  assert.deepEqual([long.state, long.badge], ["busy", null]);
});
