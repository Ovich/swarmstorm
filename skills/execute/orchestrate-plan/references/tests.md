# The testing prompt

The worker knows nothing about testing; what it does about tests is only what its brief says.
The orchestrator puts one of these in each worker's brief, its commands filled for the project,
and copies it from here rather than rewriting it. The seams and cases are each task's.

## at the plan end

Every task outside the tests phase:

```markdown
**Tests**: write none and touch none. At the end, run the suite once (`<command>`) and list every test your change breaks, by name, in the return; do not repair, skip or delete them. The proof in your acceptance criteria is not a test: whatever drives it is scratch, outside the repository, never under a name the suite collects.
```

A task of the tests phase (its post carries this line):

```markdown
**Tests**: write the cases this task names at the seams it names, from the task, not the code. Repair the tests listed as broken first. A small bug the tests expose is fixed in its own commit; anything that changes a decision is a stop. Never bend a case to pass. Land with `<the full check>` at 0.
```

## at the task end

```markdown
**Tests**: code first, then the tests each task names, at its seams. Never weaken a test to go green. Land with the task's done-when at 0.
```

## none

```markdown
**Tests**: write none. Run the task's done-when at the end and report its output.
```
