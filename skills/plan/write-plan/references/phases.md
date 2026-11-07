# Phases and seats

Every plan runs on the swarm board: N seats, phase by phase. This says how the phases and seats
are cut.

## The seats

- **The plan runs on N seats**, `seat1` … `seat<N>`, plus the validator when the person wants
  one. N is the mandate's `seats:` field: **4 to start from** (2–3 small, 5–6 large), reconsidered
  against the estimate of the work as the `orchestrate` skill's *Propose the run* says (the widest
  phase's tasks); the person's number wins, the tasks re-cut to it.
- **A seat is a place in the swarm, not an agent.** Each phase dispatches a fresh subagent into
  it; what it learned reaches the next phase through the board's thread and its report.

## The phases

- **A phase exists only where work must wait for other work merged**: a contract, a move, a
  schema the rest builds on; the tests once the code stands. Work that can run together is one
  phase. Most plans need one to three.
- **Derive the phases from what each piece of work needs merged**: name, for each, the merged
  work it cannot start without; that, and nothing else, puts it in a later phase.
- **A phase of one seat is still a phase**, a ground phase most often: on the board like the
  others, never run outside it.
- **A phase is seats working, nothing else.** A run of the person's (a gate, a trial) is a `👤`
  step; work of yours (a baseline, a check) is an orchestrator step. Neither is called a phase,
  and neither is added unless the person asks for it: offer it with its cost, never as a
  default.
- **Every seat works in every phase**, one task each, a special seat's
  phase excepted: a phase has at most N tasks. **A phase with fewer tasks than seats is said
  to the person**, with why, and with the offer to merge it into its neighbour or shrink it.
- **A special seat runs alone in its own phase**, no other seat working in it: the validator,
  a reviewer reading every merge. Its role is the mandate's, in the person's words.
- **Each phase names every seat's role and area in it**, one line each: builder of the api,
  tests of the store, reviewer of another seat's merge. A seat's role may change from one phase
  to the next.
- **The riskiest unknown goes in the first phase**, so the tasks after it are written knowing it.

## The validator

**Opt in, the mandate's `verify:` field**: the plan then runs the `orchestrate` skill's
build-verify protocol, its phases the builds, the validator its verifier. **A building phase
before a verify ends on a feature the verifier can check end to end**, never a layer (the api
without its screen), and its goal names that feature. **The plan names, per verify, what to
validate**: the feature, the stories or screens to walk, what counts as a blocker. The verify
phase itself, its findings and the cut they decide are the protocol's.

## The tasks

**No task is written with the plan.** The plan fixes each phase's goal and every seat's role
and area; each phase's tasks are posted at its open, as the `orchestrate` skill's
`references/tasks.md` says.

## The tracker

**One subgraph per seat per phase, titled with its phase and seat**, `P1 · seat2 · the api`, its id
`SL<phase><seat>`, its steps `S<phase><seat>.<step>`; until a phase opens, one subgraph
`SL<phase>0` stands for it. The shape is `references/tracker.md`.

## The mandate

**`phases:`, `seats:` and `verify:` come first**, proposed from the work and settled with the
person as the `orchestrate-plan` skill's `references/mandate.md` asks them. The *Mandate*
section holds the phase table (each phase, what it waits on, its goal, every seat's role and
area), and what the person added for the validator to watch, in their words.
