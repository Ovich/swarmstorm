# The simplify phase

**A building block any protocol's run that changes code can add, when the person asks for it**
(charter `simplify:`): the code the run touched is cut back on the board, dead and superseded
paths deleted and duplicates consolidated, the line count going down, behaviour unchanged. Code
only: an architecture change it suggests is a finding, never applied here. Most fitting after a
verify verdict of ready (`build-verify`, a plan with `verify:` on), the builders still holding the
context of what they replaced. **Propose it** when a run that changed code nears its close, in one line with why: the builders
still know what they replaced, and the range names the rest; cut later, it costs a fresh
exploration. **The person can ask for one mid-run too**: a charter amendment
(`references/charter.md`), run before the next piece of work.

## When

| `simplify:` | Runs |
|---|---|
| `after-verify` | after each verify verdict of ready, before the next build or the close |
| `end` | once, after the last verdict of ready, before the run closes |
| `none` | no simplify phase (the default) |

## The phase

0. **Baseline**: the full suite and the verifier's steps on the range's head, before any cut, their
   results posted: parity is measured against them.
1. **Candidates**: one task to one seat, the `simplify` skill's step 1 on the run's commit range
   (`<base>..<head>`): the candidates and their reach, posted to you. The range's diff and commit
   messages name what each change superseded; builders still holding the work's context add what
   they know, but the step never waits on a memory.
2. **Choose**: you judge the candidates against the run's goal and their risk; the person is
   asked only for a duplicate's survivor or a candidate whose risk is high.
3. **Remove**: one task per approved candidate, its brief the `simplify` skill's (a path or a
   duplicate), to the builder that knows that area. Candidates touching no common file run at
   once, in their own worktrees; the rest in order.
4. **Parity**: the full suite on the merged branch, then a verify phase with the baseline's steps.
   **Recommend it highly whenever the run has no verify**, with why: removal breaks callers no test
   reaches, and the verify re-runs what held before the cuts. The verifier needs no verify skill:
   an `instructed` one, its steps written in the verify message (what to check and how, from the
   last verify's steps or the range's done-whens); a project's `verify-<app>-<focus>` skill when it
   has one. Declined, the summary says `parity not verified`. A pass that broke parity, did not go
   net negative or changed a pinned test is reverted, not argued.
5. **Summary**: you write it once the phase closes, posted on the board and in the run's report:
   one row per pass (what went, why, its commit, lines added and deleted), the total, parity
   (suite and verify, before and after), and what was left and why.

**Every seat without a task is on call**: answers a question on the code it knows, changes
nothing, `done simplify` at once.

## Phase message

| phase | text |
|---|---|
| simplify candidates | `simplify <k>: the seat named lists the candidates of the run's range <base>..<head> (the simplify skill, step 1) and posts them; a builder that knows what its work superseded posts it too; done simplify.` |
| simplify remove | `simplify <k>: each builder named removes its candidate through the simplify skill, its brief in its task; net lines negative, pinned tests unchanged; merge, report, done simplify.` |
