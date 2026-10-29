// `phase --for`: only the named seats are woken and owe done; an idle member (two empty waits, owing nothing) is told to end.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board } from "../src/board/board.ts";

const REPO = "/repos/one/.git";
const SEATS = [
  { id: "architect", blockers: [] },
  { id: "skeptic", blockers: [] },
];

let dir: string;
let board: Board;
const opened: Board[] = [];
const another = async (): Promise<Board> => {
  const b = await openBoard(path.join(dir, "swarm.sqlite"));
  opened.push(b);
  return b;
};

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-phase-for-"));
  board = await another();
});
afterEach(() => {
  for (const b of opened.splice(0)) b.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const run = () => {
  const r = board.openRun({ repo: REPO, kind: "brainstorm", group: "idea", title: "I", seats: SEATS });
  const orchestrator = board.participant("idea/orchestrator")!;
  const architect = board.join({ run: r.id, seat: "architect", doing: "x", files: [] }).member;
  const skeptic = board.join({ run: r.id, seat: "skeptic", doing: "x", files: [] }).member;
  board.deliver(architect);
  board.deliver(skeptic);
  return { r, orchestrator, architect, skeptic };
};

test("phase --for wakes only its seats; only they owe done, and all-done counts them alone", async () => {
  const { r, orchestrator, architect, skeptic } = run();
  const woken = (await another()).wait(skeptic, { mentionsOnly: true, timeoutMs: 5000 });
  const asleep = (await another()).wait(architect, { mentionsOnly: true, timeoutMs: 1500 });
  const m = (await another()).phase(orchestrator, "draft", "write it", { for: ["idea/skeptic"] });
  assert.deepEqual(m.mentions, ["idea/skeptic"]);
  assert.deepEqual((await woken).full.map((x) => x.seq), [m.seq]);
  assert.deepEqual(await asleep, { full: [], lines: [] });
  assert.equal(board.owedPhase(architect), null);
  assert.equal(board.owedPhase(skeptic)?.name, "draft");
  // the others still read the phase as their header
  assert.equal(board.currentPhase(r.id)?.name, "draft");
  const d = board.done(skeptic, "draft");
  assert.deepEqual([d.progress.done, d.progress.of, d.all], [1, 1, true]);
  // a phase without --for is for every member again
  board.phase(orchestrator, "review", "read it");
  assert.equal(board.owedPhase(architect)?.name, "review");
  assert.equal(board.phaseProgress(r.id)?.of, 2);
});

test("a member is idle after its second empty wait --mentions in a row while it owes nothing", async () => {
  const { orchestrator, architect } = run();
  assert.equal(board.idle(architect), false);
  await board.wait(architect, { mentionsOnly: true, timeoutMs: 50 });
  assert.equal(board.idle(architect), false);
  await board.wait(architect, { mentionsOnly: true, timeoutMs: 50 });
  assert.equal(board.idle(architect), true);
  // owing a phase part: not idle
  board.phase(orchestrator, "draft", "write it");
  assert.equal(board.idle(architect), false);
  board.done(architect, "draft");
  // a delivery starts the count again
  board.post(orchestrator, "@idea/architect hi");
  await board.wait(architect, { mentionsOnly: true, timeoutMs: 50 });
  assert.equal(board.idle(architect), false);
  await board.wait(architect, { mentionsOnly: true, timeoutMs: 50 });
  assert.equal(board.idle(architect), false);
  await board.wait(architect, { mentionsOnly: true, timeoutMs: 50 });
  assert.equal(board.idle(architect), true);
  assert.equal(board.idle(orchestrator), false);
});

test("an idle-ended seat is dormant: a later phase counts it, all-done waits for it, and it is named", async () => {
  const { r, orchestrator, architect, skeptic } = run();
  board.phase(orchestrator, "p1", "first");
  board.done(architect, "p1");
  board.done(skeptic, "p1");
  board.deliver(skeptic);
  await board.wait(skeptic, { mentionsOnly: true, timeoutMs: 50 });
  await board.wait(skeptic, { mentionsOnly: true, timeoutMs: 50 });
  assert.equal(board.idle(skeptic), true);
  board.end(skeptic);
  board.phase(orchestrator, "p2", "second");
  const d = board.done(architect, "p2");
  assert.deepEqual([d.progress.done, d.progress.of, d.all], [1, 2, false]);
  assert.deepEqual(d.progress.dormant, ["idea/skeptic"]);
  // dispatched again into the same seat: no longer dormant, its done completes the phase
  const back = board.join({ run: r.id, seat: "skeptic", doing: "x", files: [] }).member;
  assert.deepEqual(board.phaseProgress(r.id)?.dormant, []);
  assert.equal(board.done(back, "p2").all, true);
});

test("phase --for refuses a seat the run does not have", () => {
  const { orchestrator } = run();
  assert.throws(() => board.phase(orchestrator, "p", "x", { for: ["idea/nobody"] }), /no seat of run \d+: nobody/);
});

test("an unread mention: not idle, and counted for end's refusal", async () => {
  const { orchestrator, architect } = run();
  await board.wait(architect, { mentionsOnly: true, timeoutMs: 50 });
  await board.wait(architect, { mentionsOnly: true, timeoutMs: 50 });
  assert.equal(board.idle(architect), true);
  board.post(orchestrator, "@idea/architect one more");
  assert.equal(board.idle(architect), false);
  assert.equal(board.unreadMentions(architect), 1);
  board.deliverMentions(architect);
  assert.equal(board.unreadMentions(architect), 0);
});
