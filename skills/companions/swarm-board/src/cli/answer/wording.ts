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
  // G14: the seat stays, said before the end command, so it never reads as the end of the run
  idle: (end: Command) => `nothing for you now; the run is open and your seat stays in it, the orchestrator may dispatch you to it again: run ${end} and return`,
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

  // ── the merge (V12: every command runnable as printed) ──
  mergeGuides: (guides: string) => `guides of this merge: ${guides}; check your change against each, then settle each in merged --guides "<name>:ok|n/a <why>, ..."`,
  mergeGranted: (cli: Command, as: string, guides: boolean) =>
    `granted: merge, then ${cli} merged <sha> --files <path>... --report "<your report>"${guides ? ' --guides "<name>:ok|n/a <why>, ..."' : ""} --as ${as}`,
  mergeHeld: (holder: string, wait: Command) => `held by ${holder}: ${wait} for its merged event`,

  // ── the orchestrator's verbs ──
  phaseHeard: (watch: string[]) =>
    watch.length
      ? `the done of ${watch.join(", ")} wakes you; every other done rides on your next wake`
      : "each member's done rides on your next wake; to hear one the moment it lands, open the phase with --watch <ids>",
  phaseFor: (only: string[]) => (only.length ? ` for ${only.join(", ")} alone (the others are not woken and owe no done)` : ""),
  phaseOpened: (name: string, forWhom: string, heard: string, cli: Command, as: string, run: number) =>
    `phase ${name} is open${forWhom}; ${heard}. Listen in the background: ${cli} wait --mentions --as ${as}. When the board says every member is done, open the next phase: ${cli} phase <name> "<text>" --as ${as}; after the last, ${cli} close --run ${run}`,
  briefThePerson: "brief the person: the list of what is done since the session began, one short phrase each, then what comes next",
  dormant: (seat: string) => `${seat} is dormant: dispatch a member into it (join the same seat) or resume it with SendMessage`,
  pausedAll: (run: number, person: string | null, cli: Command, as: string) =>
    `every member of run ${run} is told to stop and wait${person !== null ? `, waiting on the person: ${person}` : ""}; nothing wakes you but an urgent post until the resume, which gives you every line held meanwhile. Resume, with a message if they need one: ${cli} resume "<message>" --as ${as}`,
  resumed: (run: number, held: number, cli: Command, as: string) =>
    `run ${run} resumed${held ? `; ${held} held while paused, above` : ""}; listen again in the background: ${cli} wait --mentions --as ${as}`,
  lockHeldNext: (cli: Command, name: string, as: string, wait: Command) =>
    `next: wait for its unlocked event, then lock again (${cli} lock ${name} --as ${as}); in the foreground (${FOREGROUND_NOTE}): ${wait}`,

  // ── the run ──
  paused: (run: number, why: string, wait: Command) =>
    `run ${run} is paused${why}. Stop where you are: start nothing new, claim and merge nothing; wait in the foreground for the resume (${FOREGROUND_NOTE}): ${wait}`,
  closed: (run: number, end: Command) =>
    `run ${run} closed: run end and return your summary: ${end}; your link and listener background tasks end on their own now, and their end notices are not news`,
} as const;
