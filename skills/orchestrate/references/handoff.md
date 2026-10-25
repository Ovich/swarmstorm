# Handing a run to an orchestrator

**The session the person talks to settles the run, then hands it to an orchestrator of its
own**, so it can hold several runs at once and stay light. It keeps the conversation with the
person, the charters, and what each run escalates; the orchestrator holds the run: opening it,
the tasks, the dispatch, the watching, the judged findings, the loop.

**The handoff carries no conversation the harness cannot carry.** What the orchestrator works
from is written: the charter (in the kind's document, or the run's brief document when the kind
has none), the plan when there is one, and the board. A fork's inherited context is a bonus where
the harness has one, never the source of truth.

## The brief

```markdown
You orchestrate run `<topic>` for the person, with the `orchestrate` skill<, the `<kind>` skill> and the `swarm-board` skill's orchestrator side. The charter is settled: `<document, aiview id>`, section `<charter>`; follow it, never amend it.

**Repository**: `<path>`, branch `<branch>`. **Open the run** as the kind's skill says, then dispatch its members.

**Escalate to me, never to the person**, one message each: a charter field that should change, a cap reached without the goal, a decision only the person can take, the run's close with its summary. I answer with the person's words.

Never end your turn while the run is open.
```

## By harness

| Harness | Hand off as | Its members |
|---|---|---|
| **Claude Code** | the plugin's `orchestrator` agent (`subagent_type: "swarmstorm:orchestrator"`), fresh, from the brief; or `subagent_type: "fork"` when the conversation holds what the charter does not say well (it inherits it). Background, either way. **A fork may be refused the `Agent` tool**: its first dispatch tells; then it prepares the briefs and this session dispatches, as the last row says. | the orchestrator dispatches them itself (`Agent`, nested): `swarm-worker`, `verifier`, `brainswarm-seat` |
| **Codex** | a spawned agent (`spawn_agent`, or asked in words: "spawn an orchestrator agent with this brief"), fresh context, the brief above; **`agents.max_depth` must be 2 or more** in the Codex config (`[agents]`), else it cannot spawn its members. Run it without waiting on it. | spawned by the orchestrator, each brief naming its skill side (the `swarm-board` skill's worker side, the `verifier` rules of the kind's skill), since Codex reads no plugin agent definitions |
| **Cursor** | a subagent in the background (`is_background: true`, or asked to run in the background), clean context, the brief above; it needs the Task tool to launch its members (hooks or tool policies may block it). Cursor allows one level: the orchestrator launches the members, a member launches none. | the plugin's agents (`swarm-worker`, `verifier`, `brainswarm-seat`), which the Cursor plugin installs, launched by the orchestrator, each brief naming its skill side |
| **Nesting refused** (Codex at `max_depth` 1, a Cursor policy blocking the Task tool, a harness whose subagents cannot spawn) | the orchestrator still holds the run, but asks this session for each dispatch on the board (`@main dispatch w1–w3: <briefs' document>`); this session dispatches them and answers with the ids | dispatched here, on the orchestrator's briefs |

**Before the first handoff in a Codex session, check `max_depth`** (`~/.codex/config.toml` or the
project's `.codex/config.toml`): below 2, say so to the person and offer to raise it, or run with
this session dispatching.

## While it runs

- **One line per escalation to the person**, naming the run, its question and your
  recommendation; their answer goes back to that orchestrator verbatim.
- **The person may talk to a run directly** on its board, or ask you; either way the run's
  orchestrator is the one that acts.
- **An orchestrator that ends** (context spent, an error) is replaced by a fresh one from the same
  brief: the board and the documents hold where the run stands.
- **Small runs stay here**: a run of one or two members, or one the person wants to steer
  closely, is orchestrated in this session, without a handoff.
