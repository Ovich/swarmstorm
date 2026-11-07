# A project protocol, or a project template

**What a project keeps for its own runs lives in the project, as a skill: `protocol-<name>`**,
in the folder the project already uses for local skills, `.claude/skills/` when it has none. The
plugin's protocols stay general; a protocol or template born from one project's work is that
project's, as a workbench or a verify skill is. Written on the person's yes, from a run they
approved (or, on `keep: now`, from the settled strategy), its configuration kept and everything particular to that run (a one-off input, an
example written for that reader) left out.

**Before writing, look for a `protocol-*` skill (or an older `brainswarm-*` one) whose scope
covers this kind of work**: grow it, never a second one for the same kind. An older
`brainswarm-<name>` skill grown here is renamed `protocol-<name>` on the person's yes.

## Created with the person, through the `interview` skill

From the run they approved when there is one (its strategy, dossier and record), else from the
settled strategy; each answer written into the skill as it lands, shown before the next question.

1. **Protocol or template**: new phases make a protocol; the same phases with inputs filled
   make a template over the protocol named.
2. **The scope and name**: the kind of work it is for, as wide as it recurs; `protocol-<name>`
   and its description's trigger.
3. **What is fixed and what is left to each ask**: per strategy field, the value kept and why.
4. **The seats**: each kept, renamed or added, its persona and effort.
5. **The interview the next run opens with**: the questions to ask, in order.
6. **What this run taught**: each lesson written as a rule of the skill, or left in the dossier
   as particular to this run.

Then the skill is shown whole, and written on the person's yes. Hand over its path; the next
run of this kind starts from it.

## The skill

```markdown
---
name: protocol-[name]
description: "Use when [the kind of work] is to be done by [a brainswarm | a task swarm | a plan run]: [the protocol `<protocol>`'s template | a protocol of this project], [what it produces]. Not for [the neighbouring work]."
---

# Protocol [template]: [label]

**A [template of the `orchestrate` skill's `<protocol>` protocol | protocol]**, owned by this project: load the `orchestrate` skill and the kind's skill that runs it ([`brainswarm` | `swarm` | `orchestrate-plan`]); this file [fills the protocol's inputs and never changes its phases | is the protocol's `protocol.md`]. The run's dossier and record go to aiview, never here.

[the template's or the protocol's sections, below]
```

A protocol's other files (`documents.md`, `seats.md`) sit beside `SKILL.md`; its `SKILL.md` is
its `protocol.md`.

## A protocol

A new way for members to work: its own phases. It usually starts as one run's tuned proposal,
whose changes proved worth keeping. Its `SKILL.md` holds what goes in and comes out, in one paragraph; the kinds it
runs on; the charter fields it adds to the shared ones, each with its recommended value; **the
loop** when phases repeat (the cycle, the goal it proposes, the cap), or that it has none; the
phase table (phase, who, may, may not, the orchestrator after); the rules that hold in every phase; the phase messages,
one per phase, each saying every seat's part; the orchestrator's duties the protocol adds.
Beside it:

- **`documents.md`**: its record (its own template, or another skill's board it writes) and,
  when the topic will run more than once, its dossier: each a skeleton to copy, its sections
  the protocol's, and who reads which.
- **`seats.md`**, when it has default seats: per seat its function, effort, what it owns, what
  it answers in the brief, what it never reads; a seat's parts are what the phase messages ask
  of it.

## A template

One use of a protocol, the plugin's or the project's, kept because it worked and will run
again. It fills the protocol's inputs and never changes its phases or its rules. It holds:

- **When**: the kind of work it is for, and what the person must hand over.
- **The strategy**: every field the template fixes, its value and why; the fields left to the
  ask.
- **The seats**: each default seat renamed and given a persona for this kind of work, and any
  seat added, with its persona, effort and the phases it acts in.
- **The interview**: the questions to ask the person before the first run, in order.
- **The documents**: the sections it adds inside the protocol's dossier (an input, a seat),
  never new ones.
- **The output**: its skeleton, slots, length, tone and altitude.
- **What the orchestrator watches**: the failures this kind of work is prone to.

A template names no person: their facts, readers and preferences go into the dossier, never the
template.

## A change to the plugin's protocol

A rule every project would want, learnt in a project run, goes into the plugin's protocol (the
`orchestrate` skill's `references/protocols/`) in the swarmstorm repository, written in terms every project has, never as a project skill.
