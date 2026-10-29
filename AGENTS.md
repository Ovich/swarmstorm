# AGENTS.md

Conventions of the swarmstorm repository: the decisions a fresh agent would otherwise
guess differently. A rule may be deviated from at a specific site with a comment
beginning `AGENTS EXCEPTION (rule N):` and the reason; without one, deviation is a
review finding. When a decision made during a session would pass the five filters of
the `write-conventions` skill (contested, recurring, consequential, checkable, not
tool-enforceable), say so in chat before the session ends and propose the rule, in
that skill's shape; it is written here only on the person's yes.

## Architecture (context you must not break)

Every skill is one folder under `skills/`, opening on a `SKILL.md`; supporting files
sit beside it, situational ones under `references/`. `project/` holds what a project
has once and keeps, `verify/` its verification skill and the validation with the person, `workbench/` the pages worked on
with the person during development and the project skills that feed them; the loop's phases group the rest,
`architecture/`, `ui/`, `plan/`, `execute/`, `review/`; `help/` guides the person (how the collection works, in context; the next step at the moment it fits); `alignment/` brings the person and the agent to one understanding (interview, brainstorm, brainswarm, whiteboard-defense); `orchestrate/` and `swarm/` sit at the root;
`companions/` holds the two tools, shipped as versioned bundles so an install never builds:
aiview (`skills/companions/aiview/`), a CLI, the document server and the one UI, drawing the
documents and the board; and swarm (`skills/companions/swarm-board/`, the board every plan
runs on), a CLI, a board server and one link per member, with no page of its own. The board
server alone opens swarm's store; each member's link carries its calls over one WebSocket to
it. aiview reads the board only through `skills/companions/swarm-board/src/client/reader.ts`, a
client of that server, bundled into aiview's `dist-cli/`; never `board.ts` or SQL, and swarm
never imports aiview. The plugin sees a group only through the `skills`
list in `.claude-plugin/plugin.json`: the default scan reads one level under `skills/`,
so a group left off the list ships none of its skills, and `claude plugin validate`
passes all the same. What runs for a user is the plugin cache, not this checkout; a
change reaches anyone only through a release (`RELEASING.md`). Documents the skills
produce live in the data home, never here.

**This checkout is the only place this repository is edited.** The plugin cache under
`<claude home>/plugins/marketplaces/swarmstorm` is a clone of the same remote, with the
same branches and the same push rights, which is exactly the trap: work committed there
is real, is pushed, and leaves this checkout silently behind. It happened on 2026-09-10
— three releases were made in the cache, and this checkout then lacked a skill whose
file the person was looking for. Refresh the cache with
`claude plugin marketplace update swarmstorm`; never write to it.

## Skills

1. **MUST reference another skill by its name alone, the `<name>` skill.** The harness resolves a skill by name wherever it is installed; a path, relative or absolute, breaks on the next layout and is paid for at every load. A file inside another skill is named as that skill's `references/<topic>.md` or `scripts/<name>`.

2. **MUST keep in `SKILL.md` only what every use of the skill needs, and put what one situation needs in `references/<topic>.md`, named in `SKILL.md` at the point where the situation arises, with the condition to read it stated there.** Everything in `SKILL.md` is paid for at every load, and a condition written inside a reference is read only by an agent that has already opened it. `skills/companions/aiview/references/`, `skills/execute/execute-plan/references/`, `skills/ui/design-prototype/references/`.

3. **MUST write a description as the trigger and nothing else: what activates the skill, what it produces, what it excludes.** Method, mechanics and instructions to a loaded agent belong in the body, and the body carries no "when to use" section of its own. The router reads only the description; the agent reads the body only after.

4. **MUST give a protocol one owner and have every other skill point at it, never restate it.** Two copies drift, and the reader has to work out which lies. The tracker is `skills/execute/execute-plan/references/tracker.md`; diagram discipline is `skills/architecture/write-diagrams/`; the interview is `skills/alignment/interview/`; the index contract is `skills/companions/aiview/`; the board protocol is `skills/companions/swarm-board/`; the run protocols (build-verify, idea-to-outcome, brainstorm, debate, editorial), the run's proposal built on the closest protocol, with its loop, the handoff to an orchestrator (Claude Code, Codex, Cursor), the charter, dispatch, briefs, roles, watching and the findings table are `skills/orchestrate/`; offering the next skill to a person at the moment it fits is `skills/help/next-step/`; explaining the collection to the person, in context, its setup and its tour, is `skills/help/help/`.

8. **MUST write a skill, its examples included, only in terms every project has, never a file, module or name from the project the change came from.** A skill loads in every project; a foreign name reads as a fact about the current codebase, and the agent looks for it. Abstract the case to the rule it taught, and the counterweight it needed.

9. **MUST put a protocol used by more than one kind of work in a skill named for no kind, never in the first kind that needed it.** A plan-named owner reads as plan-only, and the next kind copies it instead.

10. **MUST let a CLI verb's answer carry the next step it asks for, and have the skill say only to read that answer and why.** A step written in both drifts, and the agent follows whichever it read last. The swarm-board skill's `references/worker.md` names the verbs and their exits; the commands to run next are in their output.

11. **MUST NOT ship a harness hook (`hooks/hooks.json`, a `hooks` key in the plugin manifest, any PreToolUse, PostToolUse, Stop or other event hook), nor write to the person's harness settings (`settings.json`, `settings.local.json`, user or project).** A plugin hook runs in every session on the machine, in every project, whether or not a skill of this collection is in use, and a settings change outlives the session that made it. What a skill needs from the agent goes through the skill, its CLI's answers and the agent's own tools. A swarm member hears the board through its own listener or its own wait, and the orchestrator may always message a member directly; no skill forbids that.

12. **MUST name one concept with one word across the skills, the CLI and its answers: a `seat` is a place in a run (a worker, a verifier, a brainswarm role are seats), a `member` is the agent holding a seat, a `slice` is only a plan's cut of work, which a seat carries out; never `runner`.** Two words for one thing read as two things, and an agent looks for the second. A seat's role may be absent; the seats file always exists, empty for a run with none declared.

## aiview

5. **MUST bundle a new runtime dependency into `dist-cli/` through `skills/companions/aiview/build.mjs`, never require `node_modules` at runtime.** An installed plugin has no `node_modules`; a bare import fails only for users. `parse5` and `mermaid` are bundled this way, the checker as its own bundle.

6. **MUST bump `version` to the same value in `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`, rebuild, and commit `dist/` and `dist-cli/` before pushing `main`.** Without the bump no existing user receives the change, and without the build they receive the old viewer. The sequence is `RELEASING.md`.

## swarm-board

13. **MUST write a command or next-step line a member reads in the answer module (`skills/companions/swarm-board/src/cli/answer/`: wording in `wording.ts`, the choice in `rules.ts`), never in a verb or a board event.** Each verb writing its own lines is what repeated the phase three times and set verbs contradicting each other; fixed per verb, the fixes looped. The sites predating the rule are counted by `tests/answer-ratchet.test.ts`, whose baseline only falls.

## Documents

7. **MUST NOT commit a board, spec, plan, prototype or report to this repository.** They are working material and go to the data home through `aiview path`; a document in the tree gets reviewed, goes stale and outlives its use. The README and `RELEASING.md` are deliverables and belong here.
