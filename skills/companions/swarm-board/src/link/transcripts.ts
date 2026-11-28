// Finding and reading a member's transcript (swarm-relay#D8, #D10, codebase-rework#D15): the link finds, in its
// caller's session, the harness transcript whose shell call ran the binding verb, then reads from it, a growing file
// at a time, what the board needs to tell the member's state. The harness decodes the lines (harness/), the fold
// keeps the state (activity.ts), the shell commands are read by shell.ts.
import fs from "node:fs";
import type { MemberActivity } from "../contract/wire.ts";
import { activityOf, emptyActivity, fold, type ActivityState } from "./activity.ts";
import { claudeCode, type Harness } from "./harness/claude-code.ts";
import type { Binding } from "./shell.ts";

/** Every harness the link knows, tried in order. */
const HARNESSES: Harness[] = [claudeCode];

/** Where a read of a transcript stopped, and what the lines before it said; only `observe` reads it. */
declare const cursorShape: unique symbol;
export type TranscriptCursor = { readonly [cursorShape]: true };
/** The cursor as `observe` keeps it: the next unread byte, the tokens counted, when the file last grew, the state. */
type Cursor = { offset: number; tokens: number; grewAt: number | null } & ActivityState;

const freshCursor = (): Cursor => ({ offset: 0, tokens: 0, grewAt: null, ...emptyActivity() });

/** The first harness's transcript of the call that ran this binding; null when none holds it (yet): the link retries each second. */
export function locate(binding: Binding, env: NodeJS.ProcessEnv): string | null {
  for (const h of HARNESSES) {
    const found = h.locate(binding, env);
    if (found) return found;
  }
  return null;
}

/** The file's bytes from `cursor.offset` on, and its mtime; a vanished or truncated file starts over from 0. */
function readFrom(transcript: string, cursor: Cursor): { cursor: Cursor; chunk: Buffer; mtime: number } {
  try {
    const fd = fs.openSync(transcript, "r");
    try {
      const stat = fs.fstatSync(fd);
      const from = stat.size < cursor.offset ? freshCursor() : cursor;
      const chunk = Buffer.alloc(stat.size - from.offset);
      fs.readSync(fd, chunk, 0, chunk.length, from.offset);
      return { cursor: from, chunk, mtime: stat.mtimeMs };
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return { cursor: freshCursor(), chunk: Buffer.alloc(0), mtime: Date.now() };
  }
}

/** The events of the chunk's complete lines, and the bytes they span; none when a first line shows another format. */
function decodeLines(chunk: Buffer, atFileStart: boolean, fallbackAt: number): { events: ReturnType<Harness["decode"]>; consumed: number } {
  const end = chunk.lastIndexOf(0x0a);
  if (end < 0) return { events: [], consumed: 0 }; // no complete line yet
  const events: ReturnType<Harness["decode"]> = [];
  let decoded = 0;
  for (const raw of chunk.subarray(0, end).toString("utf8").split("\n")) {
    const text = raw.trim();
    if (!text) continue;
    const lineEvents = claudeCode.decode(text, fallbackAt);
    const foreign = lineEvents.some((e) => e.kind === "foreign");
    // the first line not in the format: the file is another harness's; a torn line inside a recognised file is skipped
    if (foreign && decoded === 0 && atFileStart) return { events: [], consumed: 0 };
    if (foreign) continue;
    decoded++;
    events.push(...lineEvents);
  }
  return { events, consumed: end + 1 };
}

/** Reads what was appended to the transcript since `from` (all of it when null); `grew` when it read anything new.
 *  `binding`: the member this link stands for; a board call `--as` another member is that member's, plain work here (S27). */
export function observe(transcript: string, from: TranscriptCursor | null, binding?: Binding): { activity: MemberActivity; cursor: TranscriptCursor; grew: boolean } {
  const previous = from as unknown as Cursor | null;
  const read = readFrom(transcript, previous ?? freshCursor());
  let cursor: Cursor = { ...read.cursor };
  const { events, consumed } = decodeLines(read.chunk, cursor.offset === 0, read.mtime);
  if (consumed > 0) {
    let state: ActivityState = cursor;
    let tokens = cursor.tokens;
    for (const e of events) {
      if (e.kind === "tokens") tokens += e.tokens;
      else state = fold(state, e, binding);
    }
    cursor = { ...cursor, ...state, offset: cursor.offset + consumed, tokens, grewAt: read.mtime };
  }
  const said = HARNESSES.map((h) => h.finished(transcript)).find((f) => f !== null);
  const activity = activityOf(cursor, {
    grewAt: cursor.grewAt,
    tokens: cursor.tokens,
    finished: said ?? false,
    mtimeOf: (file) => {
      try {
        return fs.statSync(file).mtimeMs;
      } catch {
        return null; // not written yet, or gone: unknown
      }
    },
  });
  return { activity, cursor: cursor as unknown as TranscriptCursor, grew: cursor.offset !== previous?.offset };
}
