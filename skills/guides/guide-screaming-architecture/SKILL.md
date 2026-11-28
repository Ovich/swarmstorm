---
name: guide-screaming-architecture
description: "Use when code is added, moved or named in a product's code, in any tier: a new screen, verb, command or concept, a new file or folder, an identifier the user would read. Produces the code placed under its product feature's folder and named in the product's words, and the bar it must meet at merge. Not for a library or a tiny tool with no product surface, and not for reworking a codebase not yet aligned (screaming-architecture-rework)."
---

# Guide: screaming architecture

**Applies** to any code a product's user reaches, through a screen, a command or an agent's verb: where its files live and what their names say. The folder tree reads like the product.

## Shaping step

1. Name the product surface the change serves, in its user's words: the screen ("Orders"), the command or the verb ("checkout"); an agent's verbs and the concepts its answers name count.
2. Find that feature in the product map; no map yet, or the surface is missing from it: `references/product-map.md`.
3. Put the code under that feature's folder, in each layer it touches (layer, then feature: `ui/orders/`, `server/orders/`). Storage, transport and process stay horizontal, in their own folders.
4. Name files and identifiers with the map's words; never a retired one, never a word no surface reaches. A new surface is a new map row in the same change.

## Where a piece goes

- A primitive several features read is horizontal, in the shared layer, never one feature's.
- A shared renderer, or a bar composing several features, sits at the screen's root or in shared UI.
- A feature component that shows another feature's widget takes it as a slot; the root composes them.
- A constant or helper two features share goes to their parent's root, named for what it is.
- One feature imports itself across its layers freely; a crossing is from one feature into another.
- A name kept for the wire, the store or a test (a method, a stored key) stays, noted in the map.
- The checker flags a file: fix the dependency or the placement, never rename to dodge it.

## Ok at merge

- No feature spread: a file carrying a feature's word sits under that feature's folder or a horizontal one.
- No hidden concept: every feature folder is named in the map, or listed horizontal.
- No word drift: no retired word in a new path or identifier.
- No cross-feature import added from one feature's folder into another's.
- `node <skill-dir>/scripts/check.mjs` exits 0 (`--base <ref>` for the change's base; `--all --scope <path>` for every violation in an area). Its lines name each fix; a symptom read for the person: `references/symptoms.md`.

## When not to apply

A library, whose surface is its API and is shaped by the `guide-deepen-module` skill; a tiny tool of a few files; generated or vendored code.

## The rework

The codebase is not aligned yet, or a change would move more than its own feature: stop and run the `screaming-architecture-rework` skill.
