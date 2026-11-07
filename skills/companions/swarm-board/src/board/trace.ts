// The board's trace: what happened and when, one JSON line per fact, for analysing a run afterwards (slow calls, lock
// queues, how long a message waits to be read, how long a member takes to act on it). Written by the board server alone,
// the one process that opens the store, so one writer per file.
//
//   <data home>/swarm-server.log                           info: the swarm's health at a glance, one logfmt line per
//                                                          lifecycle fact, lock grant and release, anomaly, and a health
//                                                          line per run every HEALTH_MS
//   <data home>/logs/<YYYY-MM-DD>/events.jsonl            debug: calls, posts, deliveries, lock, links, snapshots
//   <data home>/logs/<YYYY-MM-DD>/messages/run-<n>.jsonl   debug-extended: each post's whole text, per run
//   <data home>/logs/level                                 the level, one word; absent: info
//
// A day is UTC. Day folders older than KEEP_DAYS are removed at start and once a day. A failing write never fails a call.
import fs from "node:fs";
import path from "node:path";
import { serverLogFile } from "../wire.ts";

export const TRACE_LEVELS = ["off", "info", "debug", "debug-extended"] as const;
export type TraceLevel = (typeof TRACE_LEVELS)[number];
export const KEEP_DAYS = 30;
/** info: a run's health line this often; a lock wait past LONG_WAIT_MS and an unread count from MANY_UNREAD are warned. */
export const HEALTH_MS = 5 * 60_000;
const LONG_WAIT_MS = 60_000;
const MANY_UNREAD = 5;
/** The board events told at info: a run's and a member's lifecycle; a pack's event that lands work (its `lands`) too. */
const INFO_EVENTS = new Set(["opened", "closed", "phase", "all-done", "joined", "ended", "lost", "pause", "resume"]);

export const traceRoot = (dataRoot: string): string => path.join(dataRoot, "logs");
export const traceLevelFile = (dataRoot: string): string => path.join(traceRoot(dataRoot), "level");

export function readTraceLevel(dataRoot: string): TraceLevel {
  try {
    const w = fs.readFileSync(traceLevelFile(dataRoot), "utf8").trim() as TraceLevel;
    return TRACE_LEVELS.includes(w) ? w : "info";
  } catch {
    return "info";
  }
}

export function writeTraceLevel(dataRoot: string, level: TraceLevel): void {
  fs.mkdirSync(traceRoot(dataRoot), { recursive: true });
  fs.writeFileSync(traceLevelFile(dataRoot), `${level}\n`);
}

export type Tracer = {
  /** A fact: at info its lifecycle line or warning, if it has one; at debug and above, its JSON line. */
  event(kind: string, fields: Record<string, unknown>): void;
  /** A post's whole text, at debug-extended only. */
  message(run: number, fields: Record<string, unknown>): void;
  /** Removes the day folders past KEEP_DAYS. */
  prune(at?: Date): void;
};

const SILENT: Tracer = { event() {}, message() {}, prune() {} };
let current: Tracer = SILENT;
/** The tracer the board writes through: the server sets it; anywhere else the board traces nothing. */
export const trace = (): Tracer => current;
export const setTracer = (t: Tracer | null): void => {
  current = t ?? SILENT;
};

export function makeTracer(dataRoot: string): Tracer {
  const root = traceRoot(dataRoot);
  // the level file read again whenever it changed: a log-level takes effect at the next fact
  let level: TraceLevel = readTraceLevel(dataRoot);
  let stamp = -1;
  const levelNow = (): TraceLevel => {
    let m = 0;
    try {
      m = fs.statSync(traceLevelFile(dataRoot)).mtimeMs;
    } catch {}
    if (m !== stamp) {
      stamp = m;
      level = readTraceLevel(dataRoot);
    }
    return level;
  };
  const made = new Set<string>();
  const append = (file: string, line: Record<string, unknown>): void => {
    try {
      const dir = path.dirname(file);
      if (!made.has(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        made.add(dir);
      }
      fs.appendFileSync(file, `${JSON.stringify(line)}\n`);
    } catch {}
  };
  const dayOf = (d: Date): string => d.toISOString().slice(0, 10);
  const kv = (o: Record<string, unknown>): string =>
    Object.entries(o)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => `${k}=${typeof v === "string" && /[s"=]/.test(v) ? JSON.stringify(v) : typeof v === "object" ? JSON.stringify(v) : v}`)
      .join(" ");
  const say = (sev: "info" | "warn", what: string, o: Record<string, unknown>): void => {
    try {
      // logfmt: at, level and event first, then the fact's own keys; a value with a space or a quote JSON-quoted
      fs.appendFileSync(serverLogFile(dataRoot), `${kv({ at: new Date().toISOString(), level: sev, event: what, ...o })}
`);
    } catch {}
  };
  const secs = (ms: unknown): string | null => (typeof ms === "number" ? `${Math.round(ms / 1000)}s` : null);
  // per run: the last health line's time; per member: the unread count last warned, so a count is warned once
  const healthAt = new Map<number, number>();
  const warnedUnread = new Map<string, number>();
  const infoOf = (kind: string, f: Record<string, unknown>): void => {
    if (kind === "server") say("info", "server", { action: f.action, pid: f.pid });
    else if (kind === "post" && typeof f.event === "string" && (INFO_EVENTS.has(f.event) || f.lands === true)) say("info", f.event, { run: f.run, member: f.author, seq: f.seq });
    else if (kind === "link" && f.up === false) say("info", "link-down", { run: f.run, member: f.member, cause: f.cause });
    else if (kind === "lock" && f.action === "granted")
      say(typeof f.waitedMs === "number" && f.waitedMs > LONG_WAIT_MS ? "warn" : "info", "lock-granted", { run: f.run, member: f.member, waited: secs(f.waitedMs), queue: f.waiting });
    else if (kind === "lock" && f.action === "released") say("info", "lock-released", { run: f.run, member: f.member, held: secs(f.heldMs), cause: f.cause, queue: f.waiting });
    else if (kind === "snapshot") {
      const run = Number(f.run);
      const members = (f.members ?? []) as { seat: string; unread: number; state: unknown }[];
      for (const m of members) {
        const key = `${run}/${m.seat}`;
        if (m.unread >= MANY_UNREAD && m.unread !== warnedUnread.get(key)) say("warn", "unread", { run, seat: m.seat, unread: m.unread, state: m.state });
        warnedUnread.set(key, m.unread >= MANY_UNREAD ? m.unread : 0);
      }
      const t = Date.now();
      if (t - (healthAt.get(run) ?? 0) >= HEALTH_MS) {
        healthAt.set(run, t);
        say("info", "health", { run, ...(f.states as object), unread: members.reduce((n, m) => n + m.unread, 0) });
      }
    }
  };
  return {
    event(kind, fields) {
      const l = levelNow();
      if (l === "off") return;
      infoOf(kind, fields);
      if (l === "info") return;
      const at = new Date();
      append(path.join(root, dayOf(at), "events.jsonl"), { ...fields, at: at.toISOString(), kind });
    },
    message(run, fields) {
      if (levelNow() !== "debug-extended") return;
      const at = new Date();
      append(path.join(root, dayOf(at), "messages", `run-${run}.jsonl`), { at: at.toISOString(), run, ...fields });
    },
    prune(at = new Date()) {
      const oldest = dayOf(new Date(at.getTime() - KEEP_DAYS * 86_400_000));
      try {
        for (const d of fs.readdirSync(root)) if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d < oldest) fs.rmSync(path.join(root, d), { recursive: true, force: true });
      } catch {}
    },
  };
}
