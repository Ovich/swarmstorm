// swarm-relay D41: a gone member no longer holds the phase: all-done and idle go on without it, naming it.

import { quietMember } from "./fixtures/quiet-member.ts";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, progressText, type Board, type Presence } from "../src/board/board.ts";
import type { MemberActivity } from "../src/wire.ts";
import { LOST_MS } from "../src/board/liveness.ts";
import { tick2 } from "./fixtures/tick2.ts";

const REPO = "/repos/one/.git";
let dir: string;
let board: Board;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-phase-gone-"));
  board = await openBoard(path.join(dir, "swarm.sqlite"));
});

afterEach(() => {
  board.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

let links: Map<string, { connected: boolean; lostAt: number | null }>;
const presence: Presence = (m) => links.get(m) ?? { connected: true, lostAt: null };
const act = (o: Partial<MemberActivity> = {}): MemberActivity => ({ grewAt: null, tokens: 0, context: null, openTool: null, lastTool: null, finished: false, ...o });
const at = (base: number, s: number): Date => new Date(base + s * 1000);
const events = (name: string) => board.snapshot(REPO).events.filter((e) => e.event === name);

/** A brainstorm of `seats`, all joined, phase `diverge` open. */
const setup = (seats = ["a", "b", "c", "d"]) => {
  links = new Map();
  const run = board.openRun({ repo: REPO, kind: "brainstorm", group: "idea", title: "I", stallMs: 5000, seats: seats.map((id) => ({ id, title: id, blockers: [] })) });
  const members = Object.fromEntries(seats.map((id) => [id, board.join({ run: run.id, seat: id, doing: "x", files: [] }).member]));
  const orchestrator = board.participant("idea/orchestrator")!;
  board.phase(orchestrator, "diverge", "every idea");
  // what was already for them had: a wait blocks until something new
  for (const p of [...Object.values(members), orchestrator]) board.deliver(p);
  return { run, members, orchestrator };
};
/** `d`'s agent went without end: its link lost past LOST_MS, no wait held (board-split D49); the tick at `s` tells it lost. */
const goneD = (run: number, base: number, s = 1) => {
  // D53: d's agent finished: no board call since, either
  quietMember(path.join(dir, "swarm.sqlite"), "d");
  board.recordActivity(run, "d", act({ grewAt: base + s * 1000 - LOST_MS, finished: true }), at(base, 0));
  links.set("d", { connected: false, lostAt: base + s * 1000 - LOST_MS });
  tick2(board, run, at(base, s), presence);
};

test("four members, one gone, the three others done: all-done once, naming the gone; progress reads 3/3 done, 1 gone (D41)", () => {
  const { run, members } = setup();
  const base = Date.now() + 60_000;
  goneD(run.id, base);
  for (const m of ["a", "b", "c"]) board.done(members[m], "diverge");
  tick2(board, run.id, at(base, 2), presence);
  const all = events("all-done");
  assert.equal(all.length, 1);
  assert.equal(all[0].body, "all done diverge but the lost: 3/3 done; lost, not done: idea/d: dispatch each again or end its seat, then open the next phase");
  const progress = board.phaseProgress(run.id)!;
  assert.deepEqual(progress, { phase: "diverge", done: 3, of: 3, gone: ["idea/d"], idleEnded: [], parked: [] });
  assert.equal(progressText(progress), "3/3 done, 1 lost: d");
});

test("the last member not done going gone fires all-done at the tick, once (D41)", () => {
  const { run, members } = setup();
  const base = Date.now() + 60_000;
  for (const m of ["a", "b", "c"]) board.done(members[m], "diverge");
  assert.equal(events("all-done").length, 0);
  goneD(run.id, base);
  tick2(board, run.id, at(base, 2), presence);
  assert.deepEqual(events("all-done").map((e) => e.body), ["all done diverge but the lost: 3/3 done; lost, not done: idea/d: dispatch each again or end its seat, then open the next phase"]);
});

test("every member not gone in a held wait: idle fires, naming the gone (D41, D34)", async () => {
  const { run, members } = setup();
  // the ticks follow the held waits closely: a held wait owing past the stall time is stalled, not idle (board-split D49)
  const base = Date.now();
  goneD(run.id, base);
  const waits = ["a", "b", "c"].map((m) => board.wait(members[m], { mentionsOnly: true, timeoutMs: 400 }));
  for (const s of [2, 3]) tick2(board, run.id, at(base, s), presence);
  const idles = events("idle").map((e) => e.body);
  assert.equal(idles.length, 1, "once (D34)");
  assert.match(idles[0], /^idle 0s: every member is waiting \(1 lost: idea\/d\); phase diverge 0\/3 done, 1 lost: d$/);
  await Promise.all(waits);
});

test("a gone member that comes back counts again from then on (D41)", () => {
  const { run, members } = setup();
  const base = Date.now() + 60_000;
  links.set("d", { connected: false, lostAt: base });
  tick2(board, run.id, at(base, 60), presence);
  assert.deepEqual(board.phaseProgress(run.id), { phase: "diverge", done: 0, of: 3, gone: ["idea/d"], idleEnded: [], parked: [] });
  // a new link
  links.set("d", { connected: true, lostAt: null });
  tick2(board, run.id, at(base, 61), presence);
  assert.deepEqual(board.phaseProgress(run.id), { phase: "diverge", done: 0, of: 4, gone: [], idleEnded: [], parked: [] });
  for (const m of ["a", "b", "c"]) board.done(members[m], "diverge");
  tick2(board, run.id, at(base, 62), presence);
  assert.equal(events("all-done").length, 0, "d holds the phase again");
});

test("without any gone member, all-done, idle and the progress line read exactly as before", async () => {
  const { run, members } = setup(["a", "b"]);
  // the ticks follow the held waits closely: a held wait owing past the stall time is stalled, not idle (board-split D49)
  const base = Date.now();
  const waits = ["a", "b"].map((m) => board.wait(members[m], { mentionsOnly: true, timeoutMs: 400 }));
  tick2(board, run.id, at(base, 1), presence);
  assert.deepEqual(events("idle").map((e) => e.body), ["idle 0s: every member is waiting; phase diverge 0/2 done"]);
  await Promise.all(waits);
  for (const m of ["a", "b"]) board.done(members[m], "diverge");
  // idea 2: the done that leaves one member owing names it (the straggler case)
  assert.deepEqual(events("done").map((e) => e.body), ["done diverge (1/2): all but b", "done diverge (2/2)"]);
  assert.deepEqual(events("all-done").map((e) => e.body), ["all done diverge: every member is done (2/2); open the next phase"]);
  assert.equal(progressText(board.phaseProgress(run.id)!), "2/2 done");
  // a phase opened again tells its all-done again
  const orchestrator = board.participant("idea/orchestrator")!;
  board.phase(orchestrator, "diverge", "again");
  for (const m of ["a", "b"]) board.done(members[m], "diverge");
  assert.equal(events("all-done").length, 2);
});

test("V-35: a phase opened --for a lost member counts it lost from its open, and all-done never says every member", () => {
  const { run, members, orchestrator } = setup();
  const base = Date.now() + 60_000;
  goneD(run.id, base);
  board.phase(orchestrator, "fix", "fix it", { for: ["c", "d"] });
  assert.deepEqual(board.phaseProgress(run.id)!.gone, ["idea/d"]);
  board.done(members.c, "fix");
  const all = events("all-done").map((e) => e.body).filter((b) => b.includes(" fix"));
  assert.equal(all.length, 1);
  assert.doesNotMatch(all[0], /every member/);
});
