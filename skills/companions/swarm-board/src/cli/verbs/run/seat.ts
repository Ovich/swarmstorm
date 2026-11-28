import { shellWord, WORDING } from "../../answer/index.ts";
import type { VerbContext } from "../../context.ts";
import { fail } from "../../fail.ts";

export async function seatVerb(ctx: VerbContext): Promise<void> {
  if (ctx.args.positional[0] === "add") {
    const id = ctx.args.positional[1] ?? fail(`seat add: which id?\n${ctx.verbHelp()}`);
    const run = ctx.runArg();
    await ctx.orchestratorOf("seat add", run, (as) => WORDING.seatAdd(ctx.cli, shellWord(id), run, as));
    const role = ctx.args.flag("--role");
    const area = ctx.args.flag("--area");
    const added = await ctx.board.addSeat(run, {
      id,
      ...(role ? { role } : {}),
      ...(area ? { area } : {}),
      blockers: ctx.args.list("--blockers"),
      link: ctx.args.flag("--link") ?? null,
    });
    ctx.emit({ run, seat: added }, `${id} added`);
    return;
  }
  fail(`seat: add <id>, the one thing it does\n${ctx.verbHelp()}`);
}
