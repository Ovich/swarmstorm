# Target shapes

Language-neutral. `languages.md` for the idiomatic form. A function over its band on paths (cyclomatic) usually takes A to F; one over on reading load (cognitive) only takes G first, then whatever its branches need.

## A. Closed set of variants: sum type, exhaustive matching

**When**: the cases are known and owned by the project, and new operations over them are added more often than new cases. Data that is serialized or stored usually fits here: behaviour should not travel with the data.

**Shape**: one type listing every variant, inferred from the existing schema where there is one. Raw data is parsed into it once at the entry point. Consumers match on it, with no default, so a missing case is a build error:

```
parse(raw) -> Event | ParseError        # once, at the boundary

describe(e: Event) -> Text =
  match e
    Created c   -> "created " + c.id
    Paid p      -> "paid " + p.amount
    Cancelled x -> "cancelled: " + x.reason
    # no default: a new variant fails here
```

## B. Variants that own behaviour: polymorphism

**When**: new variants are added more often than new operations, or each variant's behaviour is substantial and cohesive.

**Shape**: an interface with one method per operation, each variant implementing it. A or B is decided by what changes more often, and the report says which was chosen and why.

## C. Ordered or open rules: rule list

**When**: order matters, a matching case may decline and let the next one try, or the set is extended by plugins or configuration.

**Shape**: a list of rules, each answering a result or "not mine", tried in order, the ordering assumption stated above the list. Also the intermediate step toward A when the entry point cannot change yet.

## D. Key to result: lookup table

**When**: a branch maps a key to a value or a small function.

**Shape**: a table with a default. When the keys form a closed set, the table is typed total over it, so a missing key is a build error.

## E. Legacy or foreign shapes: normalize at the boundary

**When**: old stored formats, third-party payloads, several API versions.

**Shape**: one function at the entry point converts every accepted form into the current type, marked with when and why it can be removed. An old form that must behave differently gets its own explicit variant, never a hidden difference.

## F. Mixed responsibilities: phase split

**When**: one function parses input, decides, builds output and performs side effects, interleaved.

**Shape**: `parse -> decide -> act or format`, the decide phase a pure function from typed input to a typed decision, the side effects at the edges.

## G. Flag parameters and deep nesting

- A flag argument (`render(x, true)`): two named functions, or a small enum when the caller chooses at run time.
- Deep nesting: guard clauses with early returns, inner blocks extracted and named.

## H. Business rules: leave it

Exempt from the path limit only with an inline exception naming the rule it encodes. A long flat list of value checks is often a table: try D first.

Conditions on values, thresholds, permissions and flag combinations are the domain, and ifs express them. At most extract well-named predicates. The report records that it was reviewed and left alone, so nobody audits it again.
