# Characterize

Input: one family's audit entry. Output: one commit of tests, green on the current code, and the list of outputs that look wrong. Stop and show that list; fix nothing here.

## What to write

- **At the family's highest existing seam**: the function the consumers call, or the entry that reaches it (a handler), in the project's own test framework. Never at a private helper the rework will delete.
- **Table-driven**, one row per case of the audit's "Cases today", plus: each legacy shape still in stored data; an input that matches a schema but is declined (the fall-through); a corrupt input (the right discriminator, a missing or wrong field); an unknown discriminator; each implicit default (the field missing, null, empty).
- **Expectations come from running the old code**, never from reading it: a row written from the code's intent pins what it should do, not what it does.
- **Exact outputs**: the full string, the status and message, the exception type and text, the null. An inline expected value over a snapshot, unless the project uses snapshots.
- **Inputs built from the real schemas or fixtures**, so every row is a case the system can meet.

## Rules

- Green on the current code and committed alone, before anything else changes.
- An output that looks wrong is recorded as it is, with a comment naming the doubt, and listed for the person.
- A row whose output the person already decided to change carries that decision's id in a comment, qualified by its plan (`<topic>#D<n>`), so the rework edits exactly the marked rows and no other.
