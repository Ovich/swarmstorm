// The decisions run (board-split#D28, D29): when two open runs on one project each hold a decision-authority role, the
// answers to `open` and `status` say so and give the command opening the decisions run (group `decisions`). Which roles
// are decision authority is data, this one table (D18), never a role compared in a verb.
import { shellWord, WORDING as W, type Command } from "./wording.ts";

/** The roles whose holders settle the project's common decisions together, as the orchestrate skill's
 *  `references/authority.md` lists them (the run-level roles, reviewer and moderator, stay out). */
export const DECISION_AUTHORITY_ROLES: ReadonlySet<string> = new Set([
  "product-owner",
  "product-designer",
  "ui-ux-designer",
  "architect",
  "editor",
  "tech-lead",
  "qa-lead",
  "devops",
  "security",
]);

/** The decisions run's group. */
export const DECISIONS_GROUP = "decisions";

/** What the rule reads of an open run: its seats, to tell which holders the decisions run already seats. */
export type AuthorityRun = { id: number; repo: string; group: string; authority?: readonly string[]; seats?: readonly { id: string }[] };

/** A seat of the decisions run: one per run holding decision authority, named for its group, its roles the seat's role. */
export type DecisionsSeat = { id: string; role: string; blockers: string[] };

/** Writes the decisions run's seats file for a project and returns its path (AGENTS rule 10: the printed command runs as printed). */
export type WriteDecisionsSeats = (repo: string, seats: DecisionsSeat[]) => string;

const decisionRoles = (r: AuthorityRun): string[] => (r.authority ?? []).filter((role) => DECISION_AUTHORITY_ROLES.has(role));

/** The decisions-run line of each project where two or more open runs hold a decision-authority role; `only`: the line of
 *  that run's project alone, and only when the run itself holds one (the answer to its `open`). */
export function decisionsLines(runs: readonly AuthorityRun[], cli: Command, writeSeats: WriteDecisionsSeats, only?: number): string[] {
  const byRepo = new Map<string, AuthorityRun[]>();
  for (const r of runs) byRepo.set(r.repo, [...(byRepo.get(r.repo) ?? []), r]);
  const lines: string[] = [];
  for (const repoRuns of byRepo.values()) {
    const holders = repoRuns.filter((r) => r.group !== DECISIONS_GROUP && decisionRoles(r).length > 0);
    if (holders.length < 2) continue;
    if (only !== undefined && !holders.some((r) => r.id === only)) continue;
    const named = holders.map((r) => ({ run: r.id, group: r.group, roles: decisionRoles(r) }));
    const open = repoRuns.find((r) => r.group === DECISIONS_GROUP);
    if (open) {
      // each holder not yet seated there, its own command filled in; an open names only its own run
      const seated = new Set((open.seats ?? []).map((s) => s.id));
      const missing = named.filter((h) => !seated.has(h.group) && (only === undefined || h.run === only));
      lines.push(W.decisionsRunOpen(named, open.id, missing.map((h) => W.decisionsSeatAdd(cli, open.id, shellWord(h.group), h.roles.join(",")))));
    } else {
      const seatsFile = writeSeats(repoRuns[0].repo, named.map((h) => ({ id: h.group, role: h.roles.join(","), blockers: [] })));
      lines.push(W.decisionsRunNeeded(named, W.decisionsOpen(cli, shellWord("Decisions"), shellWord(seatsFile))));
    }
  }
  return lines;
}
