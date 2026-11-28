import type { Participant } from "../../contract/board.ts";
import type { VerbContext } from "../context.ts";
import { fail } from "../fail.ts";

export async function doingVerb(ctx: VerbContext, p: Participant): Promise<void> {
  const text = ctx.args.positional.join(" ") || fail("doing: what?");
  await ctx.board.setDoing(p, text);
  await ctx.emitHeard(p, { member: p.name, doing: text }, `${p.name} doing: ${text}`);
}
