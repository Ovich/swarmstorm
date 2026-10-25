# Protocol: build-verify

Builders change the code, verifiers judge the merged result in the running product, and the
orchestrator turns the verifiers' findings into the next build, until the loop's goal is met.
Out: the merged branch, and the last judged findings table with the goal's state.

**Runs on** a task swarm (the `swarm` skill, the default) and on a plan (the `orchestrate-plan`
skill, when the mandate's `verify:` is on). Board: `$S open --kind task --protocol build-verify`
for a task swarm; a plan's run keeps `--kind plan` and adds `--protocol build-verify`.

## Seats

| Seat | Who | Does |
|---|---|---|
| `w1` … `w<n>` | builders, the plugin's `swarm-worker` agent, each in its own worktree | build: the task posted to it, merged onto the run's branch; verify: on call, `done verify` at once |
| `v1` … `v<m>` | verifiers, the plugin's `verifier` agent, no worktree of their own beyond the detached one they check out | build: idle, `done build` at once; verify: the pass the phase message scopes, one findings table each |
| the app owner | `v1` unless the charter names another | keeps the product running for the whole run: restarts it on the merged branch at each verify's open, stops it when a build needs it stopped; **no other seat starts or stops it** |

A verifier judges **from a project skill or from instructions**: the charter names, per verifier,
its focus and its source: a `verify-<app>-<focus>` skill in the project's local skills, or
`instructed`, the steps written in each verify phase's message. No skill and the person wants
one: the `verification-skill-create` skill runs before the run opens.

## Charter fields

Beyond the shared ones (the protocol, the run table, the loop, the effort):

| Field | Content | Recommended |
|---|---|---|
| builders | how many, each one's area | 3 to start from, reconsidered against the estimate (the tasks that can run in one build at once) |
| verifiers | per verifier: id, focus, source (`verify-<app>-<focus>` or `instructed`) | 1; the project's verify skill when it has one |
| app owner | the verifier that runs the product | `v1` |
| verify after | `each build` or `the end` | `each build` |
| stop rule | a verifier stops at the first blocker and posts, or walks the whole scope | stop at the first blocker |
| branch | where the builders merge | `swarm/<topic>` off the current branch |

## The loop

**Cycle**: build → verify. **Goal** (recommended): the judged verdict `ready`, no blocker or major
standing. **Cap**: 5 iterations. Proposed as the `orchestrate` skill's *Propose the run* says: until
the goal (with its cap), N iterations, or unbounded.

## Phases

| Phase | Builders | Verifiers | You, after |
|---|---|---|---|
| **build `<k>`** | each its task: change, test, merge onto the branch, report to `@orchestrator`, `done build` | `done build` at once; the app owner stops the product when the phase says so | re-run each task's done-when on the merged branch; `all-done` then open verify |
| **verify `<k>`** | on call: answer a verifier's question on the thread, change nothing; `done verify` | the app owner restarts the product on the merged branch first; each verifier its scoped pass, one findings table to `@orchestrator`, `done verify` | the judged table (below), then the goal's state, then build `<k+1>` or the close |

- **Build 1 is the work asked**; every later build is the judged table's rows that stand.
- **A verifier stopped by a blocker posts its partial table at once**, with where it stopped;
  you may open a short build for that row alone, then a verify that resumes the walk.
- **A builder never runs the product the verifiers walk.** A task whose done-when needs to see its
  own change running (a screen at a width) runs **a private preview of its own build on a spare port**
  its task names, stopped right after; anything else asks the app owner on the thread.
- **A verify walks a copy of the person's data**, never the live one: the product served on the
  verifier's port reads a copy (for aiview and swarm, a `SWARMSTORM_HOME` copied into a temp folder),
  so a migration or a write a walk triggers never lands on what the person uses. The rest of what a
  seat may start, stop or sign in to is the swarm-board skill's `references/machine.md`.
- **A question between seats is answered on the thread**, by the seat it names; an agreement
  two builders make on a shared file binds, as the `swarm-board` skill says.

## Your duties

- **Every task names its done-when** (a command that exits 0, or what is observed) and **its
  boundary** (what not to touch). A fix task names the ids it fixes: `@w1 FIX F1 + F4: …`.
- **One task per builder per post**, written as the `swarm-board` skill's thread says: goal,
  contract, files, done-when, as short headed parts.
- **Tasks are posted once the builders have joined** (a seat's task posted earlier still reaches it
  on its first wait, but the run reads cleaner in order).
- **The verify message scopes the pass in numbered steps**: the branch and its sha, what build
  `<k>` merged, the journeys or calls to walk, what to compare, what to report, and the rows of
  the last judged table to look at again. An `instructed` verifier gets every step; a skill's
  verifier gets the scope and the inputs that differ from its defaults.
- **The judged table**: the verifiers' tables merged into one (ids kept, prefixed when several
  verifiers), judged as the `orchestrate` skill's `references/findings.md` says, ending on the
  goal's state, posted before any build is opened.
- **At the cap without the goal**, pause: the judged table to the person, with one more
  iteration, a raised cap, or the close; never a silent extra round.

## Phase messages

| phase | text |
|---|---|
| build | `build <k> of <cap>: <the tasks' ids and owners>. Builders: your task is posted to you; merge, report @orchestrator, then done build. Verifiers: done build now<; app owner: stop the product until verify>.` |
| verify | `verify <k> of <cap> on <branch> @ <sha>. App owner: restart the product on it first. <v1: the numbered steps, or "your skill, scope: …">. Builders: on call, change nothing, done verify. Every verifier: one findings table to @orchestrator, ids kept from the last table, then done verify.` |
