// P1 wake rules (plan D7, D8): an agreement's other party wakes on the merge of its file, claim or not;
// a wait in a paused run blocks until the resume or an urgent post.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board } from "../src/board/board.ts";

const REPO = "/repos/one/.git";
let dir: string;
let board: Board;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-wake-"));
  board = await openBoard(path.join(dir, "swarm.sqlite"));
});
afterEach(() => {
  board.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const setup = (kind: "task" | "brainstorm", ids: string[]) => {
  const run = board.openRun({ repo: REPO, kind, group: "g", title: "G", seats: ids.map((id) => ({ id, blockers: [] })) });
  const members = ids.map((id) => board.join({ run: run.id, seat: id, doing: "x", files: [] }).member);
  for (const m of members) board.deliver(m);
  return { run, members, orchestrator: board.participant("g/orchestrator")! };
};

test("D7: a merge of a file named in an agreement wakes the agreement's other party, with no claim held", async () => {
  const { members: [w1, w3, w2] } = setup("task", ["w1", "w3", "w2"]);
  board.post(w3, "@g/w1 you merge first, I append after", { kind: "agreement", about: "docs/notes.md" });
  board.deliver(w1);
  board.deliver(w3);
  const waiting = board.wait(w3, { mentionsOnly: true, timeoutMs: 3000 });
  const bystander = board.wait(w2, { mentionsOnly: true, timeoutMs: 600 });
  board.merged(w1, "abc123", ["docs/notes.md"]);
  const got = await waiting;
  assert.equal(got.full.length, 1);
  assert.match(got.full[0].body, /merged abc123/);
  assert.match(got.full[0].body, /@g\/w3: you agreed on a file it changed/);
  assert.deepEqual((await bystander).full, []);
});

test("D7: a merge of another file wakes nobody of the agreement; the merger is not told of its own merge", async () => {
  const { members: [w1, w3] } = setup("task", ["w1", "w3"]);
  board.post(w3, "@g/w1 you merge first", { kind: "agreement", about: "docs/notes.md" });
  board.deliver(w1);
  board.deliver(w3);
  const waiting = board.wait(w3, { mentionsOnly: true, timeoutMs: 600 });
  board.merged(w1, "abc123", ["src/other.ts"]);
  assert.deepEqual((await waiting).full, []);
});

test("D8: a wait in a paused run does not return on a mention or a plain post; resume and urgent end it", async () => {
  const { members: [a, b], orchestrator } = setup("brainstorm", ["a", "b"]);
  board.pause(orchestrator, "hold");
  board.deliver(a); // takes the pause
  assert.deepEqual(await board.wait(a, { mentionsOnly: true, timeoutMs: 500 }), { full: [], lines: [] });
  board.post(b, "@g/a are you there");
  assert.deepEqual(await board.wait(a, { mentionsOnly: true, timeoutMs: 500 }), { full: [], lines: [] });
  assert.deepEqual(await board.wait(a, { timeoutMs: 500 }), { full: [], lines: [] });

  const waiting = board.wait(a, { mentionsOnly: true, timeoutMs: 3000 });
  const urgent = board.post(orchestrator, "fire", { kind: "urgent" });
  assert.deepEqual((await waiting).full.map((m) => m.seq), [urgent.seq]);

  const again = board.wait(a, { mentionsOnly: true, timeoutMs: 3000 });
  const resumed = board.resume(orchestrator, "go on");
  const got = await again;
  assert.ok(got.full.some((m) => m.seq === resumed.seq));
  assert.ok(got.full.some((m) => /are you there/.test(m.body)), "what came during the pause arrives with the resume");
});

test("D8: a member waiting when the pause is posted wakes on it", async () => {
  const { members: [a], orchestrator } = setup("brainstorm", ["a"]);
  const waiting = board.wait(a, { mentionsOnly: true, timeoutMs: 3000 });
  const p = board.pause(orchestrator, "hold");
  assert.deepEqual((await waiting).full.map((m) => m.seq), [p.seq]);
});
