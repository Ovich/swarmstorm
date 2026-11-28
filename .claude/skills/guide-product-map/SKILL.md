---
name: guide-product-map
description: "Use when code is added, moved or named in this repository's companions (swarm-board, aiview): a verb, a screen, a module, a folder or an identifier. Produces the code placed under its feature's home and named in the product's words, as the map below says. Not for skills' text, tests' own names, or the release bundles."
paths: ["skills/companions/**/*.{ts,tsx,js,mjs}"]
---

# Guide: product map

**Applies** to every source file of the two companions: where it lives and what its names say.

## Shaping step

1. Name the entry the change serves: a verb of `swarm --help`, `swarm --help code` or `aiview --help`, or an aiview screen. A concept the answers name without a verb is a word of the feature that owns it; an alias sits with its verb.
2. Find its row below; put the code under one of its homes, the CLI side in the `cli/verbs/<feature>/` home, the board side in the `board/<feature>/` home, the page side in the `app/<feature>/` home.
3. Storage, transport, process, the answer wording (`cli/answer/`, AGENTS rule 13) and the page's chrome stay in the horizontal folders.
4. Name files and identifiers with the row's words; never a retired one, never a word no entry reaches. A new verb, screen or concept is a new row or alias here, in the same change.

## Ok at merge

- Every new or moved file sits under its feature's home or a horizontal folder.
- No new folder beside the homes that is neither a home nor horizontal.
- No retired word in a new path or identifier.
- A new verb, screen or concept has its row or alias.

## Map

| word | entries | home | retired |
|---|---|---|---|
| run, runs, retention, orchestrators | open, seat, close, pause, resume, status | skills/companions/swarm-board/src/board/run, skills/companions/swarm-board/src/cli/verbs/run, skills/companions/aiview/app/board/run | |
| members, member, liveness, guides | join, end, roster, doing, link | skills/companions/swarm-board/src/board/members, skills/companions/swarm-board/src/cli/verbs/members, skills/companions/aiview/app/board/members | runner |
| conversation, mention, mentions, talk, messages, delivery | post, agree, endorse, read, thread, wait | skills/companions/swarm-board/src/board/conversation, skills/companions/swarm-board/src/cli/verbs/conversation, skills/companions/aiview/app/board/conversation | |
| phases, owing, all-done | phase, done | skills/companions/swarm-board/src/board/phases, skills/companions/swarm-board/src/cli/verbs/phases | |
| code, claim, claims, conflicts, overlap, worktrees | merge-lock, merged, worktree | skills/companions/swarm-board/src/packs/code, skills/companions/swarm-board/src/cli/verbs/code, skills/companions/aiview/app/board/code | |
| board | board, Board | skills/companions/swarm-board/src/board, skills/companions/aiview/src/board, skills/companions/aiview/app/board | |
| documents, document | add, open, update, list, remove, move, path, Documents, Sketches, Pinned | skills/companions/aiview/src/documents, skills/companions/aiview/app/documents | |
| projects, project | project | skills/companions/aiview/src/projects | |
| pending | pending, Pending | skills/companions/aiview/src/pending, skills/companions/aiview/app/pending | |
| prototype | components, check, show, Prototype | skills/companions/aiview/src/prototype, skills/companions/aiview/app/prototype | |
| plan, tracker, slice | plan, tracker | skills/companions/aiview/src/plan | |
| workbench, bench | Workbench | skills/companions/aiview/app/workbench | |
| home | status, init | skills/companions/aiview/src/home | |

`upkeep` (run) is not retired while `Board.upkeepIfDue` and `UPKEEP_EVERY_MS` hold the name (product-shape#D15); a new name says retention.

## Horizontal

- skills/companions/swarm-board/src/host
- skills/companions/swarm-board/src/contract
- skills/companions/swarm-board/src/link
- skills/companions/swarm-board/src/server
- skills/companions/swarm-board/src/client
- skills/companions/swarm-board/src/store
- skills/companions/swarm-board/src/packs
- skills/companions/swarm-board/src/cli
- skills/companions/aiview/src/cli
- skills/companions/aiview/src/server
- skills/companions/aiview/src/store
- skills/companions/aiview/src/host
- skills/companions/aiview/src/contract
- skills/companions/aiview/app/shell
- skills/companions/aiview/app/ui
- skills/companions/aiview/app/lib

## Stoplist

- open
- status
- path
- read
