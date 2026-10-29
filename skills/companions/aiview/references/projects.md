# Projects

A project is a declared record, never a value guessed from a path:

| Field | Meaning |
|---|---|
| `slug` | The name. Also the folder name under `docs/` and the sidebar label. |
| `title` | Optional longer name; falls back to the slug. |
| `paths` | The working directories the project covers, absolute, therefore machine-specific. |

```sh
$A project add acme --path <the acme working dir on THIS machine>   # also creates docs/acme/
$A project list                                                      # slugs, counts, directories, coverage
$A use acme                                                          # the default project: new tabs, the CLI's fallback
```

`paths` never decides where a document lives; documents always live in `docs/<slug>/`.
It answers the other question, asked before a file exists: "I am working in
`C:\acme\portal`, which project is that?" The longest declared prefix wins, so a
sub-repository can be split out later without disturbing its parent.

`paths` is a list, which is what makes a data home synced between machines work: give
the same project one entry per device (`C:\acme` on Windows, `/Users/you/acme` on
macOS) and the longest-prefix match picks whichever exists locally. Adding a path never
removes the others.

## Each tab keeps its project

**A tab's project is its own**, kept in the tab and in its URL (`?project=<slug>`), so a
reload keeps it. Two sessions on two projects never pull each other's tabs.

- **The person's pick in a tab's sidebar** changes that tab only, and sets the default:
  the project a new tab opens on.
- **`use`** sets that default and the CLI's last fallback (`--project`, then the working
  directory's project, then the default). It moves no tab.
- **A major event reaches one tab**: a **new** document (an update re-renders in place and
  moves nothing), a **new** run's board, and `show`. It goes to the tab already on that
  project, else the last one used, which switches to it. That tab acknowledges; one that
  does not within 2 s is passed over for the next.
- **News in another project** puts a dot on its sidebar entry until the tab visits it.

The answer's last line says what the person now sees, and the agent says only that:

| line | meaning |
|---|---|
| `shown in the person's tab on <p>` | a tab already on the project shows it |
| `switched the person's last-used tab to <p>` | the last-used tab moved to the project |
| `updated in place: no tab moved` | an update; the tab showing it re-rendered |
| `no viewer tab showed it: give the person the link in chat: <url>` | no tab took it |
