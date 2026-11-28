// The code pack's answer rules (board-split D8): which line of CODE_WORDING a member reads after a code event. Pure
// functions over the event and its reader, as rules.ts is for the core.
import type { Message, Participant } from "../../contract/board.ts";
import { type EventName, eventOf, FOREGROUND_WAIT_MS } from "../../contract/events.ts";
import { CODE_WORDING as CW } from "./code-wording.ts";
import { shellWord, WORDING as W } from "./wording.ts";
import type { Situation } from "./situation.ts";
import { planCode } from "../../board/mentions.ts";

/** board-fixes#D6: a code run's first `close`: its members finish by merging, its closing table names each merge sha. */
export const codeCloseStep = (owing: string[], run: number, confirm: string): string =>
  owing.length ? W.closeWaitRunning(run, owing, CW.closeFinish) : W.closeSteps(run, confirm, CW.closeColumns);

/** A member as `me` mentions it: `@<seat>` in its own run, `@<CODE>·<seat>` in another. */
const mentionFrom = (me: Participant, member: string): string => {
  const [plan, seat] = [member.slice(0, member.lastIndexOf("/")), member.slice(member.lastIndexOf("/") + 1)];
  return plan === me.plan ? `@${seat}` : `@${planCode(plan)}·${seat}`;
};

/** board-split V-36 (D71): the paused line of the merge lock's holder: it finishes that merge, then stops. */
export const pausedMergingStep = (s: Situation): string | null =>
  s.pause ? CW.pausedMerging(s.run, W.pauseWhy(s.pause.person, s.pause.text), W.wait(s.cli, s.as, FOREGROUND_WAIT_MS)) : null;

/** The merge lock's name in an `unlocked` event, as the code pack posts it (contract/code.ts MERGE_LOCK). */
const MERGE_LOCK = "merge-lock";

/** The line under a code event for `me`; null for one that asks nothing of it; undefined for an event not the code
 *  pack's (the core words it). */
export function codeEventStep(m: Message, me: Participant, cli: string, event: EventName | null = eventOf(m)): string | null | undefined {
  if (event === "merged") {
    // V-49: a merge that frees the lock gives each member refused it the merge-lock command, as the lost path does
    const free = m.meta && "free" in m.meta ? (m.meta.free ?? []) : [];
    return free.includes(me.name) ? CW.mergeLockFree(cli, shellWord(me.name)) : null;
  }
  if (event === "unlocked") {
    // board-split V-22: the merge lock freed from a lost holder: a waiter's step is the merge-lock command; the
    // orchestrator's lost alarm already told it
    if (!m.meta || !("unlocked" in m.meta) || m.meta.unlocked !== MERGE_LOCK) return undefined;
    return me.seat !== "orchestrator" && m.mentions.includes(me.name) ? CW.mergeLockFree(cli, shellWord(me.name)) : null;
  }
  if (event !== "flag") return undefined;
  // spec §7: an overlap names the two members whose worktrees changed the path; the one it is posted to settles it
  // with the other (a row from before the meta: its mentions, the holder then the writer)
  const [holder, writer] = m.meta && "holder" in m.meta ? [m.meta.holder, m.meta.writer] : m.mentions;
  if (!m.about || !holder || !writer || (me.name !== holder && me.name !== writer)) return null;
  const other = me.name === holder ? writer : holder;
  return CW.overlapSettle(cli, shellWord(`${mentionFrom(me, other)} <who changes what>`), shellWord(other), shellWord(m.about), shellWord(me.name));
}

/** codebase-rework#D13: an end refused over work not merged: uncommitted work is committed first, then merged. */
export const endUnmergedLine = (worktree: string, left: string, merge: string): string =>
  CW.endUnmerged(worktree, left, /uncommitted/.test(left) ? CW.endCommitThenMerge : CW.endMergeIt, merge);
