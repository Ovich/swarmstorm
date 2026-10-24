# The leadership board

**The project runs like a company of two levels**: the **leadership**, every shared role held by
any active swarm, on one board; and the **teams**, each swarm on its own run. Two levels only: a
level more chokes the communication.

| Level | Where | Roles |
|---|---|---|
| leadership | one run, group `leadership` | `product-owner`, `product-designer`, `ui-ux-designer`, `architect`, `editor`, `tech-lead`, `qa-lead`, `devops`, `security` |
| team | the swarm's own run | `reviewer`, `moderator`, the workers, seats and verifiers |

- **Decisions flow down**: a team decides within the leadership's agreements. **Disagreements go
  up**: a team's question that touches another swarm goes to the leadership board; a deadlock there
  goes to the people, each holder to its own. Nobody overrules sideways.
- **One facilitator per open board** (`authority-roles/facilitator.md`), **in its own session**, part of no swarm,
  so it is unbiased and outlives any one of them. The orchestrator that opens the board asks the
  person to start it, giving the line to paste into a new Claude Code, Codex or Cursor session:
  `Take the facilitator seat of the leadership board, run <run id>, as the orchestrate skill's
  authority-roles/facilitator.md says.`, started in the project's folder so it finds the project's documents. It ends when the board closes.
- **No facilitator session started**: the opening orchestrator dispatches the facilitator as a subagent, said to
  the person as less neutral; when that swarm closes while others remain, it hands the board to
  the next, which dispatches a new one, the thread and the register its memory.
- **Every holder speaks as its role's character** (its file's *Character*), never as a neutral
  summary: the board is worth what its disagreements are.
- **Find it**: holding a leadership role, `swarm status` for an open run in group `leadership`.
- **None, and another active swarm holds a leadership role**: open it, `open --kind brainstorm
  --group leadership --title "Leadership"`, a seat per holding swarm, its roles in the seat's role;
  the other orchestrator is mentioned on its own run with the join command. Already open: `slice
  add` your seat, then `join`. One swarm alone opens nothing.
- **Subscribe** to `agreement` and mentions on it; it wakes you beside your own run.
- **Before a decision the role's file sends through the board**: post it as a proposal, in the
  form the role's file gives (a prototype variant for `ui-ux-designer`), `--about` the area, the
  role it is made in named; go on once every holder whose roles it touches has endorsed it. It is
  then an agreement every swarm applies. An answer opens an exchange, each post opening on what
  you take from whom.
- **The role closest to the decision leads, the others weigh in**: a flow is the product
  designer's, its effect on a boundary the architect's to raise.
- **Still split after one exchange round**: the facilitator writes a synthesis; still split after it, it breaks the tie, as its file says. A conflict it may not
  rule on pauses that area; each holder asks its own person, the thread linked.
- **The decision register**: every agreement and ruling, one row each (area, decision, roles,
  why, seq), kept by the facilitator as a document through the `aiview` skill, group `leadership`; every
  holder reads it before deciding in a leadership role, and briefs its team from it.
- **Leaving**: `end` when your run closes; the last holder closes it. Its record stays; a decision
  that recurs is proposed as a convention (the `write-conventions` skill), on the person's yes.
