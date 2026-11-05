# The simplify phase

**A building block any protocol's run that changes code can add, when the person asks for it**
(charter `simplify:`): the code the run touched is cut back on the board, dead and superseded
paths deleted and duplicates consolidated, the line count going down, behaviour unchanged. Code
only: an architecture change it suggests is a finding, never applied here. Most fitting after a
verify verdict of ready (`build-verify`, a plan with `verify:` on), the builders still holding the
context of what they replaced. **The person can ask for one mid-run too**: a charter amendment
(`references/charter.md`), run before the next piece of work.

## When

| `simplify:` | Runs |
|---|---|
| `after-verify` | after each verify verdict of ready, before the next build or the close |
| `end` | once, after the last verdict of ready, before the run closes |
| `none` | no simplify phase (the default) |

## The phase

1. **Audit**: one task to one builder, the `simplify-code` skill's phase 1 on the files the run
   changed and what they reach, its report in aiview. In the same phase, **every builder lists what
   its own work superseded** (the old path, its replacement, the commit), posted to you: the
   context no later pass can rebuild cheaply.
2. **Choose**: you judge the families against the run's goal and the audit's risk; the person is
   asked only for a duplicate's survivor or a family whose risk is high.
3. **Remove**: one task per approved family, each a `simplify-path` brief (remove, replacement,
   pinned by, scope, budget), to the builder that knows that area. Families touching no common
   file run at once, in their own worktrees; the rest in order.
4. **Re-verify**: the protocol's verify runs again on the merged branch. A family whose net lines
   did not go negative, or that changed a pinned test, is reverted, not argued.

**Every seat without a task is on call**: answers a question on the code it knows, changes
nothing, `done simplify` at once.

## Phase message

| phase | text |
|---|---|
| simplify audit | `simplify <k>: one builder audits the code this run changed (simplify-code phase 1) and posts the report; every builder posts what its own work superseded (old path, replacement, commit), then done simplify.` |
| simplify remove | `simplify <k>: each builder named removes its family through simplify-path, its brief in its task; net lines negative, pinned tests unchanged; merge, report, done simplify.` |
