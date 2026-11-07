# Language idioms

For each language: how to express a closed set of variants (shape A), how to get completeness checking, where to parse at the boundary, and the lint rule for complexity. Check the project's language version before recommending anything.

## TypeScript
- **Sum type**: discriminated union on a literal field (`{ kind: "paid"; amount: number } | ...`).
- **Exhaustiveness**: `switch` with `default: { const _: never = x; }`, or a handler map typed `{ [K in T["kind"]]: ... }` with `satisfies`; lint `@typescript-eslint/switch-exhaustiveness-check`. The never-call sits in `default:`, not after the switch: after a total switch it is unreachable code to the compiler. In a `void` function it is called, not returned.
- **Boundary parsing**: whatever validator the project uses (Zod `discriminatedUnion`, Valibot, io-ts, ArkType, TypeBox).
- **Complexity lint**: ESLint `complexity` (cyclomatic), `sonarjs/cognitive-complexity`; Biome `noExcessiveCognitiveComplexity` (cognitive only, no cyclomatic rule).

## JavaScript (untyped)
- No compile-time exhaustiveness. Use a lookup table keyed by kind plus a single assertion for unknown kinds at the boundary, and JSDoc typedefs checked with `// @ts-check` if the team accepts it.

## Python
- **Sum type**: `Union` of dataclasses/attrs/Pydantic models, each with a `Literal` tag field; or `enum.Enum` for payload-less cases.
- **Exhaustiveness**: `match` (3.10+) with `case _: assert_never(x)` (`typing.assert_never` 3.11+, `typing_extensions` before); checked by mypy/pyright. Before 3.10: if/elif with `assert_never` at the end.
- **Boundary parsing**: Pydantic discriminated unions (`Field(discriminator="kind")`), msgspec, cattrs.
- **Polymorphism**: methods on classes, or `functools.singledispatch` for operations defined outside the classes.
- **Complexity lint**: Ruff `C901`, `PLR0911/0912/0915`; radon.

## Java
- **Sum type**: `sealed interface` + `record` implementations (17+). Before 17: abstract class with private constructor, or enum.
- **Exhaustiveness**: pattern-matching `switch` over sealed types without `default` (21+). Before: visitor pattern, or enum switch plus an error-prone/checkstyle rule.
- **Boundary parsing**: Jackson `@JsonTypeInfo` + `@JsonSubTypes`.
- **Complexity lint**: Checkstyle `CyclomaticComplexity`, PMD, Sonar.

## Kotlin
- **Sum type**: `sealed interface`/`sealed class` with data classes.
- **Exhaustiveness**: `when` used as an expression over a sealed type (compiler-enforced).
- **Boundary parsing**: kotlinx.serialization polymorphic/sealed, Moshi adapters.
- **Complexity lint**: detekt `CyclomaticComplexMethod`, `ComplexCondition`.

## C#
- **Sum type**: abstract record base with sealed record subtypes; or a library such as OneOf.
- **Exhaustiveness**: switch expressions warn on non-exhaustive input (CS8509) but not for open hierarchies; keep hierarchies closed (private/internal constructors) and treat the warning as error, or use an analyzer that checks closed hierarchies.
- **Boundary parsing**: System.Text.Json `[JsonPolymorphic]` + `[JsonDerivedType]` (.NET 7+).
- **Complexity lint**: CA1502, Sonar.

## Go
- **Sum type**: interface with an unexported marker method, implemented by each variant struct.
- **Exhaustiveness**: type switch plus the `exhaustive` or `go-sumtype` linter (via golangci-lint); for const enums, `exhaustive`.
- **Polymorphism** is often more idiomatic than type switches: put the method on the interface.
- **Boundary parsing**: decode to a small envelope `{ Kind string; Data json.RawMessage }`, then switch once on Kind.
- **Complexity lint**: golangci-lint `gocyclo`, `gocognit`, `nestif`.

## Rust
- **Sum type**: `enum` with data; `match` is exhaustive by default. Loaded functions in Rust usually come from matching on `&str` or `serde_json::Value`: parse into an enum with `#[serde(tag = "kind")]` instead.
- **Complexity lint**: Clippy `cognitive_complexity`, `too_many_lines`.

## Swift
- **Sum type**: `enum` with associated values; `switch` is exhaustive. Avoid `default` in consumers.
- **Boundary parsing**: `Codable` with a custom `init(from:)` switching on the tag once.

## Scala
- **Sum type**: `sealed trait` + case classes (Scala 2), `enum` (Scala 3); compiler warns on non-exhaustive matches.

## PHP
- **Sum type**: `enum` (8.1+) for payload-less cases; interface + final readonly classes for payloads.
- **Exhaustiveness**: `match` throws on unhandled values at runtime; PHPStan/Psalm can check enum exhaustiveness statically.
- **Complexity lint**: PHPMD, PHPStan rules.

## Ruby
- **Sum type**: no static checking. Use small value classes per variant with a shared method (polymorphism, shape B) or `case/in` pattern matching (2.7+/3.0+) with an explicit `else raise`.
- **Complexity lint**: RuboCop `Metrics/CyclomaticComplexity`, `Metrics/PerceivedComplexity`.

## C / C++
- **C**: tagged struct with an enum tag; `-Wswitch-enum` warns on missing enum cases (avoid `default`).
- **C++**: `std::variant` + `std::visit` with an overloaded lambda set (compile error on a missing case); or virtual methods for shape B.
- **Complexity lint**: clang-tidy `readability-function-cognitive-complexity`.
