// A task swarm (kind `task`, the `swarm` skill): workers join a run with no plan, a task is a post to one of them,
// and the worker it names receives it in full; claims and the merge lock work as in a plan.
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-task-"));
  board = await openBoard(path.join(dir, "swarm.sqlite"));
});

afterEach(() => {
  board.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test("a task run: workers join, a task posted to w2 reaches w2 in full and w1 as nothing for it", () => {
  const run = board.openRun({ repo: REPO, kind: "task", group: "chores", title: "Chores", seats: ["w1", "w2"].map((id) => ({ id, title: "worker", blockers: [] })) });
  const w1 = board.join({ run: run.id, seat: "w1", doing: "waiting for a task", files: [], worktree: "/wt/w1" }).member;
  const w2 = board.join({ run: run.id, seat: "w2", doing: "waiting for a task", files: [], worktree: "/wt/w2" }).member;
  const orchestrator = board.participant("chores/orchestrator")!;
  for (const p of [w1, w2, orchestrator]) board.deliver(p);
  board.post(orchestrator, "@w2 rename the config loader; done when: npm test exits 0");
  const toW2 = board.deliverMentions(w2);
  assert.equal(toW2.full.length, 1);
  assert.match(toW2.full[0].body, /rename the config loader/);
  assert.equal(board.deliverMentions(w1).full.length, 0);
  assert.equal(board.lockMerge(w2).granted, true);
});

test("a task posted to a seat before its worker joins is the first thing that worker receives; other seats' tasks are not its", () => {
  const run = board.openRun({ repo: REPO, kind: "task", group: "early", title: "Early", seats: ["w1", "w2"].map((id) => ({ id, title: "worker", blockers: [] })) });
  const orchestrator = board.participant("early/orchestrator")!;
  board.post(orchestrator, "@w1 T1: the agent cards; done when: npm test exits 0");
  board.post(orchestrator, "@w2 T2: the narrow screens");
  const w1 = board.join({ run: run.id, seat: "w1", doing: "waiting for a task", files: [], worktree: "/wt/w1" }).member;
  const toW1 = board.deliverMentions(w1);
  assert.equal(toW1.full.length, 1);
  assert.match(toW1.full[0].body, /T1: the agent cards/);
  // a later join of an existing seat keeps its cursor: nothing is delivered twice
  board.join({ run: run.id, seat: "w1", doing: "back", files: [], worktree: "/wt/w1" });
  assert.equal(board.deliverMentions(w1).full.length, 0);
});
