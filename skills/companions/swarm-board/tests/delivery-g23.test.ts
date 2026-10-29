// G23, V6: a message a member already had (read in full, or the phase it is done with) never comes back on its next wait.
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-g23-"));
  board = await openBoard(path.join(dir, "swarm.sqlite"));
});
afterEach(() => {
  board.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const setup = () => {
  const run = board.openRun({ repo: REPO, kind: "brainstorm", group: "g", title: "T", seats: [{ id: "a", blockers: [] }] });
  const orch = board.participant("g/orchestrator")!;
  const a = board.join({ run: run.id, seat: "a", doing: "x", files: [] }).member;
  board.deliver(a);
  board.deliver(orch);
  return { orch, a };
};
const seqs = (d: { full: { seq: number }[]; lines: string[] }) => [...d.full.map((m) => m.seq), ...d.lines];

test("G23: a post the member read in full is not re-delivered by its next wait --mentions", () => {
  const { orch, a } = setup();
  const task = board.post(orch, "@a do the thing");
  board.read(task.seq, a);
  assert.deepEqual(seqs(board.deliverMentions(a)), []);
});

test("G23: after done, the phase's opening event is not re-delivered by the member's next wait --mentions", () => {
  const { orch, a } = setup();
  board.phase(orch, "build", "build it");
  board.done(a, "build");
  assert.deepEqual(seqs(board.deliverMentions(a)), []);
});

test("G23: a read without a member marks nothing for anyone", () => {
  const { orch, a } = setup();
  const task = board.post(orch, "@a do the thing");
  board.read(task.seq);
  assert.deepEqual(board.deliverMentions(a).full.map((m) => m.seq), [task.seq]);
});
