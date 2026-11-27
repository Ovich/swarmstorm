// Token counters from transcripts: a member's transcript, read through the adapter of its harness's format, gives one
// number that moves while the member works. Adding a harness is one entry in ADAPTERS.
import fs from "node:fs";

/** Where a read of a transcript stopped: the byte offset of the next unread line and the tokens counted so far. */
type Cursor = { offset: number; tokens: number };

interface TranscriptAdapter {
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
type TranscriptReader = (path: string, from: Reading | null) => Reading | null;

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
