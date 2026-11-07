# The findings table

**Findings travel as one table in one message, never in a document**: on a board, the member's
post to `@orchestrator`; in a dispatch, its return. Every member that judges work (a verifier,
a reviewer, a worker reporting a fault) writes this table, and the orchestrator answers with the
same table judged.

## The member's table

The inputs and the verdict first (`ready`: no blocker or major standing; else `not ready`),
then the table:

| # | weight | where | what | expected (source) | seen by |
|---|---|---|---|---|---|
| F1 | blocker | `bench.mjs` devRoute | `checkpoints --wf app` answers 401 "sign in first": the verb sends no session | the documented verb reaches the route (SKILL.md, the verbs) | the walk, step 4 |
| Q1 | unverified | profile | the Accept before the rewind wrote facts; the re-press may write them twice | one profile item per fact (D12) | the walk, step 7 |

- **`#`**: `F<n>` for a finding, `Q<n>` for a question the member could not settle with what it
  had. **An id is the row's for the whole run**: the next pass reports it under the same id,
  closed or still standing; a new row takes the next number. Several verifiers in one phase
  prefix theirs with the seat, `v2-F1`.
- **`weight`**: `blocker` (the work cannot be used or judged further), `major` (wrong or
  missing against its source), `minor` (works, but not finished), `unverified` (a `Q` row).
- **`where`**: the place a reader finds it: a screen, a route, a file, a call number.
- **`what`**: what is there, the evidence in the cell (a status, a quoted line, an id), in words
  a reader without the product can follow.
- **`expected (source)`**: what should be there, and the document, decision or rule that says so.
- **`seen by`**: the role or the step that found it.

**Ordered by weight**, blockers first. A partial pass (stopped at a blocker) posts the rows it
has and says where it stopped.

## The orchestrator's table

**The same rows, three columns added**, posted in reply before anything is dispatched; with no
board, in the next member's brief and to the person in chat:

| # | weight | where | what | judgement | reason | next |
|---|---|---|---|---|---|---|

- **`judgement`**: `stands`, `reweighed <weight>`, `question for the person`, `not a fault`, or
  `closed` (a row of an earlier pass the work now meets).
- **`reason`**: one line, from what the orchestrator knows and the member may not (the
  decisions, the charter, the inputs).
- **`next`**: who acts and in which phase: `fix → @w2`, `next iteration`, `the person`,
  `dropped`. A `Q` row goes to whoever can settle it.

The `expected` and `seen by` columns may be dropped from the judged table when they add nothing.
**The judged table ends on the loop's goal**, when the run has one: `goal: met`, `not met (F1,
F4 standing)` or `cap reached`.

**Only the rows that stand reach a fix**, each fix naming its ids (`FIX F1 + F4`); the member
that found them looks again only at those, plus what the fix touched.
