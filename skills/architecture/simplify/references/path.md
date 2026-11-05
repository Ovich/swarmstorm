# Remove one path

**The context is the asset.** The session that made the shift knows both paths, and deleting now costs a fraction of what a later pass pays to rebuild that knowledge. Delete, never rewrite.

## The brief

Settle it before the first edit, from the range, the work in hand or the audit entry, and write it where the pass is tracked (the run's task, the plan's slice, chat):

- **Remove**: the files and symbols of the old path.
- **Replacement**: what callers move to, and the change that introduced it.
- **Pinned by**: the tests that cover behaviour that must survive. Tests that only cover the old path are listed for deletion, each with why.
- **Scope**: the files the pass may touch. Nothing outside it.
- **Budget**: about 400 changed lines. Past it, stop and split.

A dispatched pass gets the brief and nothing else: no "look around", the file list is the context.

## Steps

1. Run the tests in the brief, green, before touching anything.
2. Move each caller to the replacement. A caller that needs behaviour the replacement lacks stops the pass.
3. Delete the old path and the tests listed for deletion. One commit per removed unit, its message naming what superseded it.
4. Run the project's type check, tests and unused-code finder. Then this skill's `scripts/net-lines.mjs`, run with node from the repository as `net-lines.mjs <base> --scope <files…>`: it prints the net lines and any file touched outside the scope, and exits non-zero on either failure.

## Stop and report instead of guessing

- a caller depends on old behaviour the replacement lacks,
- a test fails for a reason other than the removal,
- the budget is exceeded,
- the old path turns out reachable in a way the brief missed (a load by string, a public export, an entry point found by convention).

## Red flags

| Thought | Reality |
|---|---|
| "The replacement has a gap, I'll add it while here" | A feature in a removal diff. Stop, report the gap, it is its own change. |
| "This old test fails, I'll adjust it" | A pinned test changed is a behaviour changed. Only tests listed for deletion go. |
| "I'll keep the old path behind a flag, just in case" | A flag is a third path. History keeps the old one. |
