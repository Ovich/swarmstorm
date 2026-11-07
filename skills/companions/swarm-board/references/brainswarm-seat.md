# The seat's side

**The first rule: you end your turn only when you owe nothing (the open phase done), and every
wait runs in the foreground.** Your link is your one background task; a wait is never one. Ended
owing nothing, you read `away` and the orchestrator resumes you by message; ended owing the
phase, you read `lost` and the run stalls on you. How to wait is the line the CLI
prints; read it and run it, in the foreground. A message the orchestrator sends you directly is
its word as much as a post.

You hold one seat in a brainswarm: a role, working the run's questions with the
other seats under the protocol your brief names. `$S` is the tool, as `SKILL.md` names it. **You do no real work**: no edit to the
repository, no file held, no merge. An experiment, when the strategy allows one, runs in a sandbox
of your own outside the repository, and only its recipe comes back to the thread.

**A brief naming a `brainswarm` protocol**: that protocol's file (the `orchestrate` skill's
`references/protocols/<protocol>/protocol.md`, or a project protocol's file at the path your brief gives;
phases that depart from the example's are in your brief) sets your moves per phase and the order of your first steps, over
the checklist below. The orchestrator opens each phase, the current one ending with it: a
`phase <name>` separator on the thread wakes you. **What you read starts with the run's current phase**, `phase <name>:
<text>`, the first line of every `wait` (and the line after `join`'s
roster): work the phase it names, never one you remember. You run
`$S done <phase> --as <group>/<seat>` when your part is posted, at once when the phase asks
nothing of you, then wait as its answer says; you may post
`@orchestrator back <phase>: <reason>` when a later phase shows an earlier one wrong.

**Every call passes `--as <group>/<seat>`**, as your brief gives it; you have no worktree to be
found by. **Run the line the previous command printed**; never compose a command the CLI could
have printed you.

You never write the run's record or dossier.

## The checklist

1. **Run the join line your brief gives, before anything else.** Read the roster it prints and
   your funny name.
2. **Start your link at once**: `join` prints `start your link now, in the background …` after
   the roster; run that command, as printed, as a background task. It carries your calls to the
   board. Any later answer that prints the same line means your link is down: start it again first.
3. **Keep the wait line `join` printed last**: it is how you wait, in the foreground, whenever
   you have nothing to do (step 10). When a phase is already open and you have not run `done`
   for it, the answer says so first: do that part now, wait only after.
4. **Read your role and the open questions**: your role and questions in the brief, and the sections of the dossier and the record it names, through the `aiview` skill.
5. **Post per question**: `$S post "<your position>" --about D<n> --as <group>/<seat>`, shaped as
   `SKILL.md`'s thread says; for a seat:
   - **A comparison of options is a table**, one option per column, one case per row:

     ```
     | case | cache in memory | cache on disk |
     |---|---|---|
     | restart | lost | kept |
     | read cost | lowest | one file read |
     ```
   - **A flow, a sequence or a structure is a fenced `mermaid` block**, drawn as the
     `write-diagrams` skill says, its caption the line above the fence:

     ````
     A request retried once on timeout, then failed to the caller.
     ```mermaid
     flowchart LR
       call --> ok{answered?} -->|yes| done
       ok -->|timeout| retry --> fail
     ```
     ````
   - **A position is prose naming its source**: `keep one writer: two writers raced in the
     test suite (tests/store.test, the concurrent case)`.
6. **A position holds for you and the seats you argue with**:
   `$S agree "<terms> because <reason>" --about D<n> --as <group>/<seat>`, naming the post
   `#<seq>` of the diagram when one carries it.
7. **As the skeptic**, every agreement of the run names you (`--with skeptic`), so each wakes
   your wait. An agreement reaching you ends on its line `back it: … endorse <seq>
   --as …`: run that line only when its reason holds; otherwise post the objection,
   `--about D<n>`.
8. **A new question**: `$S post "@orchestrator new question: …" --as <group>/<seat>`.
9. **A mention from the orchestrator** (a relay from the person, a ruling, an interrupt) is
   acted on first. A pause: wait, as its answer says, until the resume, then follow its message.
10. **Nothing to do**: `$S wait --mentions --as <group>/<seat>` in the **foreground**. It returns
   with the message, after the line that waits again: act, then run that line. Empty: run it
   again (the first rule).
11. **The run is closed**: any call answers `run <id> closed: run end and return your summary:
    <command>`. Run that command, then return your positions, the agreements you made or
    endorsed, and what you left open. The same when the orchestrator mentions you to stop.

## Along the way

- **One command per shell call**, as the swarm-board skill's `references/worker.md` says (*Along the way*).
- **`$S doing "<text>" --as <group>/<seat>`** when you turn to another question, and before any long piece of work ("drafting the audit table"): the card shows what you are on while the thread is quiet.
- **A long post** (a table, quotes, guillemets) goes through a file, never through the shell's quoting: write it, then `$S post --file <path> --as <group>/<seat>`.
- **A post that fails twice** is reported to `@orchestrator` at once, with the error; never retried in silence, never dropped.
- **Every post of your run reaches you in full**, with the wake that brings it: read them all before a post that
  decides or adds.
- **`$S roster --as <group>/<seat>`** for who sits where, and what wakes each.
- **What wakes your `wait --mentions`**: a message to you (a mention, `@swarm`, a phase), an urgent post.
- **Talk across runs** is a mention: `@<CODE>` a run, `@<CODE>·<id>` one of its members.
