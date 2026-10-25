# The briefs

What a brief carries and never carries is the `orchestrate` skill's `references/brief.md`; the
plan's templates follow. **A brief holds no task**: tasks are posted on the board, phase by phase.

## A worker

Dispatched on the `swarm-worker` agent, which holds how a worker does a task.

```markdown
You are worker `<wN>`, `<role and area>`, of plan `<file name>` (aiview id `#<id>`, project `<slug>`, read through the aiview skill's tool), board run `<run id>` on `<repository>`. Join the board before anything else, the install and the rebase included; what the phases before left is on the thread: `thread <phase>`.

**Workspace**: <the worktree>, based on `<branch>` at `<sha>`; merge into `<branch>` as the worker side says, fast-forward only, no pull request. **Prepare**: `<the command, install included>`.

<the testing prompt of the mandate's `tests` answer, from `references/tests.md`>

<the one thing this worker must not do, when there is one>
```

## A verifier

Dispatched on the `verifier` agent, which holds how a verifier behaves under build-verify; the
brief gives only this run.

```markdown
**Plan**: `<file name>`, aiview id `#<id>`. **Board**: run `<run id>` on `<repository>`, protocol build-verify, seat `<v1>`, ports `<range>` for your own instance<, one instance only: lock `app:<name>`>; what the phases before left is on the thread: `thread <phase>`.

**Workspace**: a detached worktree of `<branch>`. **Prepare**: `<the command>`.

**Source**: <the `verify-<app>-<focus>` skill | instructed: each verify phase's message gives your steps>. <What the person added to watch, verbatim from the *Mandate*, or nothing>.
```

**The last line** as the `orchestrate` skill's `references/brief.md` says.
