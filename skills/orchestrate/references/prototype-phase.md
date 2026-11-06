# The prototype phase

**A building block any protocol's run that changes a screen can open with** (charter
`prototype:`): a new screen, a new user story, new components, or a visual rework is prototyped
before anyone architects or builds it, the swarm's ideas forwarded to one prototyper, then tried and
given its go by the person. **The prototype is a high-fidelity, working mockup**: the real
design language, real states, real interactions, close to pixel-exact; never a wireframe. It is
the reference the whole run holds the screens to: the builders build to it, the verifiers judge
against it, and the delivered screen matches it to the pixel. **It runs first**: with an architecture phase too, the accepted
prototype is one of the architecture's inputs (what the screens need tells the system what to
hold), then the protocol's own phases run, every task touching a screen citing the prototype.
**Propose it** whenever the work adds or changes what a user sees: one line, with why. **The
person can ask for one mid-run too**: a charter amendment (`references/charter.md`), run before
that work's tasks are cut.

## Who prototypes

| `prototype:` | Who | Does |
|---|---|---|
| `p1` (`p2`… when the screens split into flows that share little) | a prototyper seat each, the plugin's `prototyper` agent, no worktree, its screens each | prototype: reads the ideas posted to it, builds the prototype as the `design-prototype` skill says, posts its link, revises on your answers and the person's, `done prototype`; later phases: on call, answers a question on the screens, changes nothing, `done` at once |
| `orchestrator` | you | the prototype yourself, the same way; no `p1` |
| `none` | | no prototype phase (the default) |

## The phase

1. **Ideas**: every other seat posts `@p1` at most one idea for the screens, from what it knows
   of the code, the users or the work (a state to show, an existing component to reuse, a
   journey that breaks), then `done prototype`. Ideas are input, never a vote; p1 keeps or drops
   each and says which in its first post.
2. **Prototype**: p1 builds it as the `design-prototype` skill says, in the project's own design
   language, every screen and state the work needs, and posts `@orchestrator` its link.
3. **Judge**: you read it against the work asked and the charter's scope, then post
   `prototype accepted` or what to change, one round at a time.
4. **The person gives the go**: a human phase, the run paused on them (`pause --person`), with the
   prototype's link, what each screen is for, and the ideas it took. They try it and ask for
   changes, which go back to p1; their go resumes the run. The skill's own gate (no screen built
   before its prototype is approved) is met here.
5. **Hand it on**: the accepted prototype's link goes into the architecture message when the run
   has one (`references/architecture-phase.md`), into every task that touches a screen, with the
   screen and state it builds and its done-when (`matches the prototype's <screen> · <state>`),
   and into every verify message, as the reference the verifier compares the built screens to:
   side by side, state by state, at the widths the prototype shows, layout, spacing, type and
   colour to the pixel. A difference is a finding, unless the person accepted it.

**It reopens** only when a judged finding changes what a screen shows or how it flows: a short
`prototype <k>` on those screens alone, then the person's go again.

## Phase message

| phase | text |
|---|---|
| prototype | `prototype <k>: the prototype message is posted to p1. Every other seat: post @p1 at most one idea for the screens (<scope>), then done prototype. p1: read the ideas, build the prototype through the design-prototype skill, post its link @orchestrator, revise on each answer; done prototype once it is accepted.` |
