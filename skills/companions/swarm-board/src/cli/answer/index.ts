// The answer module (board-rework D1): a verb of the wait cluster (wait, deliver, read, thread, done, join) hands what it
// did as a VerbResult, with the member's situation read once (readSituation); `answer` returns the lines it prints, its
// next step and its JSON. No verb of the cluster writes a next-step line or a command itself: the wording is WORDING's,
// the choice the rules'.
import type { Situation } from "./situation.ts";
import { heardStep, joinStep, nextStep, owedLine, phaseHeaders, pausedLine, waitCommand } from "./rules.ts";
import { WORDING as W } from "./wording.ts";

export { readSituation, type Situation } from "./situation.ts";
export { closedLine, eventStep, heardStep, listenNow, nextStep, owedLine, pausedLine, phaseHeaders, waitCommand } from "./rules.ts";
export { shellWord, WORDING } from "./wording.ts";
export { CODE_WORDING } from "./code-wording.ts";
export { coreUsage, hiddenUsage, statsUsage } from "./usage.ts";

/** A message already formatted by the verb, with the line its event registry row adds (D36). */
export type Shown = { text: string; next?: string | null };

export type VerbResult =
  | { verb: "wait"; outcome: "superseded" }
  | { verb: "wait"; outcome: "ended" }
  /** nothing came: `idle` when the board says the member has nothing to do; `again` the command re-arming this very wait */
  | { verb: "wait"; outcome: "empty"; idle: boolean; again: string; foregroundAgain: string }
  /** a wake: `phaseEvent` when the phase's own event is among what woke it */
  | { verb: "wait"; outcome: "woke"; again: string; foregroundAgain: string; phaseEvent: boolean; mentionsOnly: boolean; shown: Shown[]; lines: string[] }
  | { verb: "deliver"; mentionsOnly: boolean; shown: Shown[]; lines: string[] }
  | { verb: "read"; shown: Shown; member: boolean }
  | { verb: "thread"; phase: string | null; shown: Shown[] }
  | { verb: "done"; phase: string; none: true }
  | { verb: "done"; phase: string; none?: false; line: string }
  /** a verb that heard from the member (post, agree, endorse, claim, release, doing, subscribe): its result lines */
  | { verb: "heard"; lines: string[] }
  /** join's own lines, before its phase: who, roster; after it: worktree, commands, drawing, link. `shown`: the unread
   *  posts for the member, delivered at its join (S1), the phase's own event left out: the phase line states it */
  | { verb: "join"; head: string[]; shown: Shown[]; tail: string[] };

export type Answer = {
  /** the lines printed, in order */
  lines: string[];
  /** the member's next step, as --json carries it */
  next: string | null;
  /** the phase header, whole, as --json carries it */
  phase: string | null;
};

const shownLines = (shown: Shown[]): string[] => shown.flatMap((m) => (m.next ? [m.text, m.next] : [m.text]));

/** The answer of a cluster verb, from what it did and the member's situation. */
export function answer(r: VerbResult, s: Situation): Answer {
  switch (r.verb) {
    case "wait": {
      if (r.outcome === "superseded") return { lines: [W.superseded], next: null, phase: null };
      if (r.outcome === "ended") return { lines: [W.ended(s.run)], next: null, phase: null };
      if (r.outcome === "empty") {
        const next = r.idle
          ? W.idle(r.foregroundAgain)
          : (pausedLine(s) ?? (s.seat === "orchestrator" ? W.nothingYetOrchestrator(r.again) : W.nothingYet(r.foregroundAgain)));
        return { lines: [next], next, phase: null };
      }
      const headers = phaseHeaders(s, !pausedLine(s));
      // G7: the phase's own event in this wake carries its text and its done line; no owed line besides it.
      // G10: a wake in a phase the member was already shown repeats nothing of it (one fact, once per member)
      const owes = (r.phaseEvent && !s.wholeThread) || !headers.first ? null : owedLine(s, { brief: true });
      const paused = pausedLine(s);
      const rearm = paused
        ? paused
        : s.listens === "foreground"
          ? owes
            ? W.rearmAfterOwed(owes, r.foregroundAgain)
            : W.rearmForeground(r.foregroundAgain)
          : s.listens === "orchestrator"
            ? W.rearmOrchestrator(r.again)
            : W.rearmBackground(r.foregroundAgain);
      // G10: the re-arm line first, then the owed step
      const next = owes && !paused && s.listens !== "foreground" ? `${rearm}\n${owes}` : rearm;
      // G7: the phase heads the wake once, when new since the member's last read, and never beside its own event
      const phase = headers.first && !r.phaseEvent ? headers.printed : null;
      const lines = [
        ...(s.listens === "foreground" && phase ? [phase] : []),
        next,
        ...(s.listens !== "foreground" && phase ? [phase] : []),
        ...shownLines(r.shown),
        ...r.lines,
        ...(r.mentionsOnly ? [W.delivered] : []),
      ];
      return { lines, next, phase: headers.full };
    }
    case "deliver": {
      const any = r.shown.length > 0 || r.lines.length > 0;
      const headers = any ? phaseHeaders(s) : { printed: null, full: null };
      // a member owing the open phase is told to do it, last
      const owes = r.mentionsOnly ? null : owedLine(s);
      return { lines: [...(headers.printed ? [headers.printed] : []), ...shownLines(r.shown), ...r.lines, ...(owes ? [owes] : [])], next: owes, phase: headers.full };
    }
    case "read": {
      const headers = phaseHeaders(s);
      const owes = r.member ? owedLine(s) : null;
      // V10: the result first (the post), then its phase, then the owed step
      return { lines: [r.shown.text, ...(headers.printed ? [headers.printed] : []), ...(owes ? [owes] : [])], next: owes, phase: headers.full };
    }
    case "thread": {
      const headers = phaseHeaders(s);
      // G33: the header above states the phase; the owed step alone, brief, its text not again
      const owes = owedLine(s, { thread: false, brief: !!headers.printed });
      const none = r.shown.length ? [] : [W.noPostYet(r.phase ?? s.phase?.name ?? "-")];
      return { lines: [...(headers.printed ? [headers.printed] : []), ...none, ...shownLines(r.shown), ...(owes ? [owes] : [])], next: owes, phase: headers.full };
    }
    case "done": {
      if (r.none) return { lines: [W.doneNone], next: null, phase: null };
      const next = W.doneWaitNext(waitCommand(s, true));
      return { lines: [r.line, next], next, phase: null };
    }
    case "heard": {
      // D9: the result first, then the member's step: none while its listener runs
      const next = heardStep(s);
      return { lines: [...r.lines, ...(next ? [next] : [])], next, phase: null };
    }
    case "join": {
      const headers = phaseHeaders(s);
      const next = joinStep(s, r.shown.length > 0);
      // G32: a member owing the phase reads its text once, on the owed line; the header only when it owes nothing
      const header = headers.printed && !(s.owed && !pausedLine(s)) ? [headers.printed] : [];
      // S1: the result first (the posts waiting for the member), then its steps
      return { lines: [...r.head, ...header, ...shownLines(r.shown), ...r.tail, next], next, phase: headers.full };
    }
  }
}

