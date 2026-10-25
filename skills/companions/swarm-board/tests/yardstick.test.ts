// The yardstick (run agent-ergonomics): every liveness scenario d3 listed, and idea 1's acceptance rows
// (note #11926 + #11931), played against the board's own code with a simulated clock and a synthetic
// transcript, measured for M1–M4 as d1 defined them. A scenario is a script of transcript lines, output
// growth, link changes and board waits over simulated seconds; each second the link's read (observe) feeds
// recordActivity and the server's livenessTick runs, as the server does every 1 s. The table's assertions
// hold the current numbers: a change that moves one updates its row, on purpose, with the note that asked.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board, type Participant, type Presence } from "../src/board/board.ts";
import { BUSY_MAX_MS, IN_TURN_MS, OWE_WAIT_MS, STALL_MS_DEFAULT } from "../src/board/liveness.ts";
import { EVENTS, eventOf } from "../src/board/events.ts";
import { locate, observe, type TranscriptCursor } from "../src/link/transcripts.ts";
import { textLine, toolCall, writeSubagent } from "./fixtures/transcripts.ts";

const REPO = "/repos/yardstick/.git";
const SESSION = "33333333-aaaa-bbbb-cccc-000000000003";
const PROJECT = "C--repos-yardstick";
/** d1: a stuck episode ends at T0 + 30 min when nothing intervenes. */
const EPISODE_MS = 30 * 60 * 1000;
const ALERTS = new Set(["stalled", "gone"]);
const WAKE_EVENTS = new Set(["stalled", "gone", "idle", "liveness", "recovered"]);
const MIN = 60;
const STALL_S = STALL_MS_DEFAULT / 1000;

/** One step of a scenario, at simulated second `s` from its start. */
type Step =
  | { s: number; line: (base: number, s: number, dir: string) => object }
  | { s: number; output: string }
  | { s: number; link: "down" | "up" }
  | { s: number; finished: true }
  | { s: number; boardWait: "start" | "end" };

type Scenario = {
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

type Alert = { s: number; event: string; rule: string | null; body: string; next: string | null };
type Row = { id: string; wakes: number; noAction: number; perMemberHour: number; falseAlerts: number; falseStateS: number; detectS: number | null; missed: number; rule: string | null; events: string; alerts: Alert[]; wakeAt: { s: number; events: string[] }[] };

const iso = (base: number, s: number) => new Date(base + s * 1000).toISOString();
const usage = { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

/** Plays one scenario on a fresh board; returns its row. */
async function play(sc: Scenario): Promise<Row> {
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
    let falseStateS = 0;
    const stuckFrom = sc.stuckAt;
    const isStuck = (s: number) => stuckFrom !== null && s >= stuckFrom;
    const append = (f: string, line: object, at: Date) => {
      fs.appendFileSync(f, JSON.stringify(line) + "\n");
      fs.utimesSync(f, at, at);
    };
    for (let s = 0; s <= sc.length; s++) {
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
    const hours = sc.length / 3600;
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

const SCENARIOS: Scenario[] = (() => {
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

/** The numbers after idea 1 (note #11926 + #11931): id, wakes, no-action, wakes per member-hour, M2, M2b s, M3 s, M4, first alert's rule.
 *  Moved on purpose from the baseline (f5f40b0): S2 and S8 lose their false alert, S13 its false `gone`, S11-1 is caught,
 *  S10/S12 keep about 60 s with the turn ended, S3a's old form reads 720 s (Risks). */
const EXPECTED: [string, number, number, number, number, number, number | null, number, string | null][] =[
  ["S1", 1, 1, 2.4, 1, 0, null, 0, "call"],
  ["S2", 0, 0, 0, 0, 0, null, 0, null],
  ["A1b", 3, 0, 5.1, 0, 0, 60, 0, "ended"],
  ["S2b", 1, 1, 6, 1, 233, null, 0, "background"],
  ["S3a-120", 3, 0, 5.1, 0, 0, 240, 0, "background"],
  ["S3a-600", 2, 0, 3.4, 0, 0, 720, 0, "background"],
  ["S3a-old", 2, 0, 3.4, 0, 0, 720, 0, "in-turn"],
  ["S3b", 2, 0, 3.4, 0, 0, 900, 0, "call"],
  ["S4", 3, 0, 5.1, 0, 0, 60, 0, "ended"],
  ["S5a", 1, 0, 1.7, 0, 0, 30, 0, null],
  ["A8", 2, 1, 12, 0, 0, 30, 0, null],
  ["S5b", 3, 0, 5.1, 0, 0, 60, 0, "ended"],
  ["A13", 3, 0, 5.1, 0, 0, 120, 0, "in-turn"],
  ["S5c", 2, 0, 3.4, 0, 0, 900, 0, "call"],
  ["S5d", 1, 0, 1.7, 0, 0, 1, 0, null],
  ["S6", 2, 2, 5.5, 0, 0, null, 0, null],
  ["S7", 0, 0, 0, 0, 0, null, 0, null],
  ["S8", 0, 0, 0, 0, 0, null, 0, null],
  ["A4b", 3, 0, 5.1, 0, 0, 120, 0, "in-turn"],
  ["S9", 1, 1, 2.4, 1, 0, null, 0, "call"],
  ["S10", 3, 0, 5.1, 0, 0, 60, 0, "background"],
  ["S11-1a", 20, 1, 34.3, 0, 0, 61, 0, "owing"],
  ["S11-1b", 14, 0, 24, 0, 0, 601, 0, "owing"],
  ["S11-2", 0, 0, 0, 0, 0, null, 1, null],
  ["S11-3", 0, 0, 0, 0, 0, null, 0, null],
  ["S12", 3, 0, 5.1, 0, 0, 60, 0, "ended"],
  ["A3b", 3, 0, 5.1, 0, 0, 60, 0, "ended"],
  ["S13", 1, 1, 6, 0, 0, null, 0, null],
  ["A7b", 2, 2, 12, 1, 60, null, 0, null],
  ["A12a", 3, 0, 5.1, 0, 0, 60, 0, "ended"],
  ["A12b", 2, 0, 3.4, 0, 0, 898, 0, "background"],
  ["S14", 1, 1, 1.7, 0, 5, null, 1, null],
];

let rows: Row[] = [];
const rowOf = (rid: string) => rows.find((r) => r.id === rid)!;

test("the yardstick: M1-M4 per scenario", async () => {
  rows = [];
  for (const sc of SCENARIOS) rows.push(await play(sc));
  const head = "| id | wakes | no-action | wakes/member-h | M2 false alerts | M2b false-state s | M3 detect s | M4 missed | rule | wakes at |";
  const table = [head, "|---|---|---|---|---|---|---|---|---|---|", ...rows.map((r) => `| ${r.id} | ${r.wakes} | ${r.noAction} | ${r.perMemberHour} | ${r.falseAlerts} | ${r.falseStateS} | ${r.detectS ?? "-"} | ${r.missed} | ${r.rule ?? "-"} | ${r.events} |`)].join("\n");
  console.log(table);
  assert.deepEqual(rows.map((r) => [r.id, r.wakes, r.noAction, r.perMemberHour, r.falseAlerts, r.falseStateS, r.detectS, r.missed, r.rule]), EXPECTED);
});

const bound = (rid: string, maxS: number, rule: string) => {
  const r = rowOf(rid);
  assert.equal(r.missed, 0, `${rid} caught`);
  assert.ok(r.detectS! <= maxS, `${rid}: ${r.detectS} s <= ${maxS} s`);
  assert.equal(r.rule, rule, `${rid} rule`);
};
const clean = (rid: string) => {
  const r = rowOf(rid);
  assert.equal(r.falseAlerts, 0, `${rid}: no false alert (${r.events})`);
  assert.equal(r.falseStateS, 0, `${rid}: no false quiet/gone`);
};
const stall = STALL_S + 1;
const inTurn = IN_TURN_MS / 1000 + 1;

test("A1: a background test with growing output, turn ended, draws no stalled and reads busy · background", () => clean("S2"));
test("A1b: a task notified mid-turn by attachment is closed: the turn's end is told as `ended`, never `background`", () => bound("A1b", stall, "ended"));
test("S2b (measured): a silent background task draws `stalled` at about 61 s, rule background", () => {
  const r = rowOf("S2b");
  assert.equal(r.falseAlerts, 1);
  assert.equal(r.alerts[0].rule, "background");
  assert.match(r.alerts[0].body, /background npm run build silent 60 s/);
});
test("A2: an awaited task whose output stops is stalled within 61 s of its last growth, rule background", () => {
  bound("S10", stall, "background");
  assert.match(rowOf("S10").alerts[0].body, /: background npm test silent 60 s/);
});
test("A3, A3b: only the board's own listener and link pending, through Bash or PowerShell: stalled within 61 s, rule ended", () => {
  bound("S12", stall, "ended");
  bound("A3b", stall, "ended");
});
test("A4: in turn 90 s without a line is working; in turn and silent is stalled within 121 s, rule in-turn", () => {
  clean("S8");
  bound("A4b", inTurn, "in-turn");
  assert.match(rowOf("A4b").alerts[0].body, /in turn, no line for 2 min \(its model may be hung\); last: "Bash ls"/);
});
test("A5: a turn ended is stalled within 61 s; the reason says `turn ended` and the last text; next is the ended move", () => {
  bound("S4", stall, "ended");
  const a = rowOf("S4").alerts[0];
  assert.match(a.body, /^stalled yard\/x: turn ended; last: "I will report once the build is green"/);
  assert.match(a.next!, /a post does not wake it: SendMessage it, or dispatch it again/);
});
// F1 (test 1.1): the moved result is a user line, so the member reads in turn 120 s before the background rule is reached
test("A6: a foreground Bash moved to the background, then silent: stalled within its timeout + 61 s, rule background", { todo: "F1: 240 s and 720 s today" }, () => {
  bound("S3a-120", 120 + stall, "background");
  bound("S3a-600", 600 + stall, "background");
});
test("A7: a link lost while the transcript grows is not gone: one liveness, working; S5a gone within loss + 31 s; A7b: no stat, gone as today", () => {
  clean("S13");
  assert.equal(rowOf("S13").wakeAt.flatMap((w) => w.events).filter((e) => e === "liveness").length, 1);
  bound("S5a", 31, rowOf("S5a").rule!);
  assert.equal(rowOf("S5a").alerts[0].event, "gone");
  assert.deepEqual(rowOf("A7b").alerts.map((a) => [a.event, a.s]), [["gone", 90]]);
});
test("A8: a member told gone that comes back: one recovered at the next tick", () => {
  const r = rowOf("A8");
  const recovered = r.wakeAt.filter((w) => w.events.includes("recovered"));
  assert.equal(recovered.length, 1);
  assert.ok(recovered[0].s <= 121, `recovered at ${recovered[0].s} s, the link back at 120 s`);
});
test("A10: a re-armed wait owing the phase: stalled within 61 s with every other member waiting, at 10 min with others working, never owing nothing", () => {
  bound("S11-1a", stall, "owing");
  const b = rowOf("S11-1b");
  assert.equal(b.rule, "owing");
  assert.ok(Math.abs(b.detectS! - OWE_WAIT_MS / 1000) <= 1, `S11-1b at ${b.detectS} s`);
  assert.match(b.alerts[0].next!, /your part of p1/);
  clean("S11-3");
});
test("A11: unchanged: S3b, S5a, S5c, S5d, S6, S7 (the long-call rows keep 15 min)", () => {
  bound("S3b", BUSY_MAX_MS / 1000 + 1, "call");
  bound("S5c", BUSY_MAX_MS / 1000 + 1, "call");
  assert.equal(rowOf("S5d").detectS, 1);
  clean("S6");
  clean("S7");
});
test("A12: a dev server from an earlier turn is a service: stalled within 61 s; one started in the last turn holds busy up to 15 min, rule background", () => {
  bound("A12a", stall, "ended");
  const b = rowOf("A12b");
  assert.equal(b.rule, "background");
  assert.ok(b.detectS! + 7 - 5 <= BUSY_MAX_MS / 1000 + 1, `A12b at ${b.detectS} s from the turn's end`);
});
test("A13: a crash mid-turn, last line a tool result, link alive: stalled within 121 s, rule in-turn", () => bound("A13", inTurn, "in-turn"));

test("A9: a join run through PowerShell with \\ paths is located", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-yardstick-locate-"));
  try {
    const file = writeSubagent(root, PROJECT, SESSION, "ps", [toolCall("PowerShell", { command: "node C:\\Users\\me\\.claude\\plugins\\swarm-board\\swarm.mjs join --run 85 --slice d1 --doing x" }, "toolu_ps", iso(Date.now(), 0))], {});
    assert.equal(locate({ verb: "join", run: 85, seat: "d1" }, { CLAUDE_CODE_SESSION_ID: SESSION, SWARM_TRANSCRIPTS_ROOT: root }), file);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// F2 (test 1.1): a re-armed wait reads working for the second between two waits, which clears stalled_at
test("A10: an owing member's stalled is told again only after 15 min, its re-arms between", { todo: "F2: told at every re-arm today" }, () => {
  for (const rid of ["S11-1a", "S11-1b"]) {
    const alerts = rowOf(rid).alerts.map((a) => a.s);
    for (let i = 1; i < alerts.length; i++) assert.ok(alerts[i] - alerts[i - 1] >= 900, `${rid}: stalled at ${alerts.join(", ")}`);
  }
});
