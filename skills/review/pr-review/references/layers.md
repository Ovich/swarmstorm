# The layers: jurisdiction, the brief, the return

## Jurisdiction

**No two agents in a review ever hold the same question**, between layers and inside one if a layer is split; jurisdiction is settled before dispatch.

- **The altitude rule.** A layer owns the questions answerable at its altitude without descending: L2 never reads function bodies, L1 never reasons about deployment, L3 reads the model, not the code that queries it.
- **A seam the table does not list is yours to assign before dispatch**, and the winning brief says it was assigned.
- **A defect that spans altitudes** (a transaction bug touching code, model and deploy) comes back as facets, one per layer, and joins into one finding at merge, citing every contributing return.

**The seam table**, where altitudes touch:

| Seam | Owner | Why |
|---|---|---|
| Function in the wrong module | L2 | Placement is organisation |
| Type mirroring a DB column | L3 | The schema is the truth |
| Consumers in another repo | L4 | Blast radius owns reach |
| Race inside a function body | L1 | Visible at line altitude |
| Migration deploy/execution order | L4 | A deploy question, not a model question |
| Coverage of the stated behaviour | L5 | An intent question |
| README, catalogs, discovery surfaces | L4 | They are consumed surfaces; L5 checks claims against the code, not the catalog |
| Duplicated content within one file / between files | L1 / L2 | Same evidence, two altitudes: split it before both agents find it |
| Test code quality / test placement | L1 / L2 | Tests are just code at those altitudes |
| Big file: real change or churn? | You, before dispatch | Established once, handed to every brief as fact |

## The brief

**A brief contains exactly four things, in this order**: where to read the diff; the layer's jurisdiction, its row of the layer table plus any seam assigned to it; the facts you have already established, given as facts; the output contract.

- **Establish once and hand over as a stated fact** anything two layers would otherwise derive independently: the scope script's output (base, head, file list), which branch the sibling repos are on, whether a 300-line fixture diff is two real lines under an encoding rewrite.
- **A brief names a surface, not a suspicion.** *"Check the FK on the new collection table against how the sync deletes its parent"* is a surface; *"this is the highest-value thing in the diff"* is a hypothesis the agent will spend its budget confirming.
- **A brief with more numbered surfaces than its layer has jurisdiction for is two agents' work**; split the layer (L1 by area, on a huge diff), the sub-briefs disjoint like everything else.

## The return

- **Evidence and consequence, never severity**; ranking needs the whole picture.
- **Every finding cites the `file:line` of the evidence**, both sides where there are two.
- **"Nothing in jurisdiction" is a valid return**, recorded as such.
- **A refutation is worth as much as a finding**; it becomes a *checked and clear* entry.
- **Separate what this PR introduces from what it inherits.** A defect that predates the branch is noted, attributed as pre-existing, and told to the author; it never feeds the recommendation. *"This PR does not create the exposure, it increases it"* is a third answer, and belongs in Decision points.
- **L4 searches beyond the repo under review**: the consumer in another repo or service is the one the diff never shows, and the repo docs say where to look.
- **Read the recovery path before pricing the damage**: a full rebuild, a scheduled job, a retry, a reconciliation pass. What survives is the case that path misses: the persistent failure, the window before it next runs, the state nothing re-derives.
