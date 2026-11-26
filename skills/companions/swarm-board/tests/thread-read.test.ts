// Reading the thread back, pull only: a run's phases, a page of its posts filtered and paged, one post in full; a run
// of another project never.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, THREAD_LIMIT, type Board } from "../src/board/board.ts";

const REPO = "/repos/one/.git";
const SEATS = [
  { id: "w1", blockers: [] },
  { id: "w2", blockers: [] },
];

let dir: string;
let board: Board;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-thread-read-"));
  board = await openBoard(path.join(dir, "swarm.sqlite"));
});
afterEach(() => {
  board.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const run = () => {
  const r = board.openRun({ repo: REPO, kind: "brainstorm", group: "idea", title: "I", seats: SEATS });
  const orchestrator = board.participant("idea/orchestrator")!;
  const w1 = board.join({ run: r.id, seat: "w1", doing: "x", files: [] }).member;
  const w2 = board.join({ run: r.id, seat: "w2", doing: "x", files: [] }).member;
  return { r, orchestrator, w1, w2 };
};

test("phases lists each opening with its posts; a phase opened again is a second opening, done counted on the latest", () => {
  const { r, orchestrator, w1, w2 } = run();
  board.phase(orchestrator, "build", "go");
  board.post(w1, "@w2 the interface");
  board.post(orchestrator, "@w1 urgent thing", { kind: "urgent" });
  board.phase(orchestrator, "verify", "check");
  board.done(w2, "verify");
  board.phase(orchestrator, "build", "again");
  const list = board.phases(REPO, r.id);
  assert.deepEqual(list.map((o) => [o.name, o.posts, o.urgent, o.current]), [["build", 2, 1, false], ["verify", 0, 0, false], ["build", 0, 0, true]]);
  assert.equal(list[0].done, null, "an earlier opening of a name opened again has no count of its own");
  assert.equal(list[1].done, 1);
});

test("thread: the current phase by default, filtered by seat and subject, paged back and on", () => {
  const { r, orchestrator, w1, w2 } = run();
  board.post(w1, "before any phase");
  board.phase(orchestrator, "build", "go");
  for (let i = 0; i < THREAD_LIMIT + 5; i++) board.post(w1, `@w2 note ${i}`);
  board.post(w2, "@w1 about the file", { about: "src/a.ts" });
  board.post(orchestrator, "@w1 per D44 do it");

  const page = board.thread(REPO, r.id, {});
  assert.equal(page.phase?.name, "build");
  assert.equal(page.posts.length, THREAD_LIMIT);
  assert.equal(page.posts.at(-1)!.body, "@w1 per D44 do it");
  assert.ok(page.posts.every((m) => m.body !== "before any phase"));
  assert.notEqual(page.earlier, null);
  assert.equal(page.later, null);
  // the members' joins are left out, the phase opening kept with --phase all and --events
  assert.ok(board.thread(REPO, r.id, { phase: "all", limit: 200 }).posts.every((m) => m.event !== "joined"));
  assert.ok(board.thread(REPO, r.id, { phase: "all", events: true, limit: 200 }).posts.some((m) => m.event === "joined"));

  const back = board.thread(REPO, r.id, { before: page.earlier! });
  assert.ok(back.posts.every((m) => m.seq < page.earlier!));
  assert.equal(back.posts.length, page.matched - THREAD_LIMIT);
  const on = board.thread(REPO, r.id, { from: back.posts[0].seq, limit: 3 });
  assert.deepEqual(on.posts.map((m) => m.seq), back.posts.slice(0, 3).map((m) => m.seq));
  assert.equal(on.later, back.posts[2].seq + 1);

  assert.deepEqual(board.thread(REPO, r.id, { by: "w2" }).posts.map((m) => m.body), ["@w1 about the file"]);
  assert.deepEqual(board.thread(REPO, r.id, { about: "src/a.ts" }).posts.map((m) => m.body), ["@w1 about the file"]);
  assert.deepEqual(board.thread(REPO, r.id, { about: "D44" }).posts.map((m) => m.body), ["@w1 per D44 do it"]);
  // --with: a seat's own posts and those naming it; the phase's broadcast never counts as naming it
  const withW2 = board.thread(REPO, r.id, { with: "@idea/w2", limit: 200 });
  assert.equal(withW2.matched, THREAD_LIMIT + 6);
  assert.equal(board.thread(REPO, r.id, { to: "w1" }).matched, 2);
});

test("thread refuses a phase the run never opened, naming its phases, and a run of another project", () => {
  const { r, orchestrator } = run();
  board.phase(orchestrator, "build", "go");
  assert.throws(() => board.thread(REPO, r.id, { phase: "verify" }), /never opened phase verify; its phases: build/);
  assert.throws(() => board.thread("/repos/two/.git", r.id, {}), /no run \d+ in this project/);
  assert.throws(() => board.phases("/repos/two/.git", r.id), /no run \d+ in this project/);
});

test("message: one post in full, of this project only", () => {
  const { w1 } = run();
  const long = `@w2 ${"x".repeat(500)}`;
  const m = board.post(w1, long);
  assert.equal(board.message(REPO, m.seq)?.body, long);
  assert.equal(board.message("/repos/two/.git", m.seq), null);
  assert.equal(board.message(REPO, m.seq + 1000), null);
});
