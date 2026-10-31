// The frames between the board server, a member's link and a CLI (swarm-relay D4): one JSON
// text message per frame. A frame type added later is added here only.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Board } from "./board/board.ts";
/** The code pack's answers as they cross the wire to the CLI, which never imports src/packs/ (D9). */
export type { HeldMergeLock } from "./packs/code/claims.ts";
export type { Flag } from "./packs/code/types.ts";

/** The Board methods a verb calls over the wire: all but onChange, close, livenessTick, recordActivity,
 *  memberStates, upkeepIfDue and prune, which only the server's own process runs. */
export const RPC_METHODS = [
  "openRun",
  "addSeat",
  "closeRun",
  "phase",
  "currentPhase",
  "showPhase",
  "pause",
  "resume",
  "pausedOf",
  "done",
  "phaseProgress",
  "lastActivity",
  "owedPhase",
  "idle",
  "unreadMentions",
  "guidesUntold",
  "runs",
  "packCall",
  "join",
  "participant",
  "identify",
  "setDoing",
  "end",
  "roster",
  "endedMembers",
  "heldBy",
  "post",
  "endorse",
  "deliverMentions",
  "wait",
  "repos",
  "snapshot",
  "composition",
] as const satisfies readonly (keyof Board)[];
export type RpcMethod = (typeof RPC_METHODS)[number];

/** The Board methods kept off the wire; with RPC_METHODS, every method of Board (checked below). */
type ServerOnly = "onChange" | "close" | "livenessTick" | "recordActivity" | "memberStates" | "upkeepIfDue" | "prune" | "recordLink" | "savedLinks" | "recordServerUp";
// a Board method added later must be put on one side or the other: this fails to compile until it is
type Unlisted = Exclude<keyof Board, RpcMethod | ServerOnly>;
const everyMethodPlaced: [Unlisted] extends [never] ? true : Unlisted = true;
void everyMethodPlaced;

export type MemberActivity = {
  /** last time the transcript grew */
  grewAt: number | null;
  /** the counter, as liveness.ts sums it: movement, never cost */
  tokens: number;
  /** the last call's input + cache tokens: how full the member is */
  context: number | null;
  /** a tool_use with no result yet */
  /** `boardWait`: the call runs the board's own `wait` verb, the one call that is waiting (swarm-relay D45) */
  /** `label`, `command` (board-split D45): the call's own description and its whole command; absent from an older link */
  openTool: { name: string; target: string; since: number; boardWait?: boolean; label?: string | null; command?: string | null } | null;
  /** "<name> <target, 50 chars>" */
  lastTool: string | null;
  /** the harness says the agent ended (meta.json) */
  finished: boolean;
  // Accurate states (idea 1): all optional, so an older link's activity still parses.
  /** the agent's turn is open: its last user/assistant line is not an assistant line ending the turn */
  inTurn?: boolean;
  /** the last assistant text (50 chars), or "<tool> <target>" */
  lastLine?: string | null;
  /** the oldest awaited background task (latest turn, board's own excluded); null when none */
  background?: { target: string; since: number; outputGrewAt: number | null; label?: string | null; command?: string | null } | null;
  /** the transcript's path, for the server to stat while the link is lost */
  transcript?: string;
  /** the member's last kill that was not by PID (idea 4): by name or pattern always a breach; by a port lookup a breach
   *  only for a port whose lock it does not hold, which the board checks. Null or absent when none was seen. */
  breach?: { command: string; kind: "pattern" | "port"; ports?: number[]; at: number } | null;
  /** the member's background listener (D4, G16): `running` while a background `wait --mentions` it started is not yet
   *  notified; `endedAt` when the last one was. Absent from an older link: the board falls back to its in-wait column. */
  listener?: { running: boolean; endedAt: number | null } | null;
};

// up: a link (or a CLI with no member) to the server
export type Hello = { type: "hello"; version: string; secret: string; member?: { name: string; run: number }; supersede?: boolean };
export type Call = { type: "call"; id: string; method: RpcMethod; args: unknown[] };
/** a wait whose CLI went away */
export type Cancel = { type: "cancel"; id: string };
export type Activity = { type: "activity"; at: number; activity: MemberActivity };
/** board-split D55: the link's heartbeat, every HEARTBEAT_MS */
export type Beat = { type: "beat" };
export type Bye = { type: "bye"; reason: "ended" | "closed" | "finished" | "idle" };
/** a reader (aiview) asks to hear every commit as `changed` (swarm-relay D23) */
export type Subscribe = { type: "subscribe" };
// down: the server to a link or a CLI
export type Welcome = { type: "welcome"; version: string };
export type Result = { type: "result"; id: string; ok: true; value: unknown } | { type: "result"; id: string; ok: false; error: string };
export type Refused = { type: "refused"; reason: "secret" | "version" | "superseded" | "shutdown" | "closed" };
/** to a reader that called subscribe, after each commit */
export type Changed = { type: "changed"; repo: string };

export type Frame = Hello | Call | Cancel | Activity | Beat | Bye | Subscribe | Welcome | Result | Refused | Changed;

const FRAME_TYPES: ReadonlySet<string> = new Set<Frame["type"]>(["hello", "call", "cancel", "activity", "beat", "bye", "subscribe", "welcome", "result", "refused", "changed"]);

/** One JSON text. */
export function encode(f: Frame): string {
  return JSON.stringify(f);
}

/** Throws on text that is not JSON, or on a frame of an unknown type. */
export function decode(text: string): Frame {
  const f: unknown = JSON.parse(text);
  const type = f && typeof f === "object" ? (f as { type?: unknown }).type : undefined;
  if (typeof type !== "string" || !FRAME_TYPES.has(type)) throw new Error(`unknown frame type: ${String(type)}`);
  return f as Frame;
}

const versionsByBuild = new Map<string, string>();
let ownVersion: string | undefined;

/** The file a version is read from: the built CLI beside a launcher (`<entry dir>/dist-cli/cli.mjs`), else the entry itself. */
function builtCliOf(entry: string): string {
  const file = path.resolve(entry);
  const bundle = path.join(path.dirname(file), "dist-cli", "cli.mjs");
  return fs.existsSync(bundle) ? bundle : file;
}

/** D28, D40 (board-split): the hash of the built CLI an entry runs, never of the launcher `swarm.mjs`, so a rebuilt
 *  bundle is another version and its next call replaces a server of the old build, whichever checkout or reader
 *  started it. With no entry, this process's own build, read once: what it runs never changes under it. */
export function bundleVersion(entry?: string): string {
  if (entry === undefined) return (ownVersion ??= bundleVersion(process.argv[1] ?? ""));
  const file = builtCliOf(entry);
  const st = fs.statSync(file);
  const key = `${file}|${st.mtimeMs}|${st.size}`;
  let v = versionsByBuild.get(key);
  if (v === undefined) {
    v = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 16);
    versionsByBuild.set(key, v);
  }
  return v;
}

/** What the running server writes for its clients: `<dataRoot>/swarm-server.json` (D7, D17). */
export type ServerState = { pid: number; port: number; secret: string; version: string };

export function serverStateFile(dataRoot: string): string {
  return path.join(dataRoot, "swarm-server.json");
}

/** The server's own log, `<dataRoot>/swarm-server.log`: a started server's output, its start line and
 *  every link's exit reason while it answers (D42). */
export function serverLogFile(dataRoot: string): string {
  return path.join(dataRoot, "swarm-server.log");
}

/** Set by a CLI spawning a server to its own command line, which the server's start line names (D42). */
export const SERVER_STARTER_ENV = "SWARM_SERVER_STARTER";

/** The lock a starting server takes beside its state file and holds while it runs, its pid inside
 *  (swarm-relay D40): one server per data home. */
export function serverStartLock(dataRoot: string): string {
  return path.join(dataRoot, "swarm-server.lock");
}

/** The pid holding `dataRoot`'s start lock; null when none holds it or the file cannot be read. */
export function serverLockHolder(dataRoot: string): number | null {
  try {
    const pid = Number(fs.readFileSync(serverStartLock(dataRoot), "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** How long a start lock's holder may go without writing the state file before its lock is taken for
 *  stale: its pid reused by another process, or a server stuck starting. */
const START_LOCK_GRACE_MS = 15_000;

/** The server process holding `dataRoot`'s start lock, starting or running (D40); null when the lock is
 *  free or stale: its holder dead, or the lock past its grace with no state file naming its holder. */
export function liveStartLockHolder(dataRoot: string): number | null {
  const holder = serverLockHolder(dataRoot);
  if (holder === null || !isAlive(holder)) return null;
  try {
    if ((JSON.parse(fs.readFileSync(serverStateFile(dataRoot), "utf8")) as ServerState).pid === holder) return holder;
  } catch {}
  try {
    return Date.now() - fs.statSync(serverStartLock(dataRoot)).mtimeMs < START_LOCK_GRACE_MS ? holder : null;
  } catch {
    return null;
  }
}

/** Whether `pid` names a live process. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: it lives, owned by someone else
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}
