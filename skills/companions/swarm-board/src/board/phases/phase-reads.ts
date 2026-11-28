// Who owes a phase, read from the store (codebase-rework#D8): the members owing.ts counts, and the count itself.
import type { RunId } from "../../contract/board.ts";
import { EVENTS } from "../../contract/events.ts";
import { owesPhase, phaseCount, type PhaseMember, type PhaseProgress, type PhaseScope } from "./owing.ts";
import { ORCHESTRATOR, type Row, type Rows } from "../rows.ts";
import type { Store } from "../../store/store.ts";

export function makePhaseReads(store: Store, rows: Rows) {
  const { db } = store;
  const { runRow } = rows;
  /** board-split D62: the scope `phase` is counted in: the run's open phase carries its --for, an earlier one none. */
  const phaseScopeOf = (run: Row, phase: string): PhaseScope => {
    const open = run.phase === phase;
    return { open, forSeats: open && run.phase_for != null ? (JSON.parse(String(run.phase_for)) as string[]) : null };
  };
  const phaseOpenedSeqOf = (run: RunId): number => Number((db.prepare("SELECT MAX(seq) AS seq FROM messages WHERE run = ? AND event = ?").get(run, EVENTS.phase.name) as Row).seq ?? 0);
  /** The declared seats of `run` with no member yet that the orchestrator posted to (`@<seat>`) since `phase` opened,
   *  `phase` being the run's open one: each owes its done before it joins, so all-done waits for it. A declared seat
   *  with no task in the phase is left out, so an unused seat never holds a phase. */
  const taskedSeatsNotJoinedOf = (run: RunId, phase: string): PhaseMember[] => {
    const r = runRow(run);
    if (r.phase !== phase) return [];
    const plan = String(r.plan);
    return (
      db
        .prepare(
          `SELECT s.id AS seat FROM seats s
           WHERE s.run = ? AND s.id != ?
             AND NOT EXISTS (SELECT 1 FROM participants p WHERE p.run = s.run AND p.seat = s.id)
             AND EXISTS (
               SELECT 1 FROM messages m JOIN participants o ON o.id = m.author AND o.seat = ?, json_each(m.mentions) j
               WHERE m.run = s.run AND m.kind != 'event' AND j.value = ? || '/' || s.id AND m.seq > ?)
           ORDER BY s.ord`,
        )
        .all(run, ORCHESTRATOR, ORCHESTRATOR, plan, phaseOpenedSeqOf(run)) as Row[]
    ).map((s) => ({ member: `${plan}/${s.seat}`, seat: String(s.seat), done: false, ended: false, idleEnded: false, lost: false }));
  };
  /** board-split D62: the run's members (the orchestrator apart) as owing.ts counts them for `phase`, with the seats tasked in it that no member holds yet. */
  const phaseMembersOf = (run: RunId, phase: string): PhaseMember[] => [...joinedPhaseMembersOf(run, phase), ...taskedSeatsNotJoinedOf(run, phase)];
  /** The run's members that joined, as owing.ts counts them for `phase` (only participant `onlyId` when given). */
  const joinedPhaseMembersOf = (run: RunId, phase: string, onlyId?: number): PhaseMember[] =>
    (
      db
        .prepare(
          `SELECT (SELECT r.plan FROM runs r WHERE r.id = p.run) AS plan, p.seat, p.ended_at, p.idle_ended, EXISTS (SELECT 1 FROM phase_done d WHERE d.run = p.run AND d.participant = p.id AND d.phase = ?) AS done,
             EXISTS (SELECT 1 FROM badge_episodes e WHERE e.run = p.run AND e.member = p.seat AND e.badge = 'lost' AND e.opened_at IS NOT NULL AND e.closed_at IS NULL) AS lost
           FROM participants p WHERE p.run = ? AND p.seat != '${ORCHESTRATOR}' AND (? IS NULL OR p.id = ?) ORDER BY p.id`,
        )
        .all(phase, run, onlyId ?? null, onlyId ?? null) as Row[]
    ).map((r) => ({
      member: `${r.plan}/${r.seat}`,
      seat: String(r.seat),
      done: Number(r.done) === 1,
      ended: r.ended_at != null,
      idleEnded: Number(r.idle_ended) === 1,
      // D41: lost as the last tick told it
      lost: Number(r.lost) === 1,
    }));
  /** The phase `p` owes now (D62's one owing rule): the run's open phase, for its seat, not ended, not done;
   *  null for the orchestrator or none open. */
  const owedNameOf = (p: Row, run: Row): string | null => {
    if (String(p.seat) === ORCHESTRATOR || run.state !== "open" || run.phase == null) return null;
    const phase = String(run.phase);
    const [me] = joinedPhaseMembersOf(Number(run.id), phase, Number(p.id));
    return me && owesPhase(me, phaseScopeOf(run, phase)) ? phase : null;
  };
  /** The phase's done count (board-split D62): owing.ts's one count over the run's members. */
  const progressOf = (run: RunId, phase: string | null): PhaseProgress | null =>
    phase == null ? null : phaseCount(phase, phaseMembersOf(run, phase), phaseScopeOf(runRow(run), phase));
  return { phaseScopeOf, phaseOpenedSeqOf, phaseMembersOf, owedNameOf, progressOf };
}
export type PhaseReads = ReturnType<typeof makePhaseReads>;
