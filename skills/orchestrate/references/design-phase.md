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
- **Built on the board one section at a time, and only there**: no design file. In the format's
  order, the designer posts a section to `@orchestrator`, shown the way it is best understood: a diagram
  (the module map, a sequence, a state, through the `write-diagrams` skill), pseudo-code over the
  entries, signatures, a table. You judge it and post `§<n> accepted` or what to change; **the
  next section is posted only after that answer**, never ahead of it (sections crossing your
  answers cost rounds). A section with nothing to say is one line, accepted with the next.
- **§3 is one post per deep module**, the designer having read the `deepen-module` skill first,
  after one post of the module map (a diagram: who imports whom, the imports that must not exist).
  Each module's post: its usage (the code a caller writes), its entry as signatures without
  bodies, what it hides, what stays outside, the `deepen-module` conditions each marked held or
  broken, the gap from today.
- **The accepted section posts are the design**: a task cites the post it implements
  (`#<seq> §3`), quoting its entries word for word. A section changed later is posted again, its
  change listed first, and the new post is the one cited. A body too long for one shell argument
  goes through `post --file` from a scratch file, deleted once posted: the board holds the design,
  never a file.
- **Open decisions are rows**, each with its options and a recommendation; the designer settles
  them with you on the board, never with another seat.

## Your duties

- **The design message** names the design scope (`design scope:` in the charter: the areas, the
  modules expected, what is out), the charter's constraints, what the person asked in their
  words, and the branch the code is read on.
- **Judge each section as it lands**: read it as a cold reader would (could a seat carry a task
  out from it alone?), then post `§<n> accepted` or what to change; after the last section,
  `design accepted`. **A module's post is judged against the `deepen-module` skill**: every export
  a named caller needs, one entry per case the callers are in, the conditions held; a broken
  condition goes back, unless a decision row accepts it and says what is owed. You accept it; the person is asked only when a decision is theirs (outside your
  authority) or changes what they asked.
- **Cut the protocol's first tasks from the design**: one task per entry or module, each quoting
  its entry word for word and citing the section post and decision ids (`#<seq> §3`, `D3`), with
  its done-when and its boundary.
- **The design reopens** only when a judged finding changes an accepted entry or decision, or you
  judge the design wrong: a short `design <k>` on those rows alone, before the protocol's next
  round. A finding inside the design is a task as usual.

## Phase message

| phase | text |
|---|---|
| design | `design <k>: the design message is posted to the designer. Designer: post the design one section at a time, in the design format's order, each as a diagram, pseudo-code or table, and wait for the section's accepted before the next; done design once the design is accepted. Every other seat: on call, change nothing, done design now.` |
