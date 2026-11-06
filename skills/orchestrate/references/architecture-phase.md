# The architecture phase

**A building block any protocol's run can open with** (charter `architecture:`): the system the
work lands in is defined on the board before anyone builds it, in the one design format, accepted
by you, then given its go by the person. Then the protocol's own phases run, as many rounds as its
loop says, every task quoting the architecture. Most fitting before code (`build-verify`,
`idea-to-outcome` per idea); a plan has its architecture in the plan and needs none. **Propose it**
when the work brings a new module, changes an interface, has several builders on code that meets,
or its shape is still unclear: one line, with why. **The person can ask for one mid-run too**,
before the next piece of work: it is a charter amendment (`references/charter.md`), and the
architecture phase runs before that work's tasks are cut.

## Who defines it

| `architecture:` | Who | Does |
|---|---|---|
| `a1` (`a2`… when the scope splits into areas that meet little) | an architect seat each, the plugin's `architect` agent, no worktree, one area each | architecture: reads the code the work lands in, writes the architecture, posts it, settles your questions, `done architecture`; later phases: on call, answers a question on it, changes nothing, `done` at once |
| `orchestrator` | you | the architecture yourself, in the same format, posted the same way; no `a1` |
| `none` | | no architecture phase (the default) |

**Every other seat is on call during the architecture**: answers a question on the code it knows,
changes nothing, `done architecture` at once.

## The architecture

- **The format is the short form of the `orchestrate` skill's `references/design.md`**, read
  before the first line: goal, architecture (a diagram), modules (usage and signatures), flows,
  open questions. Never the plan's nine sections. Every major area is a deep module, designed as
  the `deepen-module` skill says, read against the code it lands in.
- **Built on the board one section at a time, and only there**: no file. In the format's order,
  the architect posts a section to `@orchestrator`, shown the way it is best understood: a diagram
  (the module map, a sequence, a state, through the `write-diagrams` skill), pseudo-code over the
  entries, signatures, a table.
- **Strict turns**: you answer a part naming its post, `#<seq> accepted` or what to change; the
  architect posts the next part only in reply to that acceptance, never ahead of it, and ignores
  any answer of yours naming an older post. You never revise an acceptance once the next part is
  posted: a later problem is a change asked on the part where it shows.
- **Modules are one post each**, after the architecture post, the architect having read the
  `deepen-module` skill first.
- **The accepted posts are the architecture**: a task cites the post it implements (`#<seq>`),
  quoting its entries word for word. A part changed later is posted again, its change listed
  first, and the new post is the one cited. A body too long for one shell argument goes through
  `post --file` from a scratch file, deleted once posted: the board holds the architecture, never
  a file.
- **Open questions are one line each**, with a recommendation; the architect settles them with
  you on the board, never with another seat.

## Your duties

- **The architecture message** names its scope (`architecture scope:` in the charter: the areas,
  the modules expected, what is out), the charter's constraints, what the person asked in their
  words, the branch the code is read on, and the accepted prototype's link when a prototype phase
  ran first (`references/prototype-phase.md`): the architecture serves its screens.
- **Judge each section as it lands**: read it as a cold reader would (could a seat carry a task
  out from it alone?), then post `#<seq> accepted` or what to change; after the last part,
  `architecture accepted`. **A module's post is judged against the `deepen-module` skill**: every
  export a named caller needs, one entry per case the callers are in, the conditions held; a
  broken condition goes back, unless a decision row accepts it and says what is owed.
- **The person gives the go** before any task is cut, unless their authority delegates the
  architecture to you (`references/authority.md`): a human phase, the run paused on them
  (`pause --person`), with a short summary, the decisions taken, the module map as a diagram and
  the board's posts named. Their changes go back to the architect; their go resumes the run.
- **Cut the protocol's first tasks from the architecture**: one task per entry or module, each
  quoting its entry word for word and citing the module's post (`#<seq>`), with its done-when and
  its boundary. **The task carries the text** (the signatures, the usage, what the flow needs),
  never the post number alone: a member reads only what is addressed to it, and no verb reads the
  thread. A part changed after a task went out: post that member a new task, quoted again.
- **The architecture reopens** only when a judged finding changes an accepted entry or decision,
  or you judge it wrong: a short `architecture <k>` on those rows alone, before the protocol's
  next round, then the person's go again. A finding inside the architecture is a task as usual.

## Phase message

| phase | text |
|---|---|
| architecture | `architecture <k>: the architecture message is posted to the architect. Architect: post the short form one part at a time (goal, architecture, modules, flows, open questions), each as a diagram, pseudo-code or signatures, and post the next part only in reply to its acceptance; done architecture once it is accepted. Every other seat: on call, change nothing, done architecture now.` |
