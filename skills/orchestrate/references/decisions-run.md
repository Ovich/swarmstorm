# The decisions run

**The project runs on two levels**: the **decisions run**, one run where every decision-authority
role held by any open run is seated, its product the register of common decisions; and the
**teams**, each swarm on its own run. Two levels only: a level more chokes the communication.
"Board" stays the swarm board's word; the decisions run is one run on it.

| Level | Where | Roles |
|---|---|---|
| decisions | one run, group `decisions` | the decision-authority roles: `product-owner`, `product-designer`, `ui-ux-designer`, `architect`, `editor`, `tech-lead`, `qa-lead`, `devops`, `security` |
| team | the swarm's own run | `reviewer`, `moderator`, the workers, seats and verifiers |

- **The board knows a run's authority**: open your run with `open --authority <roles>`, the
  roles the person handed you (`authority.md`). When two open runs in one repository hold a
  decision-authority role, the answers to `open` and `status` say so and print the command that
  opens the decisions run: read that line and run it, never compose it.
- **Decisions flow down**: a team decides within the register. **Disagreements go up**: a team's
  question that touches another swarm goes to the decisions run; a deadlock there goes to the
  people, each holder to its own. Nobody overrules sideways.
- **One facilitator per open decisions run** (`authority-roles/facilitator.md`), **in its own
  session**, part of no swarm, so it is unbiased and outlives any one of them. The orchestrator
  that opens the run asks the person to start it, giving the line to paste into a new Claude Code,
  Codex or Cursor session: `Take the facilitator seat of the decisions run, run <run id>, as the
  orchestrate skill's authority-roles/facilitator.md says.`, started in the project's folder so it
  finds the project's documents. It ends when the run closes.
- **No facilitator session started**: the opening orchestrator dispatches the facilitator as a
  subagent, said to the person as less neutral; when that swarm closes while others remain, it
  hands the run to the next, which dispatches a new one, the thread and the register its memory.
- **Every holder speaks as its role's character** (its file's *Character*), never as a neutral
  summary: the run is worth what its disagreements are.
- **Find it**: holding a decision-authority role, `swarm status` for an open run in group `decisions`.
- **None, and the board's line says another open run holds a decision-authority role**: run the
  command it prints, a seat per holding run, its roles in the seat's role; the other orchestrator
  is mentioned on its own run with the join command. Already open: `seat add` your seat, then
  `join`. One run alone opens nothing.
- **Subscribe** to `agreement` and mentions on it; it wakes you beside your own run.
- **Before a decision the role's file sends through the decisions run**: post it as a proposal, in
  the form the role's file gives (a prototype variant for `ui-ux-designer`), `--about` the area,
  the role it is made in named; go on once every holder whose roles it touches has endorsed it. It
  is then an agreement every swarm applies. An answer opens an exchange, each post opening on what
  you take from whom.
- **The role closest to the decision leads, the others weigh in**: a flow is the product
  designer's, its effect on a boundary the architect's to raise.
- **Still split after one exchange round**: the facilitator writes a synthesis; still split after
  it, it breaks the tie, as its file says. A conflict it may not rule on pauses that area; each
  holder asks its own person, the thread linked.
- **The decision register**: every agreement and ruling, one row each (area, decision, roles,
  why, seq), kept by the facilitator as a document through the `aiview` skill, group `decisions`;
  every holder reads it before deciding in a decision-authority role, and briefs its team from it.
- **Leaving**: `end` when your run closes; the last holder closes it. Its record stays; a decision
  that recurs is proposed as a convention (the `write-conventions` skill), on the person's yes.
