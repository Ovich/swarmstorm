# The design phase

**A building block any protocol's run can open with, when the person asks for it** (charter
`design:`): the work is designed on the board before anyone builds, writes or walks it, in the one
design format, and accepted by you. Then the protocol's own phases run, as many rounds as its loop
says, every task quoting the design. Most fitting before code (`build-verify`, `idea-to-outcome`
per idea); a plan has its design in the plan and needs none.

## Who designs

| `design:` | Who | Does |
|---|---|---|
| `d1` | a designer seat, the plugin's `designer` agent, no worktree | design: reads the code the work lands in, writes the design, posts it, settles your questions, `done design`; later phases: on call, answers a question on the design, changes nothing, `done` at once |
| `orchestrator` | you | the design yourself, in the same format, posted the same way; no `d1` |
| `none` | | no design phase (the default) |

**Every other seat is on call during the design**: answers a question on the code it knows,
changes nothing, `done design` at once.

## The design

- **The format is the `orchestrate` skill's `references/design.md`**, read before the first line:
  why and why not, before and after, the modules after, the flows as pseudo-code, state and its
  writers, failure modes, the decisions, the guides. Every major area is a deep module, designed
  as the `deepen-module` skill says; read against the code it lands in, cited `file:line`.
- **One file, posted once and re-posted whole**: `<topic>.design.md` in the data home (its path
  from the `aiview` skill's `aiview path`, never in the repository), posted with `$S post --file`
  to `@orchestrator`; a revision is the whole file again, its changes listed first.
- **Open decisions are rows**, each with its options and a recommendation; the designer settles
  them with you on the board, never with another seat.

## Your duties

- **The design message** names the design scope (`design scope:` in the charter: the areas, the
  modules expected, what is out), the charter's constraints, what the person asked in their
  words, and the branch the code is read on.
- **Accept the design, or send it back**: read it as a cold reader would (could a seat carry a
  task out from it alone?), challenge every export no caller needs, then post `accepted` or the
  rows to change. You accept it; the person is asked only when a decision is theirs (outside your
  authority) or changes what they asked.
- **Cut the protocol's first tasks from the design**: one task per entry or module, each quoting
  its entry word for word and citing its decision ids (`<topic>.design#D3`), with its done-when
  and its boundary.
- **The design reopens** only when a judged finding changes an accepted entry or decision, or you
  judge the design wrong: a short `design <k>` on those rows alone, before the protocol's next
  round. A finding inside the design is a task as usual.

## Phase message

| phase | text |
|---|---|
| design | `design <k>: the design message is posted to the designer. Designer: write the design in the design format, post it with post --file to @orchestrator, then done design once it is accepted. Every other seat: on call, change nothing, done design now.` |
