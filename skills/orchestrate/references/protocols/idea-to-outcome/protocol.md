# Protocol: idea-to-outcome

**Ideas go in, outcomes come out, one after another, without the run standing still.** Each idea
is framed into a settled design note, built, proven live against its note, then reviewed by the
person; its tests are written once the person accepts it. The next idea is framed while this one
builds, so the run waits on nobody. Out: the merged branch; per idea, its note, its measured
before → after and the person's verdict; the run's record.

**Runs on** a task swarm (the `swarm` skill). Board: `$S open --kind task --protocol
idea-to-outcome`. Built on build-verify: its verifier rules hold here unless this file says
otherwise (`references/protocols/build-verify/protocol.md`, *Phases* and *Your duties*).

## Seats

| Seat | Agent · effort | Owns | Never |
|---|---|---|---|
| `d1` architect | `brainswarm-seat` · medium | each idea's note, drafted and settled; design questions during build | edits the repository |
| `d2` user's voice | `brainswarm-seat` · medium | the evidence from real use: who lives with the result, measured | edits the repository |
| `d3` skeptic | `brainswarm-seat` · medium | what the design breaks or stops catching; the failure cases | edits the repository |
| `w1` … builders | `swarm-worker`, own worktree · low | one task per build: change, build, type-check, run once, merge, report | runs, reads, writes or fixes a test |
| `t1` tester | `swarm-worker`, own worktree · low | the yardstick harness; every test, written after the person accepts | reads a builder's diff before drafting its cases |
| `v1` … verifiers | `verifier` · medium | the live proof of each claim, on its own instance and ports | walks the person's live data |

Opus for all. **A small idea needs no panel**: when its note fits in a screen and touches one
area, d1 frames it alone and d2, d3 sit it out.

## Charter fields

| Field | Recommended |
|---|---|
| ideas | the ordered list, each a problem with its evidence |
| yardstick | the metrics every idea must keep or move, and the harness that measures them; or `none` |
| designers · builders · tester · verifiers | 3 · 3 · 1 · 2, reconsidered against the ideas' size |
| frame judge | the orchestrator (the person's authority decides; `references/authority.md`) |
| cap | 2 build → verify rounds per idea |
| ports and data | a disjoint port range per verifier and per builder that runs anything; a temp copy of the data home each |
| branch | `swarm/<topic>`, pushed by the orchestrator at every phase close |

## The flow

```
baseline (once, when there is a yardstick)
frame 1
for each idea k:
  build k → verify k   (≤ cap rounds, until every criterion is met, no blocker or major)
  human k              (the person: accept · rework · drop)
  alongside: frame k+1 during build k · test k after accept, during build k+1
final
```

**Nothing waits on the person that need not.** While human k is open, build k+1 starts if its
note is settled and its files are disjoint from idea k's; a rework of k joins the next build.
The run pauses (`pause --person`) only when every seat would otherwise idle on the answer.

**An idea may close `not needed`** when an earlier one made it moot, with the evidence; **two
small ideas on disjoint files may share one build and one verify**, each judged on its own.

## Phases

| Phase | Designers | Builders | Tester | Verifiers | You, after |
|---|---|---|---|---|---|
| **baseline** | d1 defines the metrics; d2 measures them on real use; d3 lists what must stay caught | done | builds the harness from their posts; runs it on the base | runs the live scenarios on the base | the baseline table into the record |
| **frame k** (inside build k−1) | d1 drafts the note; d2, d3 challenge it once each; d1 settles it | — | flags each criterion it cannot test | flags each it cannot prove live | judge the note: approve, or back once |
| **build k.r** | d1 on call; frame k+1 | one task each, in its declared merge order | drafts idea k's cases from the note, no code | done | re-run each done-when on the merged tip |
| **verify k.r** | done | on call: a judged fix lands in the same round | on call | each its own steps, live, plus the harness | the judged table: human k, or round r+1 |
| **human k** | settle frame k+1 | build k+1 if ready, else wait | test k−1 if accepted | done | the review page, then the verdict into the record |
| **final** | review the branch against the goal | on call | every suite | the harness, all ideas together | close; the pull request |

## Rules

- **The note is the contract.** A builder never changes the design; a question goes to `@d1`; a
  change to the note is yours, recorded under the note.
- **Builders deal with no test**: they never run, read, write or fix one, and ignore a failing
  one. Tests are written after the person accepts an idea, never for one that may be reworked.
  The verifier proves the claims live; the harness, run in every verify, guards what no idea may
  lose.
- **Every criterion is measurable and owned**: by a verifier (live) or the tester (after accept).
  One neither can check is rewritten or cut in frame.
- **A small judged finding is fixed inside the round**: posted to its builder at once, merged,
  re-checked by the verifier that found it on the new sha. A new round only for a blocker or a
  major the fix cannot close in the round.
- **Ordered merges name the next merger**: a task that merges after another says so, and each
  merger's report mentions the next one, so no builder waits unwoken.
- **Verifiers split by minutes, not by checks**: a timed scenario counts its minutes. A verifier
  found stopped or lost hands its steps to another.
- **The shared machine** is the swarm-board skill's `references/machine.md`: own ports, own temp
  data home, stop only your own PIDs, never the person's running servers.
- **The person's decisions are asked in one message**: the verdict and every choice the note left
  to them (a UI choice, a trade-off), each with your recommendation first.
- **A protocol change the person makes mid-run** goes into the record and this run's phase
  messages at once; it binds from the next phase.

## Your duties

- **Open human k the moment the idea is proven**: phase `human-<k>`, its message opening `YOUR
  TURN:`, the review page linked; never folded into another phase or skipped.
- **Listen in the background and judge each wake by its event**: a report re-run, a finding
  judged, a phase opened; an on-call seat's `done` needs nothing.
- **Push the branch at every phase close**: side work started by the person bases on the pushed
  tip, never on a stale one.
- **Write the record as each phase closes**; at the close, one table of the ideas and their state.

## Phase messages

| phase | text |
|---|---|
| frame | `frame <k>: <title>. d1: draft the note (record §<k>), @d2 @d3 one challenge each, then settled @orchestrator. t1, verifiers: flag what you cannot test or prove.` Posted, not a phase, while build k−1 runs. |
| build | `build <k>.<r> on <branch> @ <sha>: <task ids, owners, merge order>. Builders: your task is posted; build, type-check, run once, merge, report mentioning the next merger, done build. No test. t1: draft idea <k>'s cases<; write idea <k−1>'s tests>. d1: on call; frame <k+1>. Others: done build.` |
| verify | `verify <k>.<r> on <branch> @ <sha>, <each verifier: its ports and its steps>. Prove each claim live; run the harness. One table each @orchestrator, ids prefixed by seat. Builders: on call. Others: done verify.` |
| human | `human <k>: YOUR TURN: accept, rework or drop idea <k><, and its decisions>, review page #<id>. d1: settle idea <k+1>'s note. <Builders: build <k+1> is open | wait.>` |

The record, the design note and the review page: `documents.md`.
