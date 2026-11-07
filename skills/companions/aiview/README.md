# aiview

Local document viewer with a central index. Renders Markdown (GFM + mermaid), HTML
prototypes (sandboxed iframe with viewport presets), PDFs (native browser viewer) and the
project's swarm board (read from swarm's board server) at `http://localhost:4321`, live-reloads
on save, and keeps an index of every document it has been given (path, project, title,
kind, tags, group, start time) so earlier work is one click away. It is the one page and
the one document server of the collection; swarm's own board server serves no page.

One npm package: a React + TypeScript + Tailwind + shadcn-style UI (`app/`, built to
`dist/`), a small plain-Node server (the documents' API routes, the board's
`/api/board` and static, `src/server/`), and a CLI (`src/cli/`), all sharing `src/core/`
(typed sqlite index, path rules, file watcher). The board is read only through swarm's
BoardReader (`swarm/src/client/reader.ts`), a client of the swarm board server, bundled
into `dist-cli/` at build; aiview never opens swarm's store and never writes the board.

## Requirements

Node ≥ 22.5 (`node:sqlite`). One-time per machine, in this directory:

```sh
npm install && npm run build && node aiview.mjs init
```

`aiview.mjs` is the only entry point and its path never changes. If the build is
missing, every verb says exactly what to run; `serve`/`open` rebuild the UI
automatically when `dist/` is absent.

## Two roots

| Root | Holds | |
|---|---|---|
| This checkout | `app/`, `dist/`, `dist-cli/`, `node_modules/` | Rebuildable. Delete it, clone again, rebuild: nothing of yours was here. |
| **Data home**: `$SWARMSTORM_HOME`, else `swarmstorm_appdata` in the OS home dir | `aiview.sqlite`, `aiview.pid`, `aiview.port`, and documents under `docs/<project>/` | Yours. Never versioned, never inside a project repo. |

`init` creates the home and adopts an index left next to the tool by a pre-appdata
install (the original is kept, unused). Paths inside the home are stored relative, so a
synced home carries a working index to another machine; anything outside is stored
absolute. `status` prints all of this; `status --json` exposes `home`, `docs`, `sqlite`,
`tool`, plus `project`, `projectDocs` and `cwdProject`.

Inside the home, documents are filed one directory per project
(`docs/CIIP/`, `docs/JOBS/`…), and that directory *is* the document's project. Projects
themselves are records — slug, optional title, and the **working directories** they
cover — so a working directory under CIIP resolves to CIIP by longest-prefix match without any
document ever being classified by its own path.

## Usage

```sh
A="node <path-to>/aiview.mjs"   # wherever this folder lives

F=$($A path 2026-08-23-topic.brainstorm.md)   # never hand-build a path: this joins it for your OS

$A open  "$F" --tag proj --tag topic   # THE agent gesture (see below)
$A add   "$F" --tag proj [--group g --group-title "Title"] [--started ISO]
$A update <file|#id> [--kind k] [--tag t] [--untag t] [--group g|--ungroup] [--group-title T] [--started ISO]
$A list  [--kind brainstorm] [--tag proj]
$A remove <file|#id>...
$A move   <file|#id>... [--project <slug>]
$A project <add|list|rm> [slug] [--title T] [--path P]...
$A use    <slug|*>
$A serve [file] [--port 4321] [--open] [--detach]
$A path   <filename> [--project <slug>]
$A status
$A init
```

- **open**: idempotent one-shot: ensure the file is registered (same meta flags as
  `add`), ensure a server is running (starts one detached if not), print the URL.
  Safe to repeat; the standard way for an agent to say "make this visible".
- **add**: register a document. **Kind is mandatory**: from the filename convention
  `<name>.<kind>.md` (`….brainstorm.md` → `brainstorm`) or `--kind`. Tags via `--tag`
  (repeatable). `--group <slug>` puts the doc in a group (at most one per doc);
  `--group-title` names or renames that group. Start date-time = first registration,
  or `--started <ISO>`.
- **update**: change metadata without remove/re-add. `--ungroup` clears membership.
- **move**: refile a document, file and index row together. `--project <slug>` puts it
  in another project — the only way to reclassify one, since the project *is* the
  directory; bare, it pulls a stray back into its own project's directory. Id, start
  time, tags and group survive. An unknown project is refused rather than invented. If
  a previous run moved the file but failed to write the index, re-running re-points the
  stale row.
- **serve**: start the viewer. `--detach` daemonizes: writes `aiview.pid` +
  `aiview.port` next to the sqlite and returns; `open`/`status` find it through them.
- **project**: manage projects — `slug`, an optional `title`, and the **working
  directories** the project covers (`--path`, repeatable). `add` also creates
  `<docs>/<slug>/`. `rm` is refused while documents still reference it.
- **No global project** (board-split D41): every verb takes its project from `--project`,
  else the working directory's; each viewer tab keeps its own. `use` and `list --all` are gone.
- **status**: the two roots, `project` and `projectDocs` (the working directory's project and
  where to write; null outside one), `cwdProject`, doc count, server
  up/down (stale pidfiles detected).
- **path**: prints where a document with that name belongs, joined with this OS's
  separator under this machine's home. Agents call this instead of building a path;
  `--json` gives `{path, dir, project}`.
- **init**: create the data home, adopt a legacy index, print where everything lives.
- **--json** on every verb: compact machine-readable output.

## UI

Left: documents (search, kind chips with deterministic hues, tag chips), grouped docs
in collapsible containers (title + count, members oldest-first, container sorted by
latest member activity), ungrouped docs flat. Right: doc header (title, **absolute
local path with click-to-copy**, kind, started, tags, updated) and the rendered
document; live reload via SSE. `#doc=<id>` selects a doc. Dark mode follows the OS.

`/events` carries three kinds: `changed` when a watched file is edited on disk,
`index` when the document list itself moves (a document registered, moved, re-tagged or
dropped), and `open`/`show` sent to the tabs on the agent's project. The CLI writes sqlite in its
own process, so `index` is what it POSTs to `/api/index-changed` after a mutating verb —
without it a newly registered document would stay invisible until a manual refresh.

## Storage

`aiview.sqlite` in the **data home** (not next to the tool): `documents` (one row per
doc) + `groups` (slug → title) + `projects` (slug, title, covered working directories)
+ `state` (the project shown last, where a new tab opens; it scopes no verb). Files are the truth; the index only points at them.

Document paths are stored **relative to the data home** when inside it — which is what
lets a synced home carry a working index to another machine or another OS — and
absolute anywhere else. Relative paths are stored with posix separators and re-joined
with the local separator on read, so they mean the same thing everywhere.

The index is written only by the CLI, except the project shown last, which the UI also records
through `POST /api/recent-project`. Everything else in the UI is read-only.

## Development

```sh
npm run dev        # Vite dev server with HMR, proxying /api + /events to a running serve on 4321
npm test           # core + server + CLI (node:test, runs the TS directly on Node >= 23.6)
npm run test:app   # component tests (vitest + jsdom)
npm run typecheck  # both tsconfigs
```
