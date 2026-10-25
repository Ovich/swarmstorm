// The yardstick (run agent-ergonomics, baseline): every liveness scenario d3 listed, played against the
// board's own code with a simulated clock and a synthetic transcript, measured for M1–M4 as d1 defined
// them. A scenario is a script of transcript lines, link changes and board waits over simulated seconds;
// each second the link's read (observe) feeds recordActivity and the server's livenessTick runs, as
// the server does every 1 s. The assertions hold today's numbers: an idea that moves one updates them.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board, type Presence } from "../src/board/board.ts";
import { STALL_MS_DEFAULT } from "../src/board/liveness.ts";
import { eventOf } from "../src/board/events.ts";
import { locate, observe, type TranscriptCursor } from "../src/link/transcripts.ts";
import { prompt, textLine, toolCall, toolResult, writeSubagent } from "./fixtures/transcripts.ts";

const REPO = "/repos/yardstick/.git";
const SESSION = "33333333-aaaa-bbbb-cccc-000000000003";
const PROJECT = "C--repos-yardstick";
/** d1: a stuck episode ends at T0 + 30 min when nothing intervenes. */
const EPISODE_MS = 30 * 60 * 1000;
const ALERTS = new Set(["stalled", "gone"]);
const WAKE_EVENTS = new Set(["stalled", "gone", "idle", "liveness"]);

/** One step of a scenario, at simulated second `s` from its start. */
type Step =
  | { s: number; line: object }
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
  /** A second member, w, working steadily all through: the run is never idle (S11's "while any other member works"). */
  companion?: boolean;
  /** What the orchestrator says to x at second 1, delivered to x before any later wait (S11's owe rules). */
  owe?: (board: Board, orch: NonNullable<ReturnType<Board["participant"]>>) => void;
};

type Row = { id: string; wakes: number; noAction: number; perMemberHour: number; falseAlerts: number; falseStateS: number; detectS: number | null; missed: number; events: string };

const iso = (base: number, s: number) => new Date(base + s * 1000).toISOString();
let toolIds = 0;
const call = (name: string, input: object, id: string) => (base: number, s: number) => toolCall(name, input, id, iso(base, s));

/** Plays one scenario on a fresh board; returns its row. */
async function play(sc: Scenario): Promise<Row> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-yardstick-"));
  const board: Board = await openBoard(":memory:"); // in memory: some 30 000 ticks, no disk write each
  try {
    const run = board.openRun({ repo: REPO, kind: "task", group: "yard", title: "Yardstick", stallMs: STALL_MS_DEFAULT, seats: (sc.companion ? ["x", "w"] : ["x"]).map((m) => ({ id: m, title: m, blockers: [] })) });
    const x = board.join({ run: run.id, slice: "x", doing: "work", files: [] }).runner;
    const w = sc.companion ? board.join({ run: run.id, slice: "w", doing: "work", files: [] }).runner : null;
    if (w) board.deliver(w);
    const orch = board.participant("yard/orchestrator")!;
    board.deliver(x);
    board.deliver(orch);
    // the clock starts after the join's own 30 s no-transcript window, as the existing liveness tests do
    const base = Date.now() + 60_000;
    const file = writeSubagent(dir, PROJECT, SESSION, "x", [], { finished: false });
    fs.writeFileSync(file, "");
    const wFile = w ? writeSubagent(dir, PROJECT, SESSION, "w", [], { finished: false }) : null;
    let wCursor: TranscriptCursor | null = null;
    let link = { connected: true, lostAt: null as number | null };
    const presence: Presence = () => link;
    let cursor: TranscriptCursor | null = null;
    let held: Promise<unknown> | null = null;
    const wakes: { s: number; events: string[] }[] = [];
    let falseStateS = 0;
    const stuckFrom = sc.stuckAt;
    const isStuck = (s: number) => stuckFrom !== null && s >= stuckFrom;
    for (let s = 0; s <= sc.length; s++) {
      const at = new Date(base + s * 1000);
      if (s === 1 && sc.owe) {
        sc.owe(board, orch);
        board.deliver(x);
      }
      if (wFile) {
        if (s % 20 === 0) {
          fs.appendFileSync(wFile, JSON.stringify(textLine("w works", { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, iso(base, s))) + "\n");
          fs.utimesSync(wFile, at, at);
        }
        const o = observe(wFile, wCursor);
        wCursor = o.cursor;
        board.recordActivity(run.id, "w", o.activity, at);
      }
      for (const st of sc.steps.filter((p) => p.s === s)) {
        if ("line" in st) {
          fs.appendFileSync(file, JSON.stringify(typeof st.line === "function" ? (st.line as (b: number, s: number) => object)(base, s) : st.line) + "\n");
          fs.utimesSync(file, at, at);
        } else if ("link" in st) link = st.link === "down" ? { connected: false, lostAt: at.getTime() } : { connected: true, lostAt: null };
        else if ("finished" in st) fs.writeFileSync(file.replace(/\.jsonl$/, ".meta.json"), JSON.stringify({ agentType: "general-purpose", finished: true }));
        else if (st.boardWait === "start") held = board.wait(x, { mentionsOnly: true, timeoutMs: 120_000 });
        else if (held) {
          board.post(orch, "@x go");
          await held;
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
      // what reaches the orchestrator this second: one wake when any of it is a liveness event (about x)
      const fresh = board
        .deliver(orch)
        .full.map((m) => ({ m, e: eventOf(m) }))
        .filter(({ m, e }) => e !== null && WAKE_EVENTS.has(e) && m.mentions.includes(orch.name) && !m.body.includes("yard/w"))
        .map(({ e }) => e as string);
      if (fresh.length) wakes.push({ s, events: fresh });
    }
    if (held) {
      board.post(orch, "@x go");
      await held;
    }
    // d1, M1 proxy: a wake needs action when it carries a true alert (the member stuck at that second)
    const needsAction = (w: { s: number; events: string[] }) => w.events.some((e) => ALERTS.has(e) && isStuck(w.s));
    const alerts = wakes.flatMap((w) => w.events.filter((e) => ALERTS.has(e)).map((e) => ({ e, s: w.s })));
    const falseAlerts = alerts.filter((a) => !isStuck(a.s)).length;
    const firstTrue = alerts.find((a) => isStuck(a.s) && a.s - stuckFrom! <= EPISODE_MS / 1000);
    const detectS = stuckFrom === null || !firstTrue ? null : firstTrue.s - stuckFrom;
    const missed = stuckFrom !== null && !firstTrue ? 1 : 0;
    const hours = sc.length / 3600;
    return {
      id: sc.id,
      wakes: wakes.length,
      noAction: wakes.filter((w) => !needsAction(w)).length,
      perMemberHour: Math.round((wakes.length / hours) * 10) / 10,
      falseAlerts,
      falseStateS,
      detectS,
      missed,
      events: wakes.map((w) => `${w.events.join("+")}@${w.s}s`).join(" ") || "-",
    };
  } finally {
    board.close();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

const id = () => `toolu_y${++toolIds}`;
/** A line every 30 s from `from` to `to`: the member keeps working, so the script's end is not a silence. */
const steady = (from: number, to: number): Step[] => Array.from({ length: Math.floor((to - from) / 30) + 1 }, (_, i) => work(from + i * 30));
const work = (s: number): Step => ({ s, line: (b: number, t: number) => textLine("working", { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, iso(b, t)) });
const open = (s: number, tid: string, command = "npm test", extra: object = {}): Step => ({ s, line: call("Bash", { command, ...extra }, tid) });
const close = (s: number, tid: string): Step => ({ s, line: (b: number, t: number) => toolResult(tid, iso(b, t)) });
const mcp = (s: number, tid: string): Step => ({ s, line: call("mcp__browser__browser_wait_for", { time: 1800 }, tid) });
const WAIT = "node swarm.mjs wait --mentions --as yard/x";
const MIN = 60;
const STUCK_LEN = EPISODE_MS / 1000 + 5 * MIN;

const SCENARIOS: Scenario[] = (() => {
  const [a, b, c, c2, d, e, f, g, h, k, k2, k3, l, m] = Array.from({ length: 14 }, id);
    const s11 = (sub: string, what: string, owe: Scenario["owe"], stuck: boolean, tid: string): Scenario => ({ id: `S11${sub}`, what, length: STUCK_LEN, stuckAt: stuck ? 5 : null, companion: true, owe, steps: [work(0), { s: 5, boardWait: "start" }, open(5, tid, WAIT)] });
  return [
    { id: "S1", what: "long non-Bash call (MCP) 20 min, returns", length: 25 * MIN, stuckAt: null, steps: [work(0), mcp(5, a), close(5 + 20 * MIN, a), ...steady(6 + 20 * MIN, 25 * MIN)] },
    { id: "S2", what: "background test run, turn ended, notice after 10 min", length: 15 * MIN, stuckAt: null, steps: [work(0), open(5, b, "npm test", { run_in_background: true }), close(6, b), work(7), { s: 7 + 10 * MIN, line: prompt("<task-notification>done</task-notification>") }, ...steady(8 + 10 * MIN, 15 * MIN)] },
    { id: "S3a", what: "hung Bash call, times out at 10 min, nothing after", length: STUCK_LEN, stuckAt: 5, steps: [work(0), open(5, c, "npm test"), close(5 + 10 * MIN, c)] },
    { id: "S3b", what: "hung non-Bash call (MCP), link alive", length: STUCK_LEN, stuckAt: 5, steps: [work(0), mcp(5, c2)] },
    { id: "S4", what: "turn ended owing a move, link alive", length: STUCK_LEN, stuckAt: 5, steps: [work(0), work(5)] },
    { id: "S5a", what: "crash, link down with it", length: STUCK_LEN, stuckAt: 5, steps: [work(0), work(5), { s: 5, link: "down" }] },
    { id: "S5b", what: "crash, link alive, nothing open", length: STUCK_LEN, stuckAt: 5, steps: [work(0), work(5)] },
    { id: "S5c", what: "crash, link alive, a call left open", length: STUCK_LEN, stuckAt: 5, steps: [work(0), open(5, d, "npm run build")] },
    { id: "S5d", what: "subagent finished without end", length: STUCK_LEN, stuckAt: 5, steps: [work(0), work(5), { s: 6, finished: true }] },
    { id: "S6", what: "foreground board wait 20 min", length: 22 * MIN, stuckAt: null, steps: [work(0), { s: 5, boardWait: "start" }, open(5, e, WAIT), close(5 + 20 * MIN, e), { s: 5 + 20 * MIN, boardWait: "end" }, ...steady(6 + 20 * MIN, 22 * MIN)] },
    { id: "S7", what: "steady work, a line every 10-50 s", length: 25 * MIN, stuckAt: null, steps: Array.from({ length: 50 }, (_, i) => work(i * 30 + (i % 3) * 10)) },
    { id: "S8", what: "long model turn, 90 s without a line", length: 5 * MIN, stuckAt: null, steps: [work(0), work(10), ...steady(100, 5 * MIN)] },
    { id: "S9", what: "parallel calls, one closes at 5 s, one open 20 min", length: 25 * MIN, stuckAt: null, steps: [work(0), open(1, f, "npm run lint"), mcp(1, g), close(6, f), close(1 + 20 * MIN, g), ...steady(2 + 20 * MIN, 25 * MIN)] },
    { id: "S10", what: "background task never returns, turn ended", length: STUCK_LEN, stuckAt: 6, steps: [work(0), open(5, h, "npm test", { run_in_background: true }), close(6, h)] },
    s11("-1", "foreground wait owing the open phase, w working", (bd, o) => bd.phase(o, "p1", "@x your part"), true, k),
    s11("-2", "foreground wait owing a task, w working", (bd, o) => bd.post(o, "@x task T1: do it"), true, k2),
    s11("-3", "foreground wait after an FYI mention, w working", (bd, o) => bd.post(o, "@x fyi, nothing to do"), false, k3),
    { id: "S12", what: "turn ended, only the background listener", length: STUCK_LEN, stuckAt: 6, steps: [work(0), open(5, l, WAIT, { run_in_background: true }), close(6, l)] },
    { id: "S13", what: "link lost 40 s, agent alive and working", length: 10 * MIN, stuckAt: null, steps: [...Array.from({ length: 20 }, (_, i) => work(i * 30)), { s: 60, link: "down" }, { s: 100, link: "up" }] },
    { id: "S14", what: "no transcript found, then a hang", length: STUCK_LEN, stuckAt: 5, blind: true, steps: [open(5, m, "npm test")] },
  ];
})();

/** Today's numbers at f5f40b0: id, wakes, no-action, wakes per member-hour, M2, M2b s, M3 s, M4. An idea that moves one updates its row. */
const EXPECTED_TODAY: [string, number, number, number, number, number, number | null, number][] = [
  ["S1", 1, 1, 2.4, 1, 0, null, 0],
  ["S2", 1, 1, 4, 1, 540, null, 0],
  ["S3a", 2, 0, 3.4, 0, 0, 660, 0],
  ["S3b", 2, 0, 3.4, 0, 0, 900, 0],
  ["S4", 3, 0, 5.1, 0, 0, 60, 0],
  ["S5a", 1, 0, 1.7, 0, 0, 30, 0],
  ["S5b", 3, 0, 5.1, 0, 0, 60, 0],
  ["S5c", 2, 0, 3.4, 0, 0, 900, 0],
  ["S5d", 1, 0, 1.7, 0, 0, 1, 0],
  ["S6", 2, 2, 5.5, 0, 0, null, 0],
  ["S7", 0, 0, 0, 0, 0, null, 0],
  ["S8", 1, 1, 12, 1, 30, null, 0],
  ["S9", 1, 1, 2.4, 1, 0, null, 0],
  ["S10", 3, 0, 5.1, 0, 0, 60, 0],
  ["S11-1", 0, 0, 0, 0, 0, null, 1],
  ["S11-2", 0, 0, 0, 0, 0, null, 1],
  ["S11-3", 0, 0, 0, 0, 0, null, 0],
  ["S12", 3, 0, 5.1, 0, 0, 60, 0],
  ["S13", 1, 1, 6, 1, 10, null, 0],
  ["S14", 1, 1, 1.7, 0, 5, null, 1],
];

test("the yardstick: M1-M4 per scenario at today's thresholds", async () => {
  const rows: Row[] = [];
  for (const sc of SCENARIOS) rows.push(await play(sc));
  const head = "| id | wakes | no-action | wakes/member-h | M2 false alerts | M2b false-state s | M3 detect s | M4 missed | wakes at |";
  const table = [head, "|---|---|---|---|---|---|---|---|---|", ...rows.map((r) => `| ${r.id} | ${r.wakes} | ${r.noAction} | ${r.perMemberHour} | ${r.falseAlerts} | ${r.falseStateS} | ${r.detectS ?? "-"} | ${r.missed} | ${r.events} |`)].join("\n");
  console.log(table);
  assert.deepEqual(rows.map((r) => [r.id, r.wakes, r.noAction, r.perMemberHour, r.falseAlerts, r.falseStateS, r.detectS, r.missed]), EXPECTED_TODAY);
});

test("d1's blind binding: a join run through a non-Bash shell tool locates no transcript", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-yardstick-locate-"));
  try {
    writeSubagent(root, PROJECT, SESSION, "ps", [toolCall("PowerShell", { command: "node swarm.mjs join --run 85 --slice d1 --doing x" }, "toolu_ps", iso(Date.now(), 0))], {});
    assert.equal(locate({ verb: "join", run: 85, seat: "d1" }, { CLAUDE_CODE_SESSION_ID: SESSION, SWARM_TRANSCRIPTS_ROOT: root }), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
