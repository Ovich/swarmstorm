# Security

What swarmstorm runs on your machine, what it sends over the network, what it trusts, and how to
check that the code you installed is the code in this repository.

## What runs

- **The skills** are Markdown instructions. An agent reads them; they do not run themselves. The
  plugin ships no hooks and no event handlers, and it never writes to your harness's settings.
- **Two Node CLIs**, `swarm` (the board) and `aiview` (the document viewer). Each starts from a
  small launcher (`skills/companions/*/swarm.mjs`, `aiview.mjs`) that imports a bundle committed
  to this repository (`dist-cli/`, plus aiview's viewer in `dist/`). Nothing is built or installed
  when you install the plugin.
- **A few skill scripts** (`skills/*/*/scripts/*.mjs`, one `.py`). An agent runs one when the
  skill it is following tells it to.

Every process these spawn is a program given an argument array. None of them builds a shell
command out of input.

| Spawned | By | Why |
| --- | --- | --- |
| `git` | the board, and the scripts of `pr-review`, `write-plan`, `write-conventions`, `long-horizon`, `dependency-graph` | worktrees, diffs, merge checks, `git grep`. The board puts `--end-of-options` before revisions and refuses a ref that starts with `-`. `pr-review` refuses a base branch that starts with `-`. |
| `node` | both CLIs | their own servers (the board server, the aiview server), a member's link, the other CLI's verbs, short waits |
| the browser opener | aiview | `rundll32 url.dll,FileProtocolHandler <url>` on Windows, `open` on macOS, `xdg-open` elsewhere, with the URL as one argument. It opens only for your own data home, never during tests. |
| `powershell` / `ps` | the board's link | reads one process's command line, by a pid that must be a positive integer |
| `npm install` | `dependency-graph`, on its first run | installs `dependency-cruiser` and a matching `typescript` into `~/.cache/swarmstorm-depgraph/`. The TypeScript version it reads from your project must be plain semver. On Windows npm runs as `node npm-cli.js`, not `npm.cmd`. |
| `gh` | `pr-review` (`pr <number>`), `recurring-review-findings` | your GitHub CLI, with its own login. See *Network*. |

Two calls go through a shell, both on Windows only and both with fixed arguments, because npm
there is a `.cmd` shim that only a shell starts:

- If aiview's `dist/` is missing and its source is present (a development checkout, not an
  installed release), aiview runs `npm run build` once.
- The maintainers' `scripts/release-check.mjs` runs `npm ci` and `npm run build` in each
  companion. It is not part of the plugin's runtime; you run it yourself to verify the bundles.

## Network

- **Both servers listen on 127.0.0.1 only.** aiview listens on 4321 for the default data home.
  The board server takes a port the OS chooses. A member's link talks to its CLI over a named pipe
  (Windows) or a socket file in the temp folder.
- **No telemetry, no account, no API key.** Neither CLI contacts any host outside your machine. The viewer's page, in your browser, fetches one library, mermaid, from `cdn.jsdelivr.net` at a pinned version when a document holds a diagram; the request carries no document content.
- **Calls out, each made only when an agent runs that skill's script:**
  - `dependency-graph`, the first time it runs: `npm install` from the npm registry configured on
    your machine.
  - `roadmap`'s `scripts/domains.mjs`, when names are checked for free domains: RDAP queries over
    HTTPS to `data.iana.org` and to the registries it names.
  - `pr-review` and `recurring-review-findings`: GitHub, through `gh`, for the repository you
    named.
- Documents an agent writes (prototypes, workbenches) are served by aiview as written. If one
  links a remote asset, your browser fetches it.

## Credentials

The plugin reads no credentials, keys or tokens of yours. It runs inside the harness session it is
given, with that session's permissions. `gh` and `npm`, when a skill runs them, use their own
configuration.

The board's link reads the harness's own session transcripts (Claude Code's
`~/.claude/projects/`). From them it takes the token count, the open tool calls and the last
50 characters of the agent's text, which is how the board tells whether a member is working.
These stay in the board's store in your data home.

## The local servers

Both servers write what a client needs to reach them into the data home (`~/swarmstorm_appdata`
by default, or `$SWARMSTORM_HOME`).

**aiview** (`skills/companions/aiview/src/server/guard.ts`) checks every request before any route
runs:

1. The `Host` header must be `localhost:<port>` or `127.0.0.1:<port>`, else 421. A DNS-rebound
   name fails here.
2. An `Origin`, when sent, must be the server's own (`http://localhost:<port>`,
   `http://127.0.0.1:<port>`), else 403. `Origin: null` is refused too. This applies to every
   route, including reads and the event stream.
3. Every POST must be `application/json`, else 415. A cross-site form cannot send that without a
   preflight.
4. Every POST must carry the server's token, else 403, compared in constant time. The token is 32
   random bytes written to `aiview.token` (mode 0600). The CLI sends it in `x-aiview-token`. The
   viewer gets it as an `HttpOnly; SameSite=Strict` cookie, set only on the viewer's own page.

A raw HTML document (`/api/raw/<id>`) is served with
`Content-Security-Policy: sandbox allow-scripts allow-forms allow-modals allow-popups`. The page
runs in an opaque origin of its own and cannot call aiview as the viewer.

**The board** (`skills/companions/swarm-board/src/server/`):

- **A random secret.** Each start draws 24 random bytes, written to `swarm-server.json`. A
  connection whose first frame does not carry the secret is refused.
- **Each connection bound to one member.** The first frame names the member it speaks for, which
  must exist in that run. The connection is bound to it. Every call is then checked against that
  binding (`authority.ts`): a member acts only as itself.
- **The orchestrator's exceptions.** The run's orchestrator may end a seat of its own run. Only it
  may close the run or add a seat. On the orchestrators board, any team orchestrator may act.
- **The CLI's own check.** Called from a member's worktree, the CLI refuses an `--as` that names
  a different member.

## Trust model

Every process that runs as your OS user is in one trust domain. The servers defend against:

- other machines (loopback only);
- web pages open in your browser (Host, Origin, JSON and token on aiview; the secret on the
  board);
- an agent's mistake, such as acting under another member's name from its own worktree.

They do not defend against a hostile process running as you. Such a process can read the data home
(the tokens, the secret, the stores) and do anything you can.

One case passes on purpose: an agent that names the orchestrator with `--as` from outside any
worktree is accepted as the orchestrator. Outside a worktree the CLI has nothing to check `--as`
against, so it cannot tell a mistake from a deliberate choice.

## The allow rule

A worker cannot answer a permission prompt. So the README asks you to add, yourself, a rule of
this shape to your settings:

```json
{ "permissions": { "allow": ["Bash(node <plugin dir>/skills/companions/swarm-board/swarm.mjs:*)"] } }
```

It lets the agent run the board CLI, `swarm.mjs`, with any arguments, and nothing else. Those
verbs read and write the board, create and remove the board's worktrees under the repository's git
dir, and start the board server and a member's link. The plugin never writes this rule, or any
other setting.

## Verify the bundles

The bundles are the code that runs. To check they are what this repository's source builds, run
this from a clone at the release's tag:

```sh
node scripts/release-check.mjs --dist
```

It runs `npm ci` and `npm run build` in both companions, so it fetches their locked dependencies
from the npm registry. It then asks git whether the committed `dist/` and `dist-cli/` differ.
Exit 0 means they match.

Every release tag also attests the bundles' build provenance on GitHub. To check one file you
installed:

```sh
gh attestation verify skills/companions/aiview/dist-cli/cli.mjs --repo Ovich/swarmstorm
```

The attested files are `skills/companions/swarm-board/dist-cli/cli.mjs`,
`skills/companions/aiview/dist-cli/cli.mjs`
and everything under `skills/companions/aiview/dist/`.

## Nothing outside this repository

Installing and running swarmstorm needs nothing beyond this repository and Node 22.5 or later. The
only outside sources are the ones the skills above contact when you use them: the npm registry,
RDAP, and GitHub through your own `gh`.

## Reporting a vulnerability

Report it privately through GitHub's private vulnerability reporting: the **Security** tab of
[Ovich/swarmstorm](https://github.com/Ovich/swarmstorm), then **Report a vulnerability**. Please
do not open a public issue for it.
