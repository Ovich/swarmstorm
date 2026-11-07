# Protocol: editorial

One text written by one seat, read by seats standing for its readers, revised on what they say.
Out: the final text, its rounds kept in the record.

**Runs on** a brainswarm (the `brainswarm` skill).

**The loop**: cycle `read` → `revise`; goal (recommended) every reader seat passes the text with
no blocking note; cap 3, the strategy's `rounds` field. `polish` repeats inside its own phase up to
`iterations`, never asked as a loop.

- **The kind of text lives in the inputs, never in the protocol**: the template (or, with none,
  the strategist's brief) sets the skeleton, length, tone and **altitude**, the level of detail
  the reader is owed; the dossier holds the ask, the answers, the evidence, the seats and the
  feedback.
- **The seats**: `seats.md`, read before writing the dossier's seats. **The documents**:
  `documents.md`, read before writing either.
- **The record is the seats' working memory**: every phase written in as it closes, every seat
  reading it in full at the start of each phase.

## Templates

| Template | When | File |
|---|---|---|
| — | none in the plugin: a project keeps its own as a `protocol-<name>` skill | — |

## Strategy fields

| Field | Content | Recommended |
|---|---|---|
| questions | one row: what the text must do, for whom, its length and tone | from the ask |
| template | the skeleton the run fills, binding on the writer | from the ask, or the brief |
| altitude | strategic (what, why it matters, what it changed; a mechanism only when it is the differentiator, named one level up), operational, or technical | from the template |
| evidence | adds `given`: the reader's document, a brief, a draft | `given, web` |
| election | the slots elected (the parts that make the impression), and the candidates' source: `precedents` (earlier texts of the same kind: wording and framing only, the facts from the evidence) or `generated` (from the brief and the evidence) | the opening, the turning point and the close; `precedents` when the person has earlier texts |
| iterations | polish iterations, at most | 2 |
| rounds | read-and-revise rounds | 1 |

## Phases

| Phase | Who | May | May not | You, after |
|---|---|---|---|---|
| **1 research** | judge; style | judge: the given research first, else `web`, each figure sourced; one table, the reader's ask split into demands and parts, each met · partly · gap with the evidence that backs it; then what the ask is really about, the strongest met demands in the order they serve the text, the misreadings and the framing that prevents each. style: the reader's voice markers, quoted | write the text | the table on the record |
| **2 strategy** | strategist, then every seat | the strategist posts **the brief**, each point with its recommendation and reason: who reads first and for how long, the one thesis sentence every part serves, the motivation and its weight, tone and form each shown on one sentence, **the slots** (what each must do, its length, the elected ones marked), each work by name (expand · condense · one line · out) with its angle, what is left out, each figure with its source; every seat answers from its role; the strategist posts **the settled brief**, each point taken or declined with why, and only then runs `done` | wording beyond a sample; a sample that invents a fact | correct the brief before the seats build on it; the settled brief on the record |
| **3 propose** (blind) | every seat but the readers and style | one candidate per elected slot at most, labelled, within the slot's limit: adapted from a named precedent, or written fresh | read the others' candidates first; a fact the evidence no longer holds | nothing |
| **4 vote** | every seat | per slot, approve as many as fit, one line of why each; the checker first vetoes a candidate whose fact the evidence lacks, naming where; a reader's approval counts double | approve its own | the count: most approvals win; a tie to the readers' choice, then to you, truth first; the winners are raw material fused into one voice, verified again by the checker |
| **5 draft** | writer | a ledger of the points raised, taken or declined, then the whole text from the winners and the brief | — | the text on the record |
| **6 polish** | auditor, checker, style, writer | per iteration: the **audit table**; the checker strikes rows that outrun their source and gives the strongest held wording; style marks what departs from the voice; the writer posts the whole next version, taking each row or saying why not, `unchanged` when nothing is left | rework one paragraph alone | the text, table and strikes on the record; again until every row says `keep` or the iterations are spent; the auditor ends polish |
| **7 read** | every seat but the writer | at most 5 notes on the whole text: the line quoted, the reaction as that seat, the change asked; the auditor's note on a work out of order or a minor one given more room than a core one is blocking; the strategist says whether the brief is kept | rewrite the text | the notes on the record; your rulings in one post, each note taken or declined with why; a gap the evidence cannot fill is declined and kept as the known risk |
| **8 revise** | writer | the whole new text, then per note: taken, or declined with why | patch sentence by sentence | the text on the record; 7 and 8 again while rounds remain |
| **9 final check** | every seat but the writer | at most 3 notes on what still breaks a rule, a source or natural language, or `clean`; readers: the verdict | reopen the strategy | a blocking note back to the writer for one fix; then the final text **locked** in `## The text (final)` |

- **The audit table** covers every sentence of the whole text, paragraph by paragraph: the
  sentence, what it lacks (scope · outcome · verb · aim), its priority (1 to 3, natural language
  and pull first), a stronger version and the source that carries it, or `keep` / `cut`. Below
  it, what only the whole shows: each fact said once, no phrase repeated, tenses consistent,
  each work's room matching its weight, every demand of the judge's table answered, complex sentences made simple, the
  hierarchy and the altitude kept. A sentence narrating a process where a concept or a proof is
  owed is weak; its row proposes the concept.
- **Altitude**: a sentence below it (a component, a tool, a configuration where the reader is
  owed what and why) is blocking from polish on, and is cut or lifted. Readers judge credibility
  at that altitude.
- **Highlights only**: every sentence carries a strength the sources hold; what they do not hold
  is left unsaid. No phase asks for lessons, limits or gaps; a concession found in reading is
  blocking.
- **The style keeper ranks** after the person's preferences and feedback, before a seat's taste.

## Phase messages

The text of `phase <name>`, a template's seat names replacing these:

| phase | text |
|---|---|
| research | `judge: the table as it now stands, then what the ask is really about, the strongest met demands, the misreadings and their framing; ending @swarm, then done research. style: the reader's voice markers, quoted, ending @swarm, then done research. Every other seat: read your dossier sections, then done research.` |
| strategy | `The brief. strategist: the whole brief, with the slots and the elected ones, ending @swarm. Every other seat, once it is posted: answer from your role, ending @strategist, then done strategy. strategist: once all have answered, the settled brief, ending @swarm, and only then done strategy.` |
| propose | `The election, step 1. Settled brief #<seq> (elected: <slots>). Every seat but the readers and style: one post, at most one candidate per elected slot, labelled, <from a named precedent, its facts from the evidence \| written fresh>, ending @swarm, then done propose. Readers and style: done propose now.` |
| vote | `The election, step 2. Candidates: <seat #seq (letter)…>. checker: your vetoes first. Every seat: per slot, approve as many as fit, one line of why each, never your own, also on natural language and pull; ending @orchestrator, then done vote. Readers: as the reader; your approvals count double.` |
| draft | `writer: a ledger first, then the whole text from the settled brief #<seq> and the winners <…> fused into one voice; ending @orchestrator, then done draft. Every other seat: done draft now.` |
| polish | `On the whole text (#<seq>) and the orchestrator's notes, at most <n> rounds. auditor: the audit table, the notes first, ending @checker. checker: strikes and proposals; style: the voice; ending @writer. writer: the whole next version, ending @auditor. auditor ends polish: done polish, then @swarm polish is over; the others then done. Every other seat: done polish now.` |
| read | `Round <n> on the whole text (#<seq>). Every seat but the writer: at most 5 notes from your role, ending @orchestrator; readers: only that text, notes and the verdict. Then done read. writer: done read now.` |
| revise | `writer: the read and the rulings (#<seq>); the whole new text, then per note taken or declined; ending @orchestrator, then done revise. Every other seat: done revise now.` |
| final | `Final check on #<seq>. Every seat but the writer: what still breaks a rule, a source or natural language, at most 3 notes, or clean; readers: the verdict. Then done final. writer: one fix only if a blocking note comes to you; done final now.` |

## Your seat

You hold the person's intent from the interview to the delivered text; you never write the text,
propose a candidate or vote.

- **Listen with `wait` alone**: a brief, a candidate, a draft or a version is steered before the
  next seat builds on it.
- **In the interview, show each preference on one sentence written two ways**, so the person
  chooses on the text; a motivation they cannot phrase gets two or three readings drawn from
  their words and the evidence. Restate their answers in the register the text needs.
- **Gather the precedents**, closest to this text first.
- **Quote, never rewrite**: name the weak phrase (a calque, a dangling verb, an ambiguous
  pronoun, a participle agreeing with nothing, a vague hinge, a lesson given to the reader), say
  why, and post it as priority 1 for the next round, binding on the writer. In the final check's
  one fix you may pass on wordings the seats proposed.
- **Correct the brief before the seats build on it**: a claim the evidence or the feedback
  struck, a sample that invents a fact, a level of detail the person ruled out.
- **Count the election and rule on the read**, each ruling with its reason.
- **Lock the final text before showing or delivering it**: what is shown, recorded or delivered
  is that text, verbatim.
