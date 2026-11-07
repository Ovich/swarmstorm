#!/usr/bin/env bash
# Copies into <out> the strict minimum the plugin runs from: the skills (without the
# tools' source, tests and build files), their bundles, the Claude manifest and its icon, README, LICENSE.
# The plugin directory's validation times out on the whole repository; it validates this.
# Usage: scripts/directory-tree.sh <out>   (run from the repository root)
set -euo pipefail
out=${1:?usage: directory-tree.sh <out>}
mkdir -p "$out"
git archive HEAD skills .claude-plugin/plugin.json .claude-plugin/icon.png README.md LICENSE | tar -x -C "$out"
cd "$out"
for tool in skills/companions/*/; do
  rm -rf "$tool"{src,app,tests,build.mjs,package-lock.json,vite.config.ts} "$tool"tsconfig*.json
done
find skills \( -name '*.test.*' -o -name '*.bench.ts' \) -delete
