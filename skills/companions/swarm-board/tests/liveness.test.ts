import { quietMember } from "./fixtures/quiet-member.ts";
// Liveness: the Claude Code JSONL adapter and its registry, and the member states the server's tick
// derives from each link's activity (swarm-relay D9, D11, D12, D31), the clock and presence injected.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openRawStore } from "./fixtures/raw-store.ts";
import { openBoard, type Board, type Participant, type Presence } from "../src/board/board.ts";
import { ADAPTERS, claudeCodeJsonl, readTranscript } from "../src/board/liveness.ts";
import type { MemberActivity } from "../src/wire.ts";
import { eventStep } from "../src/cli/answer/rules.ts";
import { tick2 } from "./fixtures/tick2.ts";
const stepOf = (e: import("../src/board/events.ts").EventName) => (m: Parameters<typeof eventStep>[0], me: Parameters<typeof eventStep>[1], cli: string) => eventStep(m, me, cli, e);

const REPO = "/repos/one/.git";
let dir: string;
let board: Board;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-liveness-"));
  board = await openBoard(path.join(dir, "swarm.sqlite"));
});

afterEach(() => {
  board.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const line = (usage: Record<string, number> | null): string => JSON.stringify({ type: usage ? "assistant" : "user", message: usage ? { usage } : { content: "x" } }) + "\n";

test("the Claude Code adapter sums the four usage counts over complete lines, by byte offset; a torn last line waits", () => {
  const f = path.join(dir, "t.jsonl");
  fs.writeFileSync(f, line(null) + line({ input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000 }));
  const first = readTranscript(f, null)!;
  assert.equal(first.adapter, "claude-code-jsonl");
  assert.equal(first.cursor.tokens, 1115);
  assert.equal(first.cursor.offset, fs.statSync(f).size);
  fs.appendFileSync(f, line({ input_tokens: 1, output_tokens: 2 }) + '{"type":"assist');
  const second = readTranscript(f, first)!;
  assert.equal(second.cursor.tokens, 1118);
  fs.appendFileSync(f, 'ant","message":{"usage":{"output_tokens":7}}}\n');
  assert.equal(readTranscript(f, second)!.cursor.tokens, 1125);
  // nothing new: the same reading
  assert.deepEqual(readTranscript(f, readTranscript(f, second)), readTranscript(f, second));
});

test("a missing file, or one no adapter recognises, reads null; the registry holds the Claude Code adapter", () => {
  assert.equal(readTranscript(path.join(dir, "none.jsonl"), null), null);
  const text = path.join(dir, "t.txt");
  fs.writeFileSync(text, "hello\nworld\n");
  assert.equal(readTranscript(text, null), null);
  assert.equal(claudeCodeJsonl.read(Buffer.from("[1]\n"), { offset: 0, tokens: 0 }), null);
  assert.ok(ADAPTERS.includes(claudeCodeJsonl));
});

/** Every member's link as the test sets it; a member not set is connected. */
let links: Map<string, { connected: boolean; lostAt: number | null }>;
const presence: Presence = (m) => links.get(m) ?? { connected: true, lostAt: null };
const act = (o: Partial<MemberActivity> = {}): MemberActivity => ({ grewAt: null, tokens: 0, context: null, openTool: null, lastTool: null, finished: false, ...o });

/** A brainstorm with two seats, a and b, joined, threshold 5 s; what was already for them had. */
const setup = () => {
  links = new Map();
  const run = board.openRun({ repo: REPO, kind: "brainstorm", group: "idea", title: "I", stallMs: 5000, seats: [{ id: "a", blockers: [] }, { id: "b", blockers: [] }] });
  const a = board.join({ run: run.id, seat: "a", doing: "x", files: [] }).member;
  const b = board.join({ run: run.id, seat: "b", doing: "x", files: [] }).member;
  const orchestrator = board.participant("idea/orchestrator")!;
  for (const p of [a, b, orchestrator]) board.deliverMentions(p);
  return { run, a, b, orchestrator };
};
/** Each member's own task, a post, delivered. */
const taskTo = (orchestrator: Participant, ...members: Participant[]) => {
  for (const m of members) {
    board.post(orchestrator, `@${m.name.slice(m.name.indexOf("/") + 1)} your part`);
    board.deliverMentions(m);
  }
};
const events = (name: string) => board.snapshot(REPO).events.filter((e) => e.event === name);
const at = (base: number, s: number): Date => new Date(base + s * 1000);
// board-split D55: a badge shows once two ticks confirmed it, so a read at `t` is the server having ticked there
const stateOf = (run: number, member: string, t: Date) => (tick2(board, run, t, presence), board.memberStates(run, t)).find((s) => s.member === member)!;

test("an activity updates the member's member_activity row and adds a token reading; the page's liveness reads them", async () => {
  const { run } = setup();
  const base = Date.now() + 60_000;
  board.recordActivity(run.id, "a", act({ grewAt: base, tokens: 42, context: 9, lastTool: "Read src/x.ts" }), at(base, 0));
  board.recordActivity(run.id, "a", act({ grewAt: base + 1000, tokens: 50, lastTool: "Read src/y.ts" }), at(base, 1));
  const db = openRawStore(path.join(dir, "swarm.sqlite"));
  try {
    const row = db.prepare("SELECT * FROM member_activity WHERE run = ? AND member = 'a'").get(run.id) as Record<string, unknown>;
    assert.deepEqual([row.tokens, row.grew_at, row.last_tool, row.finished], [50, base + 1000, "Read src/y.ts", 0]);
    assert.deepEqual((db.prepare("SELECT tokens FROM token_readings WHERE run = ? AND member = 'a' ORDER BY t").all(run.id) as { tokens: number }[]).map((r) => r.tokens), [42, 50]);
  } finally {
    db.close();
  }
  const live = board.snapshot(REPO).roster.find((r) => r.member === "idea/a")!.liveness!;
  // U-F6 (D45, D49): a working member names no last call as if it ran
  assert.deepEqual([live.state, live.doing, live.tokens, live.movedAt], ["working", null, 50, new Date(base + 1000).toISOString()]);
  // an ended member's activity is not recorded
  board.end(board.participant("idea/b")!);
  board.recordActivity(run.id, "b", act({ grewAt: base, tokens: 7 }), at(base, 0));
  assert.equal(board.memberStates(run.id, at(base, 0)).some((s) => s.member === "b"), false);
});

test("states: growing → working; an open call → busy with its tool and start, for as long as it is open; past 15 min it stays busy with no badge and no stalled (board-split D49: an open call is activity only)", () => {
  const { run } = setup();
  const base = Date.now() + 60_000;
  // the links are up from the start (U-F3: a member never linked is lost 30 s after its join)
  tick2(board, run.id, at(base, 0), presence);
  board.recordActivity(run.id, "a", act({ grewAt: base }), at(base, 0));
  assert.equal(stateOf(run.id, "a", at(base, 4)).state, "working");
  board.recordActivity(run.id, "a", act({ grewAt: base, openTool: { name: "Bash", target: "npm test", since: base }, lastTool: "Bash npm test" }), at(base, 1));
  const busy = stateOf(run.id, "a", at(base, 600));
  assert.deepEqual([busy.state, busy.doing, busy.since, busy.badge], ["busy", "Bash npm test", base, null]);
  tick2(board, run.id, at(base, 15 * 60), presence);
  const over = stateOf(run.id, "a", at(base, 15 * 60));
  assert.deepEqual([over.state, over.badge], ["busy", null]);
  assert.equal(events("stalled").length, 0);
  // the call returns, the transcript grows: working again, naming no last call as if it ran (U-F6)
  board.recordActivity(run.id, "a", act({ grewAt: base + 16 * 60_000, lastTool: "Bash npm test" }), at(base, 16 * 60));
  assert.deepEqual([stateOf(run.id, "a", at(base, 16 * 60)).state, stateOf(run.id, "a", at(base, 16 * 60)).doing], ["working", null]);
});

test("states: a foreground wait (its open call opened before the held wait began) → waiting; a background wait --mentions held while working → not waiting (D31, D35)", async () => {
  const { run, a } = setup();
  const opened = Date.now() - 1000;
  const held = board.wait(a, { mentionsOnly: true, timeoutMs: 300 });
  const base = Date.now() + 60_000;
  // the listener runs in the background: the open call is another tool, opened after the wait, or none while the transcript grows
  board.recordActivity(run.id, "a", act({ grewAt: base, openTool: { name: "Bash", target: "npm test", since: base } }), at(base, 0));
  assert.equal(stateOf(run.id, "a", at(base, 1)).state, "busy");
  board.recordActivity(run.id, "a", act({ grewAt: base }), at(base, 1));
  assert.equal(stateOf(run.id, "a", at(base, 2)).state, "working");
  // the call that runs the wait, open since before it reached the board: the member is blocked in it
  board.recordActivity(run.id, "a", act({ grewAt: base, openTool: { name: "Bash", target: "node swarm.mjs wait --mentions --as idea/a", since: opened, boardWait: true } }), at(base, 2));
  const w = stateOf(run.id, "a", at(base, 120));
  assert.deepEqual([w.state, w.since], ["waiting", opened]);
  await held;
  // the wait returned: no longer held, the call still open reads busy
  assert.equal(stateOf(run.id, "a", at(base, 121)).state, "busy");
});

test("states: waiting is the open call the link read as the board's own wait, its text truncated or prefixed; any other open call is work, a held background wait or not (D35, D45)", async () => {
  const { run, a } = setup();
  const opened = Date.now() - 1000;
  const truncated = { name: "Bash", target: "export SWARMSTORM_HOME=/tmp/h; cd /w; node /p/swar", since: opened, boardWait: true };
  // the run 75 false idle: a browser's wait_for while the member's background listener is held
  const browserWait = { name: "mcp__watched-browser__browser_wait_for", target: '{"time":30}', since: opened };
  const held = board.wait(a, { mentionsOnly: true, timeoutMs: 300 });
  const base = Date.now();
  board.recordActivity(run.id, "a", act({ grewAt: opened, openTool: truncated }), at(base, 0));
  assert.equal(stateOf(run.id, "a", at(base, 1)).state, "waiting");
  board.recordActivity(run.id, "a", act({ grewAt: opened, openTool: browserWait }), at(base, 0));
  assert.equal(stateOf(run.id, "a", at(base, 1)).state, "busy");
  await held;
});

test("states (board-split D49, D55): a finished transcript or silence is no badge; a link lost LOST_MS on a member owing its task is lost", () => {
  const { run, b, orchestrator } = setup();
  board.phase(orchestrator, "p1", "go", { for: ["b"] });
  const base = Date.now() + 60_000;
  // the links are up from the start (U-F3: a member never linked is lost 30 s after its join)
  tick2(board, run.id, at(base, 0), presence);
  board.recordActivity(run.id, "a", act({ grewAt: base, lastTool: "Bash node swarm.mjs wait --mentions --as idea/a" }), at(base, 0));
  assert.equal(stateOf(run.id, "a", at(base, 6)).badge, null, "no phase owed: no badge");
  board.recordActivity(run.id, "a", act({ grewAt: base, finished: true }), at(base, 7));
  tick2(board, run.id, at(base, 7), presence);
  assert.equal(stateOf(run.id, "a", at(base, 7)).badge, null, "a finished transcript is not lost");
  board.recordActivity(run.id, "b", act({ grewAt: base }), at(base, 0));
  links.set("b", { connected: false, lostAt: base });
  const before = stateOf(run.id, "b", at(base, 59));
  assert.deepEqual([before.state, before.badge], ["working", null]);
  const gone = stateOf(run.id, "b", at(base, 60));
  assert.deepEqual([gone.state, gone.badge?.name, gone.badge?.reason], [before.state, "lost", "its link was lost"]);
});

test("lost (board-split D49, D55): a finished transcript draws none; a link lost LOST_MS on a member owing its task draws one, once; never for an ended member (US3, D12)", () => {
  const { run, a, b, orchestrator } = setup();
  board.phase(orchestrator, "p1", "go", { for: ["b"] });
  const base = Date.now() + 60_000;
  board.recordActivity(run.id, "a", act({ grewAt: base, finished: true }), at(base, 0));
  tick2(board, run.id, at(base, 1), presence);
  assert.equal(events("lost").length, 0);
  board.recordActivity(run.id, "b", act({ grewAt: base }), at(base, 0));
  links.set("b", { connected: false, lostAt: base });
  tick2(board, run.id, at(base, 59), presence);
  assert.equal(events("lost").length, 0);
  tick2(board, run.id, at(base, 60), presence);
  assert.deepEqual(events("lost").map((e) => [e.body, e.mentions]), [["lost idea/b: its link was lost", ["idea/orchestrator"]]]);
  tick2(board, run.id, at(base, 61), presence);
  assert.equal(events("lost").length, 1, "once");
  // an ended member: never
  board.end(a);
  links.set("a", { connected: false, lostAt: base });
  board.end(board.participant("idea/b")!);
  tick2(board, run.id, at(base, 120), presence);
  assert.equal(events("lost").length, 1);
});

test("no transcript (board-split D55): a member with no link activity NO_TRANSCRIPT_MS after its join carries a card note, never an alarm; waiting in a board wait, else working, no badge (D33)", async () => {
  const { run, a } = setup();
  const base = Date.now() + 60_000;
  const note = (m: string) => board.snapshot(REPO).roster.find((r) => r.member === `idea/${m}`)!.liveness!.note;
  assert.deepEqual([stateOf(run.id, "b", at(base, -59)).state, stateOf(run.id, "b", at(base, -59)).badge], ["working", null]);
  const held = board.wait(a, { mentionsOnly: true, timeoutMs: 300 });
  for (const s of [0, 15, 900]) tick2(board, run.id, at(base, s), presence);
  assert.equal(events("stalled").length, 0, "no alarm");
  assert.equal(stateOf(run.id, "a", at(base, 1)).state, "waiting");
  assert.equal(stateOf(run.id, "b", at(base, 1)).badge, null);
  quietMember(path.join(dir, "swarm.sqlite"), "b", 60_000);
  assert.equal(note("b"), "no transcript found: its state is presence only");
  await held;
  // activity arrives: the member reads from it, and the note goes
  board.recordActivity(run.id, "b", act({ grewAt: base + 3000 }), at(base, 3));
  assert.equal(stateOf(run.id, "b", at(base, 4)).state, "working");
  assert.equal(note("b"), undefined);
  tick2(board, run.id, at(base, 1000), presence);
  assert.equal(events("stalled").length, 0, "no alarm");
});

test("the snapshot's liveness and the roster carry progressAt and aliveAt (D38)", () => {
  const { run } = setup();
  const base = Date.now() + 60_000;
  board.recordActivity(run.id, "a", act({ grewAt: base }), at(base, 0));
  const before = Date.now();
  tick2(board, run.id, new Date(), presence);
  const live = () => board.snapshot(REPO).roster.find((r) => r.member === "idea/a")!.liveness!;
  const rostered = () => board.roster(REPO).find((r) => r.name === "idea/a")!;
  assert.equal(live().progressAt, base);
  assert.ok(live().aliveAt! >= before, "a link up is alive now");
  assert.equal(rostered().progressAt, base);
  assert.ok(rostered().aliveAt! >= before);
  links.set("a", { connected: false, lostAt: before - 5000 });
  tick2(board, run.id, new Date(), presence);
  assert.deepEqual([live().progressAt, live().aliveAt], [base, before - 5000]);
  assert.deepEqual([rostered().progressAt, rostered().aliveAt], [base, before - 5000]);
});
