# The sidecar: how a bench's data is written and read

Read when a bench's feed or one of its views is written or changed, or when an existing bench
is reworked to this shape.

## Layout

A workbench is one registered page and one unregistered folder beside it, the sidecar:

```
<date>-<bench>.workbench.html          registered page (code only)
<date>-<bench>.workbench/
  manifest.json                        commit point, renamed in last
  .lock                                held by a writer
  data/<tab>/<run>/run.<h8>.json       the run minus its side files, content-hashed
  data/<tab>/<run>/<side file path>    one value moved out byte for byte
  shared/<name>.<h8>.json              shared files
  data/entries/NNNNNN.json             log benches
  data/notes/NNNNNN.json               log benches
```

- **The page holds code only.** Every byte of data is in the sidecar, written by the feed.
- **`manifest.json` is the commit point**: it names every tab, run, side file and shared file
  by its current file name. A reader sees the previous manifest or the new one, never half a
  write.
- **A side file** is one value of a run moved out byte for byte (a long text, a recording, a
  large JSON) so a view loads it only when it opens. The run file keeps the rest.
- **A log bench** keeps one file per entry and one per entry's notes, numbered from 1, never
  rewritten by the feed except its notes.

## The writer: `scripts/data-folder.mjs`

Copied into the bench skill's `scripts/`; `feed.mjs` imports it. Only the feed calls it.

```js
writeDerived(page, { keepRuns?, shared?, tabs: { [tab]: [{ name, stopped?, run, files? }] } }) -> { written, kept, pruned }
appendEntry(page, entry) -> n
annotate(page, n, notes)
readManifest(page) -> Manifest | null
```

- **`writeDerived`**, a derived feed: each tab's runs, each run its `run` object and its
  `files` (side file path to value). Run files are content-hashed; a side file is rewritten
  only when its bytes differ; the manifest is renamed in last; files no longer named by the new
  or the previous manifest are pruned. `keepRuns` keeps that many runs per tab, the bench's
  choice (default 5); it can grow, since only the manifest loads at open.
- **`appendEntry`**, a log feed: writes the next entry under the lock and returns its number,
  1-based. **`annotate`** merges `notes` into entry `n`'s notes. A log is never pruned.
- **The lock** (`.lock`) is held by a writer with a 5 s heartbeat and taken over once stale
  after 60 s.
- **`readManifest`** for a feed or a script that needs what is there; `null` before the first
  write.

## The loader: `bench`

Inlined into the page by `page.mjs`. A view reads data through it and nothing else.

```js
bench.manifest() · bench.run(tab, run) · bench.file(tab, run, path) · bench.shared(name)
bench.entry(n) · bench.notes(n) · bench.view(el, name, draw) · bench.redraw() · bench.onFed(cb)
bench.state.get(key) / set(key, value) · bench.text(s)
```

- **Fetching**: relative URLs into the sidecar, through aiview's bridge, which serves the
  workbench frame. Without the bridge (an older aiview, `file://`) the loader says so on the
  page. A bench's code that fetches around the loader is a review finding.
- **Caching**: each file is cached in page memory by file name; a hashed name never changes
  content, so a pick back to a run costs nothing.
- **At open**: the manifest, then the remembered run of the remembered tab (else the newest
  run of the first tab). Another run on pick, `loading <run>` shown meanwhile, never a blank.
- **A side file loads only when the view that needs it opens**: `bench.file` inside that
  view's `draw`, never at open. A view that needs every side file of a run asks for them
  itself, when it opens.
- **Views are async**: `bench.view(el, name, draw)` runs `draw`, sets `data-ready` on `el`
  when it is drawn, and `data-error` with the path and status when a fetch fails, rendered in
  the view. `bench.redraw()` draws the open views again; `bench.onFed(cb)` runs when the feed
  wrote a new manifest.
- **Fold thresholds**: a text over 256 KB is folded, showing its size and a show button
  (`bench.text`); a run over 5 MB opens one view at a time; aiview refuses a file over 64 MB
  with a named error (413).
- **The person's place**: tab, run, open view and controls are kept with `bench.state`, and
  the page reopens where they left it.
- **JSON** is drawn through `jsonTree`, as `references/json-data.md` says.

## Reworking an existing bench

A bench made before this shape (its data in a `data block` inside the page, written by
`scripts/data-block.mjs`) opens and feeds as it did; it is reworked when it is next worked on,
never by a mechanism:

1. `node scripts/page.mjs <path> --label "<label>" --replace` makes the page fresh at the same
   path: aiview id and link kept, the bench's code between `<!-- bench-code -->` and
   `<!-- /bench-code -->` kept verbatim. It refuses a page without those markers.
2. The bench's views are rewritten to load through `bench`, and put on the page by its
   `code.mjs`.
3. `feed.mjs` is rewritten over `data-folder.mjs`, its old `data-block.mjs` deleted, and run:
   the sidecar fills, the page updates in place.
4. Its `check.mjs` and `shot.mjs` are brought to the standard in `SKILL.md`.
