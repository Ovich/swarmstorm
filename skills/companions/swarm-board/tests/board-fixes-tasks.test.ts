// board-fixes#D4, D5, D12, D13: a task posted with --task / --after, the wakes of its awaited seats, the open task owed,
// the doing's age and stale mark, and the orchestrators board's seats ending with their run.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board, type LinkFact, type Presence } from "../src/board/board.ts";
import { codeVerbs } from "../src/packs/code/calls.ts";
import { quietMember } from "./fixtures/quiet-member.ts";
import { openRawStore } from "./fixtures/raw-store.ts";
import { tick2 } from "./fixtures/tick2.ts";

const REPO = "/repos/fixes/.git";
let dir: string;
let file: string;
let board: Board;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-fixes-"));
  file = path.join(dir, "swarm.sqlite");
  board = await openBoard(file);
});
afterEach(() => {
  board.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const setup = (kind: "task" | "brainstorm", seats: string[]) => {
  const run = board.openRun({ repo: REPO, kind, group: "g", title: "G", seats: seats.map((id) => ({ id, blockers: [] })) });
  for (const id of seats) board.join({ run: run.id, seat: id, doing: "waiting for a task", files: [] });
  const of = (seat: string) => board.participant(`g/${seat}`, REPO)!;
  return { run: run.id, of, orch: of("orchestrator") };
};
const awaited = () => board.snapshot(REPO).events.filter((e) => e.event === "awaited");
const rosterOf = (name: string) => board.roster(REPO).find((r) => r.name === name);

test("D4: an awaited seat's merge wakes the task's seat once, counted; its posts and a second merge never do", async () => {
  const { of, orch } = setup("task", ["w1", "w2", "w3"]);
  board.post(orch, "@w3 T3 after the two", { task: true, after: ["w1", "w2"] });
  board.deliverMentions(of("w3"));
  board.post(of("w1"), "progress note");
  assert.equal(awaited().length, 0);
  const waiting = board.wait(of("w3"), { mentionsOnly: true, timeoutMs: 3000 });
  codeVerbs(board).merged(of("w1"), "abc123", []);
  const got = await waiting;
  assert.ok(got.full.some((m) => m.body === "w1 merged (1 of 2 you wait on)"));
  codeVerbs(board).merged(of("w1"), "def456", []);
  assert.equal(awaited().length, 1);
  assert.deepEqual(awaited()[0].mentions, ["g/w3"]);
});

test("D4: on a code run a done without a merge wakes with nothing merged; an end, without merging", () => {
  const { of, orch } = setup("task", ["w1", "w2", "w3"]);
  board.phase(orch, "p1", "build");
  board.post(orch, "@w3 T3", { after: ["w1", "w2"] });
  board.done(of("w1"), "p1");
  board.end(of("w2"));
  assert.deepEqual(awaited().map((e) => e.body), ["w1 done, nothing merged (1 of 2 you wait on)", "w2 ended without merging (2 of 2 you wait on)"]);
});

test("D4: on a run with no merges a done wakes as done", () => {
  const { of, orch } = setup("brainstorm", ["a", "b"]);
  board.phase(orch, "p1", "ideas");
  board.post(orch, "@b sum up once a is in", { after: ["a"] });
  board.done(of("a"), "p1");
  assert.deepEqual(awaited().map((e) => e.body), ["a done (1 of 1 you wait on)"]);
});

test("D4: a lost awaited seat wakes the task's seat", () => {
  const { run, orch } = setup("brainstorm", ["a", "b"]);
  board.phase(orch, "p1", "ideas");
  board.post(orch, "@b after a", { after: ["a"] });
  const long = 10 * 60_000;
  const links = new Map<string, LinkFact>([["a", { connected: false, lostAt: Date.now() - long, seenAt: Date.now() - long, cause: "socket" }]]);
  const presence: Presence = (m) => links.get(m) ?? { connected: true, lostAt: null, seenAt: Date.now(), cause: null };
  board.recordServerUp(Date.now() - long);
  quietMember(file, "a", long);
  tick2(board, run, new Date(), presence);
  assert.deepEqual(awaited().map((e) => e.body), ["a lost (1 of 1 you wait on)"]);
});

test("D13: a task is the orchestrator's, to exactly one seat; --after names other seats of the run", () => {
  const { of, orch } = setup("task", ["w1", "w2"]);
  assert.throws(() => board.post(of("w1"), "@w2 do it", { task: true }), /only the orchestrator/);
  assert.throws(() => board.post(orch, "@w1 @w2 both", { task: true }), /exactly one seat/);
  assert.throws(() => board.post(orch, "@w1 go", { after: ["w9"] }), /names no other seat.*w9/);
  assert.throws(() => board.post(orch, "@w1 go", { after: ["w1"] }), /names no other seat.*w1/);
});

test("D5: an open task is owed outside any phase, until its seat's done; a later task replaces it", () => {
  const { of, orch } = setup("task", ["w1"]);
  assert.equal(rosterOf("g/w1")!.task, null);
  const t1 = board.post(orch, "@w1 T1", { task: true });
  assert.equal(rosterOf("g/w1")!.task, t1.seq);
  const t2 = board.post(orch, "@w1 T2", { task: true });
  assert.equal(rosterOf("g/w1")!.task, t2.seq);
  board.post(orch, "@w1 just a note");
  assert.equal(rosterOf("g/w1")!.task, t2.seq);
  board.phase(orch, "p1", "build");
  board.done(of("w1"), "p1");
  assert.equal(rosterOf("g/w1")!.task, null);
});

test("D5: the doing is fresh until an event to the member comes after it; a new doing is fresh again", () => {
  const { of, orch } = setup("task", ["w1", "w2"]);
  board.setDoing(of("w1"), "on T1");
  const row = rosterOf("g/w1")!;
  assert.equal(row.doingStale, false);
  assert.ok(Date.now() - row.doingAt < 60_000);
  board.post(orch, "@w1 a plain post wakes it but is no event");
  assert.equal(rosterOf("g/w1")!.doingStale, false);
  // a broadcast to the group (a phase) is no event to it by name
  board.phase(orch, "p1", "build");
  assert.equal(rosterOf("g/w1")!.doingStale, false);
  board.post(orch, "@w1 T2 once w2 is in", { after: ["w2"] });
  board.end(of("w2"));
  assert.equal(rosterOf("g/w1")!.doingStale, true);
  board.setDoing(of("w1"), "on T2");
  assert.equal(rosterOf("g/w1")!.doingStale, false);
});

const orchestratorsBoard = () => {
  const ob = board.openRun({ repo: REPO, kind: "brainstorm", group: "orchestrators", title: "Orchestrators", seats: [{ id: "g", blockers: [] }] });
  const team = board.openRun({ repo: REPO, kind: "task", group: "g", title: "G", seats: [] });
  board.join({ run: ob.id, seat: "g", doing: "orchestrating", files: [] });
  return { ob: ob.id, team: team.id };
};

test("D12: closing a run ends its orchestrator's seat on the orchestrators board, which no longer lists it", () => {
  const { team } = orchestratorsBoard();
  assert.ok(rosterOf("orchestrators/g"));
  board.closeRun(team);
  assert.equal(rosterOf("orchestrators/g"), undefined);
  assert.ok(board.participant("orchestrators/g", REPO)?.ended);
});

test("D12: at open the board ends, never deletes, the seat of every orchestrator whose run is closed; idempotent", async () => {
  const { ob, team } = orchestratorsBoard();
  board.closeRun(team);
  board.close();
  // a store from before: the seat left open after its run closed
  const raw = openRawStore(file);
  raw.prepare("UPDATE participants SET ended_at = NULL WHERE run = ? AND seat = 'g'").run(ob);
  raw.close();
  board = await openBoard(file);
  assert.equal(rosterOf("orchestrators/g"), undefined);
  board.close();
  board = await openBoard(file);
  const kept = openRawStore(file);
  const rows = kept.prepare("SELECT ended_at FROM participants WHERE run = ? AND seat = 'g'").all(ob) as { ended_at: string | null }[];
  kept.close();
  assert.equal(rows.length, 1);
  assert.ok(rows[0].ended_at);
});

test("D13: the orchestrator's plain post to one seat without --task is told how a task is posted", async () => {
  const { taskHintLines } = await import("../src/cli/answer/rules.ts");
  const base = { orchestrator: true, plain: true, task: false, mentions: ["g/w1"], group: "g" };
  assert.equal(taskHintLines(base).length, 1);
  assert.match(taskHintLines(base)[0], /--task/);
  assert.deepEqual(taskHintLines({ ...base, task: true }), []);
  assert.deepEqual(taskHintLines({ ...base, orchestrator: false }), []);
  assert.deepEqual(taskHintLines({ ...base, mentions: ["g/w1", "g/w2"] }), []);
  assert.deepEqual(taskHintLines({ ...base, mentions: ["g/*"] }), []);
});
