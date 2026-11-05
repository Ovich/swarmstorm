---
name: simplify-code
description: "Use when a codebase has grown by accretion and is to be audited or cut back: superseded paths left behind by architecture shifts, unused exports and files, two implementations of one concern, or the person asks to simplify the code or cut its lines, where the dead code is, to clean up the repo, or to stop it coming back; also a run's simplify phase. Produces a ranked audit of families, each approved family removed by its own narrow pass, duplicates consolidated behind characterization tests, and the guard. Not for one superseded path the current work already knows (simplify-path), branching complexity (complexity-rework) or an interface's shape (deepen-module)."
---

# Simplify code

**Detection is deterministic, deletion is narrow.** An agent asked to explore for dead code spends the budget rebuilding context and finds a different set each time. Tools find, the person chooses, and each removal is a fresh pass handed a file list, never a mandate to look around.

## The phases

One artefact each, and a stop.

| Phase | Produces | Stops for | Read |
|---|---|---|---|
| 1 Audit | the report: families ranked by lines saved over risk, each with its evidence and its kind (dead, superseded, duplicate) | the person's choice of families and their order | `references/audit.md` |
| 2 Remove | one approved dead or superseded family removed, through the `simplify-path` skill | that skill's stops | |
| 3 Consolidate | one duplicate family: the comparison, the survivor, the loser deleted | the person's yes on the survivor | `references/consolidate.md` |
| 4 Guard | a check that fails on new dead code, and the done-rule for the work that creates it | the person's yes on each | `references/guard.md` |

## Where to start

| The ask | Phases |
|---|---|
| where is the dead code, audit, what can go | 1, then stop |
| clean up, an approved audit | 2 or 3 per family, in the approved order |
| as a phase of a run | 1 as one task, then one task per approved family |
| stop this coming back | 4 |

## Rules

- **A family is one pass.** Its file list, its pinning tests and its line budget go into the brief, the `simplify-path` skill's brief shape. Two families in one pass make a diff no reviewer can attribute.
- **Mechanical removals run on a cheaper model, consolidations on a strong one.** The survivor choice is judgment, the deletion after it is not.
- **Families that touch no common file run in parallel**, each in its own worktree. Families that share a file run in order.
- **Add no dependency without the person's yes**: not an analyzer, not a CI step.
- **Report net lines per family** with the `simplify-path` skill's `scripts/net-lines.mjs`. A family that did not go negative is not done.
- **The audit is the context.** Run without it, a removal pass rebuilds by exploration what the audit already found. With no audit, phase 1 runs first.

## Red flags

| Thought | Reality |
|---|---|
| "I'll grep around and see what looks unused" | That is the exploration the audit replaces. Run the tools, read their list. |
| "Unused per the tool, so delete it" | Loads by string, public API, entry points found by convention and scripts read as unused. The audit marks each family's reach before it is proposed. |
| "While removing this I'll simplify the survivor" | A second change in the same diff. Note it as its own family. |
| "Both implementations are fine, keep both" | Two copies of one concern drift. Choose, or record why each is a different concern. |
