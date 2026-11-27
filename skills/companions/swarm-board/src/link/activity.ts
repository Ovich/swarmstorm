// A member's activity folded from its transcript's events (codebase-rework#D15): harness-neutral and pure. A harness
// decodes its lines into these events; the fold keeps what the board needs to tell the member's state.
import type { MemberActivity } from "../contract/wire.ts";
import { commandFacts, type Binding, type CommandFacts } from "./shell.ts";

/** board-split D45: a call as the card names it, read off the transcript alone: the call's own description (null
 *  when it gave none) and its whole command or input, for the hover. */
type CallWords = { label?: string | null; command?: string | null };

/** One thing a transcript line said, in the harness's order. */
export type TranscriptEvent =
  /** the harness's movement counter for the line; summed beside the fold, never in it */
  | { kind: "tokens"; tokens: number }
  /** a line not in the harness's format: a first one means the file is another harness's */
  | { kind: "foreign" }
  /** the harness told the agent these background tasks ended */
  | { kind: "notified"; toolUseIds: string[]; at: number }
  /** how full the agent is: the last assistant line's input and cache tokens */
  | { kind: "context"; tokens: number }
  /** the agent's own text */
  | { kind: "said"; text: string }
  /** a tool call: `target` its main input as text, `command` its shell command when it has one, `stopsTask` the id
   *  of the background task it stops */
  | { kind: "called"; id: string; tool: string; target: string; words: CallWords; command: string | null; background: boolean; stopsTask: string | null; at: number }
  /** a tool call's result; `movedToBackground` when the harness says the call now runs in the background */
  | { kind: "answered"; toolUseId: string; movedToBackground: { output: string | null; taskId: string | null } | null }
  /** an assistant line ended; it asks for a tool, the turn goes on */
  | { kind: "assistantEnded"; asksForTool: boolean }
  /** a user line: a prompt or tool results, the turn is on */
  | { kind: "userSpoke" };

type OpenCall = { name: string; target: string; since: number; boardWait?: boolean } & CallWords;
/** A background task the agent started: its output file, once the harness named it, and the turn it opened in. */
type BackgroundTask = { target: string; since: number; turn: number; output: string | null; taskId?: string | null } & CallWords;

/** What the lines read so far said, as the board needs it. */
export type ActivityState = {
  open: Map<string, OpenCall>;
  lastTool: string | null;
  context: number | null;
  /** the last assistant text (50 chars), or "<tool> <target>" */
  lastLine: string | null;
  /** the last user/assistant line was not an assistant line ending the turn */
  inTurn: boolean;
  /** how many turns have ended so far: a background task belongs to the turn it opened in */
  endedTurns: number;
  /** background tasks not yet notified, by tool_use id; the board's own wait and link never enter */
  background: Map<string, BackgroundTask>;
  /** open calls running the board's own `wait` or `link`, by tool_use id: never a background task, whichever way they go there */
  boardsOwn: Set<string>;
  /** the last kill seen that was not by PID (idea 4) */
  breach: NonNullable<MemberActivity["breach"]> | null;
  /** background `wait --mentions` calls not yet notified, by tool_use id: the member's listeners (D4) */
  listeners: Set<string>;
  /** when the last listener's notification came */
  listenerEndedAt: number | null;
};

export function emptyActivity(): ActivityState {
  return { open: new Map(), lastTool: null, context: null, lastLine: null, inTurn: false, endedTurns: 0, background: new Map(), boardsOwn: new Set(), breach: null, listeners: new Set(), listenerEndedAt: null };
}

const SHORT_CHARS = 50;
/** A text as one short line. */
const short = (text: string): string => text.replace(/\s+/g, " ").trim().slice(0, SHORT_CHARS);

const NO_FACTS: CommandFacts = { boardWait: false, boardsOwn: false, listener: false, kill: null };

/** How each event moves the state, on a copy of it. */
const FOLDS: { [K in TranscriptEvent["kind"]]: (s: ActivityState, e: Extract<TranscriptEvent, { kind: K }>, binding?: Binding) => void } = {
  tokens: () => {},
  foreign: () => {},
  notified: (s, e) => {
    for (const id of e.toolUseIds) {
      s.background.delete(id);
      if (s.listeners.delete(id)) s.listenerEndedAt = e.at;
    }
  },
  context: (s, e) => {
    s.context = e.tokens;
  },
  said: (s, e) => {
    s.lastLine = short(e.text);
  },
  called: (s, e, binding) => {
    const target = short(e.target);
    // D45: only a shell call running the board's `wait` verb is waiting; a browser's wait_for, a sleep, are work
    const facts = e.command === null ? NO_FACTS : commandFacts(e.command, e.tool, binding);
    s.open.set(e.id, { name: e.tool, target, since: e.at, ...(facts.boardWait ? { boardWait: true } : {}), ...e.words });
    s.lastTool = target ? `${e.tool} ${target}` : e.tool;
    s.lastLine = s.lastTool;
    if (facts.boardsOwn) s.boardsOwn.add(e.id);
    else if (e.background) s.background.set(e.id, { target, since: e.at, turn: s.endedTurns, output: null, ...e.words });
    if (e.background && facts.listener) s.listeners.add(e.id);
    // U-F30: a background task stopped by its id gets no notification: it ends here
    if (e.stopsTask) for (const [useId, task] of s.background) if (task.taskId === e.stopsTask) s.background.delete(useId);
    // a kill not by PID: the board checks a port kill against the member's locks (idea 4)
    if (facts.kill) s.breach = { command: e.command!.replace(/\s+/g, " ").trim(), ...facts.kill, at: e.at };
  },
  answered: (s, e) => {
    const call = s.open.get(e.toolUseId);
    if (e.movedToBackground) {
      const { output, taskId } = e.movedToBackground;
      const task = s.background.get(e.toolUseId);
      if (task) s.background.set(e.toolUseId, { ...task, output, taskId });
      else if (call && !s.boardsOwn.has(e.toolUseId))
        // a foreground call the harness moved to the background: it belongs to the turn it was called in
        s.background.set(e.toolUseId, { target: call.target, since: call.since, turn: s.endedTurns, output, taskId, label: call.label ?? null, command: call.command ?? null });
    }
    s.open.delete(e.toolUseId);
    s.boardsOwn.delete(e.toolUseId);
  },
  // the turn ends on an assistant line not asking for a tool; a line without stop_reason reads as ended (detection first)
  assistantEnded: (s, e) => {
    if (s.inTurn && !e.asksForTool) s.endedTurns++;
    s.inTurn = e.asksForTool;
  },
  userSpoke: (s) => {
    s.inTurn = true;
  },
};

/** The state after one more event; `s` is left as it was. `binding`: the member this link stands for, a board call
 *  `--as` another member being that member's, plain work here (S27). */
export function fold(s: ActivityState, e: TranscriptEvent, binding?: Binding): ActivityState {
  const next: ActivityState = { ...s, open: new Map(s.open), background: new Map(s.background), boardsOwn: new Set(s.boardsOwn), listeners: new Set(s.listeners) };
  (FOLDS[e.kind] as (s: ActivityState, e: TranscriptEvent, binding?: Binding) => void)(next, e, binding);
  return next;
}

/** The latest turn's oldest awaited background task, its output stat'd now; a task from an earlier turn is a service, never awaited. */
function awaitedBackground(s: ActivityState, mtimeOf: (file: string) => number | null): MemberActivity["background"] {
  const latestTurn = s.inTurn ? s.endedTurns : s.endedTurns - 1;
  let oldest: BackgroundTask | null = null;
  for (const t of s.background.values()) if (t.turn === latestTurn && (!oldest || t.since < oldest.since)) oldest = t;
  if (!oldest) return null;
  const outputGrewAt = oldest.output ? mtimeOf(oldest.output) : null;
  return { target: oldest.target, since: oldest.since, outputGrewAt, label: oldest.label ?? null, command: oldest.command ?? null };
}

/** The activity the link reports: the state, with what the file itself says. */
export function activityOf(s: ActivityState, io: { grewAt: number | null; tokens: number; finished: boolean; mtimeOf(f: string): number | null }): MemberActivity {
  let openTool: MemberActivity["openTool"] = null;
  for (const t of s.open.values()) if (!openTool || t.since < openTool.since) openTool = t;
  return {
    grewAt: io.grewAt,
    tokens: io.tokens,
    context: s.context,
    openTool: openTool && { ...openTool },
    lastTool: s.lastTool,
    finished: io.finished,
    inTurn: s.inTurn,
    lastLine: s.lastLine,
    background: awaitedBackground(s, io.mtimeOf),
    breach: s.breach,
    listener: { running: s.listeners.size > 0, endedAt: s.listenerEndedAt },
  };
}
