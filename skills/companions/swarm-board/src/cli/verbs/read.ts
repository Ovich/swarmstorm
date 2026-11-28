import { WORDING } from "../answer/index.ts";
import type { VerbContext } from "../context.ts";
import { fail } from "../fail.ts";

export async function readVerb(ctx: VerbContext): Promise<void> {
  const seq = Number(String(ctx.args.positional[0] ?? "").replace(/^#/, ""));
  if (!Number.isInteger(seq) || seq <= 0) fail(`read: which post? read <seq>, the number thread prints\n${ctx.verbHelp()}`);
  const m = (await ctx.board.message(ctx.projectRepo(), seq)) ?? fail(WORDING.noPost(seq));
  ctx.emit(m, () => {
    console.log(`#${m.seq} ${m.at}  ${m.from}${m.mentions.length ? ` → ${m.mentions.join(", ")}` : ""}${m.about ? `  [${m.about}]` : ""}${m.kind === "msg" ? "" : `  (${m.event ?? m.kind})`}  run ${m.run}`);
    console.log(m.body);
  });
}
