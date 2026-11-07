# Decision points

The questions every codebase answers, whether or not anyone writes them down. This is
deliberately a catalog of **questions, not rules**: the answers are stack-specific and
the rules must be written in the stack's own vocabulary.

Each entry gives: the question, why an unanswered version costs you, and **the tell**,
what an unresolved decision looks like in a repo, which is what `harvest` mode looks for.

`[forced]` = ask during **bootstrap**; the stack forces an answer before real code exists.
`[later]` = don't guess on day one. It arrives through **capture**, when a real decision
gets made.

---

## A. Shapes and contracts

**1. Where does the source of truth for data shapes live? `[forced]`**
Every project has one: a schema, a proto/OpenAPI file, a set of structs, or nothing,
in which case it's "whatever each file assumed." Unanswered, the same entity gets three
slightly different shapes and they drift silently.
*Tell:* the same field list typed by hand in two or more places; a field added in one
and missing in another.

**2. How does a shape cross each boundary? `[forced]`**
Server→client, service→service, app→database. Either the type flows (inference,
codegen, a shared package) or it is re-declared by hand at each end. Both are
defensible; picking neither means both, half the time.
*Tell:* a hand-written interface that mirrors an API response; a client type that has
fallen a field behind the server.

**3. What gets validated, and where? `[later]`**
Trust boundaries only, or every layer. If validators are hand-written separately from
the schema, they drift the moment a column changes.
*Tell:* a validator listing columns the schema no longer has.

## B. Placement and direction

**4. What may each layer import, and in which direction? `[forced]`**
The rule that keeps a codebase from becoming a graph. Usually: outer layers may
depend on inner, never the reverse; siblings never reach into each other's internals.
*Tell:* an import cycle; a domain module importing the web framework; two feature
folders importing each other.

**5. Where do calls to external services live? `[forced]`**
Confined to a named integration layer, or wherever they're needed. Inline is how a
vendor's response shape ends up load-bearing in ten files.
*Tell:* a raw `fetch`/SDK client instantiated inside business logic or a request handler.

**6. When does code become its own module or file? `[later]`**
Second caller, or "distinct concern with its own reason to change"? These give
different codebases. Say which, because otherwise every developer applies their own.
*Tell:* a `utils/` or `helpers/` grab bag; or the opposite: a one-line file per function.

**7. Shared or colocated by default? `[later]`**
Does a helper live next to its user until a second one appears, or go straight to a
shared location? Also: is there a barrel/index re-export convention, or direct imports?
*Tell:* a shared module with exactly one consumer; or the same helper copied into
three feature folders.

## C. Granularity and naming

**8. When is a unit too big to leave alone, and when must it stay inline? `[later]`**
Both halves matter. A rule that only says "split large things" produces a codebase of
single-use fragments scattered across files.
*Tell:* a file that everyone dreads opening; or a component split into six files, five
used once.

**9. What must be named, and named after what? `[later]`**
The strongest convention a UI or domain codebase can have. Name after what a thing
*is* or *renders*, not how it's built. Applies wherever meaning would otherwise live
in a literal: a utility-class string, a magic number, a status flag.
*Tell:* you must read an element's classes, or a condition's body, to know what it is.

**10. What is the domain vocabulary? `[forced]`**
One concept, one word, everywhere: code, database, UI, and docs. Cheap to decide on
day one and very expensive to unify later.
*Tell:* `class` here, `course` there, `section` in the schema, for one thing.

## D. State, data, config

**11. How does the client get and cache server data? `[forced]`**
The typed client, a data-fetching library, or hand-rolled requests. This decision leaks
into every feature, so it is worth one rule early.
*Tell:* two different fetching mechanisms in one app; a request that bypasses the
shared client and loses its types.

**12. How are schema and data migrations produced and reviewed? `[forced]` if there's a database**
Generated migrations are a starting point, not an authority: most generators can't see
a semantic change and won't write the backfill. Naming matters too: a list of
auto-generated names tells a future reader nothing about the shape the database is in.
*Tell:* migrations with generator-invented names; a generated file applied unread; a
column added with no backfill for existing rows.

**13. Where does configuration and secrets live, and how is it typed? `[forced]`**
Env vars, bindings, a config module. Includes: what is required at boot versus lazily
read, and what a missing value does.
*Tell:* `process.env.X` read inline in three modules, each with a different fallback.

## E. Failure, evidence, and work

**14. What shape does failure take? `[later]`**
Exceptions, result unions, error codes, and what crosses the API boundary versus what
stays internal. Mixed conventions mean every caller handles errors differently and some
handle them not at all.
*Tell:* a function that both throws and returns `null` for failure; a stack trace
reaching the client.

**15. What gets tested, at what level, and where do tests live? `[later]`**
Not "write tests": *which* things earn one, and what a test is allowed to touch
(a real database? the network?). The unanswered version is a suite nobody trusts.
*Tell:* a test file next to nothing that's tested; tests that fail when run in a
different order.

**16. How is work observed? `[later]`**
Structured logs or prints, what carries a request id, what must never be logged (tokens,
personal data). The last part is the one worth writing down early.
*Tell:* `console.log`/`print` debugging left in shipped code; a logged auth header.

**17. How is background and scheduled work run? `[later]`**
Queue, cron, in-request. And whether handlers may do slow work inline.
*Tell:* a request handler awaiting a long job; a retry with no idempotency story.

---

## Using this catalog

**bootstrap:** ask only the `[forced]` points the chosen stack actually opens: a
project with no database skips 12, a CLI skips 11. Expect 5–8 rules. Leave the rest.

**harvest:** read the code for the *tells*, not for the questions. A tell with several
instances is either a rule the team already follows (write it down) or a genuine
inconsistency (say which way it should go, and name the files on each side).

**capture:** locate which point the new decision answers, and put the rule in that
section of the document.
