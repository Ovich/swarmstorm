---
name: screaming-architecture-rework
description: "Use when an existing codebase is cut by technical layer instead of by what its users do, and is to be audited or regrouped: one feature spread over many folders, files named in words no screen, command or verb uses, a folder tree that says nothing about the product, or the person asks to make the code mirror the product or to stop it drifting back. Produces the product map drafted with the person, an audit of every entry with its files and a proposed move, the chosen moves applied one feature per pass, and the guard. Not for dead code or duplicates (simplify-rework), branching complexity (complexity-rework) or one module's interface (deepen-module)."
---

# Screaming architecture rework

**Moves, never logic.** A regrouping that also edits behaviour cannot be reviewed: the diff is
thousands of lines of paths with a change hidden among them. The map says where each file goes,
the checker says what is left, the person chooses, and each pass moves one feature and changes
nothing it does.

The standard itself (the map and its format, the bar at merge, the measures, the lessons that
fix a flagged dependency) is the `guide-screaming-architecture` skill's: load it first, and take
every rule from it, never from memory of this page.

## The phases

One artefact each, and a stop.

| Phase | Produces | Stops for | Read |
|---|---|---|---|
| 1 Audit | the map drafted with the person; a report: every entry with its files today, the spread, the hidden concepts, the word drifts, each with its move; the product findings apart; the tree after | the person's choice | `references/audit.md` |
| 2 Choose | the person's answer: the tree, the moves taken, which product findings to take up | nothing moves before it | |
| 3 Move | one feature or one area regrouped per pass, the suite green | a move that needs a logic change: back to the person | |
| 4 Guard | the map committed as the project guide, the checker in the project's done-whens | the person's yes on each | |

## Where to start

| The ask | Phases |
|---|---|
| does the code mirror the product, audit, where is X spread | 1, then stop |
| regroup by feature, an approved audit | 3 per feature, in the approved order |
| stop it drifting back | 4 |

## Move

- **One feature or one area per pass**, one commit set each, so a reviewer attributes every path.
- **Moves first, then renames, each in its own commits; never an edit of logic.** Only import
  paths change with a move; a test changes only its import paths. The suite runs green after each pass.
- **A dependency the checker flags is fixed by the guide's lessons** (the shared piece goes
  horizontal or to the parent's root, a foreign widget becomes a slot), **never by a renamed
  file**: a name chosen to dodge a measure hides the spread it measured.
- **A name the wire, the store or a published interface keeps** stays, noted in the map as the
  guide says; renaming it is a behaviour change.
- **Done per pass**: the guide's checker, `--all --scope <the moved area>`, reports nothing left
  there; the next pass starts from the merged one.

## Guard

Propose each, apply on the person's yes:

- **The map committed** as the project guide the guide's `references/product-map.md` names, so
  every later change is shaped against it.
- **The checker in the project's done-whens**, base-relative, so a change fails only on what it
  added: a line in the conventions file through the `write-conventions` skill, and a done-when
  line in each task when the work runs under the `orchestrate` skill.

## Rules

- **The map is the person's.** The agent drafts it from the product's own surfaces; the person
  settles its words, its homes and what stays horizontal.
- **A product finding is never applied unasked.** The audit sees a verb that duplicates
  another, a screen without a name, a concept the code has and the product hides: each is
  written for the person, apart from the moves, and changes nothing here.
- **Add no dependency without the person's yes**: the checker needs none; the cross-feature
  measure runs only where the `dependency-graph` skill's tool is already present.
- **When the project plans its work in documents**, the audit is their input and each feature's
  pass is one piece of work.

## Red flags

| Thought | Reality |
|---|---|
| "While I'm moving it, I'll tidy the function" | Then the pass is no longer a move. Note it; a later piece of work does it. |
| "Rename the file so the checker stops flagging it" | The spread is still there, now unnamed. Fix the dependency as the guide's lessons say. |
| "Every feature in one sweep" | One pass per feature, or no reviewer can attribute the diff. |
| "This shared helper belongs to the feature that wrote it" | Read by several features, it is horizontal or the parent's; the guide says which. |
| "The map can follow the folders as they are" | Then it measures nothing. The map comes from the product's surfaces, the folders follow it. |
