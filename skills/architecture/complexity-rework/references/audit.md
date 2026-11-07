# Audit

Input: a path, a package, the repository, or one function the person pasted. Output: the report. Stop after it and ask which families to rework, in what order.

## 1. Measure

`measure.md`, unless the input is one pasted function.

## 2. Find the types that already exist

Before any proposal, look for the structure the codebase can already infer: a schema whose type is derived from it (Zod, Pydantic, Valibot, io-ts, OpenAPI or JSON Schema codegen, protobuf, GraphQL codegen), a tagged union, enum, sealed hierarchy or ADT already declared, a generated client or ORM model, a database enum or check constraint.

Often the fix is not a new type but narrowing to the existing one earlier, or closing an **escape hatch** that defeats exhaustiveness: a catch-all member (`| { kind: string }`), an `any`, `Object` or `dynamic`, a `default:` that swallows new cases, a cast. A deliberate hatch (a reader that must keep data from a newer version) belongs at the one place that parses, and nowhere else. Name what exists in the report before the proposal.

## 3. Group by data, not by file

A **family** is the set of functions that branch over the same data: the same discriminator compared to literals, the same set of types or schemas tried, the same input source. It spans files and layers (server and client alike). One family is one problem with one fix.

Rank by fan-out (functions branching on the same data), then by churn (`git log --follow --since=6.months --format= -- <file> | wc -l` per file: a plain log lists old paths after a move). When the history was reorganised past use, skip churn and say so.

## 4. Classify

A shape per family from `target-shapes.md`, per branch where a function mixes several. `languages.md` for its form in the project's language and version.

## 5. Behaviour to preserve

Name it concretely. Refactors of branching code most often break:
- an **accidental fall-through**: a case that matches but declines, letting the next branch run;
- **the order** alternatives are tried in, when two could match;
- a **null, None or default result** callers rely on, for corrupt or unknown input included;
- **implicit defaults** (`?? 0`, `or []`), which a schema default may not reproduce (an explicit null, an empty string);
- **error behaviour** implicit in branch order: which message, status or exception type;
- **output consumed elsewhere**: strings shown to people, sent to another system or a model, logged and parsed. A byte there is behaviour.

## 6. The report

Highest-ranked family first. The report goes through the `aiview` skill: kind `report`, tags = `complexity`. Every number is copied from the tool's output, never retyped, and names its measure beside it (`cyclomatic 11`, `cognitive 23`). Mark any function only skimmed, not read.

```markdown
# Complexity audit: <repo or package>

**Measured with**: <measure, tool, threshold, scope, commit>

## Summary
<a ranked table: family, fan-out, shape, risk; what to do first and why; what was left alone>

## Family: <the data or concern: "order events", "webhook payloads">
- Evidence: <discriminator, or types or schemas tried, or the shared input>
- Cases today: <list, legacy ones included>
- Data enters at: <file:function>
- Types that already exist: <schema, union, model or generated type, and any escape hatch; or "none">
- Consumers: <file:function list>
- Tests at the seam today: <the suites that reach it, or "none" after looking>
- Shape: <letter(s), per branch if mixed>
- Behaviour to preserve: <section 5>
- Proposal: <target representation and where it lives, how consumers change, what disappears>
- Migration steps: <ordered, each shippable>
- Risk: <low, medium or high, and why>

## Left alone
<each function reviewed and kept, with its reason>

## Guardrails proposed
<phase 4, as proposals>
```
