# The ladder

Six rungs, highest first. A finding is tried against each from the top and takes the first whose criterion it meets. The report says, for every rung above the one taken, which criterion failed.

## 1. Impossible by design

**Criterion**: the finding names a place where the same decision is made more than once, or a state that should not exist, and one module, one type or one generator can hold it instead.

**Artefacts**: a module that is the single owner ("one session module decides where a person is sent, the guards ask it"), a type that leaves no room for the wrong value (a branded id, a discriminated union, a `never` in the switch), a generator or template the file is made from (a schematic, a scaffold command), a boundary that the wrong thing cannot cross (a mock that is a handler mounted on a route, so the client has no branch for it).

**What remains with a human**: nothing, when the module is the only way. The design change goes through a board, and the plan that follows makes the change; this skill drafts the paragraph the board opens on.

**Tell it is this rung**: the person's comment says "one place", "a service", "a module", "not in here", "shall be encapsulated".

## 2. A tool

**Criterion**: the finding is a property of the text a parser can see: a name, a pattern, an import, a shape, a type. It fails on the laptop, before the commit, with no test to write.

**Artefacts**: a linter rule, built in or custom (Biome, ESLint, Ruff, Clippy, a `no-restricted-imports` list), a type checker flag or a type in the code that makes the misuse a type error, a formatter setting.

**What remains with a human**: the exceptions, which the tool's own disable comment marks, and which a reviewer reads.

**Tell it is this rung**: the comment could be written as a regular expression or a type. "Rename to", "don't import x from y", "this should be readonly".

## 3. A test in CI

**Criterion**: the finding is a property of the tree that a script can walk and a parser cannot: a file that must sit beside another, a class named after its selector, a folder that must not contain a certain kind of module, a route that must have a test. It fails the push.

**Artefacts**: a convention test under the tests folder the repository already uses for them (`tests/conventions/<finding>.test.ts`), reading the tree and asserting the property, one message per violation with the file. Red on the existing violations first, the pull request that adds it fixes them.

**What remains with a human**: the property the test cannot express, said in the test's header.

**Tell it is this rung**: the comment is about where something lives or what it is named relative to something else.

## 4. A rule in the conventions file

**Criterion**: the finding needs judgment a reviewer can still point at (the five filters of `write-conventions`), and none of the three rungs above admits it.

**Artefact**: the rule in the shape and the placement the `write-conventions` skill asks, its cost line the count of occurrences this report found.

**What remains with a human**: everything. A rule is read after the code is written. This rung is taken only when the others were refused, and the report says why.

**Tell it is this rung**: "we prefer", "in this codebase", "always ask before".

## 5. The skill or brief that produced the code

**Criterion**: the author of the reviewed code is an agent, and the finding is a thing the agent would have done differently had its skill or its task said so. The finding recurs across pull requests because every run starts from the same text.

**Artefacts**: one sentence in the skill's body, in the shape its collection asks, or a line in the task shape (the `orchestrate` skill's `references/tasks.md`), or a row in the plan's register that every task quotes. Proposed with the skill named, written on the yes, since a skill is shared beyond this repository.

**What remains with a human**: the next run's result, read once.

**Tell it is this rung**: the same comment on the first pull request of every plan, or on every task of one plan.

## 6. Stays a review comment

**Criterion**: the finding depends on what the person knows and the code does not: a product decision, a taste the person holds, a judgment about a user. None of the rungs above admits it, and a rule would only say "ask".

**Artefact**: a line in the report naming it, so it is not proposed again. Optionally a rule saying whom to ask.

**Tell it is this rung**: the reply was a conversation, not a "done".

## Two rungs

A finding often takes rung 1 and rung 3: the design change removes the class, the convention test keeps the tree from growing a second way. Say both, and which comes first: the test is written red before the design change lands, so the change is measured.
