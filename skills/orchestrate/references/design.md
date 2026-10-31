# The design

**What gets built, settled before any code**, in one document whose sections every task points
into. One format wherever a design is written: a plan's Design part (the `write-plan` skill) and
a run's design phase on the board (`references/design-phase.md`). Written for an agent that
was not in the conversation: read alone, it gives every decision, its reason and every detail the
work needs. A section that does not apply is left out, and the header says which; a small
change's section is a sentence.

```markdown
## 1. Why, and why not
The problem and who feels it. Goals. Non-goals. Where a person sees the change, the
stories: id `US3`, the role, what they want, why, acceptance written as something observed.

## 2. Before and after
Existing code, cited `file:line`, then the after picture. New work has the after picture
only. A table of what replaces what.

## 3. Modules, after
The module map: who imports whom, and the imports that must not exist. Then one subsection per
deep module, as the `deepen-module` skill designs it: its usage (the complete code a caller
writes), the entry as signatures without bodies, what it hides, what stays outside, its
conditions held or broken, the gap from today.

## 4. Flows
One flow per kind of turn, as pseudo-code over the modules' entries (or a sequence, through the
`write-diagrams` skill), every failure branch on it:

    on place(order):
      quote = Pricing.quote(order.items)       # a module's entry, never its internals
      if quote.unavailable: refuse(order, quote.reason)   # every failure branch named
      Payments.charge(order.customer, quote.total)
        on declined: refuse(order, "payment declined")
      Orders.confirm(order, quote)

## 5. State and its writers
Where each piece of state lives, and every writer of it.

## 6. Failure modes
What breaks, and what the person sees.

## 7. What ran
The recipes the experiments handed back.

## 8. Decisions
| id | Decision | Depends on | Status | Source | Kind | Task |
The row core of the `interview` skill's `references/decisions.md`, ids and citations included,
plus `Kind` and `Task`. Kinds: purpose, module (with its state: new, deepened, interface change,
wiring, ui, schema), architecture, contract, clarification. Open questions are rows with status
open and an owner. A departure from a rule is a row naming what is owed for it.

## 9. Guides
The project's guides that apply: the shipped `guide-*` skills and the project's own under
`<repo>/.claude/skills/guide-*`. One row per guide, with the decision this design takes under it:
`guide-deepen-module`: `<X>` is the one entry point, `<Y>` stays hidden. A guide that applies and
has no decision yet is an open row in Decisions.
```

**A task quotes the entries it implements word for word**, and cites the decisions it carries
(on the board, the section post `#<seq> §3` and `D3`; in a plan, `<topic>#D3`); an entry changed
later is a new decision.
