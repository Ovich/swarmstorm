// The swarm CLI, the agent-facing surface of the board: a table of verbs behind one dispatcher (codebase-rework#D11).
// Human output is short lines an agent reads; --json prints the same data as one object; errors go to stderr, exit 1.
import { dispatch } from "./dispatch.ts";
import { VERBS } from "./verbs/index.ts";

process.exitCode = await dispatch(process.argv.slice(2), VERBS);
