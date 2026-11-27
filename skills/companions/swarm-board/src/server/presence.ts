// Each member's link as the server sees it (board-split D55), mirrored in the store (D37): connected, dropped
// and why, last seen. The one ledger the liveness tick reads presence from (plan 2026-11-27-codebase-rework#D14).
import { trace } from "../host/trace.ts";
import type { Board, LinkDropCause, LinkFact, Presence } from "../board/board.ts";
import type { MemberActivity } from "../contract/wire.ts";
import { guarded } from "./guarded.ts";

/** A link's member as its Hello names it. */
type LinkMember = { name: string; run: number };

export type PresenceLedger = {
  /** board-split D55: a link connected, or dropped for `cause`; a drop is its last sight. */
  linked(m: LinkMember, connected: boolean, cause?: LinkDropCause | null): void;
  /** board-split D55: a heartbeat (every HEARTBEAT_MS) is the link's last sight, here and in the store. */
  beat(m: LinkMember): void;
  /** A link's activity frame: what its member's transcript shows it doing, recorded at the server's clock. */
  activity(m: LinkMember, reading: MemberActivity): void;
  /** D7, G18: a join starts the seat's presence afresh: an earlier member's lost link never carries into it (no
   *  'link lost' the moment it re-joins); a link of it already connected stays. */
  joined(joinValue: { member: { run: number; seat: string } }): void;
  /** A run's presence, as its liveness tick reads it. */
  presenceIn(run: number): Presence;
};

const seatOf = (name: string): string => name.slice(name.lastIndexOf("/") + 1);

/** The ledger, restored from the store: a link the last server saw connected dropped at this start (server-restart);
 *  a link already dropped keeps its facts (D37). No member is lost within LOST_MS of the start. */
export function openPresence(board: Board, now: () => Date): PresenceLedger {
  /** Per run, per member (its seat id): its link's facts. */
  const links = new Map<number, Map<string, LinkFact>>();
  /** Sets a member's link here and in the store (D37). */
  const keepLink = (run: number, member: string, link: LinkFact): void => {
    const members = links.get(run) ?? new Map<string, LinkFact>();
    links.set(run, members);
    members.set(member, link);
    guarded("recordLink", () => board.recordLink(run, member, link));
  };

  const startedAt = now().getTime();
  guarded("recordServerUp", () => board.recordServerUp(startedAt));
  for (const { run: savedRun, member, ...saved } of board.savedLinks())
    keepLink(savedRun, member, saved.connected ? { connected: false, lostAt: startedAt, seenAt: saved.seenAt ?? startedAt, cause: "server-restart" } : saved);

  return {
    linked(m, connected, cause = null) {
      const at = now().getTime();
      trace().event("link", { run: m.run, member: m.name, up: connected, cause });
      keepLink(m.run, seatOf(m.name), connected ? { connected: true, lostAt: null, seenAt: at, cause: null } : { connected: false, lostAt: at, seenAt: at, cause });
    },
    beat(m) {
      const member = seatOf(m.name);
      const link = links.get(m.run)?.get(member);
      if (link?.connected) keepLink(m.run, member, { ...link, seenAt: now().getTime() });
    },
    activity(m, reading) {
      guarded("activity", () => board.recordActivity(m.run, seatOf(m.name), reading, now()));
    },
    joined({ member }) {
      if (!links.get(member.run)?.get(member.seat)?.connected) keepLink(member.run, member.seat, { connected: false, lostAt: null, seenAt: null, cause: null });
    },
    presenceIn: (run) => (member) => links.get(run)?.get(member) ?? { connected: false, lostAt: null },
  };
}
