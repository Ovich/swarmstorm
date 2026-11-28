import type { Participant } from "../../../contract/board.ts";
import { CODE_WORDING, WORDING } from "../../answer/index.ts";
import type { VerbContext } from "../../context.ts";
import { phaseSuffix, rosterLine } from "../../lines.ts";
import { projectNameOf } from "../../paths.ts";
import { mergeLocksHeld } from "../../pack-calls.ts";

export async function rosterVerb(ctx: VerbContext, _asker: Participant | null): Promise<void> {
  const repo = ctx.projectRepo();
  const roster = await ctx.board.roster(repo);
  // each run's title and phase above its members
  const runs = new Map((await ctx.board.runs()).filter((r) => r.repo === repo).map((r) => [r.id, r]));
  const progress = new Map(await Promise.all([...runs.keys()].map(async (id) => [id, await ctx.board.phaseProgress(id)] as const)));
  // board-split D52 (U-F18): the merge lock is in the same listing, a lock named `merge` held by its member
  const merge = (await mergeLocksHeld(ctx)).filter((m) => m.project === repo);
  const mergeHeld = merge.map((m) => ({ name: "merge", member: m.holder, run: roster.find((r) => r.name === m.holder)?.run ?? 0, since: m.since, note: null, waiters: m.waiters }));
  const compositions = new Map(await Promise.all([...runs.keys()].map(async (id) => [id, await ctx.board.composition(id)] as const)));
  ctx.emit({ repo, roster, compositions: [...compositions.values()], runs: [...runs.values()].map((r) => ({ run: r.id, title: r.title, authority: r.authority, phase: r.phase, progress: progress.get(r.id) ?? null })), locks: mergeHeld, mergeLocks: merge }, () => {
    const projectName = projectNameOf();
    for (const m of merge) console.log(`lock ${CODE_WORDING.mergeLockLine(projectName(m.project), m.holder, m.since, m.waiters)}`);
    if (!runs.size) console.log(WORDING.noRunIn(projectName(repo)));
    let shown: number | null = null;
    for (const r of roster) {
      const run = runs.get(r.run);
      if (run && r.run !== shown) console.log(`run ${run.id}  ${run.title}${WORDING.authorityShown(run.authority)}${phaseSuffix(run.phase, progress.get(run.id) ?? null)}${WORDING.runPausedShown(run.paused, run.pausedPerson)}`);
      shown = r.run;
      console.log(rosterLine(r, roster, true));
      if (roster.filter((x) => x.run === r.run).at(-1) === r) for (const l of compositions.get(r.run)?.lines ?? []) console.log(`  seat ${l}`);
    }
  });
}
