# The product map

The map lists the product's features as its user names them, each with the surfaces that reach it and the folders that are its home. The guide places code against it; the checker reads it.

## Where it lives

In the project guide `guide-product-map`, at `<repo>/.claude/skills/guide-product-map/SKILL.md`, a fixed path the checker reads. Write it through the `guide-create` skill: its `paths` the product's code files, its shaping step "find the row, put the code under its home", then the sections below. No map: the checker says so in one line and exits 0.

## Finding the map, per kind of product

| Product | Its surfaces | Read from |
|---|---|---|
| An app with screens | each screen and panel the user opens ("Orders", "Checkout") | the navigation, the routes, the prototypes' screen and component names |
| A CLI | each verb and its flags' concepts ("checkout", "refund") | `--help` and each verb's own help |
| A tool agents use | each verb, and each concept its answers name without a verb of its own | the verbs' help and their answers |
| A product still planned | each deliverable slot | the roadmap's slots |

A surface becomes an entry; entries that share one concept become one feature, its word the user's. A concept the answers name without a verb is a word of the feature that owns it; an alias (a second verb name, a plural) sits with its verb.

## Its format

```
## Map

| word | entries | home | retired |
|---|---|---|---|
| orders, order | Orders, list, cancel | src/server/orders, src/ui/orders | basket |
| checkout | checkout, pay | src/server/checkout, src/ui/checkout | — |

A kept name: `cartId`, the stored key, stays until the store migrates.

## Horizontal

- src/store
- src/transport

## Stoplist

- list
```

- **Columns** are found by their header, in any order: `word`, `entries`, `home`, `retired`. Each cell is a comma-separated list; backticks are ignored, `—` is empty.
- **`word`**: the feature's word, then its aliases. The first is the feature folder's name; every one is matched.
- **`entries`**: the surfaces that reach the feature; each is matched like a word.
- **`home`**: one or more repo-relative folders, one per layer the feature spans; a file under any of them is home. The folder holding a home is a feature layer; its other child folders are feature folders, each owed a row or a place under `## Horizontal`.
- **`retired`**: words the code must no longer use, in a path or an identifier (comments and strings are not read).
- **`## Horizontal`**: the folders of storage, transport, process and shared UI; a home may sit under one, as a feature folder of a layer inside it.
- **`## Stoplist`**: words too generic to place anything (`list`, `open`), matched in any spelling.

Words match as a whole path part, or a contiguous run inside a compound part, split on kebab, snake and camel case: `checkout` matches `checkout-panel.ts` and `checkoutTotal.ts`. Tests are outside the spread and hidden-concept measures.

**A name kept** for the wire, the store or a test (a method, a stored key) goes in a line under the table, with why; its word stays out of `retired` until the rename lands.

## Keeping it

A new surface is a new row or alias in the same change that adds it. A word that gives false spread goes to the stoplist, never a wider norm. A feature renamed for the user moves its old word to `retired`.
