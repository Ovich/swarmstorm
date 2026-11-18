# The docs phase

**A building block any run can add, whatever its protocol's shape** (charter `docs:`), when it
changes the repository: the built-in protocols, a project's own `protocol-<name>`, a plan run.
The repository's existing documents are brought in line with what the run changed, once the work
they describe has settled. It depends on no other phase: a run with no verify and no simplify
takes it the same way. **Existing documents only**: it never creates one, and never edits the project's
conventions files (`AGENTS.md`, `CLAUDE.md`, the file the `write-conventions` skill keeps); a rule
there that the run contradicts is a pause to the person, the rule and the change quoted.

**The person can turn it on mid-run**: a charter amendment (`references/charter.md`); in a run
whose work arrives as it goes, a new piece of work that matches the trigger list below is the
moment to propose it. Left at `none` without the person declining it, the stale documents the
reports named are offered at the close, as the `next-step` skill says.

## Proposing it

**Checked once, before the run is proposed, by you**, and again for each new piece of work a run
on call takes: the work asked (the person's ask, the
plan's slices, the tasks foreseen) adds, removes, renames or changes one of these, **the trigger
list**, also the one the inventory below reads:

- a CLI command, subcommand or option, or its output;
- a configuration key, an environment variable, a default;
- a public interface: an exported function or type, a route, a file or message format;
- a setup or install step, a dependency the user installs;
- a behaviour the user sees: an error, a limit, what a command does.

**A match is proposed with its evidence**, in the proposal's `docs:` line: what the work changes
and, when its name is already known, the document that shows it, found by one search of the
repository's documents for that name (`docs: end · proposed: the work renames --port, the README's
Usage shows it`). One search per run, never per task. **No match, no proposal**: `docs: none`
stands without a word. The person decides either way.

## When

| `docs:` | Runs |
|---|---|
| `end` | once, when the run's work has settled: after its last merge, and after its last verify and simplify phase when it has them, before the run closes |
| `after-<phase>` | after each pass of the phase the protocol names (`after-build`), for a long or looping run whose documents should not wait for the close; `end` then needs no pass of its own unless a later phase changed what they show |
| `none` | no docs phase (the default) |

**Its place follows from the rule, never from a protocol**: after whatever last changes what the
documents describe (a build, a fix, a simplify), before whatever only reads it. A protocol that
names its phases places it the same way.

## The phase

1. **Inventory**: one task to one seat, read-only. From the run's range `<base>..<head>` (its diff,
   its commit messages and the stale documents the reports named), list what a document might
   describe, as the trigger list says; search the repository's documents for each, generated and
   vendored files and the conventions files left out. Posted to you as one table: document,
   section, what is stale, the change that made it so.
2. **Choose**: you judge the rows. A row that would need a new document is not a task: it is kept
   for the close, where the `next-step` skill offers the `technical-writing` skill.
3. **Update**: **one task per document**, to the builder who knows that area, as
   `references/tasks.md` says; its files are that document alone, never code. Tasks on different
   documents run at once; two tasks never share a document. The done-when is read-only: each
   command and option the updated section shows matches the CLI's own `--help` or the code that
   defines it. No document command is run to prove it: one that serves never exits, takes a port,
   or writes to the person's data. What must be seen running is a verifier's step, on its own
   instance.
4. **Summary**: once the phase closes, on the board and in the run's report: one row per document
   (what changed, its commit), what was left and why, and what no document describes.

**Every seat without a task is on call**: answers a question on the code it knows, changes
nothing, `done docs` at once.

| Thought | Reality |
|---|---|
| "Each task can update the docs it touches" | A README is shared by most tasks: parallel edits of one file, and a later task makes the earlier update stale. |
| "This rule in `AGENTS.md` is outdated, I'll fix it" | A project's rule is the person's decision; it is a pause. |

## Phase message

| phase | text |
|---|---|
| docs inventory | `docs <k>: the seat named lists what the run's range <base>..<head> changed that a document may describe, searches the repository's documents for it (never AGENTS.md or CLAUDE.md), and posts the table; done docs.` |
| docs update | `docs <k>: each builder named brings the one document in its task in line with the merged code, nothing else; merge, report, done docs.` |
