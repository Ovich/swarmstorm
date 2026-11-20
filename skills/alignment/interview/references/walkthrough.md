# The walkthrough

**The interview turned the other way**: the agent explains a document awaiting the
person's approval, one unit at a time, and after each unit the person answers understood,
need more or disagree. **It is read-only**: it explains and asks, never changes the
document and decides nothing; it closes in chat and lets the caller write (*The
hand-over*). The interview's discipline holds throughout; this file adds only what the
walk needs. Several documents are walked in one sequence, each keeping its own table in
its own log.

## Cutting the units

**Units come from the document's own structure**, never from a cut the agent invents: its
parts in their order, a part too long for one screen split along its own sub-parts. A
plan, as the worked example: several plans walked together, one unit per plan; else one
per phase of its phases section; a single phase, one per deep module of its modules
section; else one per story. A unit's decisions are the `D<n>` its own text cites, nothing
inferred. Say the count before the first unit: "five parts, one at a time".

## The explanation

**The first explanation of a unit fits on one screen**: about 150 to 200 words, or one
table. Detail comes only on need more; a wall of text is answered "understood" to get
past it.

- **In the person's terms**: what the unit builds or changes, what it does for them, what
  it rests on.
- **Every claim traced to its id** (a `D<n>`, a story, a `file:line`), so the person finds
  it in the document.
- **A unit resting on a decision the person disagreed with earlier in the walk** gets one
  sentence, "this part assumes D3, which you disagreed with", and the walk goes on;
  nothing is changed.

## The question

**Through the harness's multiple-choice question tool** (in Claude Code,
`AskUserQuestion`): one question, four options, *understood*, *need more*, *disagree*,
*stop here*. **When no such tool is available, when it cannot carry four options or a
multi-select, or when you are unsure, one line** closes the explanation instead:

```text
1 understood · 2 need more · 3 disagree · 4 stop
```

A number, or the words themselves, read exactly as the tool's answer would be.

- **Need more naming no part**: the unit's parts (its sub-parts, its decisions, its
  steps) offered as a multi-select, four per question, the next four in a second question
  of the same call; through the line, the parts numbered and "pick any, e.g. 1, 3".
- **Free text, or an interrupted question**: need more on what it names.
- **A stop**: *stop here*, or the free text "stop", "enough" or "later", ends the walk.
- **Disagree**: the person's words noted (asked for in one line if the answer carried
  none), and the walk goes on to the next unit.

After a need more is answered, the question again; the answers of a unit chain.

**After a stop**, the log stays as it stands: every unit not reached keeps its row with
*Answers* empty, the card is closed, and the three lists so far are handed over. The
caller still asks where to keep the questions asked.

## The evidence ladder

**Need more starts on the decision row the part rests on and its reason**, cited by its
`D<n>` and its source. When that does not answer, take the rung the question calls for:

| The question | The rung | Cited with |
|---|---|---|
| "What is it, concretely?" | a real example from the project's recorded data, read offline, the interview's `experiments` option asked first | the file read and what it shows |
| "How does it decide?" | the project's code | `file:line` |
| "What does the provider or the specification say?" | the outside reference: third-party docs, a specification, an upstream source a submodule holds | the pinned commit, the snapshot date of a docs scrape, or a live page's URL and the date read |

A question that fits none climbs them in that order, **then something to see**: a sketch
through the `sketch` skill, or the `point-at` skill on a prototype for a screen. **Stop at
the first rung that answers.**

- **A fact the ladder needs that is not in the repository or the recorded data**: say so,
  never invent it; it goes on the disagreements list as an open point.
- **A fact that fills a gap in the document** goes on the facts list.
- **A fact that contradicts a decision** goes on the disagreements list, "fact contradicts
  D5", with its evidence; an outside reference that disagrees with the code, both cited.
- **A unit still at need more after the last rung**: its chain ends on *need more*, and
  the approval names it.

## The hand-over

**The walk closes in chat**, per document:

1. **The table's rows** (*The table*), for the caller to write into the document's
   interview log.
2. **Disagreements**: the person's words, or a contradicting fact with its evidence; the
   decision ids concerned.
3. **Questions asked**, each with the answer given.
4. **Facts the document lacked**, each with its source (the code at `file:line`, the
   recorded data read, the formula) and the section it belongs to.

**Every item names the `W<n>` it came from.** The caller writes the rows and the facts,
opens the approval on the disagreements, and asks once where to keep the questions; for
a plan, the `write-plan` skill's step 9 and the `next-step` skill say how.

## The table

**This file owns the format**; other skills point here. Under the document's interview
log, a heading with the walk's date, its opening line, then one row per unit of the walk:

```text
### Walkthrough 2026-03-14

Understanding, not approval: the defaults are confirmed only at the approval.

| id | Unit | Decisions | Answers | Parts asked about |
|---|---|---|---|---|
| W1 | Phase 1 · build | D1, D3, D4 | need more → understood | how D3 cuts a single phase |
| W2 | Phase 2 · verify | D5, D9 | disagree | |
| W3 | Phase 3 · release | D2, D7 | | |
```

- **id**: `W1`, `W2`…, from `W1` in each table.
- **Decisions**: the `D<n>` the unit's own text cites, comma-separated.
- **Answers**: the answers given, in order, joined by ` → `, each one of `understood`,
  `need more`, `disagree`; the last counts. Empty for a unit not reached or stopped before
  its answer.
- **Parts asked about**: what need more named, or the parts picked; empty if none.

**A second walk adds a new table below, never edits an earlier one**; the last table in
the file is the current one.

## The pending card

**One aiview card on each walked document for the whole walk**, opened before the first
unit, `$A` as the `aiview` skill sets it:

```sh
ID=$($A pending add "<document>" --label "walkthrough" --note "<N> units, one at a time" --json)
# the walk
$A pending done "#<id from the json above>"
```

No verb updates a card, so the progress ("part 2 of 5") is said in chat. **Close it on
every path**: the walk's end, a stop, an abandoned or failed walk.

## Understanding, not approval

**Understood says the explanation landed, nothing more**: not that the person agrees, and
never a confirmation of a default or a change of status. The walk confirms nothing; every
`agent default` is still asked at the approval. The table's opening line says so, for the
next reader.
