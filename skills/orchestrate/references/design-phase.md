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

- **The format is the short form of the `orchestrate` skill's `references/design.md`**, read
  before the first line: goal, architecture (a diagram), modules (usage and signatures), flows,
  open questions. Never the plan's nine sections. Every major area is a deep module, designed as
  the `deepen-module` skill says, read against the code it lands in.
- **Built on the board one section at a time, and only there**: no design file. In the format's
  order, the designer posts a section to `@orchestrator`, shown the way it is best understood: a diagram
  (the module map, a sequence, a state, through the `write-diagrams` skill), pseudo-code over the
  entries, signatures, a table.
- **Strict turns**: you answer a part naming its post, `#<seq> accepted` or what to change; the
  designer posts the next part only in reply to that acceptance, never ahead of it, and ignores
  any answer of yours naming an older post. You never revise an acceptance once the next part is
  posted: a later problem is a change asked on the part where it shows.
- **Modules are one post each**, after the architecture post, the designer having read the
  `deepen-module` skill first.
- **The accepted posts are the design**: a task cites the post it implements
  (`#<seq>`), quoting its entries word for word. A part changed later is posted again, its
  change listed first, and the new post is the one cited. A body too long for one shell argument
  goes through `post --file` from a scratch file, deleted once posted: the board holds the design,
  never a file.
- **Open questions are one line each**, with a recommendation; the designer settles them with
  you on the board, never with another seat.

## Your duties

- **The design message** names the design scope (`design scope:` in the charter: the areas, the
  modules expected, what is out), the charter's constraints, what the person asked in their
  words, and the branch the code is read on.
- **Judge each section as it lands**: read it as a cold reader would (could a seat carry a task
  out from it alone?), then post `#<seq> accepted` or what to change; after the last part,
  `design accepted`. **A module's post is judged against the `deepen-module` skill**: every export
  a named caller needs, one entry per case the callers are in, the conditions held; a broken
  condition goes back, unless a decision row accepts it and says what is owed. You accept it; the person is asked only when a decision is theirs (outside your
  authority) or changes what they asked.
- **Cut the protocol's first tasks from the design**: one task per entry or module, each quoting
  its entry word for word and citing the module's post (`#<seq>`), with its done-when and its
  boundary. **The task carries the text** (the signatures, the usage, what the flow needs), never
  the post number alone: a member reads only what is addressed to it, and no verb reads the
  thread. A design changed after a task went out: post that member a new task, quoted again.
- **The design reopens** only when a judged finding changes an accepted entry or decision, or you
  judge the design wrong: a short `design <k>` on those rows alone, before the protocol's next
  round. A finding inside the design is a task as usual.

## Phase message

| phase | text |
|---|---|
| design | `design <k>: the design message is posted to the designer. Designer: post the design's short form one part at a time (goal, architecture, modules, flows, open questions), each as a diagram, pseudo-code or signatures, and post the next part only in reply to its acceptance; done design once the design is accepted. Every other seat: on call, change nothing, done design now.` |
