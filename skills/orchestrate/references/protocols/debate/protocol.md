# Protocol: debate

Seats argue the open questions to decisions, each agreement endorsed by a skeptic. Out: per
question, a decision with its sources, or both sides written and the row left open.

**Runs on** a brainswarm (the `brainswarm` skill).

**The loop**: cycle `debate` (a round: every open question argued once more); goal (recommended)
every question settled or escalated; cap: the budget. A round that settles nothing ends the loop
early, the open rows written both ways.

**Record**: the `brainstorm` skill's board (`documents.md`), its sections as that skill orders them; the questions
are its decisions rows, status open, ordered as a tree. Swarm kind `brainstorm`.

**Strategy, beyond the shared fields:**

| Field | Content | Recommended |
|---|---|---|
| seats | the skeptic (fixed; every agreement names it, `--with skeptic`, so each reaches it) + topic seats. The skeptic's role asks for the diagram or the table whenever a claim is about a flow, a structure or a comparison, and endorses no agreement on a comparison without its table | skeptic + 2 to 3 to start from, reconsidered against the sides and expertise the questions need |
| experiments | yes · no; on yes, each seat its own sandbox outside the repository, only its recipe comes back; the brief adds `**Experiments**: <no \| yes, in your own sandbox at <path>>` | no |
| exchanges | N posts on one question before it escalates | 6 |
| new questions | seats may raise them: yes · no | yes |
| arbiter | orchestrator · none (an escalation leaves the row open) | orchestrator |
| budget | as shared | 45 minutes |

**One phase, `debate`**: seats post positions, `agree` and, the skeptic, `endorse`, as the
`swarm-board` skill's brainswarm-seat side says. **Every claim names its source**; the skeptic's sign-off checks it
is there.

## While it runs

- **An agreement the skeptic endorsed**: its row `agreed`, `Source` the agreement's `#<seq>`;
  a table it names promoted into the row's section as posted; a diagram it names promoted to
  *Diagrams* through the `write-diagrams` skill, its caption line above the fence, then
  `aiview mermaid-check` with no warning; the human part refreshed.
- **N exchanges on one question without one**: an escalation. With `arbiter: orchestrator`,
  post the ruling and its reason on the thread; it stands only once the skeptic endorses it,
  and is marked `ruled (by orchestrator)` in the row. With `arbiter: none`,
  or a ruling the skeptic objects to: the row goes `open`, both sides written.
- **A new question from a seat**: a row, when `new questions: yes` and the budget allows.

## Close

When every question is settled or the budget is hit. **The debate log**: per question, the posts
that moved it, the agreement verbatim.

**Phase message**: `debate`: `The questions <Q1…>. Post positions with their sources, agree when you do, the skeptic endorsing; at most <N> exchanges on one question before it escalates to @orchestrator; then done debate when your questions are settled.`
