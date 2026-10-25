# The orchestrator's side

You told the board the work, you watch the run, and you are the only one who interrupts.
`$S` is the tool, as `SKILL.md` names it; every verb here takes `--as <group>/orchestrator`
except `open`, `slice`, `close` and `status`.

## Open the run

1. **The seats file**, one entry per member the run will have.
   - **A task swarm or a plan's run**: one row per seat for the whole run, the builders `w1` …
     `w<n>` and the verifiers `v1` … `v<m>`, each with its role and area as `role`; on a plan, the
     plan's aiview URL as `link`. Tasks are posts, never rows:

     ```json
     [{ "id": "w1", "title": "worker", "role": "builder · the api", "link": "<plan URL>" },
      { "id": "v1", "title": "verifier · the app", "role": "verifier, app owner", "link": "<plan URL>" }]
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
     gets its kind's defaults: none for a member; for you, `merged, ended, stale` on a code run,
     `agreement, endorsement, ended, stale` on a brainstorm. A member's `join --on` replaces
     its row's list; `subscribe` / `unsubscribe` change it later.

2. **From the repository's checkout:**
   `$S open --kind <plan|brainstorm|task> --group <slug> --title "<title>" --seats <file> --link <plan or board URL>`,
   with `--protocol <name>` when the run runs one (build-verify, debate, …; the tab shows it).
   `--plan <slug>` stays an alias of `--kind plan --group <slug>`, `--slices` of `--seats`. It
   prints the run id, the link to the project's board page in aiview (`/board`; `/board#run=<id>`
   opens this run's tab), then the line that starts your link: give the link to the person, who
   watches the run there, and run the line as it says.
3. **You register nothing for liveness.** Each member's link finds its transcript in the
   session and reports its activity; the board derives each member's state from it (`SKILL.md`
   names them). `--stall-ms <ms>` sets how long a member may stay `quiet` before you are told,
   default 60000.

## Dispatch

**The `orchestrate` skill dispatches.** For a kind without worktree, no `isolation`, and each
brief carries `--as <group>/<seat>` and the join line, whose answer tells the seat how it
waits: in the foreground; a seat runs on the plugin's
`brainswarm-seat` agent, as the `brainswarm` skill says.

## Seat states

The CLI calls a seat's row a `slice`.

- **`$S slice <seat> --run <run> --state running`** at its dispatch; `blocked` when it waits on a
  person; `done` when the seat leaves the run.
- **A worker stays for the whole run**, task after task. One whose context runs long is ended
  (`end`) and a fresh worker joins the same seat.
- **A seat added mid-run**: `$S slice add <seat> --run <run> --title "<title>" [--link <url>]
  [--role <role>] [--on <events>]`. It lands after the last, `ready`; an id already in the run or
  a closed run is refused. Then dispatch it like the others.

## Watching the thread

- **Listen in the background from the open**: `$S wait --mentions --as <group>/orchestrator`,
  started with the harness's background-task feature; you are not a subagent, its end reaches
  you. The answers of `phase` and of your `wait` print this step: read them. Your subscriptions (a worker's `merged`
  and `ended`, `stale`), every `done`, `idle`, `stalled` and `liveness` event and every mention
  of you wake it. When it ends, read its output, act, and start it again at once, in the
  background. **Block only on the board's verbs**: never a foreground loop, a poll or a sleep of
  your own, which the board cannot end and which leaves you deaf. Empty, start it again. `close`
  makes it return.
- **Five events reach you alone**; no member is woken by them, and `stalled` and `idle` never
  fire while the run is paused. Each ends on the step it asks for.
  - **`stalled <member>`**: that member owes a move it is not making; once, then every 15 min
    while it lasts. It names its rule, the member's last line and, on the line after it, the
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
  - **`idle`**: every member is `waiting` in a board wait; once when it begins, then every
    15 min while it holds. The swarm waits on you: open the next phase if all are done, else
    answer whoever waits on you, else wait again.
  - **`liveness`**: no transcript was found for a member 30 s after its join; once. Its state
    is presence only (`waiting` or `quiet`, never `working`) and `stalled` never names it: judge
    it by its posts and its doing, and mention it when it falls silent.
    Or its link was lost while its transcript still grows (`link lost, transcript still
    growing`): it is working, not `gone`; restart its link, as the line says.
- **A `merged` event is a task to check**: re-run its done-when on the branch it merged into then,
  not when the worker's report arrives; the report adds what it found.
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
  still in the run count toward `all-done`.
- **`$S roster`** (and `status`) shows each run's title, current phase and its `<n>/<m> done`,
  then each member's state with its open or last tool, its doing and its files; `(stale)` after
  ten minutes without a call to the board.

## Interrupt

**To stop the whole run**, `$S pause "<why>" --as <group>/orchestrator`: every member is told to
stop and wait, claim and merge-lock are refused, and no stall, quiet or stale alert fires.
`$S resume "<what changed, what to do>" --as <group>/orchestrator` lets them go on, the message
in their wake. The answers print the next step.

**A mention reaches a `waiting` member at once**, and one with a listener when its listener ends;
the roster's `unread` shows what it has not read yet. **You may always message a member
directly** (`SendMessage`), whenever you judge it faster: a member busy in a long run of work, a
seat between its waits, one that is `quiet`. Post it on the board too, so the thread has it:

1. **`$S post --as <group>/orchestrator "@<seat> <the message>"`**.
2. **`SendMessage` to the member with the same message**; when it does not take it mid-call,
   stop it (`TaskStop`) and resume it with that message. It resumes with its context.

## A gone member

**Its state decides, never a guess.** `quiet` is alive and owes a move: *Interrupt*. `gone`:
**`$S slice <seat> --run <run> --state done`** frees its claims and the merge lock if it held it;
set the seat back to `running` and dispatch a fresh worker, which joins the same seat; repost its
open task.

## Close

**`$S close --run <run>`** once the work is done (a task left to the person never holds it
open), or the brainstorm concluded; it archives the run's posts. **Before ending
your session, close** the run you opened unless it is still being worked: one left open stays an
active tab. `$S status` flags a run idle a day with its close command; ask the person, then close. A member's pending `wait`, and any call it makes after, answers with the
`end` command to run and the summary to return.
