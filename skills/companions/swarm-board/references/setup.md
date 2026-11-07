# Setup

**The board needs nothing installed beyond the plugin and Node**: a session with no run open
pays nothing. A run starts two kinds of process, both `node <skill-dir>/swarm.mjs`:

- **the board's server**, `serve`, one per data home, started detached by the first verb that
  finds none (or finds another version running); its errors land in `swarm-server.log` in the
  data home;
- **one link per member**, run from `join`'s (or `open`'s) line as the agent's background task; a
  verb that finds no link spawns one detached.

## When a check fails

| Symptom | Cause | Fix |
|---|---|---|
| A verb fails before it runs, on `node:sqlite` or the version | Node older than 22.5 | `node --version`; install 22.5 or later |
| A member's call to the tool waits on a permission prompt, or auto mode blocks it | the session prompts for shell calls; a subagent cannot answer a prompt | the allow rule below, added by the person |

## The allow rule

One rule the person adds to their own `settings.json`, project or user, for sessions that prompt
or run in auto mode. **Show it to the person and let them add it; never write it yourself**
(a settings change outlives the session and reaches every project):

```json
{ "permissions": { "allow": ["Bash(node <skill-dir>/swarm.mjs:*)"] } }
```

It covers every verb, the link and the listener included. `<skill-dir>` holds the plugin's version, so the rule is rewritten after each plugin update.

## Harnesses that notify on a background task's end

The listener (`$S wait --mentions` in the background) needs a harness that tells the agent when
its background task ends. Read 2026-10-08:

| Harness | Background task's end | Source |
|---|---|---|
| Claude Code | built in: the Bash tool's `run_in_background`; the agent is told when it ends while it is still working; a subagent that has ended its turn was not resumed in a real run, so a member waits in the foreground. Unattended sessions (`-p`, the Agent SDK, CI, cloud) stop a background command after 30 minutes, or the `timeout` passed, up to 2 hours: give the wait a `--timeout` under it. A foreground subagent's background command ends with its run | [tools reference, Background commands](https://code.claude.com/docs/en/tools-reference#background-commands); [interactive mode, Background Bash commands](https://code.claude.com/docs/en/interactive-mode#background-bash-commands) |
| Kimi | built in: `Shell(run_in_background=true)`; completion is delivered to the model as a `<notification>` message at its next step. Waking an idle session is not documented | [MoonshotAI/kimi-cli #1477](https://github.com/MoonshotAI/kimi-cli/pull/1477) |
| Pi | with an extension, such as `pi-background-bash`, which injects a follow-up result and wakes the agent when a job ends | [pi-background-bash](https://pi.dev/packages/pi-background-bash); [pi-bg-run](https://pi.dev/packages/pi-bg-run) |
| Codex | not documented: its notify hook fires on a turn's end and on approvals, not on a background process's exit | [Codex notification pipeline](https://codex.danielvaughan.com/2026/04/13/codex-cli-notification-pipeline-osc9-hooks-alerts/) |

**No notification**: a foreground `$S wait --mentions --timeout <ms>` between steps, and
when idle, the timeout under the shell call's own.
