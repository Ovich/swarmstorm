// board-split D59 (V-2): a merge lock whose holder goes lost is released by the board at once; the orchestrator and the
// members refused it are told on one line, as a release by its holder would tell them; the work stays on its branch.
import { quietMember } from "./fixtures/quiet-member.ts";
import { tick2 } from "./fixtures/tick2.ts";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board, type Presence } from "../src/board/board.ts";
import { codeVerbs } from "../src/packs/code/calls.ts";
import { eventStep } from "../src/cli/answer/rules.ts";

const REPO = "/repos/one/.git";
let dir: string;
let board: Board;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-lost-lock-"));
  board = await openBoard(path.join(dir, "swarm.sqlite"));
});
afterEach(() => {
  board.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const freedLines = () => board.snapshot(REPO).events.filter((e) => e.event === "unlocked");

test("golden V-2 (D59): the lost holder's merge lock is released at once, its waiters and the orchestrator told; a waiter takes it", () => {
  const run = board.openRun({ repo: REPO, kind: "task", group: "g", title: "T", seats: ["w1", "w2"].map((id) => ({ id, blockers: [] })) });
  const w1 = board.join({ run: run.id, seat: "w1", doing: "x", files: [] }).member;
  const w2 = board.join({ run: run.id, seat: "w2", doing: "x", files: [] }).member;
  assert.deepEqual(codeVerbs(board).lockMerge(w2), { granted: true });
  assert.deepEqual(codeVerbs(board).lockMerge(w1), { granted: false, holder: "g/w2" });
  // w2 owes the open phase: a link down owing nothing is only away, and keeps its lock
  board.phase(board.participant("g/orchestrator")!, "p1", "do T1", { for: ["w2"] });
  board.deliver(w2);

  const base = Date.now();
  quietMember(path.join(dir, "swarm.sqlite"), "w2", 120_000);
  const presence: Presence = (m) => (m === "w2" ? { connected: false, lostAt: base - 61_000 } : { connected: true, lostAt: null });
  tick2(board, run.id, new Date(base), presence);

  const freed = freedLines();
  assert.equal(freed.length, 1);
  assert.equal(freed[0].body, "the merge lock is free: its holder g/w2 is lost, its work not merged stays on its branch");
  assert.deepEqual([...(freed[0].mentions ?? [])].sort(), ["g/orchestrator", "g/w1"]);
  // V-22: the waiter's step ends on the merge-lock command; the orchestrator's lost alarm already tells it
  assert.equal(eventStep(freed[0] as never, w1, "swarm"), "it is free: take it now: swarm merge-lock --as g/w1");
  assert.equal(eventStep(freed[0] as never, board.participant("g/orchestrator")!, "swarm"), null);
  // the lock is free: the waiter takes it, nobody waits forever
  assert.deepEqual(codeVerbs(board).lockMerge(w1), { granted: true });
  // the lost seat's next member does not hold it
  const again = board.join({ run: run.id, seat: "w2", doing: "replacement", files: [] }).member;
  assert.equal(board.packCall(again, "held-merge-lock", {}), null);
});

test("a lost member holding no merge lock: no lock line", () => {
  const run = board.openRun({ repo: REPO, kind: "task", group: "g", title: "T", seats: [{ id: "w1", blockers: [] }] });
  const w1 = board.join({ run: run.id, seat: "w1", doing: "x", files: [] }).member;
  board.phase(board.participant("g/orchestrator")!, "p1", "do T1");
  board.deliver(w1);
  const base = Date.now();
  quietMember(path.join(dir, "swarm.sqlite"), "w1", 120_000);
  tick2(board, run.id, new Date(base), () => ({ connected: false, lostAt: base - 61_000 }));
  assert.equal(board.snapshot(REPO).events.filter((e) => e.event === "lost").length, 1);
  assert.equal(freedLines().length, 0);
});

test("golden V-26: a member refused the merge lock, in its wait for the merged event, owing the phase, is waiting on the lock, never stalled", async () => {
  const run = board.openRun({ repo: REPO, kind: "task", group: "g", title: "T", stallMs: 5000, seats: ["w1", "w2"].map((id) => ({ id, blockers: [] })) });
  const w1 = board.join({ run: run.id, seat: "w1", doing: "x", files: [] }).member;
  const w2 = board.join({ run: run.id, seat: "w2", doing: "x", files: [] }).member;
  const orch = board.participant("g/orchestrator")!;
  board.phase(orch, "build", "go");
  board.post(orch, "@w1 your part");
  board.deliver(w1);
  codeVerbs(board).lockMerge(w2);
  assert.deepEqual(codeVerbs(board).lockMerge(w1), { granted: false, holder: "g/w2" });
  const linked: Presence = () => ({ connected: true, lostAt: null });
  const held = board.wait(w1, { mentionsOnly: true, timeoutMs: 400 });
  const t = new Date(Date.now() + 10 * 60_000);
  tick2(board, run.id, t, linked);
  assert.equal(board.memberStates(run.id, t).find((s) => s.member === "w1")!.badge, null, "queued on the merge lock: no stall");
  await held;
});

test("golden V-46: a member queued on the merge lock, its wait held, reads working (its tokens just moved), its tick waiting on lock merge held by its holder; the lock names its waiters", async () => {
  const run = board.openRun({ repo: REPO, kind: "task", group: "g", title: "T", seats: ["w1", "w2"].map((id) => ({ id, blockers: [] })) });
  const w1 = board.join({ run: run.id, seat: "w1", doing: "x", files: [] }).member;
  const w2 = board.join({ run: run.id, seat: "w2", doing: "x", files: [] }).member;
  codeVerbs(board).lockMerge(w2);
  assert.deepEqual(codeVerbs(board).lockMerge(w1), { granted: false, holder: "g/w2" });
  assert.deepEqual(board.snapshot(REPO).lock?.waiters, ["g/w1"]);
  // in its wait for the merged event: waiting on the lock, its holder named, as a named lock's waiter reads
  const held = board.wait(w1, { mentionsOnly: true, timeoutMs: 400 });
  const now = Date.now();
  board.recordActivity(run.id, "w1", { grewAt: now, tokens: 0, context: null, openTool: { name: "Bash", target: "swarm wait", since: now, boardWait: true }, lastTool: null, finished: false }, new Date(now));
  assert.equal(board.snapshot(REPO).roster.find((r) => r.member === "g/w1")!.state, "working");
  const st = board.memberStates(run.id, new Date(now)).find((s) => s.member === "w1")!;
  assert.equal(st.state, "waiting"); // the tick's activity word, not the member's state
  assert.equal(st.doing, "lock merge, held by g/w2");
  await held;
});

test("golden V-49: a merge that frees the lock gives the member refused it the merge-lock command, as the lost path does", () => {
  const run = board.openRun({ repo: REPO, kind: "task", group: "g", title: "T", seats: ["w1", "w2"].map((id) => ({ id, blockers: [] })) });
  const w1 = board.join({ run: run.id, seat: "w1", doing: "x", files: [] }).member;
  const w2 = board.join({ run: run.id, seat: "w2", doing: "x", files: [] }).member;
  codeVerbs(board).lockMerge(w2);
  codeVerbs(board).lockMerge(w1);
  codeVerbs(board).merged(w2, "abc1234", []);
  const merged = board.snapshot(REPO).events.find((e) => e.event === "merged")!;
  assert.equal(eventStep(merged as never, w1, "swarm"), "it is free: take it now: swarm merge-lock --as g/w1");
  assert.equal(eventStep(merged as never, board.participant("g/orchestrator")!, "swarm"), null);
});
