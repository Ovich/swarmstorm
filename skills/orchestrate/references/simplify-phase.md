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

1. **Audit**: one task to one seat, the `simplify` skill's phase 1 on the run's commit range
   (`<base>..<head>`) and what its files reach, its report in aiview. The range's diff and commit
   messages name what each change superseded; builders still holding the work's context add what
   they know, posted to you, but the audit never waits on a memory.
2. **Choose**: you judge the families against the run's goal and the audit's risk; the person is
   asked only for a duplicate's survivor or a family whose risk is high.
3. **Remove**: one task per approved family, each a brief of the `simplify` skill's `references/path.md` (remove, replacement,
   pinned by, scope, budget), to the builder that knows that area. Families touching no common
   file run at once, in their own worktrees; the rest in order.
4. **Re-verify**: the protocol's verify runs again on the merged branch. A family whose net lines
   did not go negative, or that changed a pinned test, is reverted, not argued.
5. **Summary**: you write it once the phase closes, posted on the board and in the run's report:
   one row per family (what went, why, its commit, lines added and deleted), the total, and what
   was left and why.

**Every seat without a task is on call**: answers a question on the code it knows, changes
nothing, `done simplify` at once.

## Phase message

| phase | text |
|---|---|
| simplify audit | `simplify <k>: one builder audits the code this run changed (the simplify skill, phase 1) and posts the report; every builder posts what its own work superseded (old path, replacement, commit), then done simplify.` |
| simplify remove | `simplify <k>: each builder named removes its family through the simplify skill, its brief in its task; net lines negative, pinned tests unchanged; merge, report, done simplify.` |
