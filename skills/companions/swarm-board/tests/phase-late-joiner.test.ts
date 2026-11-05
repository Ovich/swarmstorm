// A member that joins (or rejoins) while a phase is open owes its done: all-done waits for it.
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-phase-late-"));
  board = await openBoard(path.join(dir, "swarm.sqlite"));
});

afterEach(() => {
  board.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const allDones = () => board.snapshot(REPO).events.filter((e) => e.event === "all-done");
/** A task run of `seats`, its orchestrator, and w1 joined. */
const openTaskRun = (seats: string[]) => {
  const run = board.openRun({ repo: REPO, kind: "task", group: "g", title: "T", seats: seats.map((id) => ({ id, blockers: [] })) });
  return { run, orchestrator: board.participant("g/orchestrator")!, w1: board.join({ run: run.id, seat: "w1", doing: "x", files: [] }).member };
};

test("a member joining after the phase opened is in its count: no all-done until it is done, then all-done once", () => {
  const { run, orchestrator, w1 } = openTaskRun(["w1", "w2"]);
  board.phase(orchestrator, "build", "build it");
  const w2 = board.join({ run: run.id, seat: "w2", doing: "x", files: [] }).member;
  assert.deepEqual(board.phaseProgress(run.id), { phase: "build", done: 0, of: 2, gone: [], idleEnded: [] });
  const first = board.done(w1, "build");
  assert.equal(first.all, false);
  assert.equal(allDones().length, 0);
  const last = board.done(w2, "build");
  assert.equal(last.all, true);
  assert.equal(allDones().length, 1);
  board.done(w2, "build");
  assert.equal(allDones().length, 1);
});

test("a member rejoining its ended seat while the phase is open owes the phase again, unless it was done", () => {
  const { run, orchestrator, w1 } = openTaskRun(["w1", "w2"]);
  const w2 = board.join({ run: run.id, seat: "w2", doing: "x", files: [] }).member;
  board.phase(orchestrator, "build", "build it");
  board.end(w2);
  const back = board.join({ run: run.id, seat: "w2", doing: "x", files: [] }).member;
  assert.deepEqual(board.phaseProgress(run.id), { phase: "build", done: 0, of: 2, gone: [], idleEnded: [] });
  board.done(w1, "build");
  assert.equal(allDones().length, 0);
  board.done(back, "build");
  assert.equal(allDones().length, 1);
});

test("a declared seat tasked in the open phase owes it before it joins; a declared seat with no task never holds it", () => {
  const { run, orchestrator, w1 } = openTaskRun(["w1", "w2", "w3"]);
  board.phase(orchestrator, "build", "build it");
  board.post(orchestrator, "@w2 your task");
  assert.deepEqual(board.phaseProgress(run.id), { phase: "build", done: 0, of: 2, gone: [], idleEnded: [] });
  const first = board.done(w1, "build");
  assert.equal(first.all, false);
  assert.equal(allDones().length, 0);
  const w2 = board.join({ run: run.id, seat: "w2", doing: "x", files: [] }).member;
  assert.deepEqual(board.phaseProgress(run.id), { phase: "build", done: 1, of: 2, gone: [], idleEnded: [] });
  assert.equal(board.done(w2, "build").all, true);
  assert.equal(allDones().length, 1);
});

test("a task posted before the phase opened does not make an unjoined seat owe it", () => {
  const { run, orchestrator, w1 } = openTaskRun(["w1", "w2"]);
  board.post(orchestrator, "@w2 an earlier task");
  board.phase(orchestrator, "build", "build it");
  assert.equal(board.done(w1, "build").all, true);
  assert.equal(allDones().length, 1);
});
