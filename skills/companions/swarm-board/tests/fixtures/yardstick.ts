// The yardstick's player (run agent-ergonomics): every liveness scenario d3 listed, and idea 1's acceptance rows
// (note #11926 + #11931), played against the board's own code with a simulated clock and a synthetic
// transcript, measured for M1–M4 as d1 defined them. A scenario is a script of transcript lines, output
// growth, link changes and board waits over simulated seconds; each second the link's read (observe) feeds
// recordActivity and the server's livenessTick runs, as the server does every 1 s. The table's assertions
// hold the current numbers: a change that moves one updates its row, on purpose, with the note that asked.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board, type Participant, type Presence } from "../../src/board/board.ts";
import { STALL_MS_DEFAULT } from "../../src/board/liveness.ts";
import { EVENTS, eventOf } from "../../src/board/events.ts";
import { observe, type TranscriptCursor } from "../../src/link/transcripts.ts";
import { textLine, toolCall, writeSubagent } from "./transcripts.ts";

const REPO = "/repos/yardstick/.git";
export const SESSION = "33333333-aaaa-bbbb-cccc-000000000003";
export const PROJECT = "C--repos-yardstick";
/** d1: a stuck episode ends at T0 + 30 min when nothing intervenes. */
export const EPISODE_MS = 30 * 60 * 1000;
const ALERTS = new Set(["stalled", "gone"]);
const WAKE_EVENTS = new Set(["stalled", "gone", "idle", "liveness", "recovered"]);
const MIN = 60;
export const STALL_S = STALL_MS_DEFAULT / 1000;

/** One step of a scenario, at simulated second `s` from its start. */
type Step =
  | { s: number; line: (base: number, s: number, dir: string) => object }
  | { s: number; output: string }
  | { s: number; link: "down" | "up" }
  | { s: number; finished: true }
  | { s: number; boardWait: "start" | "end" };

export type Scenario = {
  id: string;
  what: string;
  /** Simulated seconds played. */
  length: number;
  steps: Step[];
  /** Ground truth: the second the member became stuck (T0), or null when its work is legitimate. */
  stuckAt: number | null;
  /** A member whose link never finds its transcript: no activity is ever recorded. */
  blind?: boolean;
  /** A second member, w: working steadily all through, or held in a board wait from second 2. */
  companion?: "works" | "waits";
  /** What the orchestrator does at second 1, delivered to x before any later wait (S11's owe rules). */
  owe?: (board: Board, orch: Participant) => void;
  /** The server's stat of a lost link's transcript: "mtime" (the note's rule 4), or "none" (A7b: not a file). */
  transcriptStat?: "mtime" | "none";
};

export type Alert = { s: number; event: string; rule: string | null; body: string; next: string | null };
export type Row = { id: string; wakes: number; noAction: number; perMemberHour: number; falseAlerts: number; falseStateS: number; detectS: number | null; missed: number; rule: string | null; events: string; alerts: Alert[]; told: Alert[]; wakeAt: { s: number; events: string[] }[] };

export const iso = (base: number, s: number) => new Date(base + s * 1000).toISOString();
export const usage = { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

/** Plays one scenario on a fresh board; returns its row. */
export async function play(sc: Scenario, length = sc.length): Promise<Row> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-yardstick-"));
  const board: Board = await openBoard(":memory:"); // in memory: some 40 000 ticks, no disk write each
  try {
    const run = board.openRun({ repo: REPO, kind: "task", group: "yard", title: "Yardstick", stallMs: STALL_MS_DEFAULT, seats: (sc.companion ? ["x", "w"] : ["x"]).map((m) => ({ id: m, title: m, blockers: [] })) });
    const x = board.join({ run: run.id, slice: "x", doing: "work", files: [] }).runner;
    const w = sc.companion ? board.join({ run: run.id, slice: "w", doing: "work", files: [] }).runner : null;
    if (w) board.deliver(w);
    const orch = board.participant("yard/orchestrator")!;
    board.deliver(x);
    board.deliver(orch);
    // simulated second 5, where the scenarios first wait, is the wall clock now: a board wait's start is the
    // wall clock's, and the owing span (rule 5) compares it with the tick's time
    const base = Date.now() - 5000;
    const file = writeSubagent(dir, PROJECT, SESSION, "x", [], { finished: false });
    fs.writeFileSync(file, "");
    const wFile = w ? writeSubagent(dir, PROJECT, SESSION, "w", [], { finished: false }) : null;
    let wCursor: TranscriptCursor | null = null;
    let wHeld: Promise<unknown> | null = null;
    let link = { connected: true, lostAt: null as number | null };
    const presence: Presence = (m) => {
      if (m !== "x" || link.connected) return { ...link, transcriptGrewAt: null };
      return { ...link, transcriptGrewAt: sc.transcriptStat === "none" ? null : fs.statSync(file).mtimeMs };
    };
    let cursor: TranscriptCursor | null = null;
    let held: Promise<unknown> | null = null;
    const wakes: { s: number; events: string[] }[] = [];
    const alerts: Alert[] = [];
    const told: Alert[] = [];
    let falseStateS = 0;
    const stuckFrom = sc.stuckAt;
    const isStuck = (s: number) => stuckFrom !== null && s >= stuckFrom;
    const append = (f: string, line: object, at: Date) => {
      fs.appendFileSync(f, JSON.stringify(line) + "\n");
      fs.utimesSync(f, at, at);
    };
    for (let s = 0; s <= length; s++) {
      const at = new Date(base + s * 1000);
      if (s === 1 && sc.owe) {
        sc.owe(board, orch);
        board.deliver(x);
        if (w) board.deliver(w);
      }
      if (wFile) {
        if (sc.companion === "works" && s % 20 === 0) append(wFile, textLine("w works", usage, iso(base, s)), at);
        if (sc.companion === "waits" && s === 2) {
          append(wFile, toolCall("Bash", { command: "node swarm.mjs wait --mentions --as yard/w" }, "toolu_wwait", iso(base, 1)), at);
          wHeld = board.wait(w!, { mentionsOnly: true, timeoutMs: 120_000 });
        }
        const o = observe(wFile, wCursor);
        wCursor = o.cursor;
        board.recordActivity(run.id, "w", o.activity, at);
      }
      for (const st of sc.steps.filter((p) => p.s === s)) {
        if ("line" in st) append(file, st.line(base, s, dir), at);
        else if ("output" in st) {
          const out = path.join(dir, st.output);
          fs.appendFileSync(out, `output at ${s}\n`);
          fs.utimesSync(out, at, at);
        } else if ("link" in st) link = st.link === "down" ? { connected: false, lostAt: at.getTime() } : { connected: true, lostAt: null };
        else if ("finished" in st) fs.writeFileSync(file.replace(/\.jsonl$/, ".meta.json"), JSON.stringify({ agentType: "general-purpose", finished: true }));
        else if (st.boardWait === "start") held = board.wait(x, { mentionsOnly: true, timeoutMs: 120_000 });
        else if (held) {
          // the wait returns (its 110 s timeout, as a worker re-arms it): released by a word to x, never x's own progress
          board.post(orch, "@x re-arm");
          await held;
          board.deliver(x);
          held = null;
        }
      }
      if (!sc.blind) {
        const o = observe(file, cursor);
        cursor = o.cursor;
        board.recordActivity(run.id, "x", o.activity, at);
      }
      board.livenessTick(run.id, at, presence);
      const state = board.memberStates(run.id, at).find((m) => m.member === "x")?.state;
      if ((state === "quiet" || state === "gone") && !isStuck(s)) falseStateS++;
      // what reaches the orchestrator this second, about x: one wake when any of it is a liveness event
      const fresh = board
        .deliver(orch)
        .full.map((m) => ({ m, e: eventOf(m) }))
        .filter(({ m, e }) => e !== null && WAKE_EVENTS.has(e) && m.mentions.includes(orch.name) && !m.body.includes("yard/w"));
      for (const { m, e } of fresh) told.push({ s, event: e!, rule: m.meta && "rule" in m.meta ? m.meta.rule : null, body: m.body, next: EVENTS[e as keyof typeof EVENTS]?.next?.(m, orch, "swarm") ?? null });
      for (const { m, e } of fresh) if (ALERTS.has(e!)) alerts.push({ s, event: e!, rule: m.meta && "rule" in m.meta ? m.meta.rule : null, body: m.body, next: EVENTS[e as keyof typeof EVENTS]?.next?.(m, orch, "swarm") ?? null });
      if (fresh.length) wakes.push({ s, events: fresh.map(({ e }) => e as string) });
    }
    for (const [p, h] of [[x, held], [w, wHeld]] as const) {
      if (!h || !p) continue;
      board.post(orch, `@${p.name.split("/")[1]} go`);
      await h;
    }
    // d1, M1 proxy: a wake needs action when it carries a true alert (the member stuck at that second)
    const needsAction = (wk: { s: number; events: string[] }) => wk.events.some((e) => ALERTS.has(e) && isStuck(wk.s));
    const falseAlerts = alerts.filter((a) => !isStuck(a.s)).length;
    const firstTrue = alerts.find((a) => isStuck(a.s) && a.s - stuckFrom! <= EPISODE_MS / 1000);
    const detectS = stuckFrom === null || !firstTrue ? null : firstTrue.s - stuckFrom;
    const missed = stuckFrom !== null && !firstTrue ? 1 : 0;
    const hours = length / 3600;
    return {
      id: sc.id,
      wakes: wakes.length,
      noAction: wakes.filter((wk) => !needsAction(wk)).length,
      perMemberHour: Math.round((wakes.length / hours) * 10) / 10,
      falseAlerts,
      falseStateS,
      detectS,
      missed,
      rule: (firstTrue ?? alerts[0])?.rule ?? null,
      events: wakes.map((wk) => `${wk.events.join("+")}@${wk.s}s`).join(" ") || "-",
      alerts,
      told,
      wakeAt: wakes,
    };
  } finally {
    board.close();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

let toolIds = 0;
const id = () => `toolu_y${++toolIds}`;
/** An assistant text line; without `stop_reason` it reads as a turn ended (the note's rule 1). */
const work = (s: number, text = "working"): Step => ({ s, line: (b, t) => textLine(text, usage, iso(b, t)) });
/** A line every 30 s from `from` to `to`: the member keeps working, so the script's end is not a silence. */
const steady = (from: number, to: number): Step[] => Array.from({ length: Math.floor((to - from) / 30) + 1 }, (_, i) => work(from + i * 30));
/** An assistant line calling a tool, `stop_reason: tool_use`: the turn goes on. */
const callLine = (name: string, input: object, tid: string) => (b: number, t: number) => {
  const l = toolCall(name, input, tid, iso(b, t)) as { message: Record<string, unknown> };
  l.message.stop_reason = "tool_use";
  return l;
};
const open = (s: number, tid: string, command = "npm test", extra: object = {}, tool = "Bash"): Step => ({ s, line: callLine(tool, { command, ...extra }, tid) });
const mcp = (s: number, tid: string): Step => ({ s, line: callLine("mcp__browser__browser_wait_for", { time: 1800 }, tid) });
/** A user line carrying a tool's result, its text as given. */
const result = (s: number, tid: string, text: (dir: string) => string = () => "ok"): Step => ({
  s,
  line: (b, t, dir) => ({ type: "user", timestamp: iso(b, t), message: { role: "user", content: [{ type: "tool_result", tool_use_id: tid, content: text(dir) }] } }),
});
/** Claude Code's result for a call started in the background, naming its output file. */
const startedInBackground = (s: number, tid: string, out: string): Step =>
  result(s, tid, (dir) => `Command running in background with ID: b${tid}. Output is being written to: ${path.join(dir, out)}`);
/** Claude Code's result for a foreground Bash call that passed its timeout and was moved to the background. */
const movedToBackground = (s: number, tid: string, out: string, timeoutMs: number): Step =>
  result(s, tid, (dir) => `Command did not complete within its ${timeoutMs}ms timeout and was moved to the background (ID: b${tid}). Output is being written to: ${path.join(dir, out)}`);
const notification = (tid: string) => `<task-notification>\n<task-id>b${tid}</task-id>\n<tool-use-id>${tid}</tool-use-id>\n<status>completed</status>\n</task-notification>`;
/** The notification as a user prompt (after an ended turn), or as an attachment line (mid-turn, addendum F1). */
const notifiedAsPrompt = (s: number, tid: string): Step => ({ s, line: (b, t) => ({ type: "user", timestamp: iso(b, t), message: { role: "user", content: notification(tid) } }) });
const notifiedAsAttachment = (s: number, tid: string): Step => ({ s, line: (b, t) => ({ type: "attachment", timestamp: iso(b, t), attachment: { commandMode: "task-notification", prompt: notification(tid) } }) });
/** Output written every `every` s from `from` to `to`. */
const outputs = (out: string, from: number, to: number, every = 20): Step[] => Array.from({ length: Math.floor((to - from) / every) + 1 }, (_, i) => ({ s: from + i * every, output: out }));
const WAIT = "node swarm.mjs wait --mentions --as yard/x";
const LINK = "node swarm.mjs link --run 1 --as yard/x";
const PS_WAIT = "node C:\\Users\\me\\.claude\\plugins\\swarm-board\\swarm.mjs wait --mentions --as yard/x";
const PS_LINK = "node C:\\Users\\me\\.claude\\plugins\\swarm-board\\swarm.mjs link --run 1 --as yard/x";
const STUCK_LEN = EPISODE_MS / 1000 + 5 * MIN;
/** A worker's foreground wait re-armed every 110 s (the Bash cap), from `from` to `to`. */
const rearmedWait = (from: number, to: number): Step[] => {
  const steps: Step[] = [];
  for (let s = from; s < to; s += 111) {
    const tid = id();
    steps.push({ s, boardWait: "start" }, open(s, tid, WAIT), result(s + 110, tid), { s: s + 110, boardWait: "end" });
  }
  return steps;
};

export const SCENARIOS: Scenario[] = (() => {
  const t = () => id();
  return [
    { id: "S1", what: "long non-Bash call (MCP) 20 min, returns", length: 25 * MIN, stuckAt: null, steps: ((a) => [work(0), mcp(5, a), result(5 + 20 * MIN, a), ...steady(6 + 20 * MIN, 25 * MIN)])(t()) },
    // A1: started this turn, output growing, turn ended, notification at 5 min
    { id: "S2", what: "A1 background test, output growing, turn ended, notice at 5 min", length: 10 * MIN, stuckAt: null, steps: ((a) => [work(0), open(5, a, "npm test", { run_in_background: true }), startedInBackground(6, a, "a.out"), work(7, "waiting on the tests"), ...outputs("a.out", 8, 5 * MIN), notifiedAsPrompt(5 * MIN + 5, a), ...steady(5 * MIN + 6, 10 * MIN)])(t()) },
    // A1b: the task completes mid-turn (attachment form): closed, no background reason after; then the turn ends
    { id: "A1b", what: "background task notified mid-turn by attachment, then the turn ends", length: STUCK_LEN, stuckAt: 40, steps: ((a, b) => [work(0), open(5, a, "npm test", { run_in_background: true }), startedInBackground(6, a, "a.out"), open(10, b, "ls"), result(11, b), notifiedAsAttachment(30, a), work(40, "tests passed, reporting")])(t(), t()) },
    // S2b: a silent background task, notified at 5 min: a known false alert (Risks), measured
    { id: "S2b", what: "background task silent 90 s+, notice at 5 min", length: 10 * MIN, stuckAt: null, steps: ((a) => [work(0), open(5, a, "npm run build", { run_in_background: true }), startedInBackground(6, a, "a.out"), work(7), notifiedAsPrompt(5 * MIN, a), ...steady(5 * MIN + 1, 10 * MIN)])(t()) },
    // A6 played for real, at the default 120 s and at 600 s; and the old form (a timeout result, then nothing; Risks: about 720 s)
    { id: "S3a-120", what: "A6 foreground Bash moved to background at 120 s, silent", length: STUCK_LEN, stuckAt: 5, steps: ((a) => [work(0), open(5, a, "npm test"), movedToBackground(125, a, "a.out", 120_000)])(t()) },
    { id: "S3a-600", what: "A6 foreground Bash moved to background at 600 s, silent", length: STUCK_LEN, stuckAt: 5, steps: ((a) => [work(0), open(5, a, "npm test"), movedToBackground(605, a, "a.out", 600_000)])(t()) },
    { id: "S3a-old", what: "hung Bash call, a timeout result at 10 min, nothing after", length: STUCK_LEN, stuckAt: 5, steps: ((a) => [work(0), open(5, a, "npm test"), result(5 + 10 * MIN, a, () => "Error: timed out")])(t()) },
    { id: "S3b", what: "hung non-Bash call (MCP), link alive", length: STUCK_LEN, stuckAt: 5, steps: ((a) => [work(0), mcp(5, a)])(t()) },
    // A5
    { id: "S4", what: "A5 turn ended owing a move, link alive", length: STUCK_LEN, stuckAt: 5, steps: [work(0), work(5, "I will report once the build is green")] },
    { id: "S5a", what: "crash, link down with it", length: STUCK_LEN, stuckAt: 5, steps: [work(0), work(5), { s: 5, link: "down" }] },
    // A8: S5a, then back
    { id: "A8", what: "gone, then the link and the transcript come back", length: 10 * MIN, stuckAt: 5, steps: [work(0), work(5), { s: 5, link: "down" }, { s: 120, link: "up" }, ...steady(120, 10 * MIN)] },
    { id: "S5b", what: "crash, link alive, turn ended", length: STUCK_LEN, stuckAt: 5, steps: [work(0), work(5)] },
    // A13: crash mid-turn, last line a tool result
    { id: "A13", what: "crash mid-turn, link alive, last line a tool result", length: STUCK_LEN, stuckAt: 6, steps: ((a) => [work(0), open(5, a, "ls"), result(6, a)])(t()) },
    { id: "S5c", what: "crash, link alive, a call left open", length: STUCK_LEN, stuckAt: 5, steps: ((a) => [work(0), open(5, a, "npm run build")])(t()) },
    { id: "S5d", what: "subagent finished without end", length: STUCK_LEN, stuckAt: 5, steps: [work(0), work(5), { s: 6, finished: true }] },
    { id: "S6", what: "foreground board wait 20 min, owing nothing", length: 22 * MIN, stuckAt: null, steps: ((a) => [work(0), { s: 5, boardWait: "start" }, open(5, a, WAIT), result(5 + 20 * MIN, a), { s: 5 + 20 * MIN, boardWait: "end" }, ...steady(6 + 20 * MIN, 22 * MIN)])(t()) },
    { id: "S7", what: "steady work, a line every 10-50 s", length: 25 * MIN, stuckAt: null, steps: Array.from({ length: 50 }, (_, i) => work(i * 30 + (i % 3) * 10)) },
    // A4: in turn, no line for 90 s, then a line; and in turn, silent
    { id: "S8", what: "A4 in turn, a tool result then 90 s without a line", length: 5 * MIN, stuckAt: null, steps: ((a) => [work(0), open(9, a, "ls"), result(10, a), ...steady(100, 5 * MIN)])(t()) },
    { id: "A4b", what: "A4 in turn, a tool result then silence", length: STUCK_LEN, stuckAt: 10, steps: ((a) => [work(0), open(9, a, "ls"), result(10, a)])(t()) },
    { id: "S9", what: "parallel calls, one closes at 5 s, one MCP open 20 min", length: 25 * MIN, stuckAt: null, steps: ((a, b) => [work(0), open(1, a, "npm run lint"), mcp(1, b), result(6, a), result(1 + 20 * MIN, b), ...steady(2 + 20 * MIN, 25 * MIN)])(t(), t()) },
    // A2: an awaited task whose output stops at 100 s, never notified
    { id: "S10", what: "A2 background task, output stops at 100 s, never returns", length: STUCK_LEN, stuckAt: 100, steps: ((a) => [work(0), open(5, a, "npm test", { run_in_background: true }), startedInBackground(6, a, "a.out"), work(7), ...outputs("a.out", 8, 100, 23)])(t()) },
    // A10: owing the open phase in a re-armed wait; (a) w waiting, (b) w working; S11-2 owes a task (out of scope); S11-3 owes nothing
    { id: "S11-1a", what: "A10 re-armed wait owing the phase, w waiting", length: STUCK_LEN, stuckAt: 5, companion: "waits", owe: (bd, o) => bd.phase(o, "p1", "@x @w your part"), steps: [work(0), ...rearmedWait(5, STUCK_LEN)] },
    { id: "S11-1b", what: "A10 re-armed wait owing the phase, w working", length: STUCK_LEN, stuckAt: 5, companion: "works", owe: (bd, o) => bd.phase(o, "p1", "@x your part"), steps: [work(0), ...rearmedWait(5, STUCK_LEN)] },
    // d3's guard on F2 (#12027): the span ended by a real call, then the turn ended: told again at once, not 15 min later
    { id: "S11-guard", what: "owing span, then a real call ends it, then the turn ends", length: 20 * MIN, stuckAt: 5, companion: "waits", owe: (bd, o) => bd.phase(o, "p1", "@x @w your part"), steps: ((a) => [work(0), ...rearmedWait(5, 300), open(340, a, "npm run build"), result(341, a), work(345, "built, reporting next")])(id()) },
    { id: "S11-2", what: "re-armed wait owing a task, w working", length: STUCK_LEN, stuckAt: 5, companion: "works", owe: (bd, o) => bd.post(o, "@x task T1: do it"), steps: [work(0), ...rearmedWait(5, STUCK_LEN)] },
    { id: "S11-3", what: "A10 re-armed wait after an FYI mention, owing nothing", length: STUCK_LEN, stuckAt: null, companion: "works", owe: (bd, o) => bd.post(o, "@x fyi, nothing to do"), steps: [work(0), ...rearmedWait(5, STUCK_LEN)] },
    // A3, A3b: only the board's own listener and link pending, turn ended
    { id: "S12", what: "A3 turn ended, only the background listener and link", length: STUCK_LEN, stuckAt: 8, steps: ((a, b) => [work(0), open(5, a, LINK, { run_in_background: true }), startedInBackground(6, a, "l.out"), open(6, b, WAIT, { run_in_background: true }), startedInBackground(7, b, "w.out"), work(8), ...outputs("l.out", 9, STUCK_LEN, 30)])(t(), t()) },
    { id: "A3b", what: "A3 through PowerShell with \\ paths", length: STUCK_LEN, stuckAt: 8, steps: ((a, b) => [work(0), open(5, a, PS_LINK, { run_in_background: true }, "PowerShell"), startedInBackground(6, a, "l.out"), open(6, b, PS_WAIT, { run_in_background: true }, "PowerShell"), startedInBackground(7, b, "w.out"), work(8), ...outputs("l.out", 9, STUCK_LEN, 30)])(t(), t()) },
    // A7: the link lost 90 s while the transcript grows; A7b: the server cannot stat it
    { id: "S13", what: "A7 link lost 90 s, agent alive and working", length: 10 * MIN, stuckAt: null, transcriptStat: "mtime", steps: [...Array.from({ length: 30 }, (_, i) => work(i * 20)), { s: 60, link: "down" }, { s: 150, link: "up" }] },
    { id: "A7b", what: "link lost 90 s, transcript not a file to the server", length: 10 * MIN, stuckAt: null, transcriptStat: "none", steps: [...Array.from({ length: 30 }, (_, i) => work(i * 20)), { s: 60, link: "down" }, { s: 150, link: "up" }] },
    // A12: a dev server with growing output, started in an earlier turn (a service), or in the last turn (awaited, capped)
    { id: "A12a", what: "dev server from an earlier turn, turn ended owing", length: STUCK_LEN, stuckAt: 25, steps: ((a, b) => [work(0), open(5, a, "npm run dev", { run_in_background: true }), startedInBackground(6, a, "d.out"), work(10, "server up"), { s: 20, line: (bs: number, tt: number) => ({ type: "user", timestamp: iso(bs, tt), message: { role: "user", content: "next: check the page" } }) }, open(21, b, "curl localhost"), result(22, b), work(25, "page checked"), ...outputs("d.out", 7, STUCK_LEN, 10)])(t(), t()) },
    { id: "A12b", what: "dev server started in the last turn, turn ended owing", length: STUCK_LEN, stuckAt: 7, steps: ((a) => [work(0), open(5, a, "npm run dev", { run_in_background: true }), startedInBackground(6, a, "d.out"), work(7, "server up"), ...outputs("d.out", 8, STUCK_LEN, 10)])(t()) },
    { id: "S14", what: "no transcript found (another harness), then a hang", length: STUCK_LEN, stuckAt: 5, blind: true, steps: [] },
  ];
})();
