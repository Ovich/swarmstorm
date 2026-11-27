import type { VerbContext } from "../context.ts";
import { fail } from "../fail.ts";

export async function worktreeVerb(ctx: VerbContext): Promise<void> {
  if (ctx.args.positional[0] !== "prune") fail(`worktree: the one subcommand is prune\n${ctx.verbHelp()}`);
  // each repository the board knows a run of: its worktrees folder is the only one walked, by the code pack; the
  // latest member to join from a folder says which run it belongs to
  const repos = (await ctx.board.runs()).map((r) => r.repo);
  const out = ((await ctx.board.packCall(null, "prune", { repos })) as { worktree: string; removed: boolean; why: string | null }[] | null) ?? [];
  const kept = out.filter((o) => !o.removed);
  ctx.emit({ removed: out.filter((o) => o.removed).map((o) => o.worktree), kept }, () => {
    console.log(`${out.length - kept.length} worktree${out.length - kept.length === 1 ? "" : "s"} removed (branches kept)`);
    for (const k of kept) console.log(`kept ${k.worktree}: ${k.why}`);
  });
}
