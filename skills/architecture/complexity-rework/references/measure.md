# Measure

Two numbers per function: its complexity and its fingerprint hits. Use what the project already runs before adding anything, and say in the report which measure, which tool and which threshold the numbers come from.

## Complexity

- **Cyclomatic**: independent paths, the testing effort. 1, plus one per decision point: `if`, each loop, each `case` (not `default`), each `catch`, each ternary, each `&&`, `||` and `??`. Nesting adds nothing. Tools differ: ESLint also counts `?.` and default parameters, which inflates readable chains; say which counting the numbers use.
- **Cognitive**: reading effort. +1 per break in flow (a whole `switch` counts once), plus one per level of nesting, plus one per run of like boolean operators; `?.` and `??` do not count (Sonar's specification).

**Each measure has its bands** (SKILL.md) and neither stands in for the other: a flat 12-way switch is 13 paths and cognitive 1; a loop of nested ternaries is 6 paths and cognitive 11. Where a toolchain gives only one, count the other from the language's syntax tree (a short walk) or with a scratch analyzer.

## Where the numbers come from, in order

1. **The project's own linter**, when it has a complexity rule (the rule per language: `languages.md`). Run it with the rule on at a low threshold, from a scratch configuration when the project's own must not change.
2. **A language-agnostic analyzer**, when the linter has no rule or the repository mixes languages. `lizard`, for example, parses most mainstream languages and prints cyclomatic complexity, length and parameter count per function:

   ```bash
   pip install lizard
   lizard <path> -C 10 -w          # every function above 10
   lizard <path> --csv > cc.csv    # every function, for sorting
   ```

   `scripts/detect-complexity.py` wraps lizard and adds the fingerprint score (`python3 <skill-path>/scripts/detect-complexity.py <path> --min-score 6`). An example, not a requirement.
3. **By hand**, when neither is available or the code is small: search the fingerprints below, count the decision points in what they point to.

A tool installed in a scratch folder only to measure is not a dependency; the no-dependency rule covers what lands in the repository. When two tools disagree on where a function starts, match by the enclosing function's line range: a closure counts toward its parent.

Confirm every lead by reading the function.

## Fingerprints

| Signal | What it suggests |
|---|---|
| Two or more type tests or parse attempts in one function | late typing, dispatch by trial |
| The same field compared to string literals twice, or three or more literal `case` labels | stringly-typed variants |
| An untyped input parameter | the shape decided late |
| Casts on nested values | types unknown at the use site |
| Defaults on fields that should be guaranteed (`?? 0`, `or []`, `getOrDefault`) | the model does not encode its guarantees |
| A boolean parameter | two functions in one |
| Nesting four deep | missing guard clauses, or a phase split |

**Type tests and parse attempts**
- TS/JS: `typeof x ===`, `instanceof`, `.safeParse(`, `.is(` guards, `"key" in obj`
- Python: `isinstance(`, `type(x) is`, `hasattr(`, `.model_validate(` in a `try`
- Java/Kotlin/Scala: `instanceof`, ` is `, `getClass()`, `.isInstance(`
- C#: ` is `, ` as `, `GetType()`, `TryParse(`
- Go: `.(type)`, `, ok := x.(T)`
- PHP: `instanceof`, `is_array(`, `is_string(`, `gettype(`
- Ruby: `is_a?`, `kind_of?`, `respond_to?`
- Swift: ` is `, `as?`

**Untyped input**
- TS: `unknown`, `any`, `Record<string, unknown>`
- Python: `Any`, `dict`, `dict[str, Any]`, `Mapping[str, Any]`, `object`, untyped `**kwargs`
- Java: `Object`, `Map<String, Object>`, `JsonNode`
- Kotlin: `Any`, `Map<String, Any?>`
- C#: `object`, `dynamic`, `Dictionary<string, object>`, `JsonElement`
- Go: `interface{}`, `any`, `map[string]any`
- PHP: `array`, `mixed`
- Ruby, plain JS: hash access compared to a literal (`x[:type] ==`, `x["type"] ===`)

**A field compared to a literal**: `x["kind"] ==`, `x.kind ==`, `x.get("kind") ==`, `x.getType().equals("...")`, `x[:kind] ==`, `$x['kind'] ===`.

## Not signals on their own

- Many conditions over values (thresholds, permissions, flag combinations): the domain, shape H.
- One parse or type check at an I/O boundary: that is where it belongs.
- Guard clauses at the top of a function.
- Generated code, parsers, lexers and interpreters, where a large switch is the natural form. Note them and move on.
