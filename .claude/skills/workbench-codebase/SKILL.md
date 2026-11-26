---
name: workbench-codebase
description: "Use to keep a TypeScript/JavaScript codebase in the state that makes work fast: to see the system at a glance (the `overview` verb), to gate your own change before you report it done (`check`), to find what drifted since a base and which commit did it (new cycles, upward imports, dead exports, outlier files, hotspots), to read who imports whom, a module's weight and parts, or the open branches touching the same files, and to give the person the page that shows all of it live (`open`). Works on any git repository."
---

# Codebase

**The bench catches drift early and says plainly what drifted, where, since which commit, and the line to fix.** Run `$C check` before you call any change done, on every scope: it exits 1 on a new cycle, a new upward import, a new dead export or a new outlier file since the base, and names the file:line and the commit that brought it. A done-when that checks one folder misses what the change broke next door.

`$C` is `node .claude/skills/workbench-codebase/core/cli.mjs`, run from the repository's root. **Once per checkout, `npm ci` in this skill's folder**: its one dependency, TypeScript 6, whose parser API TypeScript 7 (the companions' own) no longer ships. Nothing else to install or configure.

## Verbs

| Verb | Answers |
|---|---|
| `overview [scope] [--since <ref>]` | drift since the base first, then net lines, size, cycles, upward imports, hubs, hotspots, outliers, fat units, dead exports, shallow modules |
| `check [--since <ref>]` | the gate: exit 1 on a structural regression; hotspots touched and growth are warnings |
| `cycles [scope]` | import cycles between modules and between files, one import site each |
| `deps <folder\|file\|package> [--edges]` | who imports it and what it imports, by unit, with the import lines; `--edges` every file:line behind each |
| `layers [scope]` | the order the imports imply, one stack per group of parts that never import each other; upward imports go against it |
| `fan [scope]` | units by fan-in (hubs) and fan-out |
| `size [scope]` | each unit's weight and the outlier files; `--per-commit <range>` net lines by kind for each commit and the total |
| `hotspots [scope] [--functions]` | lines × commits over 60 days, above the repository's own norm; `--functions` the functions whose surviving lines the most commits wrote (git blame) |
| `dead [scope]` | exports nothing imports and no other file names (tests count as users); `--full` grouped by unit |
| `shallow [scope]` | modules whose index offers at most one name, and folders holding no tracked file |
| `retired <word>… [--in <scope>]` | every path, name and line holding a word of a retired concept, comments apart from code |
| `barrels [scope]` | files that only re-export, and who reads through each |
| `single-use [scope]` | exports exactly one other file imports |
| `one-impl [scope]` | interfaces and types with a single implementation (implements / satisfies) |
| `unproduced [scope]` | `kind` variants a type declares that no object literal writes |
| `same-names [scope]` | functions declared under one name in several files, and which are byte-identical |
| `outline <folder>` | its parts by weight and what its index offers |
| `uses <Name>` | the files that import a name |
| `branches` | open branches, the units each touches, files HEAD changed too |
| `runs [<run>]` | the recorded runs, or one run's calls |
| `open` | for a person: the page's address (drift, the map with its weight, deps, change, health and work lenses, the matrix, the trace) |

A scope is a folder, a file, a package name, or `all` (the default). `--head <ref>` reads a commit instead of the working tree, for every verb. The base is the merge-base with the main branch unless `--since` names one. Every verb answers short; `--full` every line, `--json` the data, `--md` a phone file, and `overview` and `deps` take `--mermaid` for a diagram in a document or a post.

## What to know

- **Every call after the first takes about a second**: parsed facts are cached by file content in the tool's own cache folder (derived, safe to delete).
- **At the start of a session, run `$C open` once**, so the person's page in aiview is live before your first verb. After that, every verb also keeps this checkout's page up and on the current code, without waiting for it; the person follows your calls there.
- **Your calls are recorded by themselves** (`~/.codebase-bench/<repo>/traces/<run>.jsonl`); the person follows them on the page. Nothing else is stored.
- **No configuration.** `.claude/`, `node_modules/` and committed bundles (`dist/`, `dist-cli/`) are not read. Units, layers and every norm (outlier files, fat units, hotspots) are inferred from the repository itself, so a finding means "unusual here", not "over a number someone chose".
- **A regression is fixed in the code**, never by a wider norm or an exception: the tool has no place to write one.

## Adding a verb or a measure

A verb is one entry in `core/verbs.mjs` (`help`, `run(root, args, flags) → { title, lines, count, data, exit? }`); a measure is computed in `core/insights.mjs` from the model and compared in `compareOf`, so `overview`, `check` and the page get it at once. Two standing rules:

- **No window, ever.** Every child process a verb or the page server starts passes `windowsHide: true`, runs its program directly (git, node; never a shell, `start` or `pnpm`), and the page's polls start none: on Windows each child otherwise opens a console window.
- **Nothing configured, nothing stored.** A threshold is read off the repository's own distribution, and only the trace is written.
