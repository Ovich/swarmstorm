// The answer rules (board-rework D1, D2): pure functions over the member's situation choosing the lines of WORDING it
// reads. No board read, no printing: the same situation always gives the same lines.
import type { Message, Participant } from "../../board/board.ts";
import { type EventName, eventOf, FOREGROUND_WAIT_MS } from "../../board/events.ts";
import { profileOf } from "../../board/kinds.ts";
import { codeEventStep } from "./code-rules.ts";
import type { Situation } from "./situation.ts";
import { shellWord, WORDING as W } from "./wording.ts";

/** The member's wait command: a background listener holds until something comes, a foreground wait carries its hold. */
export const waitCommand = (s: Situation, foreground = false): string => W.wait(s.cli, s.as, foreground ? FOREGROUND_WAIT_MS : undefined);

/** The member's one step while its run is paused; null when not paused, for the orchestrator and an ended member. */
export const pausedLine = (s: Situation): string | null => {
  if (s.seat === "orchestrator" || s.ended || !s.pause) return null;
  // board-split V-36 (D71): a step the member's pack gives it in this pause comes first
  if (s.pauseStep) return s.pauseStep;
  return W.paused(s.run, W.pauseWhy(s.pause.person, s.pause.text), waitCommand(s, true));
};

/** The orchestrator's reminder that its run is paused; null when not paused, for a member and an ended orchestrator. */
export const stillPausedLine = (s: Situation): string | null =>
  s.seat !== "orchestrator" || s.ended || !s.pause ? null : W.stillPaused(s.run, W.pauseWhy(s.pause.person, s.pause.text), s.cli, s.as);

/** The step a member owing the open phase takes before any wait; the paused line instead in a pause; null when it owes none.
 *  `brief`: the answer shows the phase, or showed it before, so the step alone. */
export const owedLine = (s: Situation, opts: { brief?: boolean } = {}): string | null => {
  const paused = pausedLine(s);
  if (paused) return paused;
  if (!s.owed) return null;
  const done = W.done(s.cli, s.owed.word, s.as);
  return opts.brief ? W.owedBrief(s.owed.name, done) : W.owedOpen(s.owed.name, s.owed.text, done);
};

/** simple-states: the step of a member that owes nothing (task merged and reported, phase done): end its turn; the
 *  pause first; null while it owes, and for the orchestrator. */
export const owesNothingLine = (s: Situation): string | null => pausedLine(s) ?? (s.owesNothing && s.seat !== "orchestrator" ? W.owesNothingEndTurn : null);

/** simple-states: what the orchestrator's post tells it of a member it mentions whose link is down, by its board state. */
export const unreachedMentionLines = (targets: { name: string; state: string }[]): string[] =>
  targets.flatMap((t) => (t.state === "away" ? [W.postToAway(t.name)] : t.state === "lost" ? [W.postToLost(t.name)] : []));

/** The line that starts the member's listener: a seat waits in the foreground, a worker and the orchestrator listen in the
 *  background. `afterPhase`: it follows the owed line, so a seat waits only once its part is in. */
export const listenNow = (s: Situation, afterPhase = false): string =>
  s.listens === "foreground" ? W.waitNow(afterPhase, waitCommand(s, true)) : W.listenerStart(waitCommand(s));

/** Where a member would be told to listen: the pause first, then the owed phase, then the listener. `brief`: the owed
 *  phase by its name alone, its text not again (S21). */
export const nextStep = (s: Situation, brief = false): string => {
  const paused = pausedLine(s);
  if (paused) return paused;
  const owed = owedLine(s, { brief });
  return owed ? `${owed}\n${listenNow(s, true)}` : listenNow(s);
};

/** Where a joining member is told to listen: a worker with nothing owed and no post shown at its join is idle, so it
 *  waits in the foreground for its task (S15); a working one starts its background listener. */
export const joinStep = (s: Situation, showedPosts: boolean): string => {
  const idleWorker = s.listens === "background" && !showedPosts && !s.owed && !s.pause;
  return idleWorker ? W.nothingYet(waitCommand(s, true)) : nextStep(s);
};

/** What a verb that heard from the member ends on: nothing for an ended member or one whose listener runs; a seat is told
 *  only the pause or its owed phase; a background listener is told to start. */
export const heardStep = (s: Situation): string | null => {
  if (s.ended || s.listenerRunning) return null;
  // S21, board-split F8: the owed phase is news once, at the wake or join that showed it; a verb that heard from a
  // working member only asks for its listener
  if (s.listens !== "foreground") return pausedLine(s) ?? listenNow(s);
  return pausedLine(s) ?? owedLine(s, { brief: true });
};

/** The phase header: whole the first time a member is shown it, then the short form naming where its text is;
 *  the pause beside it. `printed` for the human answer, `full` always whole, for --json. */
export const phaseHeaders = (s: Situation, showPause = true): { printed: string | null; full: string | null; first: boolean } => {
  const whole = s.phase ? W.phaseWhole(s.phase.name, s.phase.text) : null;
  const short = s.phase && s.phaseFirst === false ? W.phaseShort(s.phase.name, W.status(s.cli)) : whole;
  const first = s.phaseFirst !== false;
  if (!s.pause || !showPause) return { printed: short, full: whole, first };
  const why = W.pauseWhy(s.pause.person, s.pause.text);
  return { printed: W.phasePaused(short, why), full: W.phasePaused(whole, why), first };
};

/** The one line a member of a closed run reads from every member verb. */
/** break-flow V-47: the orchestrator's post that mentions a lost member is recorded, and says so with the move, as
 *  `phase` does (V-35). `lost`: the mentioned members whose badge reads lost, `<group>/<seat>`. */
export const lostMentionLines = (lost: string[], cli: string, as: string): string[] =>
  lost.map((member) => W.mentionLost(member, W.lostMove(cli, shellWord(member.slice(member.lastIndexOf("/") + 1)), as)));

export const closedLine = (s: Situation): string => W.closed(s.run, W.end(s.cli, s.as));

/** break-flow D61: the line every member verb answers before anything of its own, core and code pack alike: the run
 *  closed, or the member ended (`listener`: a wait, told it stops); null when neither, and the verb runs. */
export const gateLine = (s: Situation, listener = false): string | null => {
  if (s.closed) return closedLine(s);
  if (!s.ended || s.seat === "orchestrator") return null;
  return listener ? W.ended(s.run) : W.endedMember(s.run);
};

/** The line under an event, for the member `me` it reached; null when the event asks nothing of it (D36, D59). The board
 *  posts the fact (the event, its meta, its mentions); which line its reader runs next is chosen here. */
export function eventStep(m: Message, me: Participant, cli: string, event: EventName | null = eventOf(m)): string | null {
  const as = shellWord(me.name);
  const orchestrator = me.seat === "orchestrator";
  const own = m.from === me.name;
  const meta = m.meta ?? null;
  switch (event) {
    case "agreement":
      // G34: endorsing is a seat's (the skeptic's); the orchestrator is never told to back an agreement
      return profileOf(me.kind).member === "seat" && !orchestrator && !own ? W.backIt(cli, m.seq, as) : null;
    case "phase": {
      const name = meta && "phase" in meta ? meta.phase : null;
      if (!name || orchestrator || own) return null;
      return W.phaseDoneWhen(name, W.done(cli, shellWord(name), as));
    }
    case "pause": {
      if (orchestrator || own) return null;
      // idea 2 (B12): a pause waiting on the person says so, as the paused line does
      const pause = meta && "person" in meta ? meta : null;
      return W.pauseStop(pause?.person ? pause.text : null, W.wait(cli, as, FOREGROUND_WAIT_MS));
    }
    case "resume":
      return orchestrator || own ? null : W.resumeGoOn;
    case "all-done":
      return orchestrator ? W.openNextPhase(cli, as, m.run) : null;
    case "stopped":
      return orchestrator ? W.swarmStopped(cli, as) : null;
    case "all-joined":
      if (!orchestrator) return null;
      return meta && "tasked" in meta && meta.tasked ? W.allJoinedTasked(cli, as) : W.allJoined(cli, as);
    case "breach": {
      const member = meta && "breach" in meta ? meta.breach : null;
      if (!member || !orchestrator) return null;
      // G2: the orchestrator's own kill is its own to correct, never a message to itself
      return member === me.name ? W.breachOwn : W.breachOther(member);
    }
    case "lost": {
      // the body names the member: `lost <group>/<seat>: <why>`
      const seat = /^lost [^/\s]+\/([^:\s]+):/.exec(m.body)?.[1];
      return orchestrator ? W.lostMove(cli, shellWord(seat ?? "<seat>"), as) : null;
    }
    default:
      return codeEventStep(m, me, cli, event) ?? null;
  }
}

