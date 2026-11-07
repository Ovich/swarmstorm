# A tool an agent operates

The verify skill's helper scripts run many times in every session. A second lost or a page of output to read is paid at every step.

- **An existing driver before a script.** A browser MCP, the project's own client or CLI: the agent acts on a live state in small steps, and nothing is written per attempt.
- **A script only for what repeats identically**: a start, a state restored, a feed. One command each, named for what it does, its arguments in its head.
- **Fast**: started once and reused, no wrapper in the hot path (a loader flag, not a package-manager runner), every wait on a signal with a bound, never on time.
- **Short answers**: one line per result, JSON where fields are read, nothing else on stdout.
- **Fail with the way out**: the cause and the fix in one line, never a stack trace alone.
- **Owned by the agent that runs it**: a step slow or awkward to drive is fixed in place, in the same session.
