// The code pack's answer rules (board-split D8): which line of CODE_WORDING a member reads after a code event. Pure
// functions over the event and its reader, as rules.ts is for the core.
import type { Message, Participant } from "../../board/board.ts";
import { type EventName, eventOf } from "../../board/events.ts";
import { CODE_WORDING as CW } from "./code-wording.ts";
import { shellWord } from "./wording.ts";
import { planCode } from "../../board/mentions.ts";

/** A member as `me` mentions it: `@<seat>` in its own run, `@<CODE>·<seat>` in another. */
export const mentionFrom = (me: Participant, member: string): string => {
  const [plan, seat] = [member.slice(0, member.lastIndexOf("/")), member.slice(member.lastIndexOf("/") + 1)];
  return plan === me.plan ? `@${seat}` : `@${planCode(plan)}·${seat}`;
};

/** board-split V-13: the line under a held claim: who holds it, and the post to make, runnable as printed. */
export function claimHeldLine(me: Participant, cli: string, held: { path: string; holders: { member: string; nick: string; doing: string }[] }): string {
  const who = held.holders.map((h) => `${h.member} (${h.nick}: ${h.doing})`).join(", ");
  const mentions = held.holders.map((h) => mentionFrom(me, h.member)).join(" ");
  return CW.claimHeld(held.path, who, held.holders.length > 1, CW.claimHeldPost(cli, mentions, shellWord(held.path), shellWord(me.name)));
}

/** The line under a code event for `me`; null for any other event, or one that asks nothing of it. */
export function codeEventStep(m: Message, me: Participant, cli: string, event: EventName | null = eventOf(m)): string | null {
  if (event !== "flag") return null;
  // a flag mentions the holder, then the writer (D10): each is told how to settle it
  const [holder, writer] = m.mentions;
  if (!m.about || !holder || !writer) return null;
  if (me.name === holder) return CW.flagHolder(cli, shellWord(`@${writer} <who changes what>`), shellWord(m.about));
  if (me.name === writer) return CW.flagWriter(cli, shellWord(`@${holder} <what you change>`), shellWord(m.about));
  return null;
}
