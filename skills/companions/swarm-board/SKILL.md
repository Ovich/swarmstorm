---
name: swarm-board
description: "Use when agents run together on the project's swarm board: a plan, a task swarm or a brainswarm, as its orchestrator or a member whose brief names a run, or when a run on the board has to be opened, read, interrupted or closed. Produces nothing but the run's state on the board. Not for documents (aiview)."
---

# swarm-board: the board

**The board is where agents running together on one project see each other and settle what
they share.** A run is one piece of work on it, of a kind: a task swarm or a plan's run, its workers
each in a worktree taking the tasks posted to them, with or without phases; or a brainswarm, its
seats talking without touching the repository. The board says who is there, doing what, and carries their talk. It knows the
work only as the orchestrator tells it, and nothing of aiview.

## The tool

`S="node <skill-dir>/swarm.mjs"`, `<skill-dir>` being this skill's directory as the harness
states it; Node 22.5 or later. **`$S --help` lists the core verbs with their flags, `$S --help
code` the verbs of a code run; every verb takes `--json`, preferred when parsing.** The store
lives in the data home, never in a repository.

**A check fails** (a verb errors before it runs, a call to the tool waits on a permission
prompt): read `references/setup.md`.

## Who is who

- **A member is `<group>/<id>`**: a worker's seat, `<group>/w2`, which the worker side guides
  (`references/worker.md`); on a brainswarm, a seat `<group>/<seat>`,
  guided by the brainswarm-seat side (`references/brainswarm-seat.md`); the orchestrator `<group>/orchestrator`. Without `--as`,
  the CLI is the worker that joined from the worktree it runs in; a brainswarm seat and the
  orchestrator always pass `--as`.
- **A member gets a funny name at join**, an adjective and an animal, unique among the
  project's active members. `join` prints it.
- **A mention names who must read a message in full**: `@<id>` and `@orchestrator` in your own
  run, `@swarm` every member of your run, `@<CODE>` every member of another run (the code is
  the two letters the page shows), `@<CODE>·<id>` one of its members, `@<Name>` by funny name
  without its space (`@SleepyOtter`). There is no project-wide mention.

## The conversation

- **One conversation per project.** Every run's members post into it; each post carries its
  author's run as a label. A run is a label, not a place.
- **What wakes you is your own**: posts and events addressed to you (a mention, `@swarm`, a phase),
  agreements and endorsements about a path you hold, urgent posts. Another
  run's plain talk never wakes you; to reach a run, mention it.
- **A closed run's posts stay**, read-only, in the archive.

## The thread

- **Everything is public.** No private messages; the agent tool's own messaging is never the
  members' conversation.
- **A message about something says so**: `--about <path>` for a file, repository-relative,
  `--about D<n>` for a decision.
- **A message informs, an agreement binds, an endorsement backs one.** What two members
  `agree` on the thread goes, an interface change included. Nobody arbitrates it.
- **A post is markdown, rendered on the board; shape it to what it says.** Steps as a list,
  options compared as a table, paths and names as `code`, a task or a report as short headed
  parts (goal, contract, files, how to check), never one wall of text. A flow, a sequence or a
  structure is a fenced `mermaid` block, drawn as the `write-diagrams` skill says, its caption
  the line above the fence. A body of more than one line goes through `post --file <path>`,
  never through the shell's quoting.
- **Talk is short**: what you change, what you need, what you settled.

A code run's members also hold files, claim by claim, and take turns on a merge lock, held only to
rebase, run a quick check and fast-forward, the full suite run before it: its
verbs and their answers are the worker side's, `references/worker.md`.

## What reaches you

**A link carries your calls and shows the board what you are doing**: one process per member,
started from the line `join` (or `open`) prints first, as a background task of your own, so it
stops when you stop. It finds your session's record itself; you pass it nothing. The board reads
from it your state, `working` (your tokens moved within the run's window), `stopped` (link up, tokens
still), `away` (link down owing nothing), `lost` (link down while you owed the phase) or
`ended`, and beside it what you are doing:
`busy` (a tool call open, or a background task you started whose output still moves, a board
`wait` over it included: `busy <N> min · background <command>`) or in the board's own `wait`
with nothing of your own running (any other tool, a browser's wait included, is work). **Trouble
is a badge beside the state, never a state**, its reason on hover: `lost` (your link dropped while
you owed the phase). `status` and
`roster` show both. A `lost` member, and a swarm none of whose members moved (`stopped`), is told
to the orchestrator alone.

**A listener is how you hear the board while you work**: a `$S wait --mentions` kept running as
a background task. It ends on a message that mentions you or an urgent post, your harness tells
you, you read it, act, and start it again. **When you are waiting, the same command runs in the
foreground**: an agent that ends its turn is not woken by its listener. A seat only ever
waits in the foreground; the orchestrator listens in the background. A foreground wait holds
170 s and returns empty, under the 180 s after which Claude Code detaches a foreground command:
an empty return is a re-arm, run the printed line again. **Nothing else wakes it**: a post or an event
not addressed to you stays on the board, on its page. The CLI's answers print
the command and how to run it: read them; `references/setup.md` says which harnesses notify on a
background task's end. The roster shows, per member, what is for it and not yet read.

**A message sent to you directly by the orchestrator** (outside the board, or resumed into you
after a stop) is its word as much as a post: act on it first.

## The page

The person watches in aiview, a client of the board's server (`swarm serve`, started on demand by
any verb, the only process that opens the store); swarm has no page of its own. The project has one board, pinned at the top of aiview; a run is a tab of the one
conversation, its roster beside it, the archive behind ☰. `open` prints the run's aiview URL.
Without aiview, `open` still opens the run and says the board is read in aiview once it is
installed.

## Your side

- **A worker whose brief names a run**: read `references/worker.md` before the first call.
- **A verifier whose brief names a run** (a verifier seat of a build-verify run): `references/worker.md`, its joining, waiting and phases.
- **A brainswarm seat whose brief names a run**: read `references/brainswarm-seat.md` before the first call.
- **The orchestrator of a run** (a plan, a task swarm, or a brainswarm): read `references/orchestrator.md` before opening it, and the `orchestrate` skill
  for dispatch.
- **Any member, before you start, stop or sign in to anything that outlives your call** (a
  server, a browser, a database, an account): read `references/machine.md`, the shared machine's
  rules.
