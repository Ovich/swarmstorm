// pause and resume: the orchestrator stops every member of its run and lets them go on, with a message;
// a paused run raises no stall, quiet or stale alert.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board } from "../src/board/board.ts";
import { EVENTS } from "../src/board/events.ts";
import type { Presence } from "../src/board/board.ts";

const REPO = "/repos/one/.git";
let dir: string;
let board: Board;
const opened: Board[] = [];
/** Every link connected: presence plays no part here. */
const linked: Presence = () => ({ connected: true, lostAt: null });
const another = async (): Promise<Board> => {
  const b = await openBoard(path.join(dir, "swarm.sqlite"));
  opened.push(b);
  return b;
};

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-pause-"));
  board = await another();
});
afterEach(() => {
  for (const b of opened.splice(0)) b.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const setup = () => {
  const run = board.openRun({
    repo: REPO,
    kind: "brainstorm",
    group: "idea",
    title: "I",
    stallMs: 5000,
    seats: [
      { id: "a", blockers: [] },
      { id: "b", blockers: [] },
    ],
  });
  const a = board.join({ run: run.id, seat: "a", doing: "x", files: [] }).member;
  const b = board.join({ run: run.id, seat: "b", doing: "x", files: [] }).member;
  board.deliver(a);
  board.deliver(b);
  return { run, a, b, orchestrator: board.participant("idea/orchestrator")! };
};

test("pause wakes every member's wait with the stop line; resume wakes them with its message", async () => {
  const { run, a, orchestrator } = setup();
  const waiting = (await another()).wait(a, { mentionsOnly: true, timeoutMs: 5000 });
  const p = (await another()).pause(orchestrator, "the brief changed");
  assert.deepEqual([p.event, p.mentions, p.body], ["pause", ["idea/*"], "pause: stop where you are and wait for the resume: the brief changed"]);
  assert.deepEqual((await waiting).full.map((m) => m.seq), [p.seq]);
  assert.equal(board.pausedOf(run.id), "the brief changed");
  assert.equal(board.runs().find((r) => r.id === run.id)!.paused, "the brief changed");
  assert.match(EVENTS.pause.next!(p, a, "swarm")!, /^stop where you are: .* wait in the foreground for the resume \(give your shell tool a 600000 ms timeout\): swarm wait --mentions --as idea\/a --timeout 540000$/);
  assert.equal(EVENTS.pause.next!(p, orchestrator, "swarm"), null);
  const again = (await another()).wait(a, { mentionsOnly: true, timeoutMs: 5000 });
  const r = (await another()).resume(orchestrator, "read the new brief in the dossier");
  assert.deepEqual([r.event, r.body], ["resume", "resume: continue: read the new brief in the dossier"]);
  assert.deepEqual((await again).full.map((m) => m.seq), [r.seq]);
  assert.equal(board.pausedOf(run.id), null);
});

test("pause and resume are the orchestrator's, once each; a closed run refuses both", () => {
  const { run, a, orchestrator } = setup();
  assert.throws(() => board.pause(a), /only the orchestrator pauses/);
  assert.throws(() => board.resume(orchestrator), /is not paused/);
  board.pause(orchestrator);
  assert.equal(board.pausedOf(run.id), "");
  assert.throws(() => board.pause(orchestrator), /already paused/);
  assert.throws(() => board.resume(a), /only the orchestrator resumes/);
  board.closeRun(run.id);
  assert.throws(() => board.resume(board.participant("idea/orchestrator")!), /closed|ended/);
});

test("a paused run raises no stalled, quiet or stale alert; after resume the silence counts from the resume", () => {
  const { run, orchestrator } = setup();
  const base = Date.now() - 120_000;
  const at = (s: number) => new Date(base + s * 1000);
  const alerts = () => board.snapshot(REPO).events.filter((e) => ["stalled", "quiet", "stale"].includes(e.event ?? ""));
  for (const m of ["a", "b"]) board.recordActivity(run.id, m, { grewAt: base, tokens: 1, context: null, openTool: null, lastTool: null, finished: false }, at(0));
  board.livenessTick(run.id, at(0), linked);
  board.pause(orchestrator);
  for (const s of [6, 11, 30, 60]) board.livenessTick(run.id, at(s), linked);
  board.flagStale(new Date(Date.now() + 60 * 60_000));
  assert.equal(alerts().length, 0);
  board.resume(orchestrator);
  board.livenessTick(run.id, new Date(Date.now() + 3_000), linked);
  assert.equal(alerts().length, 0, "silence counts from the resume");
  board.livenessTick(run.id, new Date(Date.now() + 6_000), linked);
  // per member (D11): a and b are each quiet past the threshold
  assert.deepEqual(alerts().map((e) => e.event), ["stalled", "stalled"]);
});
