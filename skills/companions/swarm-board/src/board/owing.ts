// board-split D62: the one answer to "who owes this phase", read by done, roster, status, all-done and the card.
// A member owes a phase when the phase is for its seat (`phase --for`), it is not parked and not ended (an idle-ended
// seat, or one --for names, still owes). A lost member that owes it is out of the count (D41) and named beside it.

/** A member of the run as the count reads it: its facts on the board, nothing derived. */
export type PhaseMember = { member: string; seat: string; done: boolean; ended: boolean; idleEnded: boolean; parked: boolean; lost: boolean };
/** The phase counted: whether it is the run's open phase, and the seats its `--for` names (null: every seat). */
export type PhaseScope = { open: boolean; forSeats: string[] | null };
/** The phase's done count: members done of the members owing it, the lost named out of it, the idle-ended named,
 *  the parked (for its seats, not ended) named out of it (D70, V-34). */
export type PhaseProgress = { phase: string; done: number; of: number; gone: string[]; idleEnded: string[]; parked: string[] };

/** False for a seat the open phase is not for; an earlier phase's --for is gone, so every seat counts there. */
export const phaseIsForSeat = (scope: PhaseScope, seat: string): boolean => !scope.open || scope.forSeats == null || scope.forSeats.includes(seat);

/** True when `m` is in the phase's count: for its seat, not parked, and present (not ended, unless idle-ended, named by
 *  --for, or done before it ended). */
const inCount = (m: PhaseMember, scope: PhaseScope): boolean => {
  if (!phaseIsForSeat(scope, m.seat) || m.parked) return false;
  const namedByFor = scope.open && scope.forSeats != null;
  return m.done || !m.ended || m.idleEnded || namedByFor;
};

/** True when `m` still owes the phase: in its count and not done. */
export const owesPhase = (m: PhaseMember, scope: PhaseScope): boolean => inCount(m, scope) && !m.done;

/** The one done count of `phase` over `members` (the orchestrator left out by the caller). */
export const phaseCount = (phase: string, members: PhaseMember[], scope: PhaseScope): PhaseProgress => {
  const counted = members.filter((m) => inCount(m, scope));
  const lost = counted.filter((m) => !m.done && !m.ended && m.lost);
  const owing = counted.filter((m) => !lost.includes(m));
  return {
    phase,
    done: owing.filter((m) => m.done).length,
    of: owing.length,
    gone: lost.map((m) => m.member),
    idleEnded: owing.filter((m) => !m.done && m.ended).map((m) => m.member),
    parked: members.filter((m) => m.parked && !m.ended && phaseIsForSeat(scope, m.seat)).map((m) => m.member),
  };
};

/** True when every member owing the phase is done (at least one owes it). */
export const everyOwingDone = (p: PhaseProgress): boolean => p.of > 0 && p.done === p.of;

/** Members as their seats, short: `w2, w3`. */
const seatsOf = (members: string[]): string => members.map((m) => m.slice(m.lastIndexOf("/") + 1)).join(", ");

/** The count as every line prints it: `3/3 done`, `, 1 lost: w2` and `, 1 parked: w3` naming each member left out of it
 *  (D41, D62, D70). */
export const progressText = (p: PhaseProgress): string =>
  `${p.done}/${p.of} done${p.gone.length ? `, ${p.gone.length} lost: ${seatsOf(p.gone)}` : ""}${p.parked?.length ? `, ${p.parked.length} parked: ${seatsOf(p.parked)}` : ""}`;
