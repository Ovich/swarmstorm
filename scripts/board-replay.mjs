#!/usr/bin/env node
// The board's replay (board-fixes#D14): a recorded run's calls, played again without agents against a board server
// on a copy of a real store. The store is only ever read: it is copied with VACUUM INTO from a read-only connection
// (the WAL included), and the server runs on the copy in a scratch home. Manual, never shipped, no suite runs it.
//
// The pattern comes from the store: the run's call_log (each member's waits, posts, doings, dones, merges, endorsements
// with their times). What the log does not record is modelled on the worker loop: a roster and a status read after
// each write. The replay seats a new run of the same project and seats, so the server reads the real history beside it.
//
// Usage: node scripts/board-replay.mjs --store <swarm.sqlite> --run 95 [--server <swarm-board dir>] [--speed 10]
//          [--window-min 8]
// --server: the swarm-board folder whose src/ serves (default: this checkout's); --speed: the pace, 1 is real time;
// --window-min: the busiest stretch of the run replayed, in minutes (0: the whole run).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const option = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const realStore = option("--store", null);
const recordedRun = Number(option("--run", "95"));
const serverDir = path.resolve(option("--server", path.join(repoRoot, "skills/companions/swarm-board")));
const speed = Number(option("--speed", "1"));
const windowMs = Number(option("--window-min", "8")) * 60_000;
if (!realStore) {
  console.error("board-replay: --store <path to swarm.sqlite> is required");
  process.exit(2);
}
/** A wait as replayed: it looks once and returns, so a re-arm costs the server what a real wake's look costs it. */
const WAIT_LOOK_MS = 50;
const GIVE_UP_MS = 120_000;

// ── the copy, read-only from the real store ──
const scratchHome = fs.mkdtempSync(path.join(os.tmpdir(), "board-replay-"));
const copy = path.join(scratchHome, "swarm.sqlite");
const real = new DatabaseSync(path.resolve(realStore), { readOnly: true });
real.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
real.close();

// ── the pattern, from the copy ──
const recorded = new DatabaseSync(copy, { readOnly: true });
const runRow = recorded.prepare("SELECT repo, plan, kind FROM runs WHERE id = ?").get(recordedRun);
const seatsOfRun = recorded.prepare("SELECT id, seat FROM participants WHERE run = ? ORDER BY id").all(recordedRun);
const logged = recorded
  .prepare("SELECT c.participant, c.at, c.verb FROM call_log c JOIN participants p ON p.id = c.participant WHERE p.run = ? ORDER BY c.at")
  .all(recordedRun)
  .map((r) => ({ participant: Number(r.participant), at: Date.parse(r.at), verb: String(r.verb) }));
const historySize = Number(recorded.prepare("SELECT COUNT(*) n FROM messages").get().n);
recorded.close();

/** The busiest stretch of `windowMs`, by its writes (a wait is a re-arm, not work); the whole run with no window. */
const busiest = (calls) => {
  if (!windowMs) return calls;
  const writes = calls.filter((c) => c.verb !== "wait");
  let best = { from: calls[0].at, count: -1 };
  for (let i = 0, j = 0; i < writes.length; i++) {
    while (writes[j].at < writes[i].at - windowMs) j++;
    if (i - j > best.count) best = { from: writes[j].at, count: i - j };
  }
  return calls.filter((c) => c.at >= best.from && c.at < best.from + windowMs);
};
const replayed = busiest(logged);
const startAt = replayed[0].at;

// ── the server, on the copy ──
// the wire client the load bench drives, from this checkout (an older --server has none); --server only serves
const { serveBoard, connectMember } = await import(pathToFileURL(path.join(repoRoot, "skills/companions/swarm-board/tests/fixtures/wire-client.ts")).href);
const boardCli = path.join(serverDir, "src/cli/index.ts");
const serverEnv = { ...process.env, SWARMSTORM_HOME: scratchHome };
const served = await serveBoard(scratchHome, boardCli);
const server = served.child;
const connectAs = (member) => connectMember(served, member, GIVE_UP_MS);

// ── the run seated again: the same project, the same seats ──
const opener = await connectAs(null);
const workerSeats = seatsOfRun.filter((s) => s.seat !== "orchestrator").map((s) => ({ id: String(s.seat), blockers: [] }));
const run = (await opener.call("openRun", { repo: runRow.repo, kind: runRow.kind, group: `replay-${recordedRun}`, title: `replay of run ${recordedRun}`, seats: workerSeats })).value;
const seatOf = new Map(seatsOfRun.map((s) => [Number(s.id), String(s.seat)]));
const members = new Map();
for (const s of seatsOfRun) {
  // the orchestrator is seated by the open; every other seat joins
  const isOrchestrator = s.seat === "orchestrator";
  const joiner = await connectAs(null);
  const joined = isOrchestrator
    ? await joiner.call("participant", `replay-${recordedRun}/orchestrator`)
    : await joiner.call("join", { run: run.id, seat: String(s.seat), doing: "replay", files: [] });
  joiner.close();
  if (!joined.ok || !joined.value) throw new Error(`seat ${s.seat}: ${joined.error ?? "not found"}`);
  const member = isOrchestrator ? joined.value : joined.value.member;
  members.set(String(s.seat), { member, link: await connectAs({ name: member.name, run: run.id }) });
}

// ── the replay ──
const timings = new Map();
const record = (verb, outcome) => {
  const t = timings.get(verb) ?? { ms: [], dropped: 0 };
  timings.set(verb, t);
  if (outcome.dropped || outcome.ok === false) t.dropped++;
  t.ms.push(outcome.ms ?? 0);
};
/** `status` as the CLI reads it: the runs, then each open run's activity, progress and roster. */
const status = async (link) => {
  const started = Date.now();
  const runs = await link.call("runs");
  if (!runs.ok) return runs;
  const reads = (runs.value ?? []).flatMap((r) => [link.call("lastActivity", r.id), link.call("phaseProgress", r.id), link.call("roster", r.repo)]);
  const outcomes = await Promise.all(reads);
  return outcomes.find((o) => o.dropped || o.ok === false) ?? { ok: true, ms: Date.now() - started };
};
/** One logged call as its member made it, then the reads a worker makes after a write. */
const replayCall = async ({ verb, participant }, n) => {
  const seat = seatOf.get(participant);
  const { member, link } = members.get(seat);
  const write = {
    wait: () => link.call("wait", member, { timeoutMs: WAIT_LOOK_MS, mentionsOnly: true }),
    post: () => link.call("post", member, `replayed post ${n} of ${seat}`),
    setDoing: () => link.call("setDoing", member, `replayed doing ${n}`),
    endorse: () => link.call("post", member, `replayed endorsement ${n}`),
    // the merge pair, as the board sees it: an event posted to the run (the code pack's lock is not replayed)
    lockMerge: () => link.call("post", member, `replayed merge-lock ${n}`),
    merged: () => link.call("post", member, `replayed merged ${n}`),
    done: () => link.call("post", member, `replayed done ${n}`),
    phase: () => link.call("post", member, `replayed phase ${n}`),
  }[verb];
  if (!write) return;
  record(verb, await write());
  if (verb === "wait") return;
  record("roster", await link.call("roster", runRow.repo));
  record("status", await status(link));
};
const replayStarted = Date.now();
await Promise.all(
  replayed.map(
    (c, n) =>
      new Promise((resolve) => {
        setTimeout(() => replayCall(c, n).then(resolve, resolve), (c.at - startAt) / speed);
      }),
  ),
);
const replayTook = Date.now() - replayStarted;

for (const { link } of members.values()) link.close();
opener.close();
await new Promise((r) => setTimeout(r, 300));
const serverGone = new Promise((r) => server.once("exit", r));
spawn(process.execPath, [boardCli, "serve", "stop"], { env: serverEnv, stdio: "ignore", windowsHide: true });
await serverGone;

// ── the report ──
const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
const pingCloses = fs
  .readFileSync(path.join(scratchHome, "swarm-server.log"), "utf8")
  .split(/\r?\n/)
  .filter((l) => l.includes("cause ping timeout")).length;
console.log(`board-replay: run ${recordedRun}, ${replayed.length} logged calls over ${Math.round((replayed.at(-1).at - startAt) / 1000)} s, at ${speed}x (${replayTook} ms); server ${serverDir}; history ${historySize} messages`);
console.log("verb        count  median     p95     max  dropped");
let dropped = 0;
for (const [verb, t] of [...timings].sort((a, b) => b[1].ms.length - a[1].ms.length)) {
  const sorted = [...t.ms].sort((a, b) => a - b);
  dropped += t.dropped;
  console.log(`${verb.padEnd(10)} ${String(sorted.length).padStart(6)} ${String(quantile(sorted, 0.5)).padStart(7)} ${String(quantile(sorted, 0.95)).padStart(7)} ${String(sorted.at(-1)).padStart(7)} ${String(t.dropped).padStart(8)}`);
}
console.log(`dropped: ${dropped}; ping-timeout closes: ${pingCloses}`);
try {
  fs.rmSync(scratchHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
} catch {
  console.log(`scratch home left: ${scratchHome}`);
}
process.exit(0);
