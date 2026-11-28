import type { Participant } from "../../../contract/board.ts";
import { FOREGROUND_WAIT_MS } from "../../../contract/events.ts";
import { endUnmergedLine } from "../../answer/code-rules.ts";
import { CODE_WORDING, shellWord, WORDING } from "../../answer/index.ts";
import type { VerbContext } from "../../context.ts";
import { fail } from "../../fail.ts";
import { stateLine } from "../../lines.ts";

export async function endVerb(ctx: VerbContext, asker: Participant): Promise<void> {
  // its run closed: the close ended it; end answers what the closed line promised, the summary to return
  if ((await ctx.board.runs()).every((r) => r.id !== asker.run)) {
    const line = WORDING.closedEndSummary(asker.run, asker.name);
    // ended: no link to start
    ctx.linkToStart = null;
    ctx.emit({ member: asker.name, ended: true, closed: true, next: line }, line);
    return;
  }
  // board-split D30, D38: a member never ends itself while its run is open; the orchestrator ends a seat
  // (`end --seat <id>`), its context spent, and a fresh agent joins it
  const endedSeat = ctx.args.flag("--seat");
  if (endedSeat !== undefined && asker.seat !== "orchestrator") fail(`end --seat: only the orchestrator ends a seat; ${asker.name} is not ${asker.plan}/orchestrator`);
  // break-flow V-38 (D73): the orchestrator's seat ends with its run, never alone while the run is open
  if (endedSeat === "orchestrator") fail(WORDING.endOrchestratorRefused(asker.run, ctx.cli, shellWord(asker.name)));
  if (endedSeat === undefined && asker.seat !== "orchestrator") fail(WORDING.endRefused(asker.run, WORDING.wait(ctx.cli, shellWord(asker.name), FOREGROUND_WAIT_MS)));
  const p = endedSeat === undefined ? asker : ((await ctx.board.participant(`${asker.plan}/${endedSeat}`)) ?? fail(`end --seat: no member in seat ${endedSeat} of run ${asker.run}`));
  // a member already ended: nothing to do, nothing to say
  if (p.ended) return;
  // a mention landed since its last look: it reads it before it ends (the orchestrator ending a seat reads for it)
  const unread = endedSeat === undefined ? await ctx.board.unreadMentions(p) : 0;
  if (unread > 0) fail(WORDING.unreadBeforeEnd(unread, WORDING.wait(ctx.cli, shellWord(p.name))));
  // the board's worktree with work not merged: the pack refuses the end, naming it and the merge (beforeEnd)
  const base = (await ctx.runOf(p.run))?.base ?? null;
  const refusal = (await ctx.board.packCall(p, "beforeEnd", {})) as { reason: string; worktree: string; left: string } | null;
  // board-split D59: the orchestrator ending a lost member's seat is never refused: the work stays on its branch
  const lostSeat = refusal && endedSeat !== undefined && (await ctx.board.composition(p.run)).entries.some((e) => e.seat === endedSeat && e.state === "lost");
  const unmergedKept = lostSeat ? ((await ctx.board.packCall(p, "unmerged", {})) as { branch: string; left: string } | null) : null;
  // V-40: the orchestrator ending a live seat is answered as the orchestrator: the branch, who merges it, or the close
  if (refusal && !lostSeat && endedSeat !== undefined) {
    const live = (await ctx.board.packCall(p, "unmerged", {})) as { branch: string; left: string } | null;
    fail(CODE_WORDING.endSeatUnmerged(p.name, CODE_WORDING.unmergedFact(live?.branch ?? "", live?.left ?? refusal.left), WORDING.closeRun(ctx.cli, p.run, shellWord(asker.name))));
  }
  if (refusal && !lostSeat) {
    fail(endUnmergedLine(refusal.worktree, refusal.left, CODE_WORDING.mergeLockReport(ctx.cli, base ?? "<branch>", shellWord(p.name))));
  }
  // break-flow V-29: the orchestrator ending a seat is told the state its member was in, and what it is told now
  const before = endedSeat === undefined ? null : ((await ctx.board.roster(p.repo)).find((r) => r.name === p.name) ?? null);
  await ctx.board.end(p);
  // ended: no link to start
  ctx.linkToStart = null;
  // the pack removes its worktree once clean and merged, its link stopped first (afterEnd)
  const after = ((await ctx.board.packCall(p, "afterEnd", {})) ?? {}) as { worktree?: string; removed?: boolean; why?: string | null };
  const mine = after.worktree ?? null;
  const removal = after.why ?? null;
  ctx.emit({ member: p.name, ended: true, ...(mine ? { worktree: mine, removed: removal === null } : {}) }, () => {
    // V-41: a lost member's activity is from before its link died: its state is lost, with why
    const was = before?.badge?.name === "lost" ? WORDING.wasLost(before.badge.reason) : before ? stateLine(before) : "";
    console.log(before ? WORDING.seatEnded(p.name, was, WORDING.endedMember(p.run)) : `${p.name} ended`);
    if (mine) console.log(removal === null ? `worktree ${mine} removed (branch kept)` : `worktree ${mine} kept: ${removal}; the orchestrator's close sweeps it`);
    if (unmergedKept) console.log(CODE_WORDING.endedSeatUnmerged(p.name, CODE_WORDING.unmergedFact(unmergedKept.branch, unmergedKept.left)));
  });
}
