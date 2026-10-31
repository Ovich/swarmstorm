// The whole thread: in a seat's run every post is everyone's, a wake bringing the unread thread with it, in full;
// a plan run delivers a post only to whom it names.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board } from "../src/board/board.ts";

const REPO = "/repos/one/.git";
const SEATS = [
  { id: "writer", blockers: [] },
  { id: "checker", blockers: [] },
  { id: "judge", blockers: [] },
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-thread-"));
  board = await another();
});

afterEach(() => {
  for (const b of opened.splice(0)) b.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const seats = () => {
  const run = board.openRun({ repo: REPO, kind: "brainstorm", group: "letter", title: "L", seats: SEATS });
  const orchestrator = board.participant("letter/orchestrator")!;
  const [writer, checker, judge] = SEATS.map((s) => board.join({ run: run.id, seat: s.id, doing: "x", files: [] }).member);
  for (const p of [orchestrator, writer, checker, judge]) board.deliverMentions(p);
  return { run, orchestrator, writer, checker, judge };
};

test("in a seat's run, a wake brings every unread post of the run with it, in full", async () => {
  const { writer, checker, judge } = seats();
  const poster = await another();
  poster.post(poster.participant(judge.name)!, "@orchestrator the gap is a part, not the whole");
  const waiting = board.wait(writer, { timeoutMs: 5000, mentionsOnly: true });
  setTimeout(() => poster.post(poster.participant(checker.name)!, "@writer take the sourced wording"), 100);
  const d = await waiting;
  assert.deepEqual(
    d.full.map((m) => m.body),
    ["@orchestrator the gap is a part, not the whole", "@writer take the sourced wording"],
  );
});

test("in a seat's run, posts that wake no one stay until a wake, then come with it", async () => {
  const { writer, checker } = seats();
  const poster = await another();
  const waiting = board.wait(writer, { timeoutMs: 5000, mentionsOnly: true });
  let done = false;
  void waiting.then(() => (done = true));
  await new Promise((r) => setTimeout(r, 100));
  poster.post(poster.participant(checker.name)!, "@orchestrator no strike");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(done, false, "a post for someone else ended a mentions-only wait");
  poster.post(poster.participant(checker.name)!, "@writer your turn");
  const d = await waiting;
  assert.deepEqual(d.full.map((m) => m.body), ["@orchestrator no strike", "@writer your turn"]);
});

test("a plan run delivers another member's post to nobody it does not name", () => {
  const plan = board.openRun({ repo: REPO, group: "build", title: "B", seats: [{ id: "S1", blockers: [] }, { id: "S2", blockers: [] }] });
  const [s1, s2] = ["S1", "S2"].map((id) => board.join({ run: plan.id, seat: id, doing: "x", files: [] }).member);
  board.deliverMentions(s1);
  board.deliverMentions(s2);
  board.post(s1, "@orchestrator the parser is in");
  const d = board.deliverMentions(s2);
  assert.equal(d.full.length, 0);
});

