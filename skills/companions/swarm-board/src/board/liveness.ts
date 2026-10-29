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
/** A member whose link has sent no activity this long after its join has no transcript: named once, its state presence only (D33). */
// SWARM_NO_TRANSCRIPT_MS: a test scene with no link sets it past its own length, so the notice cannot land mid-scene (board-split T21, S31)
export const NO_TRANSCRIPT_MS = Number(process.env.SWARM_NO_TRANSCRIPT_MS) || 30 * 1000;
/** The default stall threshold of a run, in ms: a member silent this long is `quiet` (swarm-relay D9, D11). */
export const STALL_MS_DEFAULT = 60000;
/** Readings older than this are pruned. */
export const READINGS_KEPT_MS = 10 * 60 * 1000;
/** A tool call open longer than this keeps its member `busy`, and the orchestrator is told it may be hung (stalled, D46). */
export const BUSY_MAX_MS = 15 * 60 * 1000;
/** `stalled <member>` is told again after this, while the member stays `quiet` (D11). */
export const STALLED_AGAIN_MS = 15 * 60 * 1000;
/** A member's link closed and not back this long: the member is `gone` (D12). */
export const LINK_LOST_MS = 30 * 1000;
/** A member in turn (its last line not an ended turn) is quiet only after this with no line (idea 1, rule 1). */
export const IN_TURN_MS = 120 * 1000;
/** A member waiting on the board while it owes the open phase is `quiet · waiting, not done` once its owing span is this long (idea 1, rule 5). */
export const OWE_WAIT_MS = 10 * 60 * 1000;
/** A carried message pending this long (from its post, or from the resume) is due: it wakes its member by itself (idea 2). */
export const CARRY_MAX_MS = 5 * 60 * 1000;
/** A named lock others wait on, held this long since its first waiter queued, is `stalled · lock` to both orchestrators (idea 4). */
export const LOCK_HELD_MS = 10 * 60 * 1000;

/** board-split D36: a member's one state, for every kind of run. `working`: it owes its part of the open phase;
 *  `waiting`: on the board, owing nothing (the orchestrator watching too); `parked`: its seat kept with no agent
 *  (parked, or ended idle and dormant until a later phase); `ended`: it left, or its run closed. A pack's own fact
 *  (the code pack's `merging`) and the badges (stalled, lost, blocked) sit beside it, never in it. */
export type CoreMemberState = "working" | "waiting" | "parked" | "ended";

/** What the core reads of a member to name its state. `owes`: the open phase is for it and it has not run `done`;
 *  `inBoardWait`: a `wait` of its own pending on the board, read only when no phase is open, where nothing else
 *  says whether it owes the run something. */
export type CoreStateFacts = { orchestrator: boolean; runOpen: boolean; ended: boolean; dormant: boolean; parked: boolean; phaseOpen: boolean; owes: boolean; inBoardWait: boolean };

export function coreStateOf(m: CoreStateFacts): CoreMemberState {
  if (!m.runOpen) return "ended";
  if (m.parked || (m.ended && m.dormant)) return "parked";
  if (m.ended) return "ended";
  if (m.orchestrator) return "waiting";
  if (m.phaseOpen) return m.owes ? "working" : "waiting";
  return m.inBoardWait ? "waiting" : "working";
}

/** board-split D36: a seat's state, derived from its member, never set: `ready` none has sat in it, `running` its
 *  member is on the board, `done` its member left; a parked seat is `ready` again, waiting for its dispatch. */
export type SeatState = "ready" | "running" | "done";
