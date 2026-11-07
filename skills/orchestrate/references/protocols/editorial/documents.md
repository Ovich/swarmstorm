# Editorial: the documents

An editorial run has both documents, always: the **dossier** of the text, one per text, kept
across its runs, and a new **record** per run. Each template below is the skeleton to copy;
`<…>` is filled, nothing else is added except what the run's template adds, and only inside
**Inputs** and **Seats**.

| Document | Kind | Created | Read by |
|---|---|---|---|
| the dossier | `reference` | before the first run on the text, during the interview | each seat the sections its brief names (`seats.md`) |
| the record | `report` | when the run opens, before the dispatch | every seat at the start of each phase; readers only what their brief names |

## The dossier

`YYYY-MM-DD-<topic>-dossier.reference.md`.

```markdown
# <Topic>: the dossier

The inputs of every editorial run on <topic><, template `<template>`>. The person's answers,
confirmed facts, preferences and feedback bind. The orchestrator's proposals and every sample
sentence may be overturned with a reason and are never copied. This is material, not a
checklist: the text carries some of it, and the brief says what it leaves out.

## The strategy

| field | value |
|---|---|
| <field> | <value> |

## The ask

<what the text must do, for whom; the reader's own document named>

## The interview

### The ask against the evidence
<the ask split into its demands, each into parts, each met · partly · gap, with where the
evidence holds it; the verdict in one sentence; gaps inform emphasis, never content>

### Questions and answers
**Q1. <the question, as asked>** <the answer, restated in the register the text needs; what
the evidence already held>

### Preferences
**Q<n>. <voice | register | level of detail | the one thing the reader keeps | the close | …>.**
Shown: A « … » / B « … ». **Preference: <A | B | their own>.** The cost to watch: <…>.

### Confirmed facts beyond the evidence
- (Q<n>, <date>) <the fact, as written into <where> in the evidence>

## Inputs

| input | what it is | binding |
|---|---|---|
| <the evidence> | the facts | every fact and constraint binds |
| <the reader's own document> | the ask | the reader's own words |
| <the precedents> | earlier texts of the same kind | wording and framing only; a fact counts only if the evidence still holds it |

**Reading.** <how to read a large source: look up by name, never whole.>

## Given research

<context researched before the run, each figure and quote with its source and date; refreshed
when the evidence or the reader changes>

## Seats

### All seats
<whose text this is, for which reader, to what end: write it as if it were yours, the evidence
your only experience; the truth rule (a claim holds only if the evidence or the confirmed facts
hold it; a gap is never content and never conceded); the text (its language, the part written,
its length); the election (slots, source of candidates, the vote's rules)>

### <seat>
<its role prompt in full, its persona when it stands for a reader, what it never reads>

## Feedback

| date | what | the person's reason |
|---|---|---|
| <date> | <the phrase, claim or choice, quoted> | <their reason> |

**Claims struck**: <the claim>: <why, and what the evidence holds instead>.
**Accepted wordings** (a seat never strikes one it uses): « … ».
**What worked**: <what made the difference, one line per run>.

## This run

<what holds for the next run only, overriding the sections above where it differs>
```

**How it is kept.** The interview is written as it goes, the person confirming each restated
answer; a later round of preferences supersedes the answers it names, dated. Feedback is added
after each run. **This run** is the one section rewritten per run, what it changed for good
moved up first; the rest only grows or is corrected.

## The record

`YYYY-MM-DD-<topic>-record.report.md`, a new one per run.

```markdown
# <Topic>: run record

The record of one run: every phase's work, written here as the phase closes. Every seat reads
it at the start of each phase and builds on it. The inputs are in the dossier.

**Question**: <what the text must do, for whom>.

## 1. Research
### Judge
<the post>

## 2. Brief
### Strategist
<the brief>
### <Seat>
<its answer>
### Orchestrator
<a correction, if any>
### Strategist
<the settled brief>

## 3. Election: candidates
## 4. Election: votes and count
## 5. Draft
## 6. Polish
## 7. Read, round <n>
## 8. Revise
## 9. Final check

## The text (final)

<the final text, alone, as it will be used>
```
