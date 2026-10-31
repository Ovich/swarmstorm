// board-split D31, D33, D45: a member in a board wait over a background task of its own is busy; the shown doing
// follows the latest board fact; the card carries the call's label.
import { quietMember } from "./fixtures/quiet-member.ts";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board, type Presence } from "../src/board/board.ts";
import type { MemberActivity } from "../src/wire.ts";
import { openRawStore } from "./fixtures/raw-store.ts";
import { observe } from "../src/link/transcripts.ts";
import { toolCall, writeMain } from "./fixtures/transcripts.ts";
import { tick2 } from "./fixtures/tick2.ts";

const REPO = "/repos/one/.git";
let dir: string;
let board: Board;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-busy-"));
  board = await openBoard(path.join(dir, "swarm.sqlite"));
});
afterEach(() => {
  board.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const linked: Presence = () => ({ connected: true, lostAt: null });
const lost = (since: number): Presence => () => ({ connected: false, lostAt: since });
const act = (o: Partial<MemberActivity> = {}): MemberActivity => ({ grewAt: null, tokens: 0, context: null, openTool: null, lastTool: null, finished: false, ...o });
const at = (base: number, s: number): Date => new Date(base + s * 1000);
const eventsOf = (name: string) => board.snapshot(REPO).events.filter((e) => e.event === name);

const setup = () => {
  const run = board.openRun({ repo: REPO, kind: "brainstorm", group: "g", title: "T", stallMs: 5000, seats: [{ id: "a", blockers: [] }, { id: "b", blockers: [] }] });
  const a = board.join({ run: run.id, seat: "a", doing: "x", files: [] }).member;
  const b = board.join({ run: run.id, seat: "b", doing: "x", files: [] }).member;
  const orch = board.participant("g/orchestrator")!;
  for (const p of [a, b, orch]) board.deliverMentions(p);
  return { run, a, b, orch };
};

test("D31 (S37): a board wait over its own un-notified background suite reads busy '<N> min · background <command>', never waiting or idle", async () => {
  const { run, a } = setup();
  const base = Date.now();
  const held = board.wait(a, { mentionsOnly: true, timeoutMs: 400 });
  const waitCall = { name: "Bash", target: "swarm wait --mentions", since: base, boardWait: true };
  board.recordActivity(run.id, "a", act({ grewAt: base, openTool: waitCall, background: { target: "npm test", since: base - 3 * 60_000, outputGrewAt: base } }), at(base, 0));
  const st = board.memberStates(run.id, at(base, 1)).find((s) => s.member === "a")!;
  assert.deepEqual([st.state, st.doing, st.badge], ["busy", "3 min · background npm test", null]);
  // the card's activity carries both the open wait and the background task (D32)
  const card = board.snapshot(REPO).roster.find((r) => r.member === "g/a")!;
  assert.deepEqual([card.activity?.open?.boardWait, card.activity?.background?.target], [true, "npm test"]);
  // 13 min from the task's start it stays busy, no badge: a background task is activity only (board-split D49)
  const long = board.memberStates(run.id, new Date(base + 13 * 60_000)).find((s) => s.member === "a")!;
  assert.deepEqual([long.state, long.badge], ["busy", null]);
  await held;
});

test("S22 (board-split D25, D55): a fresh agent re-joining a seat joined long ago carries no 'no transcript found' note before its link speaks, and never an alarm", () => {
  const { run, b } = setup();
  // the seat's first member joined ten minutes ago and finished; a fresh one joins it now
  const raw = openRawStore(path.join(dir, "swarm.sqlite"));
  raw.prepare("UPDATE participants SET joined_at = ? WHERE seat = 'b'").run(new Date(Date.now() - 10 * 60_000).toISOString());
  raw.close();
  board.recordActivity(run.id, "b", act({ grewAt: Date.now(), finished: true }), new Date());
  const rejoinedAt = Date.now();
  board.join({ run: run.id, seat: "b", doing: "again", files: [] });
  tick2(board, run.id, new Date(rejoinedAt + 1000), linked);
  const noteOfB = () => board.snapshot(REPO).roster.find((r) => r.member === "g/b")!.liveness?.note;
  assert.equal(noteOfB(), undefined, "measured from the re-join, not the seat's first join");
  quietMember(path.join(dir, "swarm.sqlite"), "b", 31_000);
  tick2(board, run.id, new Date(rejoinedAt + 31_000), linked);
  assert.equal(noteOfB(), "no transcript found: its state is presence only", "a note 30 s after the re-join");
  assert.deepEqual(eventsOf("liveness"), [], "never an alarm");
  void b;
});

test("D45: the card's activity carries the call's own label and whole command, null from a link that sent none", () => {
  const { run } = setup();
  const base = Date.now();
  const open = { name: "Bash", target: "npm run build", since: base, label: "Build the viewer", command: "cd app && npm run build" };
  board.recordActivity(run.id, "a", act({ grewAt: base, openTool: open, background: { target: "npm test", since: base, outputGrewAt: null } }), at(base, 0));
  const card = board.snapshot(REPO).roster.find((r) => r.member === "g/a")!;
  assert.deepEqual([card.activity?.open?.label, card.activity?.open?.command], ["Build the viewer", "cd app && npm run build"]);
  // no description, no command (an older link): the label is the target's short form
  assert.deepEqual([card.activity?.background?.label, card.activity?.background?.command], ["npm test", null]);
});

test("D45 (F14): with no description the label is the command's short form; the board's own wait is marked, for the card to show no line", () => {
  const { run } = setup();
  const base = Date.now();
  const command = "SWARMSTORM_HOME=/h node /p/swarm-board/swarm.mjs claim src/a.ts --as g/a";
  board.recordActivity(run.id, "a", act({ grewAt: base, openTool: { name: "Bash", target: command.slice(0, 50), since: base, label: null, command } }), at(base, 0));
  assert.equal(board.snapshot(REPO).roster.find((r) => r.member === "g/a")!.activity?.open?.label, "board claim");
  board.recordActivity(run.id, "a", act({ grewAt: base, openTool: { name: "Read", target: "/r/src/a.ts", since: base, label: null, command: "/r/src/a.ts" } }), at(base, 4));
  assert.equal(board.snapshot(REPO).roster.find((r) => r.member === "g/a")!.activity?.open?.label, "Read · a.ts");
  const wait = "node /p/swarm.mjs wait --mentions --as g/a";
  board.recordActivity(run.id, "a", act({ grewAt: base, openTool: { name: "Bash", target: wait, since: base, boardWait: true, label: null, command: wait } }), at(base, 8));
  assert.equal(board.snapshot(REPO).roster.find((r) => r.member === "g/a")!.activity?.open?.boardWait, true);
});

test("D45 (F14) end to end: a transcript's call, read by the link, stored and served, keeps its label", () => {
  const { run } = setup();
  const served = (lines: object[], session: string) => {
    const { activity } = observe(writeMain(path.join(dir, "projects"), "p", session, lines), null);
    board.recordActivity(run.id, "a", activity, new Date());
    return board.snapshot(REPO).roster.find((r) => r.member === "g/a")!.activity?.open;
  };
  const described = served([toolCall("Bash", { command: "cd app && npm run build", description: "Build the viewer" }, "t1", "2026-10-22T10:00:00.000Z")], "s1");
  assert.deepEqual([described?.label, described?.command], ["Build the viewer", "cd app && npm run build"]);
  const bare = served([toolCall("Bash", { command: "CI=1 npm test -- --watch=false" }, "t2", "2026-10-22T10:00:00.000Z")], "s2");
  assert.deepEqual([bare?.label, bare?.command], ["npm test --", "CI=1 npm test -- --watch=false"]);
  assert.equal(served([toolCall("Bash", { command: "node /p/swarm.mjs wait --mentions --as g/a", description: "Wait" }, "t3", "2026-10-22T10:00:00.000Z")], "s3")?.boardWait, true);
});
