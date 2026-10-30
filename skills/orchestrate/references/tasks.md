# Tasks

**A task is the one unit of work an orchestrator gives a worker, whatever the kind**: a post to
one worker on the board, written when it is about to be done, never ahead. A plan names each
phase's goal and every seat's role and area; the phase's tasks are written at its open, from that
and from what the run left (its merges, the agreements and findings on the thread, the reports).

## The post

`$S post --task --file <path> --as <group>/orchestrator`, one task per post, to one worker (the one member it
mentions; `--task` records it as that member's task for the open phase, and its card reads `working on` it), its id the
run's next `T<n>`, in short headed parts (the `swarm-board` skill's thread):

```markdown
@w2 **T7 · the rewind route** (phase build 2; FIX F3 when it fixes findings)

**Goal**: the end-to-end behaviour, from the user's side, in one or two sentences.
**Builds on**: what is merged that this needs; the tasks of this phase it shares a file with.
**Contract**: the decisions it must hold, by id (`D3`); an interface it creates or changes, as code (below).
**Guides**: the plan's *Guides* decisions within this task's scope, quoted word for word; none, left out.
**Files**: `path` interface · `path` inside — every file it will edit, declared at its claim.
**Done when**: a command that exits 0, or what is observed; the tests the mandate asks for, by case.
**Not this**: what a reader would assume is included and is not; the boundary it must not cross.
```

- **An interface** is everything a caller must know: signatures, invariants, ordering, error
  modes. A task that creates or changes one carries it **as code, bodies never**: the exports
  with their types; a change shows before and after and every caller. An agreed `module`
  document (the `deepen-module` skill) is quoted word for word.
- **Files** are `interface` when another task imports or calls through them, `inside` when only
  this task reads them; a file two tasks of the phase both edit is named in both, and the two
  workers settle it on the board.
- **A task that outgrows a post** (a module's design, a migration, a screen's states) links a
  short document in aiview, kind `task`, in the plan's group when there is a plan; the post keeps
  its goal, files and done-when. The exception, never the habit.
- **The design is the plan's**: a decision the task needs that the plan does not carry is a
  question to the person, never one taken in the task.

## Cutting a phase into tasks

- **Thin and vertical**, through every layer the change touches, each verifiable end to end when
  it lands; by layer only when one check holds every step, and the plan says so.
- **One task is one worker's context.** The riskiest unknown first.
- **The tasks of one phase never block each other**; work that must wait for merged work goes in
  a later phase.
- **Every merge leaves the branch green**: complete, or inert where it is not yet, and the task
  says what makes it inert.
- **A fix task names the findings it fixes** (`FIX F1 + F4`), from the judged table.
- **Cut to the seats the person chose**: more seats than the work cuts into naturally, split
  further (by part of the feature, by layer, code apart from its tests, a later phase's
  independent part brought forward) until each seat has a task in the phase; fewer, merge tasks.
  A split that makes two tasks share a file names both in their files and lets the workers settle
  it on the board.

| Thought | Reality |
|---|---|
| "Schema first, then the API, then the screens" | Nothing is verifiable until the last task. |
| "I'll write the tasks with the plan" | They go stale at the first merge; a phase's tasks are written at its open. |

## A report

The worker's report is one post to `@orchestrator`, given with its merge as the swarm-board skill's `references/worker.md` says: done or not, the commit when it merged, each
done-when with its evidence, what it shaped around the task and why, and anything the task did
not predict. **Re-run the done-when on the merged branch** before the task counts as done.
