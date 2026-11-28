import { progressText } from "../../board/board.ts";
import type { Participant } from "../../contract/board.ts";
import { answer, CODE_WORDING, shellWord, WORDING } from "../answer/index.ts";
import type { VerbContext } from "../context.ts";

export async function doneVerb(ctx: VerbContext, p: Participant): Promise<void> {
  // V-21: the example names the phase open now, never a made-up one
  const name = ctx.args.positional[0] ?? ctx.usageError("done: which phase?", "done <phase> --as <member>", `done ${(await ctx.board.currentPhase(p.run))?.name ?? "<phase>"} --as ${ctx.asWord()}`);
  // board-split D63: a done with work not merged is accepted, the branch named to the member and the orchestrator
  const unmerged = (await ctx.board.packCall(p, "unmerged", {})) as { branch: string; left: string; onto: string | null } | null;
  let r;
  try {
    r = await ctx.board.done(p, name, unmerged ? { unmerged: unmerged.branch } : undefined);
  } catch (e) {
    // F20: a done with no phase open marks nothing, and is not an error
    if (!/no phase is open/.test((e as Error).message)) throw e;
    ctx.emit({ member: p.name, phase: name, done: null, none: true }, WORDING.doneNone);
    return;
  }
  // a done for a phase no longer current is accepted and told to the orchestrator (idea 2, §3: overlapping phases);
  // V-5: its answer names what the member owes now; a repeat says already done; the count is owing.ts's (D62)
  const open = (await ctx.board.currentPhase(p.run))?.name ?? name;
  // V-28: a seat the count leaves out is told why before anything else; V-5: a late done names what is owed now
  const line = r.notOwed
    ? WORDING.doneNotOwed(name, r.notOwed)
    : r.already
      ? WORDING.doneAlready(name, r.late ? null : progressText(r.progress), r.late ? { owesNow: r.owesNow } : null)
      : r.late
        ? WORDING.doneLate(name, open, r.owesNow)
        : WORDING.doneCounted(name, progressText(r.progress), r.all, r.progress.gone.length > 0);
  const facts = unmerged ? [CODE_WORDING.unmergedAtDone(CODE_WORDING.unmergedFact(unmerged.branch, unmerged.left), ctx.cli, shellWord(unmerged.onto ?? "<branch>"), shellWord(p.name))] : [];
  const a = answer({ verb: "done", phase: name, line, facts }, await ctx.situation(p));
  ctx.emitAnswer({ member: p.name, phase: name, done: r.progress.done, of: r.progress.of, gone: r.progress.gone, all: r.all, already: r.already, late: r.late, owes: r.owesNow }, a, false);
}
