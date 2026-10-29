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

**A tab's project is its own**: the open document's, or on the board the one its address names
(`#board&repo=<key>[&run=<id>]`, the key a project's slug or a repository on its board), so a reload
keeps it. A tab opened without one takes the project shown last once (else the first) and writes it in.
There is no global project and no All projects: each tab shows one project, each verb works in one.
Two sessions on two projects never pull each other's tabs.

- **The person's pick in a tab's project switcher** changes that tab only, and records the
  project a new tab opens on.
- **Every CLI verb takes its project from `--project <slug>`, else the working directory's**;
  neither, it is refused, naming the known projects. `list` is one project's (no `--all`).
- **The agent's `open` and `show` go to the tabs on the agent's project**, the one claiming the
  CLI's working directory: every such tab moves, no tab on another project does. None open there:
  aiview opens a new tab on it.

The answer's last line says what the person now sees, and the agent says only that:

| line | meaning |
|---|---|
| `opened in <n> open tab(s) on <p>` / `shown in <n> open tab(s) on <p>` | the tabs on the project show it |
| `no tab showed <p>: opened a new one` | no tab was on the project: a new one shows it |
| `no aiview server answered: give the person the link` | `show` reached no server: the link goes in chat |
