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

/** What the rule reads of an open run. */
export type AuthorityRun = { id: number; repo: string; group: string; authority?: readonly string[] };

const decisionRoles = (r: AuthorityRun): string[] => (r.authority ?? []).filter((role) => DECISION_AUTHORITY_ROLES.has(role));

/** The decisions-run line of each project where two or more open runs hold a decision-authority role; `only`: the line of
 *  that run's project alone, and only when the run itself holds one (the answer to its `open`). */
export function decisionsLines(runs: readonly AuthorityRun[], cli: Command, only?: number): string[] {
  const byRepo = new Map<string, AuthorityRun[]>();
  for (const r of runs) byRepo.set(r.repo, [...(byRepo.get(r.repo) ?? []), r]);
  const lines: string[] = [];
  for (const repoRuns of byRepo.values()) {
    const holders = repoRuns.filter((r) => r.group !== DECISIONS_GROUP && decisionRoles(r).length > 0);
    if (holders.length < 2) continue;
    if (only !== undefined && !holders.some((r) => r.id === only)) continue;
    const named = holders.map((r) => ({ run: r.id, group: r.group, roles: decisionRoles(r) }));
    const open = repoRuns.find((r) => r.group === DECISIONS_GROUP);
    lines.push(
      open
        ? W.decisionsRunOpen(named, open.id, W.decisionsSeatAdd(cli, open.id))
        : W.decisionsRunNeeded(named, W.decisionsOpen(cli, shellWord("Decisions"))),
    );
  }
  return lines;
}
