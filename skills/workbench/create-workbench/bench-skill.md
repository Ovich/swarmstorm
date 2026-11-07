# The shape of a bench's skill

The bench skill records how the work is done: what the person and the agent aligned on, kept
so it is never explained again, with the bench as its dev tool. Text in `[brackets]` is filled
from the definition. Every other sentence is carried as written.

```markdown
---
name: workbench-[bench]
description: "Use when [the bench's scope, a kind of work on a part of the product] is to be worked on with the person on the [label] workbench, or the bench's feed or scripts fail. Feeds the page from the project's own data[ and operates the walk]. Not for [the neighbouring question it does not answer]."
---

# [Label] workbench

**You are the owner of the [label] workbench**: its page, its feed and its scripts are yours. You operate it with the person and keep it true, fast and easy to drive: when the project moves on, or a step is slow or awkward, you adapt it in place, in the same session. No other skill maintains it.

[The bench's scope, one sentence.] [Its views, one line each: the question each answers.] [What the person does on it.]

This bench is a dev tool for iterating on ideas with the person: a clear UI for them, cheap to read, change and check for you. A new question in this scope is a new view or mode here, never a second bench; an idea dropped takes its view, its code and its feed fields with it, in the same change. Every JSON on the page is shown through `jsonTree`, with its toolbar.

**The page** is `[YYYY-MM-DD-bench.workbench.html]` in aiview, kind `workbench`
([the aiview link]). It is a working document of the data home and never enters this
repository. Its data is in the sidecar beside it, `[YYYY-MM-DD-bench.workbench/]`.[ One page
per run: the page code kept in this skill is every page's code; the feed's `init` makes a run's
page with a sidecar of its own, and its `refresh` puts changed code onto each page as
`page.mjs --replace` does, the code block replaced, the sidecar untouched.]

## Sources

| Source | Path | Written by |
|---|---|---|
| [what it is] | [path, or how it is reached] | [the code that produces it] |

The page works on these as the project produces them, never on a translation.

## Feed

**[Derived | Log].** [Derived: `node .claude/skills/workbench-[bench]/scripts/feed.mjs [--watch]`
rebuilds the runs from the sources. | Log: `node .claude/skills/workbench-[bench]/scripts/feed.mjs <verb>`
appends one entry and never rewrites one; the page is the only record of the walk.]
Only the feed writes the sidecar, through `scripts/data-folder.mjs`; views read it through the page's loader, `bench`.

## Iterating

[The one command that runs the loop: feed, reload, screenshot.] [The scripts that drive the page, one line each: open a view, set its controls, screenshot, read back what it shows.] Drive the bench through them; a view or control added gets its driving script in the same change.

**Keep your context clean.** Every verb prints a short summary; ask for `--full` or `--json` only when the summary cannot answer. Read summaries and diffs, never the raw files the bench shows.

**The person asks from a phone.** "Send me X" is `shot <view> --mobile` for a picture or `--md` on a reading verb for data, then the file sent as it is, unread. [The CLI's verbs, one line each, with what they print.] [The view the page opens on: the current question.] Read the page's code from its marker `// ---- the bench`, never the whole file.

## Operating

[Only when using the bench takes steps. Each step a script in `scripts/`, in the order
they run, with what it needs and what it leaves: start, act, hold, reset, record.]

## Drift

**Every script checks what it depends on and fails loudly**: a source missing, a field the
page reads absent, a table, a column, a route or a container gone, named in the error with
a non-zero exit.

**When a script fails, or the page shows a blank where data should be, the project has moved
on: adapt the bench to it, in place.** Read the source as it is now, change the feed, the
scripts and the page to match it, never the data to match the page, run the feed again,
and show the person what changed. A source the bench lost entirely is named to the person
before anything that depended on it is removed.

**A step that is slow or awkward to drive is drift too**, fixed the same way.
```
