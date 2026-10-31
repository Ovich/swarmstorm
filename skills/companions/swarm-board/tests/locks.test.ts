// Idea 4, shared-machine guardrails (run agent-ergonomics, note #12401): store-wide named locks across runs and
// repositories, their release on unlock, end, gone and close, the lock wait's state, `stalled · lock` to both
// orchestrators, and the link's kill classifier feeding `breach`. One case per acceptance row, D1-D9 (D6 is a read
// of the skill files, D7 the yardstick).
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board, type Participant, type Presence } from "../src/board/board.ts";
import { STALL_MS_DEFAULT } from "../src/board/liveness.ts";
import { observe } from "../src/link/transcripts.ts";
import type { MemberActivity } from "../src/wire.ts";
import { toolCall, writeSubagent } from "./fixtures/transcripts.ts";
import { eventStep } from "../src/cli/answer/rules.ts";
import { tick2 } from "./fixtures/tick2.ts";
const stepOf = (e: import("../src/board/events.ts").EventName) => (m: Parameters<typeof eventStep>[0], me: Parameters<typeof eventStep>[1], cli: string) => eventStep(m, me, cli, e);

let dir: string;
let board: Board;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-locks-"));
  board = await openBoard(path.join(dir, "swarm.sqlite"));
});

afterEach(() => {
  board.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

let links: Map<string, { connected: boolean; lostAt: number | null }>;
const presence: Presence = (m) => links.get(m) ?? { connected: true, lostAt: null };
const act = (o: Partial<MemberActivity> = {}): MemberActivity => ({ grewAt: null, tokens: 0, context: null, openTool: null, lastTool: null, finished: false, ...o });

/** Two task runs in two repositories on one store: A (members a1, a2) and B (b1). */
const setup = () => {
  links = new Map();
  const runA = board.openRun({ repo: "/repos/a/.git", kind: "task", group: "ga", title: "A", seats: [{ id: "a1", blockers: [] }, { id: "a2", blockers: [] }] });
  const runB = board.openRun({ repo: "/repos/b/.git", kind: "task", group: "gb", title: "B", seats: [{ id: "b1", blockers: [] }] });
  const a1 = board.join({ run: runA.id, seat: "a1", doing: "x", files: [] }).member;
  const a2 = board.join({ run: runA.id, seat: "a2", doing: "x", files: [] }).member;
  const b1 = board.join({ run: runB.id, seat: "b1", doing: "x", files: [] }).member;
  const oA = board.participant("ga/orchestrator")!;
  const oB = board.participant("gb/orchestrator")!;
  for (const p of [a1, a2, b1, oA, oB]) board.deliverMentions(p);
  return { runA, runB, a1, a2, b1, oA, oB };
};
const waitOf = (p: Participant, ms = 300) => board.wait(p, { mentionsOnly: true, timeoutMs: ms });
const bodies = (p: Participant) => board.deliverMentions(p).full.map((m) => m.body);

test("D5: the link reads a kill by name or pattern as a breach, once per command; by PID never; by port only without its lock", () => {
  const { runA, a1 } = setup();
  const kills = (lines: string[]) => {
    const file = writeSubagent(dir, "C--repos-a", "44444444-aaaa-bbbb-cccc-000000000004", `k${Math.random().toString(36).slice(2)}`, lines.map((c, i) => toolCall(/^(Get-|Stop-)/.test(c) ? "PowerShell" : "Bash", { command: c }, `toolu_k${i}`, new Date().toISOString())), {});
    return observe(file, null).activity.breach ?? null;
  };
  for (const c of ["taskkill /IM node.exe /F", "pkill -f vite", "Get-Process node | Stop-Process -Force", "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object { taskkill /PID $_.ProcessId /F }"]) {
    const b = kills([c]);
    assert.equal(b?.kind, "pattern", c);
  }
  assert.equal(kills(["taskkill /PID 1234 /F"]), null, "by PID: never");
  assert.equal(kills(["echo taskkill /IM node.exe"]), null, "quoted or echoed: not a kill");
  const port = kills(["Get-NetTCPConnection -LocalPort 4413 | ForEach-Object { Stop-Process -Id $_.OwningProcess }"]);
  assert.deepEqual([port?.kind, port?.ports], ["port", [4413]]);
  // the board: once per command
  const breaches = () => board.snapshot("/repos/a/.git").events.filter((e) => e.event === "breach").map((e) => e.body);
  const at = Date.now();
  const pattern = { command: "pkill -f vite", kind: "pattern" as const, at };
  board.recordActivity(runA.id, "a1", act({ grewAt: at, breach: pattern }), new Date(at));
  board.recordActivity(runA.id, "a1", act({ grewAt: at, breach: pattern }), new Date(at + 1000));
  assert.deepEqual(breaches(), ["breach ga/a1: pkill -f vite"]);
  board.recordActivity(runA.id, "a1", act({ grewAt: at, breach: { command: "kill port 4414", kind: "port", ports: [4414], at } }), new Date(at + 3000));
  assert.deepEqual(breaches().at(-1), "breach ga/a1: kill port 4414 (port 4414)");
  // G2: a kill from before the member joined is the transcript's past, not the run's: never judged
  board.recordActivity(runA.id, "a1", act({ grewAt: at, breach: { command: "pkill -f old", kind: "pattern", at: at - 3_600_000 } }), new Date(at + 4000));
  assert.equal(breaches().length, 2, "a kill before the join: no breach");
});

test("G2: the orchestrator's own breach is never told to SendMessage itself", () => {
  const { runA, oA } = setup();
  const at = Date.now();
  board.recordActivity(runA.id, "orchestrator", act({ grewAt: at, breach: { command: "pkill -f vite", kind: "pattern", at } }), new Date(at));
  const m = board.snapshot("/repos/a/.git").events.find((e) => e.event === "breach")!;
  const next = stepOf("breach")(m as never, oA, "swarm")!;
  assert.ok(!next.includes("SendMessage"), next);
  assert.match(next, /stop only the PIDs you started/);
});

