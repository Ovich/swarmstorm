import { DATA_ROOT } from "../../host/home.ts";
import { TRACE_LEVELS, readTraceLevel, traceRoot, writeTraceLevel, type TraceLevel } from "../../host/trace.ts";
import type { VerbContext } from "../context.ts";
import { fail } from "../fail.ts";

export async function logLevelVerb(ctx: VerbContext): Promise<void> {
  // the trace's level (logs/<day>/), read by the board server within seconds; no word: the level now
  const word = ctx.args.positional[0];
  if (word !== undefined) {
    if (!TRACE_LEVELS.includes(word as TraceLevel)) fail(`log-level: ${word} is none of ${TRACE_LEVELS.join(", ")}`);
    writeTraceLevel(DATA_ROOT, word as TraceLevel);
  }
  const level = readTraceLevel(DATA_ROOT);
  ctx.emit({ level, logs: traceRoot(DATA_ROOT) }, `log level ${level}: ${traceRoot(DATA_ROOT)}`);
}
