# Guard

Input: the audit's families, reworked or not. Output: configuration and a check in the repository, and a written convention proposed. Stop for the person's yes before writing the convention into the project's conventions file.

Before proposing a guard, read what the project's configuration already sets, following what it extends (a shared base config, a strictest preset): a guard already on is confirmed, not proposed. Propose the skill's limit, never another number.

Cheapest first, in what the project's tooling can hold:

1. **A complexity limit in the linter the project already runs** (the rule per language: `languages.md`). The bands are SKILL.md's, a gate per measure: fail blocks, review is listed: cyclomatic at 10 where the linter measures it, cognitive at 10 where only that is offered. Introduce it as a warning while families are open, count the functions above it, then ratchet: an error on changed files, then everywhere, the limit lowered as families land. An exception is named inline with its reason, never by raising the limit.
2. **Exhaustiveness**, in the language's own form (`languages.md`), plus the compiler's flag against silent fall-through where one exists.
3. **A check for the family's own pattern**, which no generic rule catches: a test or lint rule that fails on the fingerprint the audit found (two parse attempts on one value in one function, a discriminator compared to a string literal outside the parsing module, a cast to a hand-written shape of a known type). Scoped to where the pattern must not appear, the one boundary module allowed.
4. **A written convention** in the project's conventions file, on the person's yes only: untyped data is parsed once at the boundary into a type inferred from its source of truth, consumers match exhaustively, no second hand-written type for data that has one. Worded against the project's own names, with the check that holds it.
5. **A gate that blocks a merge**, when the person wants one: a check in the project's own suite (so the laptop and CI run the same) that compares the linter's findings with a committed baseline of the functions over the limit today, and fails on a new one or one grown worse; the baseline only shrinks. It blocks a merge only once the check is a required status in the repository's branch protection: say so, and say when the hosting plan or CI does not allow it.

Report what was added, the count above the limit today on the audit's scope and on the whole repository, each named (a linter caps its output by default: raise the cap to count), and the ratchet's next step.
