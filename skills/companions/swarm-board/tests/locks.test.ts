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
import { LOCK_HELD_MS, STALL_MS_DEFAULT } from "../src/board/liveness.ts";
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
  for (const p of [a1, a2, b1, oA, oB]) board.deliver(p);
  return { runA, runB, a1, a2, b1, oA, oB };
};
const waitOf = (p: Participant, ms = 300) => board.wait(p, { mentionsOnly: true, timeoutMs: ms });
const bodies = (p: Participant) => board.deliver(p).full.map((m) => m.body);

test("D1: a lock is granted store-wide; another run's member is refused, told who holds it, from which run, in what state and since when", () => {
  const { a1, b1 } = setup();
  assert.deepEqual(board.lock(a1, "port:4413", "the app under test"), { granted: true });
  assert.deepEqual(board.lock(a1, "port:4413"), { granted: true }, "granted again to its holder");
  const refused = board.lock(b1, "port:4413");
  assert.equal(refused.granted, false);
  if (refused.granted) return;
  assert.equal(refused.holder.member, "ga/a1");
  assert.ok(refused.holder.nick.length > 0);
  assert.equal(typeof refused.holder.code, "string");
  assert.ok(refused.holder.since);
  assert.ok(refused.holder.state);
  assert.throws(() => board.lock(a1, "Port 4413!"), /a lock name is/);
});

test("D2: unlock wakes the waiter in another repository with unlocked <name>, and its lock is then granted", async () => {
  const { a1, b1 } = setup();
  board.lock(a1, "port:4413");
  board.lock(b1, "port:4413");
  board.deliver(b1);
  const held = waitOf(b1, 2000);
  const t0 = Date.now();
  assert.deepEqual(board.unlock(a1, "port:4413"), { released: true, waiters: ["gb/b1"] });
  const d = await held;
  assert.ok(Date.now() - t0 < 1500, "within a poll");
  assert.match(d.full.map((m) => m.body).join("\n"), /^unlocked port:4413/m);
  assert.equal(board.lock(b1, "port:4413").granted, true);
  assert.deepEqual(board.unlock(a1, "port:4413"), { released: false, waiters: [] });
});

test("D3: a lock is released by end, by gone and by close, each telling its waiters unlocked", async () => {
  const { runA, a1, a2, b1 } = setup();
  for (const [name, release] of [
    ["app:one", () => board.end(a1)],
    ["app:two", () => {
      const base = Date.now();
      board.recordActivity(runA.id, "a2", act({ grewAt: base }), new Date(base));
      links.set("a2", { connected: false, lostAt: base });
      tick2(board, runA.id, new Date(base + 61_000), presence);
    }],
  ] as const) {
    const holder = name === "app:one" ? a1 : a2;
    board.lock(holder, name);
    board.lock(b1, name);
    board.deliver(b1);
    const held = waitOf(b1, 2000);
    release();
    assert.match((await held).full.map((m) => m.body).join("\n"), new RegExp(`^unlocked ${name}`, "m"), name);
    assert.ok(!board.locks().some((l) => l.name === name), `${name} free`);
  }
  // close: a fresh holder in a new run
  const runC = board.openRun({ repo: "/repos/c/.git", kind: "task", group: "gc", title: "C", seats: [{ id: "c1", blockers: [] }] });
  const c1 = board.join({ run: runC.id, seat: "c1", doing: "x", files: [] }).member;
  board.lock(c1, "db:main");
  board.lock(b1, "db:main");
  board.deliver(b1);
  const held = waitOf(b1, 2000);
  board.closeRun(runC.id);
  assert.match((await held).full.map((m) => m.body).join("\n"), /^unlocked db:main/m);
  assert.equal(board.lock(b1, "db:main").granted, true);
});

test("D4: locks lists every held lock store-wide with its holder, run, since and waiters", () => {
  const { runA, a1, b1 } = setup();
  board.lock(a1, "browser:default", "the walk");
  board.lock(b1, "browser:default");
  const [l] = board.locks();
  assert.deepEqual([l.name, l.member, l.run, l.note, l.waiters], ["browser:default", "ga/a1", runA.id, "the walk", ["gb/b1"]]);
  assert.ok(l.since);
});

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
  // the board: once per command; a port kill is a breach only without the port's lock
  const breaches = () => board.snapshot("/repos/a/.git").events.filter((e) => e.event === "breach").map((e) => e.body);
  const at = Date.now();
  const pattern = { command: "pkill -f vite", kind: "pattern" as const, at };
  board.recordActivity(runA.id, "a1", act({ grewAt: at, breach: pattern }), new Date(at));
  board.recordActivity(runA.id, "a1", act({ grewAt: at, breach: pattern }), new Date(at + 1000));
  assert.deepEqual(breaches(), ["breach ga/a1: pkill -f vite"]);
  board.lock(a1, "port:4413");
  board.recordActivity(runA.id, "a1", act({ grewAt: at, breach: { command: "kill port 4413", kind: "port", ports: [4413], at } }), new Date(at + 2000));
  assert.equal(breaches().length, 1, "its own lock: no breach");
  board.recordActivity(runA.id, "a1", act({ grewAt: at, breach: { command: "kill port 4414", kind: "port", ports: [4414], at } }), new Date(at + 3000));
  assert.deepEqual(breaches().at(-1), "breach ga/a1: kill port 4414 (port 4414 not locked)");
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

test("D8: a holder waiting past stall_ms with another run's member queued: stalled · lock to both orchestrators, once per hold; held 10 min by a holder at work: told too", async () => {
  const { runA, runB, a1, b1, oA, oB } = setup();
  board.lock(a1, "port:4413");
  board.lock(b1, "port:4413");
  board.deliver(oA);
  board.deliver(oB);
  // a1 waits in a plain board wait, as its link reads it
  const held = board.wait(a1, { mentionsOnly: true, timeoutMs: 1500 });
  const base = Date.now();
  board.recordActivity(runA.id, "a1", act({ grewAt: base, openTool: { name: "Bash", target: "node swarm.mjs wait --mentions --as ga/a1", since: base - 1000, boardWait: true } }), new Date(base));
  // past the run's stall window (board-split D54: 5 min by default)
  const stallS = STALL_MS_DEFAULT / 1000;
  for (const s of [30, stallS + 1, stallS + 2, stallS + 60]) tick2(board, runB.id, new Date(base + s * 1000), presence);
  const toB = bodies(oB).filter((b) => /· lock port:4413/.test(b));
  const toA = bodies(oA).filter((b) => /· lock port:4413/.test(b));
  assert.equal(toB.length, 1, toB.join("\n"));
  assert.equal(toA.length, 1, toA.join("\n"));
  assert.match(toB[0], /^stalled ga\/a1 · lock port:4413: its holder waiting \d+ s; .*1 waiting$/);
  await held;
  // a holder at work, the lock held 10 min since its first waiter
  board.unlock(a1, "port:4413");
  board.deliver(oA);
  board.deliver(oB);
  board.lock(a1, "app:x");
  board.lock(b1, "app:x");
  const t = Date.now();
  board.recordActivity(runA.id, "a1", act({ grewAt: t + LOCK_HELD_MS, openTool: { name: "Bash", target: "npm test", since: t } }), new Date(t + LOCK_HELD_MS));
  tick2(board, runB.id, new Date(t + LOCK_HELD_MS - 2000), presence);
  assert.equal(bodies(oB).filter((b) => /lock app:x/.test(b)).length, 0, "not before 10 min");
  tick2(board, runB.id, new Date(t + LOCK_HELD_MS + 1000), presence);
  assert.match(bodies(oB).find((b) => /lock app:x/.test(b))!, /held 10 min since its first waiter/);
});

test("D9: a member waiting on a lock while owing the phase reads waiting on the lock, never owing", async () => {
  const { runB, a1, b1, oB } = setup();
  board.phase(oB, "build", "@b1 your part");
  board.deliver(b1);
  board.lock(a1, "port:4415");
  board.lock(b1, "port:4415");
  const held = board.wait(b1, { mentionsOnly: true, timeoutMs: 1000 });
  const base = Date.now();
  board.recordActivity(runB.id, "b1", act({ grewAt: base, openTool: { name: "Bash", target: "node swarm.mjs wait --mentions --as gb/b1", since: base - 1000, boardWait: true } }), new Date(base));
  for (const s of [61, 601, 700]) tick2(board, runB.id, new Date(base + s * 1000), presence);
  const st = board.memberStates(runB.id, new Date(base + 700_000)).find((m) => m.member === "b1")!;
  assert.equal(st.state, "waiting");
  assert.match(st.doing!, /^lock port:4415, held by /);
  assert.ok(!board.deliver(oB).full.some((m) => m.meta && "rule" in m.meta && m.meta.rule === "owing" && m.meta.member === "b1"), "never owing");
  await held;
});

test("idea 5, F12: a grant after a release names that release: by whom and how; a first grant names none", () => {
  const { a1, b1 } = setup();
  const first = board.lock(a1, "port:4416");
  assert.ok(first.granted && first.released === undefined);
  board.unlock(a1, "port:4416");
  const next = board.lock(b1, "port:4416");
  assert.ok(next.granted);
  if (!next.granted) return;
  assert.deepEqual([next.released?.by, next.released?.how], ["ga/a1", "unlock"]);
  assert.ok(next.released?.at);
});
