/** board-split D55: `stalled` as a pure function of the board's facts and the time, and the one reason formatter
 *  every badge's text goes through. The caller (memberView) gathers the facts; nothing here reads the store. */

export type StallRule = "owing" | "silent" | "call" | "lock";

/** The facts `stalledOf` reads, ms epoch throughout. */
export type StallFacts = {
  /** The member's shown state word (working, waiting, busy, merging…): the reason opens on it. */
  shownState: string;
  /** The open phase it owes, null when it owes none (done, not for it, the orchestrator, no phase); with no phase open,
   *  the task it owes a report on (`task #<seq>`, `owesReport`). */
  owes: string | null;
  /** board-split D64: `owes` names a task delivered with no phase open, owed a report to the orchestrator (or a merge). */
  owesReport?: boolean;
  /** When its latest task was delivered to it (D54's gate); null: none delivered, it owes nothing yet. */
  taskDeliveredAt: number | null;
  /** The newest of the phase's opening and the run's resume: no clock runs before either. */
  clockFloorAt: number;
  /** In a board wait the server holds as its open call, not a lock wait (the lock rule tells that). */
  inHeldWait: boolean;
  /** board-split D55 (amended, U-F22): when its current waiting spell began (`nextWaitSpell`); null out of one. */
  waitSpellSince: number | null;
  /** Its open tool call (not the board wait), or null. */
  openCallSince: number | null;
  /** Its background task, or null; `grewAt`: its output last moved. */
  background: { since: number; grewAt: number | null } | null;
  /** Its transcript last grew, or null. */
  transcriptGrewAt: number | null;
  /** The newest sign of it on the board (board call, heartbeat, growth, seating). */
  signAt: number;
  stallMs: number;
  silentMs: number;
  busyMaxMs: number;
  /** The pack's own stall (the merge lock held past LOCK_HELD_MS), owing or not; null with none. */
  lockStall: { fact: string; since: number } | null;
};

export type Stall = { rule: StallRule; since: number; fact: string };

/** board-split D55: stalled ⇔ the lock held too long, owing or not; else owing the open phase with its task delivered
 *  and one of: a held wait past the stall window with no background task of its own open, a call or background task with no growth past the busy bound, or
 *  out of any wait with nothing open and no sign for the silent time. Lost, parked and ended are the caller's. */
export function stalledOf(f: StallFacts, t: number): Stall | null {
  if (f.lockStall) return { rule: "lock", since: f.lockStall.since, fact: f.lockStall.fact };
  if (f.owes == null || f.taskDeliveredAt == null) return null;
  const floor = Math.max(f.clockFloorAt, f.taskDeliveredAt);
  // board-split D64: a no-phase task owes its report, a phase its done
  const owed = f.owesReport ? `${f.owes} delivered, no report` : `not done ${f.owes}`;
  // board-split D55 amended (O-F3, D31): a background task of its own still open makes it busy, never held-wait
  // stalled; that task's hang is the busy bound's below
  if (f.inHeldWait && f.background == null) {
    // board-split D55 amended (U-F22): from the later of the floor and the waiting spell's start; the work before
    // the spell never counts as waiting, and a re-armed wait keeps its spell
    const from = Math.max(floor, f.waitSpellSince ?? floor);
    return t - from >= f.stallMs ? { rule: "owing", since: from, fact: `${owed}, in a wait` } : null;
  }
  const opened = f.openCallSince ?? f.background?.since ?? null;
  if (opened != null) {
    const grewAt = Math.max(floor, opened, f.transcriptGrewAt ?? 0, f.background?.grewAt ?? 0);
    const what = f.openCallSince != null ? "a call open" : "a background task";
    return t - grewAt >= f.busyMaxMs ? { rule: "call", since: grewAt, fact: `${owed}, ${what}, no growth` } : null;
  }
  const sign = Math.max(floor, f.signAt, f.transcriptGrewAt ?? 0);
  return t - sign >= f.silentMs ? { rule: "silent", since: sign, fact: `${owed}, no activity` } : null;
}

/** board-split D55 (amended): out of any wait this long breaks a waiting spell; a re-arm, out for a second, keeps it. */
export const WAIT_SPELL_BREAK_MS = 10_000;

/** A member's waiting spell: `since` its first wait opened, `inAt` the last time it was seen in a wait. */
export type WaitSpell = { since: number; inAt: number };

/** board-split D55 (amended): the waiting spell after a look at time `t`. In a wait (`waitOpenedAt` the held wait's
 *  start): the spell goes on unless it was out of any wait for WAIT_SPELL_BREAK_MS, else a new one starts at that
 *  wait's opening. Out of a wait: the spell is kept for its break test, null when there was none. */
export function nextWaitSpell(prev: WaitSpell | null, waitOpenedAt: number | null, t: number): WaitSpell | null {
  if (waitOpenedAt == null) return prev;
  const goesOn = prev != null && Math.min(t, waitOpenedAt) - prev.inAt < WAIT_SPELL_BREAK_MS;
  return { since: goesOn ? prev!.since : waitOpenedAt, inAt: t };
}

/** The age as a reader reads it: seconds under two minutes, else minutes. */
export function ageText(ageMs: number): string {
  const s = Math.max(0, Math.round(ageMs / 1000));
  return s < 120 ? `${s} s` : `${Math.round(s / 60)} min`;
}

/** board-split D55: the one badge reason: the member's shown state word, then the fact that fired it, with its age. */
export function reasonOf(state: string, fact: string, ageMs: number): string {
  return `${state}, ${fact} ${ageText(ageMs)}`;
}
