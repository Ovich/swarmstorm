// One pipeline for every verb (codebase-rework#D11): find its entry, give it what it needs,
// run it, map its failure to the line and exit the person reads, tell the tabs what moved.
import { openIndex, type Index } from "../store/index-db.ts";
import { parseArgs } from "./args.ts";
import { contextFor, Refusal, type VerbContext } from "./context.ts";
import { ensureDist, notifyIndexChanged } from "./server.ts";
import { TOP_USAGE } from "./usage.ts";

export interface Verb {
  name: string;
  /** `listed` verbs are the keys of `VERB_USAGE`; a `hidden` one answers but is never shown. */
  help: "listed" | "hidden";
  /** What the dispatcher provides: the UI built before `run`, an index opened on the verb's first
   *  `ctx.index()` (and closed after it ran). */
  needs?: { index?: true; dist?: true };
  /** A verb that changes what the sidebar shows: the tabs are told once it succeeded. */
  mutatesIndex?: true;
  /** Its exit code; nothing is 0. A refusal is thrown through `fail`. */
  run(ctx: VerbContext): number | void | Promise<number | void>;
}

export async function dispatch(argv: string[], verbs: readonly Verb[]): Promise<number> {
  const args = parseArgs(argv);
  const verb = verbs.find((v) => v.name === args.verb);
  if (!verb) {
    console.error(TOP_USAGE);
    return 1;
  }
  let index: Index | undefined;
  let code: number;
  try {
    if (verb.needs?.dist) ensureDist();
    const openOnce = (): Index => (index ??= openIndex());
    code = (await verb.run(contextFor(args, verb.needs?.index ? openOnce : undefined, verb.name))) ?? 0;
  } catch (err) {
    if (err instanceof Refusal) {
      console.error(err.message);
      return 1;
    }
    // a verb's thrown error is a user's: one line, exit 1; AIVIEW_DEBUG=1 shows the stack
    if (process.env.AIVIEW_DEBUG === "1") throw err;
    console.error(`aiview ${args.verb}: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  } finally {
    index?.close();
  }
  // One notification per invocation, after the work is done: any open tab reloads its
  // list. A failed verb announces nothing; a partial remove or move succeeded.
  if (code === 0 && verb.mutatesIndex) notifyIndexChanged();
  return code;
}
