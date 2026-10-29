// P1 wake rules (plan D7, D8): an agreement's other party wakes on the merge of its file, claim or not;
// a wait in a paused run blocks until the resume or an urgent post.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board } from "../src/board/board.ts";
import { codeVerbs } from "../src/packs/code/calls.ts";

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
  codeVerbs(board).merged(w1, "abc123", ["docs/notes.md"]);
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
  codeVerbs(board).merged(w1, "abc123", ["src/other.ts"]);
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

test("G27: an agreement replying to the member's own post rides on its next answer, never waking it", () => {
  const { members: [w1, w3] } = setup("task", ["w1", "w3"]);
  board.post(w3, "@g/w1 I change the helper in src/x.ts", { about: "src/x.ts" });
  board.deliver(w1);
  const agreed = board.post(w1, "@g/w3 w3 the helper, w1 the rest", { kind: "agreement", about: "src/x.ts" });
  assert.deepEqual(board.deliverMentions(w3).full.map((m) => m.seq), [], "no wake");
  board.post(w1, "@g/w3 a question");
  const next = board.deliverMentions(w3);
  assert.ok(next.full.some((m) => m.seq === agreed.seq) || next.lines.some((l) => l.includes(`#${agreed.seq}`)), "rides on the next wake");
});

test("G27: an agreement about a file the member holds, not replying to its own post, still wakes it", () => {
  const { members: [w1, w3] } = setup("task", ["w1", "w3"]);
  codeVerbs(board).checkEdit(w3, "src/y.ts");
  const agreed = board.post(w1, "@g/w3 w1 the top, w3 the rest", { kind: "agreement", about: "src/y.ts" });
  assert.deepEqual(board.deliverMentions(w3).full.map((m) => m.seq), [agreed.seq]);
});

test("G35: an endorsement is carried for the orchestrator, never waking it", () => {
  const { members: [w1, w3], orchestrator } = setup("task", ["w1", "w3"]);
  board.deliver(orchestrator);
  // the orchestrator's own ruling, endorsed by a member: the endorsement names it
  const ruled = board.post(orchestrator, "@g/w1 @g/w3 w1 first, then w3", { kind: "agreement", about: "src/z.ts" });
  board.deliver(w1);
  const endorsed = board.endorse(w3, ruled.seq);
  assert.deepEqual(board.deliverMentions(orchestrator).full.map((m) => m.seq), [], "no wake");
  board.post(w1, "@g/orchestrator merged");
  const next = board.deliverMentions(orchestrator);
  assert.ok([...next.full.map((m) => `#${m.seq}`), ...next.lines].some((l) => l.includes(`#${endorsed.seq}`)), "rides on the next wake");
});
