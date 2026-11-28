import type { Participant } from "../../contract/board.ts";
import { seqLine } from "../format.ts";
import type { VerbContext } from "../context.ts";
import { fail } from "../fail.ts";

export async function endorseVerb(ctx: VerbContext, p: Participant): Promise<void> {
  const raw = (ctx.args.positional[0] ?? fail("endorse: which seq?")).replace(/^#/, "");
  const seq = Number(raw);
  if (!Number.isInteger(seq)) fail(`endorse takes a seq, got ${raw}`);
  const m = await ctx.board.endorse(p, seq);
  await ctx.emitHeard(p, { seq: m.seq, endorses: m.endorses, run: m.run }, seqLine(m));
}
