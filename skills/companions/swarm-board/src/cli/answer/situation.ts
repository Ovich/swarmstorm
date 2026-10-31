// The member's situation, read from the board once per verb (board-rework D1): everything the answer rules decide on.
// The rules (rules.ts) are pure functions over it; nothing else reads the board for an answer line.
import type { Participant } from "../../board/board.ts";
import { profileOf } from "../../board/kinds.ts";
import type { ConnectedBoard } from "../../client/remote.ts";

export type Listening = "foreground" | "background" | "orchestrator";

export type Situation = {
  /** this CLI as the member calls it, home included, as one command prefix */
  cli: string;
  /** the member's name as a shell word */
  as: string;
  run: number;
  seat: string;
  ended: boolean;
  /** parked by the orchestrator (D30, D60): every own call answers parked first */
  parked: boolean;
  /** a background listener of the member's is running (the link's report, D4) */
  listenerRunning: boolean;
  /** how the member listens: a seat in the foreground, a worker and the orchestrator in the background */
  listens: Listening;
  /** a run whose members read the phase's whole thread before their part */
  wholeThread: boolean;
  /** the run is gone from the open runs */
  closed: boolean;
  pause: { text: string; person: boolean } | null;
  /** board-split V-36 (D71): the member's own step in this pause, given by its pack's answer rules; absent: the core's */
  pauseStep?: string | null;
  /** the run's current phase */
  phase: { name: string; text: string } | null;
  /** the phase the member owes its done, null when none */
  owed: { name: string; text: string; word: string } | null;
  /** this verb showed the member its phase, and it was the first time in that phase; null when the verb shows none */
  phaseFirst: boolean | null;
  /** simple-states: a member (never the orchestrator) owing no phase */
  owesNothing: boolean;
};

/** Reads the member's situation. `show`: the verb shows the phase to the member (wait, deliver, read), which the board
 *  records, so a later answer in the same phase is told it was shown. */
export async function readSituation(board: ConnectedBoard, me: Participant, opts: { cli: string; word: (w: string) => string; show?: boolean }): Promise<Situation> {
  const runs = await board.runs();
  const run = runs.find((r) => r.id === me.run);
  const shown = opts.show ? await board.showPhase(me) : null;
  const phase = shown ? shown.phase : await board.currentPhase(me.run);
  const owed = run ? await board.owedPhase(me) : null;
  const profile = profileOf(me.kind);
  return {
    cli: opts.cli,
    as: opts.word(me.name),
    run: me.run,
    seat: me.seat,
    ended: !!me.ended,
    parked: !!me.parked,
    listenerRunning: !!me.listening,
    listens: me.seat === "orchestrator" ? "orchestrator" : profile.member === "worker" ? "background" : "foreground",
    wholeThread: !!profile.wholeThread,
    closed: !run,
    pause: run && run.paused != null ? { text: run.paused, person: !!run.pausedPerson } : null,
    phase: phase ? { name: phase.name, text: phase.text } : null,
    owed: owed ? { name: owed.name, text: owed.text, word: opts.word(owed.name) } : null,
    phaseFirst: shown ? shown.first : null,
    owesNothing: owed == null,
  };
}
