# The plan document

The tracker first, then two parts. **Design** is what gets built, and every task points into its
structure. **Execution** is for whoever runs the plan. A section that does not apply is left
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

## 1. Why, and why not
The problem and who feels it. Goals. Non-goals. Where a person sees the change, the
stories: id `US3`, the role, what they want, why, acceptance written as something observed.

## 2. Before and after
Existing code, cited `file:line`, then the after picture. New work has the after picture
only. A table of what replaces what.

## 3. Modules, after
The module map: who imports whom, and the imports that must not exist. Then one subsection per deep module: its usage, the complete code a caller
writes, the entry as signatures without bodies, what it hides, what stays outside.

## 4. Flows
One sequence per kind of turn, every failure branch on it.

## 5. State and its writers
Where each piece of state lives, and every writer of it.

## 6. Failure modes
What breaks, and what the person sees.

## 7. What ran
The recipes the experiments handed back.

## 8. Decisions
| id | Decision | Depends on | Status | Source | Kind | Task |
The row core of the `interview` skill's `references/decisions.md`, ids and citations included,
plus `Kind` and `Task`. Kinds: purpose, module (with
its state: new, deepened, interface change, wiring, ui, schema), architecture, contract, clarification. Open
questions are rows with status open and an owner. A departure from a rule is a row naming
what is owed for it. The status line names the `agent default` rows the person confirmed;
`aiview plan check <plan>` warns on an approved plan whose defaults it does not name.

## 9. Guides
The project's guides that apply: the shipped `guide-*` skills and the project's own under
`<repo>/.claude/skills/guide-*`. One row per guide, with the decision this plan takes under it:
`guide-deepen-module`: `<X>` is the one entry point, `<Y>` stays hidden. A guide that applies
and has no decision yet is an open row in Decisions. How a seat is held to them while it works
is the `swarm-board` skill's `references/worker.md`.

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
