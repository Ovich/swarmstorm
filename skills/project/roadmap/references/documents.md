# The roadmap and the foundation: contents

## The roadmap

**`YYYY-MM-DD-<project>.roadmap.md`, kind `roadmap`**, dated at declaration and kept for the life of the project. Sections, in order:

1. **Links**: the foundation, every board the project holds.
2. **The tracker diagram.**
3. **One section per iteration**: its outcome in one or two sentences in the customer's words, the one end-to-end check a person performs when it lands, and its slots. An iteration with no customer-facing outcome, the foundation, states the operator's check instead: what runs where, and what a commit does.
4. **The unscheduled pool**: one line per idea not yet placed.
5. **The redraw log.**
6. **The interview log.**

**A slot row**: its slug, what it delivers, what exists for it (the documents by name, and their groups once the slot has been split into pieces of work), its derived state, what it depends on. **Stories are not here**; they live in the plan of the slot that makes them true.

## The foundation

**`foundation.reference.md`, kind `reference`**, undated, never retires: the technology decisions, one row each, decided / open / deferred with an owner, and the slot that will force each open one. Rows:

- **Name and branding**: the name the code, the repository and the domain carry, the wordmark, the placeholder until the name is chosen.
- **Domain**: registered where, DNS served by whom, the environments' addresses.
- **Repository**: which provider, its name and visibility, the conventions file it opens with.
- **Runtime and language.**
- **Frontend framework and UI library**, pointing at the design language, never repeating it.
- **Backend framework**, **API style**, **database and ORM**, **typing strategy**, **auth**, **hosting and operations**, **testing and CI.**
- **The AI engine's place in the architecture**, when the product has one: provider, tiering, where the prompts and rules live. Its internal design is a slot's board, not a row.
- **Any technology decision the boards hold that a slot will build on** (a rendering engine, a payments provider), added as a row.

**Once code exists, re-derive the file from the code**, and distil the durable rules into the conventions file through the `write-conventions` skill.
