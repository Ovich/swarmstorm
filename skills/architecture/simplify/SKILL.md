---
name: simplify
description: "Use when code is to be cut back to fewer lines, behaviour unchanged: a codebase grown by accretion (superseded paths, unused exports and files, two implementations of one concern), a path the current work just replaced and left behind, the person asking to simplify the code, where the dead code is, to clean up the repo or to stop it coming back, or a run's simplify phase. Produces a ranked audit of families, each approved family or known path removed by its own narrow pass with net lines negative, duplicates consolidated behind characterization tests, and the guard. Not for branching complexity (complexity-rework) or an interface's shape (deepen-module)."
---

# Simplify

**Detection is deterministic, deletion is narrow.** An agent asked to explore for dead code spends the budget rebuilding context and finds a different set each time. Tools find, the person chooses, and each removal is a fresh pass handed a file list, never a mandate to look around.

## The phases

One artefact each, and a stop.

| Phase | Produces | Stops for | Read |
|---|---|---|---|
| 1 Audit | the report: families ranked by lines saved over risk, each with its evidence and its kind (dead, superseded, duplicate) | the person's choice of families and their order | `references/audit.md` |
| 2 Remove | one approved dead or superseded family, or one path the work already knows, removed | the stops of `references/path.md` | `references/path.md` |
| 3 Consolidate | one duplicate family: the comparison, the survivor, the loser deleted | the person's yes on the survivor | `references/consolidate.md` |
| 4 Guard | a check that fails on new dead code, and the done-rule for the work that creates it | the person's yes on each | `references/guard.md` |

## Where to start

| The ask | Phases |
|---|---|
| where is the dead code, audit, what can go | 1, then stop |
| clean up, an approved audit | 2 or 3 per family, in the approved order |
| a commit range (`<base>..<head>`): what a piece of work changed | 1 scoped to the range's files and what they reach; its diff and commit messages name what each change superseded, so no one's memory is needed |
| the work just replaced a path and knows the old one | 2 on it, no audit: the work in hand is the context |
| as a phase of a run | 1 as one task, then one task per approved family |
| stop this coming back | 4 |

## Rules

- **A family is one pass.** Its file list, its pinning tests and its line budget go into the brief, the shape of `references/path.md`. Two families in one pass make a diff no reviewer can attribute.
- **Mechanical removals run on a cheaper model, consolidations on a strong one.** The survivor choice is judgment, the deletion after it is not.
- **Families that touch no common file run in parallel**, each in its own worktree. Families that share a file run in order.
- **Add no dependency without the person's yes**: not an analyzer, not a CI step.
- **Report net lines per family** with `scripts/net-lines.mjs`. A family that did not go negative is not done.
- **The phase ends on a summary**, short and scannable: one row per family (what went, why, its commit, lines added and deleted), then the total, and what was left and why.
- **The audit is the context.** Run without it, a removal pass rebuilds by exploration what the audit already found. With no audit and no known path, phase 1 runs first.

## Red flags

| Thought | Reality |
|---|---|
| "I'll grep around and see what looks unused" | That is the exploration the audit replaces. Run the tools, read their list. |
| "Unused per the tool, so delete it" | Loads by string, public API, entry points found by convention and scripts read as unused. The audit marks each family's reach before it is proposed. |
| "While removing this I'll simplify the survivor" | A second change in the same diff. Note it as its own family. |
| "Both implementations are fine, keep both" | Two copies of one concern drift. Choose, or record why each is a different concern. |
