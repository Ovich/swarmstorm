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
     [{ "id": "w1", "title": "worker", "role": "builder · the api", "link": "<plan URL>" },
      { "id": "v1", "title": "verifier · the app", "role": "verifier", "link": "<plan URL>", "busyMax": 300000 }]
     ```

   - **A brainstorm**: every seat, with its `role` and the brainstorm board's URL as `link`;
     the seat's row on that board is named in its brief:

     ```json
     [{ "id": "skeptic", "title": "<the seat's title>", "role": "<the role>", "link": "<brainstorm board URL>", "on": ["agreement"] },
      { "id": "builder", "title": "<…>", "role": "<…>", "link": "<…>" }]
     ```

   - **`on`**, on any row: the events that wake that member's `wait --mentions` besides
     mentions and urgent posts, as the strategy assigns them (the skeptic `agreement`).
     `any:<event>` for one of any run, a plain `<event>` your own run's; `$S --help` lists the events. A row without `on`
     gets its kind's defaults: none for a member; for you, waking on `ended, stale` and
     carrying `done, joined, idle` on a code run, waking on `agreement, endorsement,
     ended, stale` on a brainstorm (*Watching the thread* says what carried means). An explicit
     `subscribe merged` wakes, and replaces the carry. A member's `join --on` replaces
     its row's list; `subscribe` / `unsubscribe` change it later.
   - **`busyMax`** (ms), on any row: how long a **non-shell** call (a browser or other tool step)
     of that seat may stay open before `stalled · call` tells you; a shell call keeps its own
     timeout and the default 15 min. Set it on a verifier (`300000`), where a hung browser step
     would hold the walk. `seat add <id> --busy-max <ms>` sets it on a seat added later.

2. **From the repository's checkout:**
   `$S open --kind <plan|brainstorm|task> --group <slug> --title "<title>" --seats <file> --link <plan or board URL>`,
   with `--protocol <name>` when the run runs one (build-verify, debate, …; the tab shows it), or
   `--protocol none` for a run with no phases on purpose. A run that builds code (plan, task)
   takes `--onto <branch>`, the branch its work merges into: each member's join makes its
   worktree from it, under the data home, never in the repository, and the cleanup checks a
   worktree's branch is merged into it. Without `--onto`, the checkout's branch at the open.
   `--plan <slug>` stays an alias of `--kind plan --group <slug>`. It
   prints the run id, the link to the project's board page in aiview (`/board`; `/board#run=<id>`
   opens this run's tab), then the line that starts your link. `open`'s last line is the next
   step: the first phase, or why there is none. Give the link to the person, who
   watches the run there, and run the line as it says.
3. **You register nothing for liveness.** Each member's link finds its transcript in the
   session and reports its activity; the board derives each member's state from it (`SKILL.md`
   names them). `--stall-ms <ms>` sets how long a member may stay `quiet` before you are told,
   default 60000.

## Dispatch

**The `orchestrate` skill dispatches.** Never with `isolation`: a code run's member gets its
worktree from its join. For a kind without worktree, each
brief carries `--as <group>/<seat>` and the join line, whose answer tells the seat how it
waits: in the foreground; a seat runs on the plugin's
`brainswarm-seat` agent, as the `brainswarm` skill says.

## Seat states

- **`$S seat <seat> --run <run> --state running`** at its dispatch; `blocked` when it waits on a
  person; `done` when the seat leaves the run.
- **A worker stays for the whole run**, task after task. One whose context runs long is ended
  (`end`) and a fresh worker joins the same seat.
- **A seat added mid-run**: `$S seat add <seat> --run <run> [--link <url>]
  [--role <role>] [--on <events>]`. It lands after the last, `ready`; an id already in the run or
  a closed run is refused. Then dispatch it like the others.

## Watching the thread

- **Listen in the background from the open**: `$S wait --mentions --as <group>/orchestrator`,
  started with the harness's background-task feature; you are not a subagent, its end reaches
  you. The answers of `phase` and of your `wait` print this step: read them. The harness's
  task-end notice repeats the wait's answer: one event, already delivered, its last line says so. **These wake it**:
  every mention of you, `all-done`, `stalled`, `gone`, `recovered`, `liveness`, `urgent`, your
  waking subscriptions (`ended`, `stale`), a repeated `idle`, and a member's `done` in five cases,
  its case named in the body: the member is in the phase's `--watch`, it is done without a post
  since you last mentioned it in the phase, it leaves one member owing (the straggler), or it is
  done for a phase that is not current (`late done`). **These are carried**: any other
  `done`, `joined`, a first `idle` after `all-done`. A carried line does not end your wait; it
  comes with the next wake, one line each, and wakes you itself after 5 min if nothing else did.
  To hear a member's `done` the moment it lands (one others wait on, work you judge early), open
  the phase with `--watch <ids>`. When it ends, read its output, act, and start it again at once, in the
  background. **Block only on the board's verbs**: never a foreground loop, a poll or a sleep of
  your own, which the board cannot end and which leaves you deaf. Empty, start it again. `close`
  makes it return.
- **Five events reach you alone**; no member is woken by them, and `stalled` and `idle` never
  fire while the run is paused. Each ends on the step it asks for.
  - **`stalled <member>`**: that member owes a move it is not making; never carried. Members
    stalled at one tick come in one line, `stalled <group>: N members: …`, each with its rule,
    and the `next` line gives each member's move after its name. Told again when the set of
    stalled members changes, or every 15 min for the same set, still one line. It names its rule, the member's last line and, on the line after it, the
    move that rule asks for: `turn ended` (a post does not wake it), `in turn, no line for 2 min`
    (its model may be hung), `background <cmd> silent 60 s` or `15 min` (a task it awaits),
    `call open 15 min, may be long or hung`, `waiting, not done <phase>` (it waits while owing
    its part). **Read that `next` line and make that move**: the rule says why the member is
    stuck, so it alone knows what reaches it, a mention for a member in a wait, a direct message
    for one whose turn ended. A member waiting on a task it just started reads `busy ·
    background <cmd>` and draws no alert.
  - **`gone <member>`**: its agent finished without `end`, or its link has been lost 30 s and
    its transcript has not grown for 30 s; once. It is not running: dispatch a fresh agent into
    its seat, or close the seat (*A gone member*).
  - **`recovered <member>`**: a member told `gone` reads alive again; once. Do not dispatch into
    its seat; if you already did, close one of the two.
  - **`idle`**: every member is `waiting` in a board wait; once when it begins, then again
    only if something changed on the board since (a post, a member leaving its wait), at most
    every 15 min. The swarm waits on you: open the next phase if all are done, else
    answer whoever waits on you, else wait again.
  - **`liveness`**: no transcript was found for a member 30 s after its join; once. Several
    due at one tick come in one line, each member named. Its state
    is presence only (`waiting` or `quiet`, never `working`) and `stalled` never names it: judge
    it by its posts and its doing, and mention it when it falls silent.
    Or its link was lost while its transcript still grows (`link lost, transcript still
    growing`): it is working, not `gone`; restart its link, as the line says.
- **A merge report is a task to check**: the worker's `@orchestrator merged <sha>: <report>`,
  posted by `merged --report`, is the one wake of a merge; the `merged` event itself no longer
  reaches you (`subscribe merged` to hear it). Re-run the done-when at the sha it names, not at
  the branch's tip by then; the report adds what it found.
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
  then each member's state with its open or last tool, its doing and its files; `(stale)` after
  ten minutes without a call to the board.

## Interrupt

**To stop the whole run**, `$S pause "<why>" --as <group>/orchestrator`: every member is told to
stop and wait, claim and merge-lock are refused, and no stall, quiet or stale alert fires.
A paused run is silent for you too: only `urgent` wakes you; everything else (`gone`,
`liveness`, `recovered`, `done`, `all-done`) is held, and the 5 min carry does not run.
`$S resume "<what changed, what to do>" --as <group>/orchestrator` lets them go on, the message
in their wake, and its answer hands you every held line, one each. The answers print the next step.

**While the run waits on the person**, pause it: `$S pause --person "<what they decide>" --as
<group>/orchestrator`. The members' paused line and the viewer then say `waiting on the person:
<what>`; a protocol's human phase opens with it. Resume with their answer.

**A mention reaches a `waiting` member at once**, and one with a listener when its listener ends;
the roster's `unread` shows what it has not read yet. **You may always message a member
directly** (`SendMessage`), whenever you judge it faster: a member busy in a long run of work, a
seat between its waits, one that is `quiet`. Post it on the board too, so the thread has it:

1. **`$S post --as <group>/orchestrator "@<seat> <the message>"`**.
2. **`SendMessage` to the member with the same message**; when it does not take it mid-call,
   stop it (`TaskStop`) and resume it with that message. It resumes with its context.

## A gone member

**Its state decides, never a guess.** `quiet` is alive and owes a move: *Interrupt*. `gone`:
**`$S seat <seat> --run <run> --state done`** frees its claims and the merge lock if it held it;
set the seat back to `running` and dispatch a fresh worker, which joins the same seat; repost its
open task.

**An idle member ends itself.** One that owes nothing (no phase part, no mention, no claim) and
whose wait returned empty twice in a row is told to `end` and return; you hear it as `ended`.
That seat is not done, only dormant: it stays in the run's phases, all-done waits for it, and
the `phase` answer names it with how to wake it; dispatch into it again, a fresh agent that
joins the same seat, or the ended one resumed (`SendMessage`) with the task.

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
