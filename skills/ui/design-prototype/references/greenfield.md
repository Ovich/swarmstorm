# No design language yet

**The design language is decided here, not extracted.**

## Ask before drawing

**Five questions at most, one message each, multiple choice where the options are knowable, before any token is chosen.** Anything else is decided in the plan and shown, not asked.

1. **The stack and the UI library.** What the screens will be built with, and which component library or design system, if any: shadcn, Radix, spartan, MUI, Angular Material, Bootstrap, Tailwind alone, a house system, or none yet. "None yet" is an answer, and then the prototype's own components become the proposal.
2. **The subject and the people.** What the product is, who uses it, in what setting, with what they already read every day.
3. **What is being designed.** The screen, flow or component the person has in mind, and the one thing it must make obvious; never assumed to be the entry page.
4. **Constraints already fixed.** A logo, brand colours, a typeface, an existing site or app it must sit beside, a platform (desktop, mobile first, both), a language.
5. **The reference point.** One or two products whose feel is right, and one whose feel is wrong; to place the direction, not to copy.

**The answers are the brief. Distinctive choices come from the subject's world**: its materials, its vernacular, what its people already read every day.

## The plan is a token system

**Before any HTML, write the skill's step 3 plan as a design brief:**

- **Colour**: the base palette as four to six named hex values, one accent, semantic colours apart from it.
- **Type**: one family, or two clearly distinct, with their roles; a type scale with intentional weights and spacing; line lengths under 80 characters.
- **Layout**: one sentence and an ASCII wireframe; alignment stated.
- **Principles**: what makes this product's screens its own, in three lines.

**Read the plan against the tells below; anything that could have come from any similar brief is revised, and the revision said.** Before calling the plan done, remove one thing. Then write `design-language.reference.md` from the plan.

## The tells of a generated page

**Where the brief pins a direction, follow it. Where it leaves an axis free, spend the freedom on none of these:**

- A warm cream background with a high-contrast serif display and a terracotta accent.
- A near-black background with one acid-green or vermilion accent.
- The broadsheet: hairline rules, zero radius, dense newspaper columns.
- The SaaS card kit: content chopped into identical rounded cards, one radius on everything, the same soft grey shadow under each, gradient washes as decoration.
- Template chrome whatever the subject: a tracked-out all-caps eyebrow above every heading, meta strings joined with middle dots, labels of the form "WORD, fragment", tinted near-black standing in for black, a monospace face for small data labels, an arrow appended to every link and button.
- Typographic tells: one word of a headline in italic or another colour, all caps for labels, a label above content that needs none, numbered markers on content that is not a sequence.
- Motion tells: fade-and-slide entrances on every section, a hover transition on every card. One orchestrated moment lands; motion that answers the person's action is welcome.
