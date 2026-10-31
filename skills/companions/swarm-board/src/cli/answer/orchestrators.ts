// The orchestrators board: one permanent run per project, group `orchestrators`, where every orchestrator registers,
// whatever roles it holds. The answers to `open` and `status` give each open run not yet seated there the command
// that registers it: the board's open when the project has none, else the seat's add and its join. Never closed.
import { shellWord, WORDING as W, type Command } from "./wording.ts";

/** The orchestrators board's group. */
export const ORCHESTRATORS_GROUP = "orchestrators";

/** What the rule reads of an open run: its seats, to tell which runs the board already seats. */
export type OrchestratorRun = { id: number; repo: string; group: string; authority?: readonly string[]; seats?: readonly { id: string }[] };

/** A seat of the orchestrators board: one per run, named for its group, its roles (if any) the seat's role. */
export type OrchestratorSeat = { id: string; role?: string; blockers: string[] };

/** Writes the orchestrators board's seats file for a project and returns its path (AGENTS rule 10: the printed command runs as printed). */
export type WriteOrchestratorSeats = (repo: string, seats: OrchestratorSeat[]) => string;

const seatOf = (r: OrchestratorRun): OrchestratorSeat => ({ id: r.group, ...(r.authority?.length ? { role: r.authority.join(",") } : {}), blockers: [] });

/** The registration line of each project with an open run not yet seated on its orchestrators board; `only`: that
 *  run's line alone (the answer to its `open`). */
export function orchestratorsLines(runs: readonly OrchestratorRun[], cli: Command, writeSeats: WriteOrchestratorSeats, only?: number): string[] {
  const byRepo = new Map<string, OrchestratorRun[]>();
  for (const r of runs) byRepo.set(r.repo, [...(byRepo.get(r.repo) ?? []), r]);
  const lines: string[] = [];
  for (const repoRuns of byRepo.values()) {
    const teams = repoRuns.filter((r) => r.group !== ORCHESTRATORS_GROUP && (only === undefined || r.id === only));
    if (teams.length === 0) continue;
    const board = repoRuns.find((r) => r.group === ORCHESTRATORS_GROUP);
    if (board) {
      const seated = new Set((board.seats ?? []).map((s) => s.id));
      const missing = teams.filter((t) => !seated.has(t.group));
      if (missing.length === 0) {
        if (only !== undefined) lines.push(W.orchestratorsRejoin(board.id, teams.map((t) => W.seatJoin(cli, board.id, ORCHESTRATORS_GROUP, shellWord("orchestrating"), shellWord(t.group)))));
        continue;
      }
      lines.push(
        W.orchestratorsRegister(
          board.id,
          missing.map((t) => {
            const seat = seatOf(t);
            return `${W.orchestratorsSeatAdd(cli, board.id, shellWord(seat.id), seat.role)} ; ${W.seatJoin(cli, board.id, ORCHESTRATORS_GROUP, shellWord("orchestrating"), shellWord(seat.id))}`;
          }),
        ),
      );
    } else {
      const seatsFile = writeSeats(repoRuns[0].repo, teams.map(seatOf));
      lines.push(W.orchestratorsNeeded(W.orchestratorsOpen(cli, shellWord("Orchestrators"), shellWord(seatsFile))));
    }
  }
  return lines;
}
