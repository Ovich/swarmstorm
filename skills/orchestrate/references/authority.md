# Authority

**What the person delegates to you for this run**, asked once the proposal is approved and
before the dispatch, from what the alignment (interview, brainstorm, board, plan) left in your
hands. Written as the charter's `authority:` field.

## Ask

**Delegate roles, never single decisions**: the software-engineering roles this run needs filled
that the alignment did not keep for the person. **The list is fixed**, its names the same in every
swarm, so that two swarms holding one role find each other; what a role covers in a run is
described in the run's terms. Each role's file is `authority-roles/<role>.md`, read once you
hold the role:

| Role | Holds |
|---|---|
| `product-owner` | scope, priorities, what is in or out |
| `product-designer` | user journeys and flows, how features fit together |
| `ui-ux-designer` | screens, interaction, visual design, the prototypes and the component library |
| `architect` | structure, boundaries, the technology choices |
| `tech-lead` | how the work is cut, conventions, trade-offs inside the design |
| `reviewer` | judging what comes back, accepting or sending it back |
| `qa-lead` | what is checked, when quality is enough |
| `devops` | build, CI, environments, dependencies, the merge, PR, release, deploys |
| `security` | secrets, permissions, supply chain, exposure |
| `editor` | a text's structure, claims and tone |
| `moderator` | steering a discussion: phases, seats, when it ends |

**Ask only the roles the run will meet**; a fix run needs no product designer. **A run that ends on a branch always asks DevOps**: every such run
meets the merge.

**One multiple-choice question, several answers allowed** (`AskUserQuestion`, `multiSelect`):
*Which roles do you hand me for this run?*, the roles this run meets as options, the widest first,
each option's description the role's *holds* written for this run, what it covers here in the
run's own terms, never the table's generic line (reviewer on a CV run: "accepting or sending back
each worker's CV changes against the three rules"), then your recommendation with why, from the
alignment. Over four roles, a second question in the same call, the next four.

- **A role picked is yours**: you decide in it and go on, the reason in the record, shown to the
  person at the next stop.
- **A role left out stays the person's**: you propose and pause for a yes.
- **A level the person writes in for a role** ("decide, no need to show", "ask before any work")
  replaces it for that role.

## Hold

- **Open with `--authority <roles>`**, the roles you hold; your seat on the project's orchestrators
  board carries them (`orchestrators-board.md`, read at your first open). Every orchestrator
  registers there, roles or none.
- **The line**: `authority: product owner · reviewer (yours) · product designer · DevOps (theirs)`.
- **A decision outside every role asked is the person's.**
- **The person may hand over or take back a role mid-run** ("you judge from now on"): the field overwritten
  with the decision's id, as any amendment.
- **A recurring run keeps its authority** in its dossier or its project skill, on the person's
  yes, and the next proposal starts from it, shown, never assumed.
