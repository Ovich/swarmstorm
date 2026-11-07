# Rework

Input: one family's audit entry and its committed characterization tests. Output: commits, each leaving the build and the tests green, the characterization tests never edited. Stop on any diff in a pinned output and show it: the expectation is not updated.

One family at a time. `target-shapes.md` for the family's shape, `languages.md` for its form in the project's language and version.

## Steps

1. **The target representation, beside the old code.** Inferred from the existing source of truth (audit step 2): a narrowing helper over the existing schema or union, a typed root from the existing component schemas, a total map keyed by the existing enum. A hand-written type only where nothing exists. Consumers unchanged.
2. **Parse or normalize once, where the data enters.** One function turns the raw value into the representation and keeps today's behaviour for corrupt and unknown input (a null, a skip, the raw value kept) at that one place. A deliberate escape hatch lives here and nowhere else.
3. **Legacy shapes to the boundary**, normalized in step 2's function with a note on when they can go. Consumers see current cases only.
4. **Consumers one at a time**, each its own commit: a match over the representation, a table for key-to-result, the business rules as they were. Delete the re-parsing, casts and string compares the types made unnecessary.
5. **Completeness on**, in the language's form (`languages.md`). A new case must now fail to compile, or fail one test, until it is handled.
6. **The characterization tests and the project's full check** after every commit.

## Boundaries

- **A library meant to stay independent of the application** (shared, extractable, published) must not import the application's type. Its hook goes generic in the type; the application supplies it.
- **A type shared between server and client** travels by the project's existing channel (a shared package, an inferred API type). Check what the client actually receives before relying on narrowing: serialization can widen a union to `unknown`.
- **Output that other things depend on** (people, another system, a model, recorded fixtures) stays byte for byte unless the person decided a change. Then it is its own commit, and whatever was recorded against the old output is re-recorded with it.
