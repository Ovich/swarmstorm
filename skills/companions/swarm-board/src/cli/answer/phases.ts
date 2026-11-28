// The phases' answer wording (product-shape#D20): the lines of phase, phases and done, what a member owes and the
// orchestrator's first phase. Spread into WORDING (wording.ts), which every caller reads.
import { FOREGROUND_NOTE, type Command } from "./command.ts";

/** Where the orchestrator reads a protocol's phases, before the colon of its first-phase step. */
const FIRST_PHASE_POINTER = "(its protocol.md's phase table names them)";

export const PHASES_WORDING = {
  phaseConfirm: (cli: Command, name: string, text: string, flags: string, as: string): Command => `${cli} phase ${name} ${text}${flags} --confirm --as ${as}`,
  /** The opt-in phases, fixed, each with why it would come now: the orchestrator weighs them before every phase opens. */
  phaseOptIns: [
    "prototype: the work adds or changes a screen or a user story; a working prototype first, then the person's go",
    "architecture: a new module, an interface that changes, or a shape still unclear; the system defined first, then the person's go",
    "verify: the result must be seen working; verifiers who built none of it walk the running product",
    "reflect: the same kind of fault keeps coming back; the work paused, every member asked once",
    "simplify: the run nears its close and replaced old code; cut it back, parity verified",
    "the person: a decision outside your authority; pause --person, the decision as its reason",
  ] as readonly string[],
  phaseConfirmStep: (name: string, optIns: readonly string[], confirm: Command) =>
    `phase ${name}: confirm the next phase. Does the run need one of these first?\n${optIns.map((o) => `- ${o}`).join("\n")}\n- or a phase in your own words.\nAs planned, open it: ${confirm}`,

  // ── the phase ──
  phaseWhole: (name: string, text: string) => `phase ${name}: ${text}`,
  phaseShort: (name: string, status: Command) => `phase ${name} (unchanged; its text: ${status})`,
  phasePaused: (head: string | null, why: string) => [head, `PAUSED${why}`].filter(Boolean).join("  "),
  // board-split D65: a phase opened during a pause is open, but nothing wakes the members before the resume
  phaseOpenedPaused: (name: string, run: number) => `run ${run} is paused: phase ${name} is open, and its members hear it at resume`,
  owedOpen: (name: string, text: string, done: Command) => `phase ${name} is open and asks: ${text}. Do your part now, then mark it done: ${done}`,
  owedBrief: (name: string, done: Command) => `you owe phase ${name}: do your part, then mark it done: ${done}`,
  /** board-fixes V1-3 */
  taskStillOpen: (seq: number, done: Command) =>
    `your task #${seq} is still open: finish it and report, then close it with your next done: ${done}; a later task to you replaces it`,
  doneWaitNext: (wait: Command) => `wait for the next phase, in the foreground (${FOREGROUND_NOTE}): ${wait}`,
  doneNone: "no phase is open: nothing to mark",
  /** simple-states: a member owing nothing (its task merged and reported, its phase done) ends its turn; the board reads it away */
  owesNothingEndTurn: "you owe nothing now: end your turn with your report, without end; the orchestrator resumes you by message with the next task",

  // ── the orchestrator's verbs ──
  phaseHeard: (watch: string[]) =>
    watch.length
      ? `the done of ${watch.join(", ")} wakes you; the board tells you once every member is done`
      : "the board tells you once every member is done; to hear one done the moment it lands, open the phase with --watch <ids>",
  phaseFor: (only: string[]) => (only.length ? ` for ${only.join(", ")} alone (the others are not woken and owe no done)` : ""),
  circling: (kind: string, passes: number) =>
    `${kind} pass ${passes} since the run began or last reflected: closer to the goal, or circling? When the same kinds of fault keep coming back, a reflect phase may serve better than another pass (the orchestrate skill's references/reflect-phase.md).`,
  phaseOpened: (name: string, forWhom: string, heard: string, cli: Command, as: string, run: number) =>
    `phase ${name} is open${forWhom}; ${heard}. Listen in the background: ${cli} wait --mentions --as ${as}. When the board says every member is done, open the next phase: ${cli} phase <name> "<text>" --as ${as}; after the last, ${cli} close --run ${run} --as ${as}`,
  briefThePerson: "brief the person: the list of what is done since the session began, one short phrase each, then what comes next",
  seatIdleEnded: (seat: string) => `${seat} ended idle and still owes this phase: dispatch a member into it (join the same seat) or resume it with SendMessage`,
  phaseDoneWhen: (name: string, done: Command) => `when your part of ${name} is posted: ${done}`,
  openNextPhase: (cli: Command, as: string, run: number) => `open the next phase: ${cli} phase <name> "<text>" --as ${as}; after the last, ${cli} close --run ${run} --as ${as}`,

  // ── w4 (board-split D62, D47): the done count, the phase that replaces an owed one, the project word ──
  /** a done of the open phase: the one count (owing.ts), the lost named in it */
  /** V-43: with a lost member owing the phase, "every member" is not said: the orchestrator's own line says "but the lost" */
  doneCounted: (phase: string, progress: string, all: boolean, lost: boolean) =>
    `done ${phase}: ${progress}${all ? (lost ? "; the orchestrator is told every member present is done, the lost not" : "; the orchestrator is told every member is done") : ""}`,
  /** V-44: `phase --for` with no seat in it */
  phaseNoKind: (name: string) => `phase ${name}: a phase's name opens on its kind, a word (build, verify, simplify, reflect, or any other), then anything after it: verify-3, build-desk`,
  phaseForEmpty: (name: string) => `phase ${name}: --for names no seat; name the seats it is for (--for w1,w2), or leave --for out for every member`,
  /** V-35: a member owing the phase just opened whose agent is lost */
  phaseLostMember: (member: string, move: string) => `${member} owes this phase and is lost: ${move}`,
  /** V-28: a done from a seat the open phase's count leaves out: recorded, and why it is not counted */
  doneNotOwed: (phase: string, why: { forSeats: string[] }) => `done ${phase} recorded; you do not owe ${phase} (it is for ${why.forSeats.join(", ")})`,
  /** a done run again for the same phase: nothing new recorded; for a phase no longer open, what the member owes now */
  doneAlready: (phase: string, progress: string | null, late: { owesNow: string | null } | null) =>
    `already done ${phase}${progress ? `: ${progress}` : ""}; nothing new recorded${late && !late.owesNow ? "; you owe nothing now" : ""}`,
  /** V-5: a done for a phase no longer open: recorded; the owed line after it names the phase owed now, else this says none is */
  doneLate: (phase: string, current: string, owesNow: string | null) =>
    `done ${phase} recorded late (the open phase is ${current}; the orchestrator is told)${owesNow ? "" : "; you owe nothing now"}`,
  /** V-6: a phase opened while members still owed the one it replaces */
  phaseStillOwed: (previous: string, members: string[]) => `${members.join(", ")} had not run done for ${previous}; ask each whether its part landed before you count on it`,

  // ── codebase-rework#D13: lines the CLI's verbs wrote themselves before ──
  /** idea 3: the orchestrator's step after `open` of a task or plan run; the reading pointer before the colon, the command last (F6) */
  phaseCommand: (cli: Command, as: string): Command => `${cli} phase <name> "<its message>" --as ${as}`,
  firstPhasePhaseless: "next: phaseless: the workers take tasks on call",
  firstPhaseOfProtocol: (protocol: string, phase: Command) => `next: open ${protocol}'s first phase before any task ${FIRST_PHASE_POINTER}: ${phase}`,
  firstPhaseNoProtocol: (phase: Command) =>
    `next: no protocol, so the workers take tasks on call with no phases; if the approved proposal names a protocol, open its first phase before any task ${FIRST_PHASE_POINTER}: ${phase}`,
} as const;

/** The first `phase`'s answer: confirm the next phase, the fixed opt-ins weighed first, ending on the confirming call;
 *  two steps by the answer alone, no state between them, as `close`. */
export const phaseStep = (name: string, confirm: string): string => PHASES_WORDING.phaseConfirmStep(name, PHASES_WORDING.phaseOptIns, confirm);

/** A phase's kind: the word its name opens with, lowercased (`verify-38`, `verify1`, `build-desk`); null when the name
 *  opens on no letter, which the phase verb refuses. Any word is a kind: the list is never fixed. */
export const phaseKind = (name: string): string | null => /^[a-z]+/i.exec(name)?.[0].toLowerCase() ?? null;
/** The reminder at a phase's open that a loop may be circling: the opening phase's kind at its 3rd, 6th, 9th… pass
 *  since the run's last reflect; null otherwise, and for a reflect itself. */
export const circlingLine = (earlier: readonly string[], name: string): string | null => {
  const kind = phaseKind(name);
  if (!kind || kind === "reflect") return null;
  const kinds = earlier.map(phaseKind);
  const passes = kinds.slice(kinds.lastIndexOf("reflect") + 1).filter((k) => k === kind).length + 1;
  return passes % 3 === 0 ? PHASES_WORDING.circling(kind, passes) : null;
};

/** `--protocol none`: a run phaseless on purpose. */
const PHASELESS = "none";
/** idea 3: the orchestrator's step after `open` of a task or plan run: open the protocol's first phase before any task,
 *  or, with none, why there are no phases; null for a kind that opens on its phases already (a brainswarm). */
export const firstPhaseLine = (kind: string, protocol: string | null, cli: string, as: string): string | null => {
  if (kind !== "task" && kind !== "plan") return null;
  // --protocol none: phaseless on purpose, so no reminder (the person's addition to idea 3)
  if (protocol === PHASELESS) return PHASES_WORDING.firstPhasePhaseless;
  const phase = PHASES_WORDING.phaseCommand(cli, as);
  return protocol ? PHASES_WORDING.firstPhaseOfProtocol(protocol, phase) : PHASES_WORDING.firstPhaseNoProtocol(phase);
};
