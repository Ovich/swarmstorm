# The plan document

The tracker first, then two parts. **Design** is what gets built, and every task points into its
structure, in the one design format. **Execution** is for whoever runs the plan. A section that does not apply is left
out, and the header says which. A small change's section is a sentence.

```markdown
# <topic>, plan

> **Status**: draft | approved: <who>, <date>, in their words; defaults confirmed: <ids | all>
> **Delivers**: the increment, in one sentence, and what is accepted as proof of it
> **Hard rule**: what must not change, when there is one
> **Read against**: `<branch>` at `<sha>`; every `file:line` cited holds there
> **Libraries read from source**: `<package>` `<version>`, <date>
> **Left out**: the sections below that do not apply

## The tracker
The diagram, above everything else. Drawn when the phases are cut; until then the heading
holds one line saying so. Under it, the mandate in one line: `mandate: not asked yet` until
it is.

# Design

## 1. … ## 9.
The nine sections of the `orchestrate` skill's `references/design.md`, read before writing the
first: why and why not, before and after, the modules after (deep modules), the flows as
pseudo-code, state and its writers, failure modes, what ran, the decisions, the guides. The
status line names the `agent default` rows the person confirmed; `aiview plan check <plan>`
warns on an approved plan whose defaults it does not name.

# Execution

## 10. The phases
One heading per phase: what it waits on, its goal, every seat's role and area, its check,
its mark, and its tasks once posted at its open.

## 11. The mandate
The orchestrator's mandate, as answered.

## Interview log
One entry per question, verbatim: the options and the recommendation, then the answer as
given.
```
