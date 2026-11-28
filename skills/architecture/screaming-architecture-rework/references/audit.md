# Audit

## The map, drafted with the person

Draft it as the `guide-screaming-architecture` skill's `references/product-map.md` says: the
entries from the product's own surfaces (its screens, its commands' help, an agent's verbs and
answers, its prototypes' names), grouped into features, each feature's word, aliases, homes and
retired words, the horizontal folders, the stoplist. Show the draft to the person before
measuring: a word they would not use is fixed now, not after the audit is built on it.

## Measure

Run once each, on the commit the audit names:

- **The guide's checker**, `scripts/check.mjs --all` (`--scope` the product's source folders):
  every spread file, hidden concept and word drift today, with the alignment figure.
- **The `dependency-graph` skill at folder level** (`--level` folding each area into one node),
  the whole package first, then `--focus` each feature's folders: which features import which,
  the imports a regrouping turns into cross-feature ones, the cycles it would create.

A finding the checker reports and the person's map says is fine is fixed in the map (a stoplist
word, an exception), never by narrowing the measure.

## The report

Through the `aiview` skill, kind `report`, `YYYY-MM-DD-<subject>.audit.report.md`, never in the
repository. Its parts:

1. **The choice in one table**: each question the person answers (the tree's shape, each
   contested move, the product findings), the recommended answer and the alternative.
2. **Every entry and its files today**: per feature, each entry (a screen "Orders", a verb
   "checkout") and every file it runs through, across all folders.
3. **Spread, hidden concepts, word drifts**, each with the move proposed: a spread feature's
   files and the one home they go to; a folder no entry reaches, with the feature it belongs to
   or why it is horizontal; a code word differing from the product word, with the rename.
4. **Product findings, apart**: what the audit saw in the product itself (a verb that duplicates
   another, a concept the code has and no surface names), each a question for the person; none
   is applied by this skill.
5. **The tree after**: the folder tree once the moves are done, one option per shape worth
   weighing (layer then feature, or feature then layer), with what each costs: the tests or
   rules that re-key, the imports that become cross-feature.
6. **Alignment, before and after**: the checker's figure today and the one the chosen tree
   gives.

Rank the moves by how much of a feature they gather over the imports they touch, and propose
the order of passes.
