// One pipeline for every verb (codebase-rework#D11, plan §3.4): the helps first, then the verb's entry, the refs it
// hands git, the board when it talks to one, who is calling and the gates before a member verb, the verb itself, and
// the line and exit a failure maps to. An entry holds no text: its names key VERB_USAGE (D12).
import type { Participant } from "../board/board.ts";
import { connectBoard, SERVER_CLOSED_CONNECTION } from "../client/remote.ts";
import { refArg } from "../host/git.ts";
import { DATA_ROOT } from "../host/home.ts";
import { closedConnectionHint, codeUsage, coreUsage, hiddenUsage, WORDING, type VerbName } from "./answer/index.ts";
import { contextFor, EXIT, type VerbContext } from "./context.ts";
import { CliError } from "./fail.ts";

/** Who may call a verb, and what the dispatcher hands it: anyone; the caller; a member past the closed/ended gate; a
 *  listener past its own gate; a member when --as names one, else nobody. */
type Who = "anyone" | "caller" | "member" | "listener" | "member-if-as";
interface VerbBase {
  names: readonly VerbName[];
  /** `board`: connected before it runs; `none`: never talks to the board; `self`: starts or is its own process (serve, link) */
  server: "board" | "none" | "self";
  help: "core" | "code" | "hidden";
  /** refused, exit 4, while the member's run is paused */
  refusedPaused?: true;
}
export type Verb =
  | (VerbBase & { who: "anyone"; run(ctx: VerbContext): Promise<void> })
  | (VerbBase & { who: "caller" | "member" | "listener"; run(ctx: VerbContext, p: Participant): Promise<void> })
  | (VerbBase & { who: "member-if-as"; run(ctx: VerbContext, p: Participant | null): Promise<void> });

/** trust-adaptations#D7: the refs a call hands git (`--onto`, merged's sha) refused before any git runs when git
 *  could read one as an option. */
function refuseOptionLikeRefs(ctx: VerbContext): void {
  const onto = ctx.args.flag("--onto");
  if (onto !== undefined) refArg(onto, "--onto");
  if (ctx.verb === "merged" && ctx.args.positional[0] !== undefined) refArg(ctx.args.positional[0], "merged: the sha");
}

/** The verb run as its `who` says, past the gates; a gate that answers runs nothing. */
async function runAsItsCaller(verb: Verb, ctx: VerbContext): Promise<void> {
  if (verb.who === "anyone") return verb.run(ctx);
  if (verb.who === "member-if-as") {
    // a member asking (--as) learns its run closed
    const p = ctx.args.flag("--as") ? await ctx.caller() : null;
    if (p && (await ctx.answeredGate(p))) return;
    return verb.run(ctx, p);
  }
  const p = await ctx.caller();
  if (verb.who !== "caller" && (await ctx.answeredGate(p, verb.who === "listener"))) return;
  if (verb.refusedPaused && (await ctx.refusedPaused(p))) return;
  return verb.run(ctx, p);
}

export async function dispatch(argv: string[], verbs: readonly Verb[]): Promise<number> {
  const ctx = contextFor(argv);
  if (!ctx.args.verb) {
    console.error(coreUsage(ctx.cli));
    return EXIT.error;
  }
  // a hidden verb's help never starts it (run 75: `serve --help` took the start lock and logged a start)
  if ((ctx.verb === "serve" || ctx.verb === "link") && (ctx.args.has("--help") || ctx.args.has("-h"))) {
    console.log(hiddenUsage(ctx.cli, ctx.verb));
    return EXIT.ok;
  }
  if (ctx.verb === "--help") {
    // the core verbs; `--help code` the claim and merge verbs (D22)
    console.log(ctx.args.positional[0] === "code" ? codeUsage(ctx.cli) : coreUsage(ctx.cli));
    return EXIT.ok;
  }
  const verb = verbs.find((v) => (v.names as readonly string[]).includes(ctx.verb));
  if (!verb) {
    // V-48: a word that is no verb names itself and where the verbs are, the same for every caller
    console.error(WORDING.unknownVerb(ctx.verb, ctx.cli));
    return EXIT.error;
  }
  try {
    refuseOptionLikeRefs(ctx);
    // every verb reaches the board through the server, started on demand (D6, D19)
    if (verb.server === "board") ctx.board = await connectBoard({ dataRoot: DATA_ROOT });
    await runAsItsCaller(verb, ctx);
    // D39: the call went straight to the server; the agent starts its own link (on stderr under --json, which stays
    // parseable). On every call while the link is down: unseen, the member reads away or lost while it works
    ctx.tellLinkToStart(ctx.asJson ? console.error : console.log);
    return ctx.exitCode;
  } catch (e) {
    const said = (e as Error).message;
    console.error(e instanceof CliError || said.startsWith("swarm: ") ? said : `swarm: ${said}`);
    if (said === SERVER_CLOSED_CONNECTION) console.error(closedConnectionHint(ctx.verb, ctx.cli));
    return EXIT.error;
  } finally {
    ctx.board?.close();
  }
}
