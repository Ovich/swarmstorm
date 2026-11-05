# Audit

## Find

Use what the project already has before proposing anything new; a finder not installed is
proposed and run only on a yes. Every stack has the first three; the last two need its tooling.
In order of yield:

- **Coverage** of the whole test suite, and of a real use where one can be run (the stack's
  coverage tool or its runtime's profiler): code nothing ever runs. The one signal that also
  catches code a static finder believes reached.
- **History**: `git log --since=<window> --name-only` for files nobody touched since the shift
  that replaced them, and commit messages naming a replacement ("replaces", "v2", "new").
- **Names and references**: each exported or public symbol searched for outside its own file,
  none found making it a candidate; two modules whose names differ by a version, an `old`,
  `legacy` or `new` marker, or a flag choosing between paths.
- **The stack's unused-code finder**: the compiler's own unused warnings first, then the
  ecosystem's analyzer for unused files, exports, symbols and dependencies, in its
  machine-readable output.
- **The module graph** (the stack's dependency analyzer, or the `dependency-graph` skill where it
  applies): orphan modules, modules reached only from tests.

## Reach

Before a candidate becomes a family, check the ways a finder misses a caller: a load by string
(reflection, a plugin registry, an import built at runtime), an entry point resolved by
convention (routes, handlers, migrations, a framework's naming), a public export of a published
package, a script, a CI job, a config file naming it. A candidate reached by any of these is
marked, never proposed as dead.

## Families

Group by cause, not by file: one shift left one family behind. Each entry:

- kind: dead (no caller), superseded (callers exist, a replacement exists), duplicate (two live implementations of one concern)
- files, and lines they hold
- the evidence line: the finder or coverage output, the commit that superseded it
- pinning tests: which tests cover the behaviour that must survive, or "none" (a finding, the `simplify` skill's `references/consolidate.md` characterizes it)
- risk: low (no caller), medium (callers move), high (behaviour differs between copies)

Rank by lines saved over risk. The report goes where the project keeps working documents (the `aiview` skill when the collection is in use), never in the repository.
