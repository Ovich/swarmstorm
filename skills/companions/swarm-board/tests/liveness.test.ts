// Liveness: the Claude Code JSONL adapter and its registry, and the member states the server's tick
// derives from each link's activity (swarm-relay D9, D11, D12, D31), the clock and presence injected.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openRawStore } from "./fixtures/raw-store.ts";
import { openBoard, type Board, type Presence } from "../src/board/board.ts";
import { ADAPTERS, claudeCodeJsonl, readTranscript } from "../src/board/liveness.ts";
import type { MemberActivity } from "../src/wire.ts";
import { eventStep } from "../src/cli/answer/rules.ts";
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
  for (const p of [a, b, orchestrator]) board.deliver(p);
  return { run, a, b, orchestrator };
};
const events = (name: string) => board.snapshot(REPO).events.filter((e) => e.event === name);
const at = (base: number, s: number): Date => new Date(base + s * 1000);
const stateOf = (run: number, member: string, t: Date) => board.memberStates(run, t).find((s) => s.member === member)!;

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
  assert.deepEqual([live.state, live.doing, live.tokens, live.movedAt], ["working", "Read src/y.ts", 50, new Date(base + 1000).toISOString()]);
  // an ended member's activity is not recorded
  board.end(board.participant("idea/b")!);
  board.recordActivity(run.id, "b", act({ grewAt: base, tokens: 7 }), at(base, 0));
  assert.equal(board.memberStates(run.id, at(base, 0)).some((s) => s.member === "b"), false);
});

test("states: growing → working; an open call → busy with its tool and start, for as long as it is open; past 15 min it stays busy, says so, and is told to the orchestrator as stalled (D46)", () => {
  const { run } = setup();
  const base = Date.now() + 60_000;
  board.recordActivity(run.id, "a", act({ grewAt: base }), at(base, 0));
  assert.equal(stateOf(run.id, "a", at(base, 4)).state, "working");
  board.recordActivity(run.id, "a", act({ grewAt: base, openTool: { name: "Bash", target: "npm test", since: base }, lastTool: "Bash npm test" }), at(base, 1));
  const busy = stateOf(run.id, "a", at(base, 600));
  assert.deepEqual([busy.state, busy.doing, busy.since, busy.badge], ["busy", "Bash npm test", base, null]);
  board.livenessTick(run.id, at(base, 15 * 60), presence);
  const over = stateOf(run.id, "a", at(base, 15 * 60));
  assert.deepEqual([over.state, over.badge?.name, over.badge?.reason], ["busy", "stalled", "call open 15 min, may be long or hung; last: \"Bash npm test\""]);
  const stalled = events("stalled");
  assert.equal(stalled.length, 1);
  assert.match(stalled[0].body, /^stalled idea\/a: call open 15 min, may be long or hung; last: "Bash npm test"/);
  // the call returns, the transcript grows: working again
  board.recordActivity(run.id, "a", act({ grewAt: base + 16 * 60_000, lastTool: "Bash npm test" }), at(base, 16 * 60));
  assert.equal(stateOf(run.id, "a", at(base, 16 * 60)).state, "working");
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

test("states: a last line that is a background task's result, then silence → quiet (E12); finished, or a link lost 30 s → gone", () => {
  const { run } = setup();
  const base = Date.now() + 60_000;
  board.recordActivity(run.id, "a", act({ grewAt: base, lastTool: "Bash node swarm.mjs wait --mentions --as idea/a" }), at(base, 0));
  const q = stateOf(run.id, "a", at(base, 6));
  assert.equal(q.badge?.name, "stalled");
  assert.match(q.badge!.reason, /^no progress for 6s, link down; last Bash node swarm\.mjs wait/);
  board.recordActivity(run.id, "a", act({ grewAt: base, finished: true }), at(base, 7));
  board.livenessTick(run.id, at(base, 7), presence);
  assert.deepEqual([stateOf(run.id, "a", at(base, 7)).badge?.name, stateOf(run.id, "a", at(base, 7)).badge?.reason], ["lost", "its agent finished without end"]);
  board.recordActivity(run.id, "b", act({ grewAt: base + 100_000 }), at(base, 0));
  links.set("b", { connected: false, lostAt: base });
  assert.equal(stateOf(run.id, "b", at(base, 29)).state, "working");
  const gone = stateOf(run.id, "b", at(base, 30));
  assert.deepEqual([gone.badge?.name, gone.badge?.reason], ["lost", "its link was lost"]);
});

test("one member quiet past the threshold: stalled <member> to the orchestrator alone, no other woken; again only after 15 min; nothing while busy (US2, D11)", async () => {
  const { run, b } = setup();
  const base = Date.now() + 60_000;
  const grow = (s: number) => board.recordActivity(run.id, "b", act({ grewAt: base + s * 1000 }), at(base, s));
  board.recordActivity(run.id, "a", act({ grewAt: base }), at(base, 0));
  grow(0);
  const bWait = board.wait(b, { mentionsOnly: true, timeoutMs: 600 });
  board.livenessTick(run.id, at(base, 4), presence);
  assert.equal(events("stalled").length, 0);
  grow(5);
  board.livenessTick(run.id, at(base, 5), presence);
  assert.equal(events("stalled").length, 1);
  const s = events("stalled")[0];
  assert.match(s.body, /^stalled idea\/a: no progress for 5s, link alive; no phase open$/);
  assert.deepEqual(s.mentions, ["idea/orchestrator"]);
  assert.equal((await bWait).full.length, 0, "b is not woken");
  for (const t of [6, 60, 14 * 60]) {
    grow(t);
    board.livenessTick(run.id, at(base, t), presence);
  }
  assert.equal(events("stalled").length, 1, "once");
  grow(5 + 15 * 60);
  board.livenessTick(run.id, at(base, 5 + 15 * 60), presence);
  assert.equal(events("stalled").length, 2, "again after 15 min");
  // a busy member is never stalled, however long under 15 min
  const t0 = base + 2 * 3600_000;
  board.recordActivity(run.id, "a", act({ grewAt: t0, openTool: { name: "Bash", target: "npm test", since: t0 } }), new Date(t0));
  for (const s2 of [10, 300, 800]) {
    board.recordActivity(run.id, "b", act({ grewAt: t0 + s2 * 1000 }), at(t0, s2));
    board.livenessTick(run.id, at(t0, s2), presence);
  }
  assert.equal(events("stalled").length, 2);
  assert.match(stepOf("stalled")(board.read(s.seq), board.participant("idea/orchestrator")!, "swarm")!, /^read the thread, then address the member who owes a move/);
  assert.equal(stepOf("stalled")(board.read(s.seq), b, "swarm"), null);
});

test("gone: posted at the tick after an activity with finished and no end, and after a link lost 30 s; once; never for an ended member (US3, D12)", () => {
  const { run, a } = setup();
  const base = Date.now() + 60_000;
  board.recordActivity(run.id, "a", act({ grewAt: base, finished: true }), at(base, 0));
  board.livenessTick(run.id, at(base, 1), presence);
  assert.deepEqual(events("lost").map((e) => [e.body, e.mentions]), [["lost idea/a: its agent finished without end", ["idea/orchestrator"]]]);
  board.livenessTick(run.id, at(base, 2), presence);
  assert.equal(events("lost").length, 1, "once");
  board.recordActivity(run.id, "b", act({ grewAt: base + 100_000 }), at(base, 0));
  links.set("b", { connected: false, lostAt: base });
  board.livenessTick(run.id, at(base, 29), presence);
  assert.equal(events("lost").length, 1);
  board.livenessTick(run.id, at(base, 30), presence);
  assert.equal(events("lost")[1].body, "lost idea/b: its link was lost");
  // an ended member: never
  board.end(a);
  board.end(board.participant("idea/b")!);
  board.livenessTick(run.id, at(base, 60), presence);
  assert.equal(events("lost").length, 2);
});

test("idle once when every member but the orchestrator turns waiting (D31, D34), again after 15 min only when the board changed since; a member stirring buys no idle within 15 min of the last (D44); a closed run's tick answers false", async () => {
  const { run, a, b } = setup();
  const opened = Date.now() - 1000;
  const wa = board.wait(a, { mentionsOnly: true, timeoutMs: 400 });
  const wb = board.wait(b, { mentionsOnly: true, timeoutMs: 400 });
  const base = Date.now() + 60_000;
  // a prefixed line, as a seat runs it: the link read it as the board's wait (D35, D45)
  const waitCall = (m: string, since = opened) => ({ name: "Bash", target: `export SWARMSTORM_HOME=/h; node swarm.mjs wait --mentions --as idea/${m}`, since, boardWait: true });
  const idles = () => events("idle").map((e) => [e.body.split(":")[0], e.mentions]);
  board.recordActivity(run.id, "a", act({ grewAt: base, openTool: waitCall("a") }), at(base, 0));
  // b holds its wait in the background while it works: not waiting, no idle
  board.recordActivity(run.id, "b", act({ grewAt: base, openTool: { name: "Bash", target: "npm test", since: base } }), at(base, 0));
  for (const s of [0, 15, 30]) board.livenessTick(run.id, at(base, s), presence);
  assert.equal(events("idle").length, 0);
  board.recordActivity(run.id, "b", act({ grewAt: base, openTool: waitCall("b") }), at(base, 31));
  for (const s of [31, 45, 60, 600, 31 + 15 * 60 - 1]) board.livenessTick(run.id, at(base, s), presence);
  assert.deepEqual(idles(), [["idle 0s", ["idea/orchestrator"]]]);
  // nothing changed on the board: no repeat, however long
  board.livenessTick(run.id, at(base, 31 + 15 * 60), presence);
  board.livenessTick(run.id, at(base, 31 + 15 * 60 + 1), presence);
  assert.deepEqual(idles().length, 1);
  // a post since: told again
  board.post(board.participant("idea/orchestrator")!, "note for the record");
  board.livenessTick(run.id, at(base, 31 + 15 * 60 + 2), presence);
  assert.deepEqual(idles().map(([b]) => b), ["idle 0s", "idle 902s"]);
  // b moves, then waits again: a new quiet spell, but no idle within 15 min of the last one (D44)
  const t2 = 31 + 15 * 60 + 5;
  board.recordActivity(run.id, "b", act({ grewAt: base + t2 * 1000 }), at(base, t2));
  board.livenessTick(run.id, at(base, t2), presence);
  board.recordActivity(run.id, "b", act({ grewAt: base + t2 * 1000, openTool: waitCall("b") }), at(base, t2 + 1));
  board.livenessTick(run.id, at(base, t2 + 1), presence);
  board.livenessTick(run.id, at(base, t2 + 60), presence);
  assert.deepEqual(idles().map(([b]) => b), ["idle 0s", "idle 902s"]);
  board.livenessTick(run.id, at(base, 31 + 30 * 60 + 2), presence);
  assert.equal(idles().length, 3);
  await Promise.all([wa, wb]);
  board.closeRun(run.id);
  assert.equal(board.livenessTick(run.id, at(base, t2 + 61), presence), false);
  assert.equal(board.livenessTick(999, at(base, t2 + 61), presence), false);
});

test("no transcript: a member with no link activity 30 s after its join is named once to the orchestrator; waiting in a board wait, else quiet, never working (D33)", async () => {
  const { run, a } = setup();
  const base = Date.now() + 60_000;
  const warnings = () => events("liveness").map((e) => [e.body, e.mentions]);
  // before 30 s: no evidence of work, so not working, and no warning yet
  assert.deepEqual([stateOf(run.id, "b", at(base, -59)).state, stateOf(run.id, "b", at(base, -59)).badge], ["working", null]);
  board.livenessTick(run.id, at(base, -59), presence);
  assert.equal(warnings().length, 0);
  // a in a board wait, b not: both past 30 s with no activity
  const held = board.wait(a, { mentionsOnly: true, timeoutMs: 300 });
  for (const s of [0, 15, 900]) board.livenessTick(run.id, at(base, s), presence);
  // due at one tick: one wake naming both
  assert.deepEqual(warnings(), [
    ["liveness idea: no transcript found for idea/a: its state is presence only; no transcript found for idea/b: its state is presence only", ["idea/orchestrator"]],
  ]);
  assert.equal(stateOf(run.id, "a", at(base, 1)).state, "waiting");
  const b = stateOf(run.id, "b", at(base, 1));
  assert.deepEqual([b.badge?.name, b.badge?.reason], ["stalled", "no transcript found"]);
  await held;
  assert.deepEqual([stateOf(run.id, "a", at(base, 2)).badge?.name, stateOf(run.id, "a", at(base, 2)).badge?.reason], ["stalled", "no transcript found"]);
  // activity arrives: the member reads from it, and the warning is not posted again
  board.recordActivity(run.id, "b", act({ grewAt: base + 3000 }), at(base, 3));
  assert.equal(stateOf(run.id, "b", at(base, 4)).state, "working");
  board.livenessTick(run.id, at(base, 1000), presence);
  assert.equal(warnings().length, 1);
});

test("stalled needs no progress AND the link alive: it names the last call and the missing signal; a lost link draws gone, never stalled (D36, finding 2)", () => {
  const { run, a } = setup();
  const base = Date.now() + 60_000;
  board.recordActivity(run.id, "a", act({ grewAt: base, lastTool: "Read src/x.ts" }), at(base, 0));
  board.recordActivity(run.id, "b", act({ grewAt: base, lastTool: "Bash npm test" }), at(base, 0));
  // b stopped: its link died at once
  links.set("b", { connected: false, lostAt: base + 1000 });
  for (const s of [4, 5, 10, 20, 30]) board.livenessTick(run.id, at(base, s), presence);
  assert.deepEqual(
    events("stalled").map((e) => e.body),
    ["stalled idea/a: no progress for 5s, link alive; last Read src/x.ts; no phase open"],
    "a stalled with its evidence; b never",
  );
  assert.equal(events("lost").length, 0);
  board.livenessTick(run.id, at(base, 31), presence);
  assert.deepEqual(events("lost").map((e) => e.body), ["lost idea/b: its link was lost"]);
  assert.equal(events("stalled").length, 1, "still never stalled for b");
  // a post is progress: a reads working again
  board.post(a, "still here");
  assert.equal(stateOf(run.id, "a", new Date(Date.now() + 1000)).state, "working");
});

test("the snapshot's liveness and the roster carry progressAt and aliveAt (D38)", () => {
  const { run } = setup();
  const base = Date.now() + 60_000;
  board.recordActivity(run.id, "a", act({ grewAt: base }), at(base, 0));
  const before = Date.now();
  board.livenessTick(run.id, new Date(), presence);
  const live = () => board.snapshot(REPO).roster.find((r) => r.member === "idea/a")!.liveness!;
  const rostered = () => board.roster(REPO).find((r) => r.name === "idea/a")!;
  assert.equal(live().progressAt, base);
  assert.ok(live().aliveAt! >= before, "a link up is alive now");
  assert.equal(rostered().progressAt, base);
  assert.ok(rostered().aliveAt! >= before);
  links.set("a", { connected: false, lostAt: before - 5000 });
  board.livenessTick(run.id, new Date(), presence);
  assert.deepEqual([live().progressAt, live().aliveAt], [base, before - 5000]);
  assert.deepEqual([rostered().progressAt, rostered().aliveAt], [base, before - 5000]);
});

test("no idle while a seat of the run has yet to join: a run filling up is not idle (D44)", async () => {
  links = new Map();
  const run = board.openRun({ repo: REPO, kind: "brainstorm", group: "fill", title: "F", stallMs: 5000, seats: ["a", "b", "c"].map((id) => ({ id, title: id, blockers: [] })) });
  const a = board.join({ run: run.id, seat: "a", doing: "x", files: [] }).member;
  board.deliver(a);
  const held = board.wait(a, { mentionsOnly: true, timeoutMs: 300 });
  const base = Date.now();
  board.recordActivity(run.id, "a", act({ grewAt: base, openTool: { name: "Bash", target: "node swarm.mjs wait --mentions --as fill/a", since: base - 1000, boardWait: true } }), at(base, 0));
  for (const s of [1, 16, 31]) board.livenessTick(run.id, at(base, s), presence);
  assert.equal(events("idle").length, 0);
  await held;
});

test("G31: alerts due within the window after one told are held and told together at its end, one wake", () => {
  const { run } = setup();
  const base = Date.now() + 60_000;
  // both seats have no transcript: one liveness line at the first tick, the window opened by it
  board.livenessTick(run.id, at(base, 0), presence);
  assert.equal(events("liveness").length, 1, "the first at once");
  board.recordActivity(run.id, "a", act({ grewAt: base, tokens: 1 }), at(base, 0));
  board.recordActivity(run.id, "b", act({ grewAt: base, tokens: 1 }), at(base, 0));
  // a stalls 5 s on: held inside the window
  board.livenessTick(run.id, at(base, 6), presence);
  assert.equal(events("stalled").length, 0, "held inside the window");
  board.livenessTick(run.id, at(base, 11), presence);
  assert.equal(events("stalled").length, 1, "told at the window's end");
});

test("D43: a gone due inside the window is told at once, and what is held rides along with it (S31: liveness then gone)", () => {
  const { run } = setup();
  const base = Date.now() + 60_000;
  // b's link was lost 25 s before the first tick: its gone comes due 5 s after the liveness alert opened the window
  links.set("b", { connected: false, lostAt: base - 25_000 });
  board.livenessTick(run.id, at(base, 0), presence);
  assert.equal(events("liveness").length, 1);
  assert.equal(events("lost").length, 0);
  board.recordActivity(run.id, "a", act({ grewAt: base, tokens: 1 }), at(base, 0));
  // a stalls at 6 s: held; b is gone at 6 s: told at once, the held stalled with it
  board.livenessTick(run.id, at(base, 6), presence);
  assert.deepEqual(events("lost").map((e) => e.body), ["lost idea/b: its link was lost"], "told at this tick, not at the window's end");
  assert.equal(events("stalled").length, 1, "the held alert rode along");
});
