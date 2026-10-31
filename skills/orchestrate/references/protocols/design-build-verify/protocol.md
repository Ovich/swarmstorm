# Protocol: design-build-verify

The work is designed on the board before any code, then built and judged as `build-verify` does,
for as many build → verify rounds as the goal needs. A designer writes the design in the one design
format (deep modules, entries as signatures, flows as pseudo-code, decisions), the orchestrator
accepts it, and every build task quotes it. Out: the accepted design, the merged branch, and the
last judged findings table with the goal's state.

**Runs on** a task swarm (the `swarm` skill): `$S open --kind task --protocol design-build-verify`.
A plan has its design in the plan already, and runs `build-verify`.

**Everything of `build-verify` holds** (`references/protocols/build-verify/protocol.md`, read
first): its seats, charter fields, build and verify phases, duties and phase messages. This file
adds the design.

## The designer

| Seat | Who | Does |
|---|---|---|
| `d1` | the designer, the plugin's `designer` agent, no worktree | design: reads the code the work lands in, writes the design, posts it, settles the orchestrator's questions, `done design`; build and verify: on call, answers a builder's question on the design, changes no code, `done` at once |

**The charter may give the design to the orchestrator instead** (`design: orchestrator`): then
there is no `d1`, and you write the design yourself in the same format, posted the same way.

## Charter fields

Beyond `build-verify`'s:

| Field | Content | Recommended |
|---|---|---|
| design | `d1` (a designer seat) or `orchestrator` | `d1` |
| design scope | what the design covers: the areas, the modules expected, what is out | the work asked, as one increment |

## The loop

**Cycle**: design once, then build → verify, repeated. **Goal** and **cap** as `build-verify`'s
(the cap counts build → verify rounds). **The design reopens** only when a judged finding changes
an accepted entry or decision, or you judge the design wrong: a short `design <k>` on those rows
alone, then the next build.

## Phases

| Phase | Designer | Builders | Verifiers | You, after |
|---|---|---|---|---|
| **design `<k>`** | the design, as below; `done design` once accepted | on call: answer a question on the code they know, change nothing; `done design` at once | `done design` at once | accept the design or post what to change (below); then build 1 |
| **build `<k>`**, **verify `<k>`** | on call, as above | as `build-verify` | as `build-verify` | as `build-verify`, every task quoting the design |

## The design

- **The format is the `orchestrate` skill's `references/design.md`**, read before the first
  line: why and why not, before and after, the modules after, the flows as pseudo-code, state
  and its writers, failure modes, the decisions, the guides. Every major area is a deep module,
  designed as the `deepen-module` skill says; read against the code it lands in, cited
  `file:line`.
- **One file, posted once and re-posted whole**: `<topic>.design.md` in the data home (its path
  from the `aiview` skill's `aiview path`, never in the repository), posted with `$S post --file`
  to `@orchestrator`; a revision is the whole file again, its changes listed first.
- **Open decisions are rows**, each with its options and a recommendation; the designer settles
  them with you on the board, never with the builders.

## Your duties

Beyond `build-verify`'s:

- **The design message** names the design scope, the charter's constraints, what the person
  asked in their words, and the branch the code is read on.
- **Accept the design, or send it back**: read it as a cold reader would (could a builder carry a
  task out from it alone?), challenge every export no caller needs, then post `accepted` or the
  rows to change. You accept it; the person is not asked, unless a decision is theirs (outside
  your authority) or changes what they asked.
- **Cut the build from the design**: one task per entry or module, each quoting its entry word
  for word and citing its decision ids (`<topic>.design#D3`); its done-when, its boundary.
- **A finding that hits the design** (an entry wrong, a decision broken): `design <k>` on that
  row before the next build; a finding inside the design is a build task as usual.

## Phase messages

| phase | text |
|---|---|
| design | `design <k>: the design message is posted to the designer. Designer: write the design in the design format, post it with post --file to @orchestrator, then done design once it is accepted. Builders and verifiers: on call, change nothing, done design now.` |
| build, verify | `build-verify`'s, with `build <k>` and `verify <k>` counted from the first build. |
