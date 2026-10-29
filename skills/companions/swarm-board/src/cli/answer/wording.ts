// The answer module's wording (board-rework D1): every line and command template of the wait cluster's answers, in one
// typed table. A placeholder is a typed parameter, so a template called with a missing or wrong value does not compile.
// The rules choosing which line a member reads are in rules.ts; no verb writes these lines itself.
import { FOREGROUND_NOTE } from "../../board/events.ts";

/** A command as printed: the words joined, ready to copy. */
export type Command = string;

export const WORDING = {
  // ── commands ──
  /** `wait --mentions`, foreground carrying its hold */
  wait: (cli: Command, as: string, holdMs?: number): Command => `${cli} wait --mentions --as ${as}${holdMs ? ` --timeout ${holdMs}` : ""}`,
  done: (cli: Command, phase: string, as: string): Command => `${cli} done ${phase} --as ${as}`,
  thread: (cli: Command, as: string): Command => `${cli} thread --as ${as}`,
  end: (cli: Command, as: string): Command => `${cli} end --as ${as}`,

  // ── the listener ──
  listenerStart: (wait: Command) => `start your listener now, in the background (your harness's background task): ${wait}`,
  waitNow: (afterPhase: boolean, wait: Command) =>
    `${afterPhase ? "only then wait" : "wait now"}, in the foreground (never a background listener: a seat that ends its turn is gone; ${FOREGROUND_NOTE}): ${wait}`,
  rearmBackground: (wait: Command) => `start this listener again, in the background while you work, in the foreground when you are waiting (${FOREGROUND_NOTE}): ${wait}`,
  rearmForeground: (wait: Command) => `wait again, in the foreground (${FOREGROUND_NOTE}): ${wait}`,
  rearmOrchestrator: (wait: Command) => `act on it, then start this listener again, in the background: ${wait}`,
  rearmAfterOwed: (owed: string, wait: Command) => `${owed}\nonly then wait again, in the foreground (${FOREGROUND_NOTE}): ${wait}`,
  nothingYetOrchestrator: (wait: Command) => `nothing yet; wait again: ${wait}`,
  nothingYet: (wait: Command) => `nothing yet; wait again (${FOREGROUND_NOTE}): ${wait}`,
  superseded: "superseded by a newer wait",
  idle: (end: Command) => `nothing for you now: run ${end} and return; your seat stays in the run, and the orchestrator may dispatch you to it again`,
  ended: (run: number) => `you have ended in run ${run}: this listener stops; nothing to re-arm`,
  delivered: "these lines are delivered; the task-end notice is the same event",

  // ── the phase ──
  phaseWhole: (name: string, text: string) => `phase ${name}: ${text}`,
  phaseShort: (name: string, thread: Command) => `phase ${name} (unchanged; its text: ${thread})`,
  phasePaused: (head: string | null, why: string) => [head, `PAUSED${why}`].filter(Boolean).join("  "),
  pauseWhy: (person: boolean, text: string) => (person ? `: waiting on the person: ${text || "their decision"}` : text ? `: ${text}` : ""),
  owedOpen: (name: string, text: string, read: string, done: Command) => `phase ${name} is open and asks: ${text}. ${read}Do your part now, then: ${done}`,
  owedBrief: (name: string, read: string, done: Command) => `phase ${name} is yours: ${read}Do your part now, then: ${done}`,
  readWholePhase: (thread: Command) => `Read the whole phase first: ${thread}. `,
  noPostYet: (name: string) => `no post yet in phase ${name}`,
  doneWaitNext: (wait: Command) => `wait for the next phase, in the foreground (${FOREGROUND_NOTE}): ${wait}`,
  doneNone: "no phase is open: nothing to mark",

  // ── the run ──
  paused: (run: number, why: string, wait: Command) =>
    `run ${run} is paused${why}. Stop where you are: start nothing new, claim and merge nothing; wait in the foreground for the resume (${FOREGROUND_NOTE}): ${wait}`,
  closed: (run: number, end: Command) =>
    `run ${run} closed: run end and return your summary: ${end}; your link and listener background tasks end on their own now, and their end notices are not news`,
} as const;
