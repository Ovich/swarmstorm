# The orchestrator's side

You told the board the work, you watch the run, and you are the only one who interrupts.
`$S` is the tool, as `SKILL.md` names it; every verb here takes `--as <group>/orchestrator`
except `open`, `seat`, `close` and `status`.

## Open the run

1. **The seats file**, one entry per member the run will have.
   - **A task swarm or a plan's run**: one row per seat for the whole run, the builders `w1` …
     `w<n>` and the verifiers `v1` … `v<m>`, each with its role and area as `role`; on a plan, the
     plan's aiview URL as `link`. Tasks are posts, never rows:

     ```json
     [{ "id": "w1", "role": "builder · the api", "link": "<plan URL>" },
      { "id": "v1", "role": "verifier", "link": "<plan URL>" }]
     ```

   - **A brainstorm**: every seat, with its `role` and the brainstorm board's URL as `link`;
     the seat's row on that board is named in its brief:

     ```json
     [{ "id": "skeptic", "role": "<the role>", "link": "<brainstorm board URL>", "on": ["agreement"] },
      { "id": "builder", "role": "<…>", "link": "<…>" }]
     ```

   - **`on`**, on any row: the events that wake that member's `wait --mentions` besides
     mentions and urgent posts, as the strategy assigns them (the skeptic `agreement`).
     `any:<event>` for one of any run, a plain `<event>` your own run's; `$S --help` lists the events (an old name, `gone`, `stale`, `quiet`, `stalled` or `idle`, is read as `lost` or `stopped`, and the answer says so). A row without `on`
     gets its kind's defaults: none for a member; for you, waking on `ended, stopped` and
     carrying `done, joined` on a code run, waking on `agreement, endorsement,
     ended, stopped` on a brainstorm (*Watching the thread* says what carried means). An explicit
     `subscribe merged` wakes, and replaces the carry. A member's `join --on` replaces
     its row's list; `subscribe` / `unsubscribe` change it later.

2. **From the repository's checkout:**
   `$S open --kind <plan|brainstorm|task> --group <slug> --title "<title>" --seats <file> --link <plan or board URL>`,
   with `--authority <roles>` naming the roles the person handed you (the `orchestrate` skill's
   `references/authority.md`); every open's answer ends on the line registering your run on the
   project's permanent orchestrators board (its `references/orchestrators-board.md`): run it,
   with `--protocol <name>` when the run runs one (build-verify, debate, …; the tab shows it), or
   `--protocol none` for a run with no phases on purpose. A run that builds code (plan, task)
   takes `--onto <branch>`, the branch its work merges into: each member's join makes its
   worktree from it, under the repository's git dir (`swarm/worktrees/<run>/<seat>`, the only folder the board ever removes from), never in its tree, and the cleanup checks a
   worktree's branch is merged into it. Without `--onto`, the checkout's branch at the open.
   `--plan <slug>` stays an alias of `--kind plan --group <slug>`. It
   prints the run id, the link to this run's tab on the project's board in aiview
   (`#board&repo=<project>&run=<id>`; without `&run=`, the project's board), then the line that starts your link. `open`'s last line is the next
   step: the first phase, or why there is none. Give the link to the person, who
   watches the run there, and run the line as it says.
3. **You register nothing for liveness.** Each member's link finds its transcript in the
   session and reports its activity; the board derives each member's state from it (`SKILL.md`
   names them). `--stall-ms <ms>` sets the run's window: a member whose tokens did not move this long reads `stopped`, and when
   none of them moved you are told `stopped`; default and floor 10 min.

## Dispatch

**The `orchestrate` skill dispatches.** Never with `isolation`: a code run's member gets its
worktree from its join. For a kind without worktree, each
brief carries `--as <group>/<seat>` and the join line, whose answer tells the seat how it
waits: in the foreground; a seat runs on the plugin's
`brainswarm-seat` agent, as the `brainswarm` skill says.

## Seat states

- **A seat's state is derived from its member** (`ready`, `running`, `done`); you set none.
  **`$S block <seat> "<what the person decides>" --as <group>/orchestrator`** when one seat waits
  on the person: it carries the `blocked` badge, that text its reason, and is told to stop and
  wait; **`$S unblock <seat>`** with their answer. The seat leaves the run by `end --seat <seat>`.
- **A worker stays for the whole run**, task after task; a member never ends itself while the
  run is open (its own `end` is refused). One whose context runs long is ended by you,
  `$S end --seat <seat> --as <group>/orchestrator` (it refuses while that seat's work is not
  merged), and a fresh worker joins the same seat.
- **A seat added mid-run**: `$S seat add <seat> --run <run> [--link <url>]
  [--role <role>] [--on <events>]`. It lands after the last, `ready`; an id already in the run or
  a closed run is refused. Then dispatch it like the others.

## Watching the thread

- **Listen in the background from the open**: `$S wait --mentions --as <group>/orchestrator`,
  started with the harness's background-task feature; you are not a subagent, its end reaches
  you. The answers of `phase` and of your `wait` print this step: read them. The harness's
  task-end notice repeats the wait's answer: one event, already delivered, its last line says so. **These wake it**:
  every mention of you, `all-done`, `stopped`, `lost`, `urgent`, your
  waking subscriptions (`ended`, `stopped`), and a member's `done` in five cases,
  its case named in the body: the member is in the phase's `--watch`, it is done without a post
  since you last mentioned it in the phase, it leaves one member owing (the straggler), or it is
  done for a phase that is not current (`late done`). **These are carried**: any other
  `done`, `joined`. A carried line does not end your wait; it
  comes with the next wake, one line each, and wakes you itself after 5 min if nothing else did.
  To hear a member's `done` the moment it lands (one others wait on, work you judge early), open
  the phase with `--watch <ids>`. When it ends, read its output, act, and start it again at once, in the
  background. **Block only on the board's verbs**: never a foreground loop, a poll or a sleep of
  your own, which the board cannot end and which leaves you deaf. Empty, start it again. `close`
  makes it return.
- **Two events reach you alone**; no member is woken by them, and neither fires while the run is
  paused. Each ends on the step it asks for.
  - **`stopped <group>`**: no member's tokens moved for the run's window (default 10 min); once,
    again only after one moved. The swarm waits on you, or every member is stuck: read the thread,
    then post the next task, open the next phase, or resume the members by message (`SendMessage`).
    A member's own card reads `stopped` the same way, its link up and its tokens still: a long call
    with no line written (a hung command, a prompt it cannot answer) reads so too.
  - **`lost <member>`**: its link dropped while it owed the open phase; once. Owing is judged at the
    drop: a member whose link drops owing nothing reads `away` and stays away, whatever phase you
    open after, until its link is back. It is not running: dispatch a fresh agent into its seat, or
    close the seat (*A lost member*).
- **A merge report is a task to check**: the worker's `@orchestrator merged <sha>: <report>`,
  posted by `merged --report`, is the one wake of a merge; the `merged` event itself no longer
  reaches you (`subscribe merged` to hear it). Re-run the done-when at the sha it names, not at
  the branch's tip by then; the report adds what it found.
- **A merge past the lock is yours alone**: `merged` refuses a member that holds no merge lock;
  when a merge had to land without it (the holder died mid-merge), record it with
  `$S merged <sha> --files <path>... --report - --unlocked "<why>" --as <plan>/orchestrator`, the why posted in the run.
- **`$S deliver --as <plan>/orchestrator`** between other work: what was said since, mentions of
  you in full. With no background notification in the harness (`references/setup.md`), a
  foreground `$S wait --as <plan>/orchestrator --timeout <ms>` when nothing else is to do.
- **Answer what is asked of you**, on the thread. Two workers' agreement is theirs to make; an
  agreement that changes a decision the plan took is recorded in the plan.
- **A brainstorm's events**: an agreement and its endorsement, an escalation, a new question,
  handled as the `brainswarm` skill's protocol says.
- **Phases**: `$S phase <name> "<what it asks>" --as <group>/orchestrator` opens phase
  `<name>`; the current phase ends with it. A separator on the thread that wakes every member
  of the run, and the run's current phase, the first line of everything a member reads from
  then on. A member runs `$S done <name>` when its part is in, which tells you; when every member
  is done, the board tells you once, `all-done`. Each answer prints the step to run next. Phases
  belong to every kind of run: when to open which is the run's protocol (the `orchestrate` skill's
  protocols), and, for a plan, the phases it names (the `orchestrate-plan` skill). Only members
  still in the run count toward `all-done`. **`--for <seat>[,<seat>]`** when only some seats have
  a part: only they are woken and owe `done`, and `all-done` counts them alone; the others read
  the phase as their first line the next time they read. A seat with nothing to do is never woken
  for it: each wake costs its tokens.
- **`$S roster`** (and `status`) shows each run's title, current phase and its `<n>/<m> done`,
  then each member's state with its open or last tool, its badge and reason in brackets
  (`[lost: its link was lost]`), its doing and its files.

## Interrupt

**To stop the whole run**, `$S pause "<why>" --as <group>/orchestrator`: every member is told to
stop and wait, claim and merge-lock are refused, and no `stopped` or `lost` alert fires.
A paused run is silent for you too: only `urgent` wakes you; everything else (`lost`,
`done`, `all-done`) is held, and the 5 min carry does not run.
`$S resume "<what changed, what to do>" --as <group>/orchestrator` lets them go on, the message
in their wake, and its answer hands you every held line, one each. The answers print the next step.

**While the run waits on the person**, pause it: `$S pause --person "<what they decide>" --as
<group>/orchestrator`. The members' paused line and the viewer then say `waiting on the person:
<what>`, and every member carries the `blocked` badge with that text; a protocol's human phase
opens with it. Resume with their answer. One seat alone waiting on the person: `block` (*Seat states*).

**A mention reaches a `waiting` member at once**, and one with a listener when its listener ends;
the roster's `unread` shows what it has not read yet. **You may always message a member
directly** (`SendMessage`), whenever you judge it faster: a member busy in a long run of work, a
seat between its waits, one that reads `stopped`. Post it on the board too, so the thread has it:

1. **`$S post --as <group>/orchestrator "@<seat> <the message>"`**.
2. **`SendMessage` to the member with the same message**; when it does not take it mid-call,
   stop it (`TaskStop`) and resume it with that message. It resumes with its context.

## A lost member

**Its state decides, never a guess.** `stopped` is alive and not moving: *Interrupt*. `lost`:
**`$S end --seat <seat> --as <group>/orchestrator`** frees its claims and the merge lock if it held
it; dispatch a fresh worker, which joins the same seat; repost its open task.

**An `away` member is resumed, never re-dispatched**: it finished and handed back. Post its next
task, then resume it (`SendMessage`) so it reads it; where the harness has no resume, dispatch a
fresh agent that joins the same seat.

**A member with nothing to do stays; you decide whether to park it.** It is only told to wait
again. On `stopped`, a member its peers may need (one holding files, a debate seat) keeps waiting;
one only you need (a worker between tasks with nothing held, a verifier until its phase) you
park: `$S park <seat> [--until <phase>] --as <group>/orchestrator`. It is told to end its turn
without `end`; its card reads `parked until <phase>`; it carries no badge and raises no
`stopped` or `lost`, its unread kept for its return, and all-done does not wait for it. Only you lift
the park, its own calls never do: `$S unpark <seat>`, then resume it (`SendMessage`) with its next task, or, where the harness has no
resume, dispatch a fresh agent that joins the same seat.

## Close

**`$S close --run <run>`** once the work is done (a task left to the person never holds it
open), or the brainstorm concluded; it archives the run's posts. **Before ending
your session, close** the run you opened unless it is still being worked: one left open stays an
active tab. `$S status` flags a run idle a day with its close command; ask the person, then close. A member's pending `wait`, and any call it makes after, answers with the
`end` command to run and the summary to return.

**`close` cleans up the worktrees the board made for the run**: each one clean and merged goes,
its branch kept; its answer names each one kept and why (uncommitted changes, commits not
merged). Merge or discard what it names, then `$S worktree prune`, which sweeps every worktree
of a closed run that is clean and merged, and names the rest.
