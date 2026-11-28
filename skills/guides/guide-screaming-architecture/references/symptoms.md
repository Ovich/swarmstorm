# The symptoms

Each symptom the checker counts is a place where the code and the product disagree. Read it first as a weakness of the product's ergonomics, not of the code: the code often shows what the user already trips on. The fix in the checker's line repairs the code; the question goes to the person when the product itself may be wrong.

| Symptom | Checker | What it says about the product | The question for the person |
|---|---|---|---|
| A feature spread: a file carrying a feature's word outside its home | M1 | One thing the user knows as one ("checkout") is several things inside; a change to it lands in many places and some get missed | Is this one feature to the user, or two the product should name apart? |
| A hidden concept: a feature folder no surface names | M2 | The code holds a concept the user never meets; either it is infrastructure, or a feature the product hides | Should the user see this (a screen, a verb), or is it plumbing to move horizontal? |
| Word drift: a retired word in a path or an identifier | M3 | The code speaks an older or other language than the user; a reader looks for a thing under a name the product does not use | Which word does the user say, and is the old one still heard anywhere (a doc, an answer)? |
| A cross-feature import: one feature's folder importing another's | M4 | Two features the user sees as separate are welded; one cannot change alone | Do they share a concept the product should name, or should the shared part go to the shared layer? |

**Alignment**, the share of files under the feature layers that sit under a home, measures the whole: low, and the tree does not read like the product; the rework is the `screaming-architecture-rework` skill.

**Ask, never apply**: a product change a symptom suggests (two verbs merged, a concept renamed, a screen split) is a finding for the person. The code follows the product; it never changes the product to quiet the checker.
