// The answer rules (board-rework D1, D2): pure functions over the member's situation choosing the lines of WORDING it
// reads. No board read, no printing: the same situation always gives the same lines.
import { FOREGROUND_WAIT_MS } from "../../board/events.ts";
import type { Situation } from "./situation.ts";
import { WORDING as W } from "./wording.ts";

/** The member's wait command: a background listener holds until something comes, a foreground wait carries its hold. */
export const waitCommand = (s: Situation, foreground = false): string => W.wait(s.cli, s.as, foreground ? FOREGROUND_WAIT_MS : undefined);

/** The member's one step while its run is paused; null when not paused, for the orchestrator and an ended member. */
export const pausedLine = (s: Situation): string | null => {
  if (s.seat === "orchestrator" || s.ended || !s.pause) return null;
  return W.paused(s.run, W.pauseWhy(s.pause.person, s.pause.text), waitCommand(s, true));
};

/** The step a member owing the open phase takes before any wait; the paused line instead in a pause; null when it owes none.
 *  `brief`: the answer shows the phase, or showed it before, so the step alone. */
export const owedLine = (s: Situation, opts: { thread?: boolean; brief?: boolean } = {}): string | null => {
  const paused = pausedLine(s);
  if (paused) return paused;
  if (!s.owed) return null;
  const read = (opts.thread ?? true) && s.wholeThread ? W.readWholePhase(W.thread(s.cli, s.as)) : "";
  const done = W.done(s.cli, s.owed.word, s.as);
  return opts.brief ? W.owedBrief(s.owed.name, read, done) : W.owedOpen(s.owed.name, s.owed.text, read, done);
};

/** The line that starts the member's listener: a seat waits in the foreground, a worker and the orchestrator listen in the
 *  background. `afterPhase`: it follows the owed line, so a seat waits only once its part is in. */
export const listenNow = (s: Situation, afterPhase = false): string =>
  s.listens === "foreground" ? W.waitNow(afterPhase, waitCommand(s, true)) : W.listenerStart(waitCommand(s));

/** Where a member would be told to listen: the pause first, then the owed phase, then the listener. */
export const nextStep = (s: Situation): string => {
  const paused = pausedLine(s);
  if (paused) return paused;
  const owed = owedLine(s);
  return owed ? `${owed}\n${listenNow(s, true)}` : listenNow(s);
};

/** What a verb that heard from the member ends on: nothing for an ended member or one whose listener runs; a seat is told
 *  only the pause or its owed phase; a background listener is told to start. */
export const heardStep = (s: Situation): string | null => {
  if (s.ended || s.listenerRunning) return null;
  if (s.listens !== "foreground") return nextStep(s);
  return pausedLine(s) ?? owedLine(s);
};

/** The phase header: whole the first time a member is shown it, then the short form naming where its text is;
 *  the pause beside it. `printed` for the human answer, `full` always whole, for --json. */
export const phaseHeaders = (s: Situation, showPause = true): { printed: string | null; full: string | null; first: boolean } => {
  const whole = s.phase ? W.phaseWhole(s.phase.name, s.phase.text) : null;
  const short = s.phase && s.phaseFirst === false ? W.phaseShort(s.phase.name, W.thread(s.cli, s.as)) : whole;
  const first = s.phaseFirst !== false;
  if (!s.pause || !showPause) return { printed: short, full: whole, first };
  const why = W.pauseWhy(s.pause.person, s.pause.text);
  return { printed: W.phasePaused(short, why), full: W.phasePaused(whole, why), first };
};

/** The one line a member of a closed run reads from every member verb. */
export const closedLine = (s: Situation): string => W.closed(s.run, W.end(s.cli, s.as));
