import { CODE_WORDING, ORCHESTRATORS_GROUP, shellWord, WORDING } from "../answer/index.ts";
import * as rules from "../answer/rules.ts";
import type { VerbContext } from "../context.ts";
import { fail } from "../fail.ts";
import { mergeLocksHeld } from "../pack-calls.ts";

export async function closeVerb(ctx: VerbContext): Promise<void> {
  const run = ctx.runArg();
  // V-45: a member of the run holding the merge lock is named: its merge did not land
  const closing = (await ctx.board.runs()).find((r) => r.id === run);
  const plan = closing?.plan ?? null;
  // the orchestrators board is permanent: closed only on purpose
  if (plan === ORCHESTRATORS_GROUP && !ctx.args.has("--force")) fail(WORDING.orchestratorsNeverClosed(ctx.cli, run));
  await ctx.orchestratorOf("close", run, (as) => WORDING.closeRun(ctx.cli, run, as));
  // board-fixes#D6: two steps by the answer alone, no state between them; the first lists who still owes, or the closing steps
  if (plan !== ORCHESTRATORS_GROUP && !ctx.args.has("--confirm")) {
    const confirm = WORDING.closeConfirm(ctx.cli, run, shellWord(ctx.args.flag("--as") ?? `${plan ?? "<group>"}/orchestrator`));
    fail(rules.closeStep(await ctx.board.owingMembers(run), run, confirm, closing?.kindPack != null));
  }
  const lockHolder = plan ? ((await mergeLocksHeld(ctx)).find((l) => l.holder.startsWith(`${plan}/`))?.holder ?? null) : null;
  await ctx.board.closeRun(run);
  // the run's worktrees go once clean and merged, each seat's link stopped first, by the run's pack (D9)
  const swept = ((await ctx.board.packCall(null, "close", { run })) as { worktree: string; member: string; removed: boolean; why: string | null }[] | null) ?? [];
  const kept = swept.filter((w) => !w.removed);
  ctx.emit({ run, state: "closed", ...(lockHolder ? { lockHolder } : {}), removed: swept.filter((w) => w.removed).map((w) => w.worktree), kept: kept.map((w) => ({ worktree: w.worktree, member: w.member, why: w.why })) }, () => {
    console.log(`run ${run} closed`);
    if (lockHolder) console.log(CODE_WORDING.closedLockHolder(lockHolder));
    const n = swept.length - kept.length;
    if (n) console.log(`${n} worktree${n === 1 ? "" : "s"} removed (branches kept)`);
    for (const w of kept) console.log(CODE_WORDING.keptWorktree(w.worktree, w.member, w.why, ctx.cli));
  });
}
