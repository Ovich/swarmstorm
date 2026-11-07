# The two documents

**The report makes claims; the analysis holds the evidence.**

## The stamp

**A section written from a subagent's return carries a one-line attribution under its heading**, naming the layer and what you did to its output before believing it:

> *From L4 Integration. Merged, deduplicated, and every citation re-read before inclusion.*

- **Attribution is provenance, never endorsement.**
- **Sections you wrote yourself carry no stamp**; absence means exactly that.

## Diagrams

**The `write-diagrams` skill**: pick from its catalog by the reviewer's question, follow its discipline. **Draw the delta, never the whole system.**

- **Change map** (almost always): the components the PR touches and their edges, new edges and nodes marked, removed ones dashed.
- **Behavior change**: a sequence diagram of the *new* ordering (a flow, a handshake, a retry), failure branches included; before/after as two small diagrams only when the contrast is the point.
- **Schema change**: ER diagram of the touched entities, changed relations marked.
- **Lifecycle change**: state machine when the PR adds or removes legal states.

**The change map is the report's. Every other diagram supports a specific finding and belongs in the analysis**, next to what it explains. One diagram per question a reviewer would ask: a big PR usually earns 2–3 across both documents, a small one the change map alone, a trivial one none, and then say so.

## The report

**It fits on one screen**; if it does not, the cure is a sharper Abstract, not a smaller font. Sections, in reading order:

1. **Abstract**: two to four sentences a non-reader of the diff understands: the feature or fix in product terms, roughly how it is achieved, and the one thing the reviewer should look at. Your own synthesis, not the author's claims. No file names.
2. **What changed**: short prose and the change map. **Essence, not inventory**; the file list is in the analysis. Name the incidental churn in one sentence, so the reviewer stops looking for meaning in it.
3. **What you have to decide**: one line per open decision, the question and what the diff currently chooses. The trade-offs live in the analysis. **Never the section you cut.**
4. **Verdict**: **one line per layer**, `L<n> <name>: <worst issue | clean | not run, reason>`, then the open-decision count, and what this review did **not** cover. Correctness gets its line whether or not anything ran it.
5. **Proposed comment**: the whole review condensed into a PR comment the reviewer can post as-is *if they agree*, in a fenced markdown block. The recommendation on the first line (**Approve** / **Approve with comments** / **Request changes**), then at most ~150 words: what the change does (one sentence), the must-address items, the open questions, genuine appreciation where earned. Written in the PR's own language; every claim traceable to a section above; questions phrased as questions; **it says which layers ran**.
   Recommendation: a blocking finding on any layer **or in any linked report** → Request changes; nothing blocking but open decisions or non-blocking findings → Approve with comments; clean on every layer that ran, with no open decisions → Approve.

## Voice

**Fred Brooks's register:**

- **Separate essence from accident**: the difficulty inherent in what the change does, versus what tools and habits pile on top. A re-encoded fixture, a formatter sweep, a rename: accident. Say which is which.
- **Ask whether the change preserves conceptual integrity**: does it fit the model the system already has, or add a second way of doing something? A claim of parity with an existing pattern is checkable, and worth checking.
- **One idea per sentence, and short sentences.** Then elaborate if it earns it.
- **Name the risk so it can be argued about.**
- **Be candid, including about yourself**: what you did not check, what you could not verify, where you were wrong earlier.
- **No adjectives doing an argument's work.** "Risky" is not a finding; the failure scenario is.

## The analysis

**Everything that earns a claim in the report, and nothing aimed at persuading anyone.** Sections, in reading order:

1. **Provenance**: refs compared, merge-base, commit count, file count, evidence base, and anything the environment could not reach.
2. **Intent**: what the PR claims, from its description, linked issue and commit messages, and when a plan was named, one line per user story: met, partial or not met, with the evidence. Quote, never paraphrase. No stated intent → "no stated intent", never one inferred and presented as theirs.
3. **What actually changed**: prose per area, not per file, sized to the change; a files-touched table when it adds orientation. **And the triage record**: which layers ran, which did not, and why.
4. **Diagrams** that support a specific finding (§ Diagrams).
5. **Layer returns**: one section per dispatched layer, stamped, holding that layer's verified evidence; a skipped layer's slot holds the one-line skip and its reason.
6. **Decision points**: each stated as the trade-off, what the diff currently chooses, and the alternative. Scope creep beyond the stated intent lands here, as do irreversible choices (schema migrations, API contract changes, dropped compatibility). **Each one traces to the diff or to a repo doc.**
7. **Findings**, merged across layers, each tagged with its source layer, in three groups: *introduced by this PR*, *pre-existing* (noted, never counted against the change), and *checked and clear*, the claims raised that did not survive verification, with the reason.
