// Liveness from token counters: a member's transcript, read through the adapter of its harness's
// format, gives one number that moves while the member works. The board stores the readings; the
// stall rule reads only them, never board calls. Adding a harness is one entry in ADAPTERS.
import fs from "node:fs";

/** Where a read of a transcript stopped: the byte offset of the next unread line and the tokens counted so far. */
export type Cursor = { offset: number; tokens: number };

export interface TranscriptAdapter {
  name: string;
  /** Reads `chunk`, the file's bytes from `from.offset` on; null when this
   *  adapter does not recognise the format. Only complete lines are consumed. */
  read(chunk: Buffer, from: Cursor): Cursor | null;
}

/** Claude Code's JSONL transcript: one JSON object per line; an assistant line carries
 *  `message.usage`, whose four token counts are summed. */
export const claudeCodeJsonl: TranscriptAdapter = {
  name: "claude-code-jsonl",
  read(chunk, from) {
    const end = chunk.lastIndexOf(0x0a);
    if (end < 0) return from; // no complete line yet: nothing moved, nothing refused
    let tokens = from.tokens;
    let parsed = 0;
    for (const line of chunk.subarray(0, end).toString("utf8").split("\n")) {
      const text = line.trim();
      if (!text) continue;
      let obj: unknown;
      try {
        obj = JSON.parse(text);
      } catch {
        if (parsed === 0 && from.offset === 0) return null; // the first line is not JSON: another format
        continue; // a torn line inside a file already recognised
      }
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
        if (parsed === 0 && from.offset === 0) return null;
        continue;
      }
      parsed++;
      const usage = (obj as { message?: { usage?: Record<string, unknown> } }).message?.usage;
      if (!usage) continue;
      for (const k of ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"]) {
        const n = usage[k];
        if (typeof n === "number" && Number.isFinite(n)) tokens += n;
      }
    }
    return { offset: from.offset + end + 1, tokens };
  },
};

/** Every harness format the board reads, tried in order. */
export const ADAPTERS: TranscriptAdapter[] = [claudeCodeJsonl];

/** A transcript read once more: the adapter that took it and where it stopped; null when the file is
 *  missing or no adapter recognises it. `adapter` keeps a file on the adapter that first read it. */
export type Reading = { adapter: string; cursor: Cursor };
export type TranscriptReader = (path: string, from: Reading | null) => Reading | null;

/** The default reader: the file from the cursor's offset, through its adapter, or every adapter on a first read. */
export const readTranscript: TranscriptReader = (file, from) => {
  let chunk: Buffer;
  const offset = from?.cursor.offset ?? 0;
  try {
    const fd = fs.openSync(file, "r");
    try {
      const size = fs.fstatSync(fd).size;
      if (size < offset) return null; // truncated or replaced: not the file it was
      chunk = Buffer.alloc(size - offset);
      fs.readSync(fd, chunk, 0, chunk.length, offset);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
  const cursor = from?.cursor ?? { offset: 0, tokens: 0 };
  const tried = from ? ADAPTERS.filter((a) => a.name === from.adapter) : ADAPTERS;
  for (const a of tried) {
    const next = a.read(chunk, cursor);
    if (next) return { adapter: a.name, cursor: next };
  }
  return null;
};

/** Every member but the orchestrator `waiting`: an `idle` to the orchestrator at once, then again after each IDLE_MS while it holds (swarm-relay D34). */
export const IDLE_MS = 15 * 60 * 1000;
/** A member whose link has sent no activity this long after its join has no transcript: a card note, never an alarm (board-split D55). */
// SWARM_NO_TRANSCRIPT_MS: a test scene with no link sets it past its own length, so the notice cannot land mid-scene (board-split T21, S31)
export const NO_TRANSCRIPT_MS = Number(process.env.SWARM_NO_TRANSCRIPT_MS) || 30 * 1000;
/** The default stall window of a run, in ms (board-split D54: 5 min): a member owing the open phase in a held wait this
 *  long after its task was delivered reads stalled. */
export const STALL_MS_DEFAULT = 5 * 60 * 1000;
/** Readings older than this are pruned. */
export const READINGS_KEPT_MS = 10 * 60 * 1000;
/** A tool call open longer than this keeps its member `busy`, and the orchestrator is told it may be hung (stalled, D46). */
export const BUSY_MAX_MS = 15 * 60 * 1000;
/** board-split D55: lost needs its link unseen, its last sign, the server's start and its seating all this old: twelve
 *  missed heartbeats, longer than a server restart plus every link's reconnect, and the time a harness takes to start a
 *  member's link after `join` or a restart (D55 (6)). */
export const LOST_MS = 60 * 1000;
/** board-split D55: a link's heartbeat, a sign of life each time: the card's freshness, a fact on it within seconds (D55 (6)). */
export const HEARTBEAT_MS = 5 * 1000;
/** A member in turn (its last line not an ended turn) is quiet only after this with no line (idea 1, rule 1). */
export const IN_TURN_MS = 120 * 1000;
/** A member waiting on the board while it owes the open phase is `quiet · waiting, not done` once its owing span is this long (idea 1, rule 5). */
export const OWE_WAIT_MS = 10 * 60 * 1000;
/** A carried message pending this long (from its post, or from the resume) is due: it wakes its member by itself (idea 2). */
export const CARRY_MAX_MS = 5 * 60 * 1000;
/** A named lock others wait on, held this long since its first waiter queued, is `stalled · lock` to both orchestrators (idea 4). */
export const LOCK_HELD_MS = 10 * 60 * 1000;

/** board-split D36, D49: a member's one state, for every kind of run. `working`: on the board, out of any wait it
 *  holds; `waiting`: in a board wait the server holds (the orchestrator always); `parked`: parked by the orchestrator
 *  until it unparks; `ended`: it left, or its run closed. A pack's own fact (the code pack's `merging`) and the badges
 *  (stalled, lost, blocked) sit beside it, never in it. */
export type CoreMemberState = "working" | "waiting" | "parked" | "ended";

/** board-split D49: the board-held facts a member's state is derived from, and nothing else: no phase owing, no
 *  `doing`, no transcript. `inHeldWait`: a board wait of its own the server holds as its open call. */
export type CoreStateFacts = { orchestrator: boolean; runOpen: boolean; ended: boolean; parked: boolean; inHeldWait: boolean };

/** board-split D49: the one derivation of a member's state, read by snapshot, roster, status and reader alike:
 *  ended > parked > (the pack's fact, applied by the caller) > waiting > working. */
export function coreStateOf(m: CoreStateFacts): CoreMemberState {
  if (!m.runOpen || m.ended) return "ended";
  if (m.parked) return "parked";
  if (m.orchestrator) return "waiting";
  return m.inHeldWait ? "waiting" : "working";
}

/** board-split D36: a seat's state, derived from its member, never set: `ready` none has sat in it, `running` its
 *  member is on the board, `done` its member left; a parked seat is `ready` again, waiting for its dispatch. */
export type SeatState = "ready" | "running" | "done";
/** board-split D54 (amended): out of any wait, a member owing the open phase reads stalled only when its transcript has
 *  not grown and no tool call of its own is open for this long; board-call silence alone is never a stall. */
export const SILENT_MS = Number(process.env.SWARM_SILENT_MS) || 10 * 60 * 1000;
