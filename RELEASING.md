# Releasing Swarmstorm

Swarmstorm reaches its users as a Claude Code plugin, installed from this repository
acting as its own marketplace. Codex installs it from the same marketplace file,
`.claude-plugin/marketplace.json`, and reads its own manifest, `.codex-plugin/plugin.json`;
Cursor installs it as a clone and reads `.cursor-plugin/plugin.json`. Two properties of
that channel decide whether a change you push actually arrives, and both are easy to get
wrong silently.

## The version is the delivery

Claude Code caches an installed plugin by its *resolved version*, under
`~/.claude/plugins/cache/swarmstorm/swarmstorm/<version>/`. On update it compares the
version the marketplace declares against the one the user already has, and **skips the
plugin when they match** — no diff is consulted, no commit SHA is compared.

`version` is declared twice, and `.claude-plugin/plugin.json` silently wins over
`.claude-plugin/marketplace.json`. A bump in the marketplace entry alone changes
nothing.

So: **push without bumping `version` and no existing user receives the change.** They
will run `/plugin marketplace update`, watch it succeed, and keep running the old code.
Everyone who installs fresh gets the new code, which makes the failure invisible from
the maintainer's side — the bug reports come only from people who installed early.

Codex caches the same way, under `~/.codex/plugins/cache/swarmstorm/swarmstorm/<version>/`,
from the version in `.codex-plugin/plugin.json`. Cursor runs the clone as it is; its
manifest carries the version for its marketplace.

Bump `version` in all four manifests, to the same value, on every release. Not on every
commit — on every release.

The three `plugin.json` files list the same skills, each in its harness's terms. Claude
Code and Cursor scan one level under each listed folder, so a new skill group goes into
`.claude-plugin/plugin.json` and `.cursor-plugin/plugin.json` both; Cursor also lists the
two skills at the root, `skills/orchestrate/` and `skills/swarm/`, since a listed
`skills` replaces its default scan. Codex walks `./skills/` to any depth and needs no
change.

**Which number moves.** The last one, on every release, whatever the release holds. The
major and the minor move only on the person's word.

## The build output is versioned on purpose

`skills/companions/aiview/dist/` (the UI, ~5 MB, the collection's one page, documents and
the swarm board) and `skills/companions/aiview/dist-cli/cli.mjs` (the CLI and the one server,
swarm's BoardReader bundled in, by esbuild with no runtime dependencies) are committed.

They have to be. An update installs into a *new, empty* cache directory; nothing carries
over from the previous version. Anything not in git is therefore rebuilt by every user
on every release — a 347 MB `npm install` and a Vite build, needing network and a
toolchain, to produce 5 MB of static files you already built here. Committed, the whole
runtime requirement is Node ≥ 22.5.

The consequence: **a release that changes aiview's source but not its build output ships
the old viewer.** Run the build before tagging, every time, and commit what it produces.

## The sequence

```bash
cd skills/companions/aiview && npm install && npm run build && npm test && npm run test:app && cd ../../..   # the one page and server: dist/ + dist-cli/
cd skills/companions/swarm-board && npm install && npm run build && npm test && cd ../../..   # the board's CLI: dist-cli/ only
node --test skills/plan/write-plan/scripts/decisions.test.mjs     # the decision ids check
node --test skills/review/pr-review/scripts/scope.test.mjs            # the review scope script
node --test skills/project/write-conventions/scripts/rules.test.mjs # the conventions rules script
node --test "skills/workbench/create-workbench/scripts/*.test.mjs" # the workbench page, writer and loader
# bump "version" to the SAME value in all four:
#   .claude-plugin/plugin.json
#   .claude-plugin/marketplace.json
#   .codex-plugin/plugin.json
#   .cursor-plugin/plugin.json
claude plugin validate .                        # manifests, skills, commands
git add -A && git commit -m "release: v<version>"
git push                                        # the tag is created for you
```

The tag is not yours to make. `.github/workflows/tag-release.yml` watches the four
manifests on `main`; when the version they agree on has no `swarmstorm--v<version>` tag,
it creates and pushes one. A push that touches those files without changing the version
is a no-op, so editing a description or a keyword costs nothing. The workflow fails loudly
on the one case that would otherwise ship silently wrong — the manifests disagreeing,
where `plugin.json` wins at install time while the catalogue advertises the other number.

`claude plugin tag --push -m "swarmstorm %s"` does the same thing locally and remains the
fallback when Actions is unavailable. Neither it nor the workflow can tell that you failed
to bump the version at all; that part stays yours.

Verify against a real install rather than trusting the push:

```bash
claude plugin marketplace update swarmstorm
claude plugin update swarmstorm@swarmstorm        # says "up to date" if you forgot the bump
```

## What users run

```
/plugin marketplace update swarmstorm
/plugin update swarmstorm@swarmstorm
```

then **restart Claude Code** — an update applies only to sessions started afterwards.
Users with background marketplace refresh still need the second command and the restart.

In Codex, `codex plugin marketplace upgrade swarmstorm`, then a new session. In Cursor,
`git -C ~/.cursor/plugins/local/swarmstorm pull`, then **Developer: Reload Window**.

## Notes

- swarm builds its CLI only: `skills/companions/swarm-board/dist-cli/cli.mjs` is committed; it has no
  page and no server. The board's page is aiview's, so a release that changes swarm's board
  reader or the board's page rebuilds aiview too, or ships the old board.
- `aiview mermaid-check` is its own bundle, `dist-cli/mermaid-check.mjs`, about 3.5 MB,
  built by `npm run build` with the CLI. It is versioned like the CLI bundle, for the
  same reason.
- The data home (`$SWARMSTORM_HOME`, or `swarmstorm_appdata` in the OS home) is never
  touched by an update. Documents and the index survive every release.
- Dropping `version` from every manifest is the alternative delivery model: git sources
  then resolve to the commit SHA and every push becomes an update. It removes the bump
  from this procedure and removes release points along with it.
