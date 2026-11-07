# Decisions rows

The core every decisions table shares, whatever document holds it:

```text
| id | Decision | Depends on | Status | Source |
```

- **id**: `D<n>`, from `D1` in each document, never continuing another's: no counter is
  shared between documents written on two branches. Outside its document a decision is cited
  `<topic>#D<n>` (a plan) or `<topic>.board#D<n>` (a board), the topic being the file name's
  slug; a task quotes its plan's short `D<n>`. A document of an older project-wide series
  carries `> **Decision ids**: legacy series` under its title, and a bare `D<n>` in code
  resolves against those.
- **Decision**: the decision, in one sentence.
- **Depends on**: the ids it rests on, or nothing.
- **Status**: `agreed` · `open` · `deferred` · `ruled (by whom)` · `for the person`.
- **Source**: where it was settled: `Q<n>` (a question), `#<seq>` (an agreement on the board),
  the person's words, `agent, delegated` (the person left it to the agent), or `agent default`
  (the person was never asked: status `for the person` until they confirm it at approval).

A document adds its own columns after these, never between them: a brainstorm board adds
`Log`, a plan adds `Kind` and `Task`.
