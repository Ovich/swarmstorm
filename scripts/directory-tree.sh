#!/usr/bin/env bash
# Copies into <out> the strict minimum the plugin runs from: the skills (without the tools'
# source, tests and build files), their bundles, the Claude manifest and its icon, LICENSE, and a
# short README of its own (the full one carries install commands the directory's scan flags).
# The plugin directory's validation times out on the whole repository; it validates this.
# Usage: scripts/directory-tree.sh <out>   (run from the repository root)
set -euo pipefail
out=${1:?usage: directory-tree.sh <out>}
mkdir -p "$out"
git archive HEAD skills .claude-plugin/plugin.json .claude-plugin/icon.png LICENSE | tar -x -C "$out"
cd "$out"
for tool in skills/companions/*/; do
  rm -rf "$tool"{src,app,tests,build.mjs,package-lock.json,vite.config.ts} "$tool"tsconfig*.json
  # aiview finds its own folder by its package.json: kept, with only what names the tool
  node -e 'const f=process.argv[1],p=JSON.parse(require("fs").readFileSync(f,"utf8"));require("fs").writeFileSync(f,JSON.stringify({name:p.name,private:p.private,type:p.type,engines:p.engines},null,2)+"\n")' "${tool}package.json"
done
find skills \( -name '*.test.*' -o -name '*.bench.ts' \) -delete
cat > README.md <<'EOF'
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
- Three skills reach the network when an agent runs their script: dependency-graph (npm, first
  run), pr-review and recurring-review-findings (GitHub, through gh).
- No hooks, no event handlers, no change to your settings.

MIT licensed. Source, tests and build: https://github.com/Ovich/swarmstorm
EOF
