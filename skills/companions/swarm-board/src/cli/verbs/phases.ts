import type { VerbContext } from "../context.ts";
import { shortAt } from "../lines.ts";

export async function phasesVerb(ctx: VerbContext): Promise<void> {
  const run = await ctx.readRun("phases");
  const list = await ctx.board.phases(ctx.projectRepo(), run);
  ctx.emit({ run, phases: list }, () => {
    if (!list.length) console.log(`run ${run}: no phase opened yet`);
    for (const o of list)
      console.log(`#${o.seq}  ${o.name}  opened ${shortAt(o.at)}  ${o.posts} post${o.posts === 1 ? "" : "s"}${o.urgent ? `  ${o.urgent} urgent` : ""}${o.done === null ? "" : `  ${o.done} done`}${o.current ? "  (current)" : ""}`);
  });
}
