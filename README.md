# Swarmstorm

Multi-agent orchestration for Claude Code: parallel coding agents that settle shared files before
the merge, QA agents that test the running app, clickable prototypes, workbenches and live plans,
on your own subscription. The full guide is at https://github.com/Ovich/swarmstorm.

## What it runs, and what it sends

- Two local tools, bundled: aiview (the documents and the board, in your browser) and the swarm
  board. Their servers listen on 127.0.0.1 only. No telemetry, no account, no API key.
- The board reads your agents' session transcripts under ~/.claude/projects to show their state;
  nothing read there leaves your machine.
- aiview's page loads two libraries from cdn.jsdelivr.net, at pinned versions, when a document
  needs them: mermaid for diagrams, shiki for code.
- Four skills reach the network when an agent runs their script: dependency-graph (npm, first
  run), roadmap (domain lookups), pr-review and recurring-review-findings (GitHub, through gh).
- No hooks, no event handlers, no change to your settings.

MIT licensed. Source, tests and build: https://github.com/Ovich/swarmstorm
