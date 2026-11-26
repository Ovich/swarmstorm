// board-split#D28 (T23): a run knows the roles its orchestrator holds, read back by status, roster and the reader.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board } from "../src/board/board.ts";

const REPO = "/repos/one/.git";
const SEATS = [{ id: "w1", role: "builder", blockers: [] }];

let dir: string;
const opened: Board[] = [];
const boardAt = async (file: string): Promise<Board> => {
  const b = await openBoard(file);
  opened.push(b);
  return b;
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-authority-"));
});
afterEach(() => {
  for (const b of opened.splice(0)) b.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test("a run opened with an authority reads its roles back; one opened without reads []", async () => {
  const board = await boardAt(path.join(dir, "swarm.sqlite"));
  const deciding = board.openRun({ repo: REPO, group: "decide", title: "Decide", seats: SEATS, authority: ["architect", "tech-lead", "architect"] });
  const plain = board.openRun({ repo: REPO, group: "build", title: "Build", seats: SEATS });
  assert.deepEqual(deciding.authority, ["architect", "tech-lead"]);
  assert.deepEqual(plain.authority, []);
  assert.deepEqual(board.runs().map((r) => r.authority), [["architect", "tech-lead"], []]);
  const summaries = board.snapshot(REPO).runs;
  assert.deepEqual(summaries.map((r) => r.authority), [["architect", "tech-lead"], []]);
});

test("a role outside lower case, digits and dashes is refused", async () => {
  const board = await boardAt(path.join(dir, "swarm.sqlite"));
  assert.throws(() => board.openRun({ repo: REPO, group: "g", title: "T", seats: SEATS, authority: ["Tech Lead"] }), /authority/);
});

