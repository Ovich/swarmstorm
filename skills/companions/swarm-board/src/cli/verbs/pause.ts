import type { Participant } from "../../contract/board.ts";
import { seqLine } from "../format.ts";
import { CODE_WORDING, shellWord, WORDING } from "../answer/index.ts";
import type { VerbContext } from "../context.ts";
import { mergeLocksHeld } from "../pack-calls.ts";

export async function pauseVerb(ctx: VerbContext, p: Participant): Promise<void> {
  // pause --person "<what they decide>": a pause waiting on the person (idea 2, B12)
  // the text is --person's value or the positional words, either way (board-split F2, D44)
  const person = ctx.verb === "pause" && ctx.args.has("--person") ? (ctx.args.flag("--person") ?? ctx.args.positional.join(" ")) : undefined;
  const text = person ?? ctx.args.positional.join(" ");
  const cli = ctx.cli;
  if (ctx.verb === "pause") {
    const m = await ctx.board.pause(p, text, person !== undefined ? { person: true } : undefined);
    const next = WORDING.pausedAll(m.run, person !== undefined ? text : null, cli, shellWord(p.name));
    // board-split V-36 (D71): a member of this run holding the merge lock lands that merge first
    const holder = (await mergeLocksHeld(ctx)).find((l) => l.holder.startsWith(`${p.plan}/`))?.holder ?? null;
    const merging = holder ? CODE_WORDING.pauseLockHolder(holder) : null;
    ctx.emit({ seq: m.seq, run: m.run, paused: true, person: person !== undefined, ...(holder ? { merging: holder } : {}), next }, () => {
      console.log(seqLine(m));
      if (merging) console.log(merging);
      console.log(next);
    });
    return;
  }
  const m = await ctx.board.resume(p, text);
  // what the pause held from the orchestrator, one line each, given once (idea 2, judgment 1)
  const next = WORDING.resumed(m.run, m.held.length, cli, shellWord(p.name));
  ctx.emit({ seq: m.seq, run: m.run, paused: false, held: m.held, next }, () => {
    console.log(seqLine(m));
    for (const line of m.held) console.log(line);
    console.log(next);
  });
}
