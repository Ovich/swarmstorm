# The shakedown phase

**A building block any run with a verify can add, when the person asks for it** (charter
`shakedown:`): a walk that stops at each blocker or major, waits while it is fixed, checks again
the step it stopped on, and goes on. A blocker costs one fix, not a whole new walk. **It never
replaces the verify**: a fresh verify walks the whole scope after it, on the final code, because a
fix made mid-walk can break a step the shakedown had already passed.

**The roles stay split.** The verifier judges and never fixes; the worker fixes and never judges;
**every finding passes by you**. A verifier never sends a finding to a worker (a question on the
thread stays allowed), and a worker never decides
whether a finding is real or whether its fix holds. Split, neither grades its own work.

**Propose it by default when the verify walks the running product** (build-shakedown-verify), in
one line with why: a walk is a chain, and an early blocker hides every step after it; without a
shakedown each blocker costs a fix round and a new walk, with it one fix and one check. Propose
`first` when the run verifies after each phase; `none` when the verify is tests or a short check,
or the change is small (one or two screens). The person decides. **The person can ask for one
mid-run too**: a charter amendment (`references/charter.md`), run before the next verify.

## When

| `shakedown:` | Runs |
|---|---|
| `before-verify` | after each build, before its verify |
| `first` | once, after the first build, before its verify; the later iterations verify as usual |
| `none` | no shakedown phase (the default) |

## The phase

1. **Open it** with the verify's steps, on the build's branch and sha, `--for` the one verifier
   seat walking: only it owes the phase. The builders are not woken; a fix task reaches one as
   any task does.
2. **The verifier walks.** At a **blocker or major** it stops, posts that one row to
   `@orchestrator` as `references/findings.md` shapes it (its id kept for the run), says the step
   it stopped on, and waits, the phase still owed. A minor is kept for its table and the walk goes
   on.
3. **You judge the row**, as `references/findings.md` says: a stale bundle, the environment or a
   row that is not a fault is answered to the verifier, who goes on. A row that stands is a fix
   task to the builder of that area (`references/tasks.md`), the row in it, never forwarded raw.
4. **The builder fixes, merges, reports**, as its task says; it owes nothing of the phase.
5. **You tell the verifier it is delivered**, with the new sha. The verifier moves its detached
   worktree to that sha and restarts its own instance if code changed, checks again **only the step it stopped on**, and goes on from there. Never
   back: what the fix may have broken behind is the verify's.
   **After each row you judge, post the tally** on the thread, so the person sees it converge or
   circle: `shakedown <k>: <n> fixed · <n> not a fault · <n> minors kept · <n> open`, a row
   reopened named in it (`SH-3 reopened once`).
6. **At the walk's end** the verifier posts its table (every row, each with what became of it:
   fixed at `<sha>`, not a fault, standing), then `done shakedown`.
7. **Then the verify**, as the protocol runs it, by a **fresh verifier**: a verifier that watched
   its own findings get fixed would judge them with that bias. So a run with `shakedown:` on
   declares one verifier seat more than its verify needs, the shakedown's; it has no part in the
   verify. **Its brief lists the steps fixed during the shakedown, walked first**: a fix
   checked only on its own step may have broken one behind it. The steps alone, never the rows'
   verdicts.

**A row you cannot judge** is a question to the person, the walk paused until answered. **A fix
that does not hold** at the check again is the same row, reopened, back to step 3; its second
failure is a pause to the person, as a circling loop is (`references/reflect-phase.md`).

## Phase message

| phase | text |
|---|---|
| shakedown | `shakedown <k> on <branch> @ <sha>, @<verifier> walking; the steps are posted to you. Verifier: at a blocker or major, post that row to @orchestrator and wait; on "delivered", restart if code changed, check that step again, go on; minors in the final table, then done shakedown.` |
