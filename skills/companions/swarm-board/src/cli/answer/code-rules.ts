// The code pack's answer rules (board-split D8): which line of CODE_WORDING a member reads after a code event. Pure
// functions over the event and its reader, as rules.ts is for the core.
import type { Message, Participant } from "../../board/board.ts";
import { type EventName, eventOf, FOREGROUND_WAIT_MS } from "../../board/events.ts";
import { CODE_WORDING as CW } from "./code-wording.ts";
import { shellWord, WORDING as W } from "./wording.ts";
import type { Situation } from "./situation.ts";
import { planCode } from "../../board/mentions.ts";

/** A member as `me` mentions it: `@<seat>` in its own run, `@<CODE>·<seat>` in another. */
export const mentionFrom = (me: Participant, member: string): string => {
  const [plan, seat] = [member.slice(0, member.lastIndexOf("/")), member.slice(member.lastIndexOf("/") + 1)];
  return plan === me.plan ? `@${seat}` : `@${planCode(plan)}·${seat}`;
};

/** board-split V-36 (D71): the paused line of the merge lock's holder: it finishes that merge, then stops. */
export const pausedMergingStep = (s: Situation): string | null =>
  s.pause ? CW.pausedMerging(s.run, W.pauseWhy(s.pause.person, s.pause.text), W.wait(s.cli, s.as, FOREGROUND_WAIT_MS)) : null;

/** The merge lock's name in an `unlocked` event, as the code pack posts it (packs/code/events.ts MERGE_LOCK). */
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
  // spec §7: an overlap mentions the two members whose worktrees changed the path: each settles it with the other
  const [holder, writer] = m.mentions;
  if (!m.about || !holder || !writer || (me.name !== holder && me.name !== writer)) return null;
  const other = me.name === holder ? writer : holder;
  return CW.overlapSettle(cli, shellWord(`${mentionFrom(me, other)} <who changes what>`), shellWord(other), shellWord(m.about), shellWord(me.name));
}
