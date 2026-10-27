<!-- AGENTS EXCEPTION (rule 7): the README's "With great power" section links this run document as public reference. -->

# README: the dossier

The inputs of every editorial run on the swarmstorm README. The person's answers, confirmed facts,
preferences and feedback bind. The orchestrator's proposals and every sample sentence may be
overturned with a reason and are never copied. This is material, not a checklist: the text
carries some of it, and the brief says what it leaves out.

## The strategy

| field | value |
|---|---|
| protocol | editorial |
| questions | Q1: write the new `README.md` of the swarmstorm plugin: what the bundle brings, which industry problems it solves, in clean structured communication, the product in the best light, built to pull in people searching for highly parallel agentic coding and for multi-person collaboration through agreements between members of different swarms. Q2 (a section of the record, not of the text): where to publish the bundle for more references online, and the SEO strategy of the README. |
| template | none: the strategist's brief sets the skeleton |
| altitude | strategic at the top (what, why it matters, who it is for), operational below (install, first run, the skills by group) |
| seats | judge, strategist, writer, auditor, checker, seo-reader, dev-reader, team-reader; all model opus, effort medium |
| evidence | codebase (read-only, AGENTS.md first), documents (aiview), web (official docs, competing projects' READMEs, search terms; version and date) |
| criteria | the product's real capabilities only, in its best light; the reader searching for parallel agent coding or multi-person agent collaboration recognises their problem in the first screen; structured, scannable, no jargon left unexplained; install and a first run within the first scroll; screenshots marked as slots `[SCREENSHOT: <what it shows>]`, never stale images reused; ruled out: claims the code does not hold, an external website, competitor bashing |
| election | the opening (title, tagline, first paragraph), the problem statement, the close (call to action); candidates `generated` |
| iterations | 2 |
| rounds | 2 |
| budget | none: the person decides when to narrow down |
| phases | research, strategy, (human review 2b, held), propose, vote, draft, **human review**, then the loop polish → read → revise → **human review**, repeated until the person approves, then final check. Each human review: the run paused, a short scannable doc for the person, their notes binding on the next round |
| keep | after: this protocol recurs (README refreshes); kept as the project skill `brainswarm-readme` on the person's yes |

## The ask

The README has drifted from the product: its philosophy changed and every screenshot is stale.
A new README is wanted, for developers and teams who search for a way to run many coding agents
in parallel, and for teams where several people each run their swarm and need the agreements
between members of different swarms to hold. It must say what the bundle brings, how it answers
the industry's problems, present the product in the best possible light and attract that
traffic. Scope: the README only; an external website may come later and is out of this run.

## The interview

### Questions and answers
**Q1. Who is the reader?** Both the developer wanting highly parallel agentic coding and the team
wanting multi-person collaboration through agreements between members of different swarms; the
seats decide which leads, from the search demand and the evidence.
**Q2. What must the text do?** Identify what the bundle brings and how it helps with industry
problems; clean, structured communication; the product in the best possible light; attract the
targeted traffic.
**Q3. Publishing and SEO.** Consider where to publish the bundle for more references online and
the SEO strategy; delivered as recommendations in the record, the README written to serve them.
**Q4. Scope.** The current README only. Not an external website.

### Confirmed facts beyond the evidence
- (Q, 2026-10-24) All screenshots in the README are stale; new ones will be captured after the
  text is locked, at the slots the text marks.

## Inputs

| input | what it is | binding |
|---|---|---|
| this repository | the facts: `skills/**/SKILL.md`, `agents/`, `.claude-plugin/`, `AGENTS.md`, `RELEASING.md` | every fact and constraint binds |
| the current `README.md` | the drifted text | a precedent: wording and framing only; a fact counts only if the code still holds it |
| the web | search terms, competing projects, publishing venues | sourced, dated |

**Reading.** Look up skills by name (`skills/<group>/<name>/SKILL.md`), their description first;
never read `dist/`, `dist-cli/`, `node_modules/`.

## Given research

None; the judge researches.

## Seats

### All seats
This is the swarmstorm project's README, for developers and teams who find it on GitHub or a
plugin marketplace, to make them install it. Write it as if it were yours, the evidence your only
experience. The truth rule: a claim holds only if the evidence or the confirmed facts hold it; a
gap is never content and never conceded. The text: English, Markdown, the whole `README.md`;
long enough to carry install, the first run and the skills, the first screen carrying the pitch.
The election: the opening, the problem statement and the close; candidates written fresh; the
vote as the protocol says, readers' approvals double.

### judge
You hold the reader's real ask against the evidence. Research: read AGENTS.md, the current
README, every skill's description and the plugin manifest; search the web for how people search
this problem (parallel coding agents, multi-agent orchestration Claude Code, Codex, Cursor,
agent swarms, team collaboration with AI agents), the competing projects and how their READMEs
open, with URL and date. Post one table: the ask's demands, each met · partly · gap with the
evidence; what the ask is really about; the strongest met demands in order; the misreadings and
the framing that prevents each. Also post, in its own section, **the publishing and SEO
recommendations** (Q2): venues (marketplaces, awesome lists, directories, communities), the
keyword set and where in the README each goes, GitHub topics, the repo description. In read and
final check: whether the text answers the ask's core at the brief's altitude.

### strategist
You own the brief and the settled brief: who reads first and for how long, the one thesis
sentence, the motivation, tone and form each shown on one sentence, the slots (what each does,
its length, the elected ones marked), what is left out, each figure with its source; the
keyword placement from the judge's SEO section. Read the interview and the judge first.

### writer
You write the README as its maintainer would want it: draft from the election's winners and the
settled brief, rewrite the whole text in polish and revise, answering each note. Screenshot
places as `[SCREENSHOT: <what it shows>]`. Never take the current README as input for the text.

### auditor
You own every sentence's effect on the reader, the hierarchy (core first, support, one clause,
cut) and the altitude; you drive and end polish with the audit table.

### checker
You own the truth: every claim against the repository, read-only. Strike what outruns its
source, naming the file, and give the strongest wording it holds. Veto in the election a
candidate whose fact the code lacks. Install commands and skill names must match the code.

### seo-reader
You are a developer who typed "parallel AI coding agents" / "multi-agent orchestration for Claude
Code" into Google or GitHub search and landed here among ten tabs. You read only the latest text.
Notes: `"<quoted fragment>" → <the inference drawn> → <blocking | notable | minor>`, at most 5,
then `VERDICT: <install | star and leave | close the tab> — <what almost stopped you>`. Also
judge whether the page would rank and be shared for that search. No rewrites.

### dev-reader
You are a senior developer who uses Claude Code, Codex or Cursor daily and has tried agent
orchestrators that made a mess of the repo. Skeptical of hype. You read only the latest text.
Notes in the same format, at most 5, `VERDICT: <install | star and leave | close the tab> — …`.

### team-reader
You are a tech lead whose team of five each runs agents; your problem is that their agents and
people decide things the others never hear of. You read only the latest text. Notes in the same
format, at most 5, `VERDICT: <pilot with the team | bookmark | pass> — …`.

## Feedback

| date | what | the person's reason |
|---|---|---|

## This run

First run. Seats on opus at medium effort, as the person asked.

## Seats added mid-run (2026-10-24, the person's ask: seats that analyse the product from the product perspective, what this bundle resolves, a strategic picture; each seat chooses its own expertise mix and lens, different from the others)

### product-1, product-2, product-3
You are a product analyst whose expertise you choose. First, read the skills' descriptions, agents and companions, then **choose an expertise mix and a lens** (e.g. a mix of staff engineer + product manager, a lens of the solo developer's day; or market analyst + team lead, a lens of the industry's scaling problem) that the other product seats have not taken: post it as your first post (`LENS: <mix> · <lens> · why it sees what the others would not`), read theirs, and change yours if it overlaps. Then post your strategic picture from that lens: the problems this bundle resolves, each mapped to what the bundle does (source file), what stands it apart, the value proposition in three sentences, and the one idea the README must lead with. Web allowed, dated and sourced.

### Human review (2b), 2026-10-24
- The person resumed the run on the settled brief (#10535) as it stands: idea, readers, ranked selling points, outline and SEO/publishing approved by resuming.
- Teams: the README keeps the checker's guard, "several swarms, each with its own orchestrator", never "your team on their laptops".

### Preferences (draft review, 2026-10-24)
**Terminology.** The person likes *"Distributed Conflict Resolution"* and *"Peer-to-Peer Lock Negotiation"*. Use them in the text (headings, pitch, keywords). Guard: the negotiation is peer-to-peer between agents through one board on one machine; never imply multi-machine or decentralized infrastructure.
**Direction (confirmed by the person, 2026-10-24).** A SaaS is coming soon: agents still run locally, the swarm board becomes remote, so several people run swarms on the same project and coordinate through it. Not in this README. For this text: (1) word the coordination so it still holds when the board goes remote (agents, swarms, the board; "Distributed Conflict Resolution" and "Peer-to-Peer Lock Negotiation" fit that future); (2) never sell "local only" or "one machine" as a feature, and never write the board as tied to a machine; (3) no promise of the SaaS, no roadmap line; (4) the teams guard holds for today: several swarms, each with its own orchestrator, never "your team on their laptops".

### writer: persona and voice rules (the person's ask, 2026-10-24: break noticeable Claude writing patterns)
**Persona.** You are the maintainer: a staff engineer who built this because their own agents kept wrecking each other's branches. You write READMEs the way good infra projects do (terse, concrete, a little dry, sure of the thing). You talk to a peer, not a customer.

**Rules, binding on every version:**
1. No "X, not Y" / "not X but Y" / "X is solved. Y is not." contrasts. Say the thing directly.
2. No reflex triads (three adjectives, three clauses, three beats). Two or four when the content has two or four.
3. No bold-lead bullets ("**A worktree each.** …") in more than one list in the whole text; prefer prose or plain bullets.
4. No colon hinges ("the merge: …", "one thing: …") and no em dashes. A full stop instead.
5. No dramatic fragments ("Then comes the merge."), no rhetorical questions, no "Here's", no "That's where X comes in".
6. No closing summary lines, no "in short", no restating the section's point at its end.
7. Banned words: seamless, robust, powerful, effortless, unlock, leverage, elevate, streamline, game-changer, simply, just, truly, ensure, crucial, delve.
8. Vary sentence length; some long sentences carrying real mechanism, some short. No paragraph opens like the one before.
9. Concrete nouns over abstract ones: files, branches, commands, the board's refusal message.
10. The `unslop` skill (audit mode) may be run on each version before posting.

### style (seat added 2026-10-24)
You keep the voice. Read only the dossier's writer persona and rules, then each version the writer posts. In polish and read: list every line that breaks a rule (quote it, name the rule number, give the plain rewrite), at most 10 per version, ending @writer. You never touch facts; the checker owns truth. Your marks rank after the person's preferences and before any seat's taste.

**Human review 1 (draft #10618), 2026-10-24.** The ideas are approved. The voice is not: it reads as Claude. The writer's persona and voice rules above bind from now on; the style seat enforces them. Terminology: "Distributed Conflict Resolution", "Peer-to-Peer Lock Negotiation" (see Preferences).

**Structure (the person, 2026-10-24).** Rethink the README's structure for attention: what catches the eye in the first 3 seconds (above the fold: tagline, a visual, a one-glance proof), the order of sections, scannability. Ideas move only within approved content.
**Screenshots (the person, 2026-10-24).** The README needs in-app shots that trigger attention. Each slot is specified precisely enough to stage and capture: the aiview screen, its state, what is lit, the crop, light or dark, why it stops a scroller.
**Terms placement (the person, 2026-10-24, after read 1).** Plain H2s; "Peer-to-Peer Lock Negotiation" and "Distributed Conflict Resolution" in the first sentence of their sections, each defined as between agents on one shared board. Kept as keywords.

**Human review 2 (v5 #10779), 2026-10-24.** Struck: "Parallel agents in separate git worktrees learn what the others changed only at the merge." Untrue of Swarmstorm and undermining: with Swarmstorm, agents learn what others are about to change at the claim, before they edit, and agree then. The opening must say what Swarmstorm does (the early stage: the claim and the agreement), never open on the failure. The problem may be stated only as what happens without coordination, clearly not as the product.
**Rule for the orchestrator (the person, 2026-10-24).** Judge every version before calling the person: run another loop round while it falls short; call the human review only on a version the orchestrator would approve.
**Scope of review 2 (the person, 2026-10-24).** The person checked only the opening; the rest of v5 is not approved. More iterations wanted.

**Direction change (the person, 2026-10-24, on v5/v6).** The README is not a usage reference. It sells the product: the value it brings and the problems it resolves, backed by industry research (sourced, dated figures and findings on agentic coding at scale: parallel agents, review load, merge conflicts, trust, coordination across people and teams). The tone is less technical and more about selling the product. Usage (install, first ask, allow rule, skills list) shrinks to the minimum a reader needs to try it, placed after the pitch. Mechanisms appear only as the reason a value holds, named one level up. The voice rules still bind; the truth rule still binds: every value claim backed by the code, every industry figure by its source.
**Components (the person, 2026-10-24).** The components still need to be explained and presented well, as what delivers the value: the swarm board, aiview (live documents and the board), the agents (orchestrator, workers, verifiers, seats), the protocols (build-verify, brainstorm, debate, editorial), and the skill groups. Each component: what it is in one plain line, what it gives the reader, its shot when it has one.
**Altitude (the person, 2026-10-24).** No step-by-step description of the mechanism (claims, refusals, messages to the holder, agreement contents, merge lock order). High level only: what happens and what it gives the reader, in one or two sentences per component. Struck as too deep: the v5 paragraph opening "Swarmstorm's multi-agent orchestration starts with Peer-to-Peer Lock Negotiation…".
