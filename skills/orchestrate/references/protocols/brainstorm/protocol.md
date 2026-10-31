# Protocol: brainstorm

Ideas first, judgment last, in separate phases. Out: per question, 3 to 5 options, each with
its pre-mortem, ranked against the criteria.

**Runs on** a brainswarm (the `brainswarm` skill). **No loop**: its phases run once, so the setup
interview asks no loop question.

**Record**: the `brainstorm` skill's board (`documents.md`), its sections as that skill orders them. Swarm kind
`brainstorm`. **Seats**: 3 to 4 to start from, reconsidered against the angles the topic needs, roles chosen so each sees what the others would not (a user, a
builder, an operator, an outsider), no skeptic: judgment has its own phase. `on` none.

| Phase | Seats may | Seats may not | You, after |
|---|---|---|---|
| **1 ideas** | post ideas, as many as they can, one line each, the odd ones included, `--about Q<n>` | read the thread before posting, criticise, ask for sources | nothing |
| **2 build** | read the ideas (every post reaches every seat); combine, extend, flip ideas (substitute, merge, adapt, reverse), each post naming the `#<seq>` it builds on | criticise, reject | group the ideas into themes and draw 3 to 5 options per question; post them as one table per question, option per column |
| **3 pre-mortem** | per option: "it failed a year on; why", each cause naming its source, as the evidence allows | propose new options | write the options and their causes on the board |
| **4 rank** | — | — | rank the options per question against the criteria, the reason per rank, written on the board |

**Phase 1 is blind**: the brief's order is join, post the ideas, then read the thread. The
board cannot hide the thread; a seat that read it first says so on the thread before its `done`.

**The debate log** holds, per question, the ideas by theme with their `#<seq>`, then the
options and their causes verbatim.

**Phase messages**:

| phase | text |
|---|---|
| ideas | `Blind: post your ideas before reading the thread, one line each, the odd ones included, --about Q<n>; then done ideas.` |
| build | `Read the ideas first: thread ideas (thread alone shows only this phase). Combine, extend, flip them, each post naming the #seq it builds on; no criticism; then done build.` |
| pre-mortem | `Options <table #seq>. Per option: it failed a year on; why, each cause with its source; no new options; then done pre-mortem.` |
| rank | `Nothing asked of the seats: done rank now.` |
