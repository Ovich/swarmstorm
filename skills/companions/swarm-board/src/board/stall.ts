/** `stalled` as a pure function of the board's facts and the time, and the one reason formatter every badge's text
 *  goes through. The caller (memberView) gathers the facts; nothing here reads the store. */

/** The facts `stalledOf` reads, ms epoch throughout. */
export type StallFacts = {
  /** What it owes: the open phase's name, or `task #<seq>` owed a report with no phase open. */
  owes: string;
  /** `owes` names a task owed a report rather than a phase owed its done. */
  owesReport: boolean;
  /** The newest sign of progress: transcript growth, a board call, an open call's start, never before the task's
   *  delivery, the phase's opening or the run's resume. */
  progressAt: number;
  /** The run's stall window. */
  stallMs: number;
};

export type Stall = { since: number; fact: string };

/** simple-states: stalled ⇔ working (link up, owing work) with no sign of progress for the run's stall window. Its
 *  state is the caller's to check; lost, parked and ended never reach here. */
export function stalledOf(f: StallFacts, t: number): Stall | null {
  if (t - f.progressAt < f.stallMs) return null;
  return { since: f.progressAt, fact: `${f.owesReport ? `${f.owes} delivered, no report` : `not done ${f.owes}`}, no activity` };
}

/** The age as a reader reads it: seconds under two minutes, else minutes. */
export function ageText(ageMs: number): string {
  const s = Math.max(0, Math.round(ageMs / 1000));
  return s < 120 ? `${s} s` : `${Math.round(s / 60)} min`;
}

/** The one badge reason: the member's shown state word, then the fact that fired it, with its age. */
export function reasonOf(state: string, fact: string, ageMs: number): string {
  return `${state}, ${fact} ${ageText(ageMs)}`;
}
