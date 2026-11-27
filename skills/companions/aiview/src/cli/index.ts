// aiview's CLI, the agent-facing surface: a table of verbs behind one dispatcher
// (codebase-rework#D11). `open` is the standard gesture: ensure registered, ensure server,
// print URL.
import { dispatch } from "./dispatch.ts";
import { VERBS } from "./verbs/index.ts";

process.exitCode = await dispatch(process.argv.slice(2), VERBS);
