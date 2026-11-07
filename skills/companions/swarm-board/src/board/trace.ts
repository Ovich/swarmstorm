// The board's trace: what happened and when, one JSON line per fact, for analysing a run afterwards (slow calls, lock
// queues, how long a message waits to be read, how long a member takes to act on it). Written by the board server alone,
// the one process that opens the store, so one writer per file.
//
//   <data home>/logs/<YYYY-MM-DD>/events.jsonl            debug: calls, posts, deliveries, lock, links, snapshots
//   <data home>/logs/<YYYY-MM-DD>/messages/run-<n>.jsonl   debug-extended: each post's whole text, per run
//   <data home>/logs/level                                 the level, one word; absent: debug
//
// A day is UTC. Day folders older than KEEP_DAYS are removed at start and once a day. A failing write never fails a call.
import fs from "node:fs";
import path from "node:path";

export const TRACE_LEVELS = ["off", "debug", "debug-extended"] as const;
export type TraceLevel = (typeof TRACE_LEVELS)[number];
export const KEEP_DAYS = 30;

export const traceRoot = (dataRoot: string): string => path.join(dataRoot, "logs");
export const traceLevelFile = (dataRoot: string): string => path.join(traceRoot(dataRoot), "level");

export function readTraceLevel(dataRoot: string): TraceLevel {
  try {
    const w = fs.readFileSync(traceLevelFile(dataRoot), "utf8").trim() as TraceLevel;
    return TRACE_LEVELS.includes(w) ? w : "debug";
  } catch {
    return "debug";
  }
}

export function writeTraceLevel(dataRoot: string, level: TraceLevel): void {
  fs.mkdirSync(traceRoot(dataRoot), { recursive: true });
  fs.writeFileSync(traceLevelFile(dataRoot), `${level}\n`);
}

export type Tracer = {
  /** A fact at debug and above. */
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
  return {
    event(kind, fields) {
      if (levelNow() === "off") return;
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
