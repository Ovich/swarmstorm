// The board's published types (codebase-rework#D4): a run's id, a member, a message and what it carries, the shapes
// every unit above the contract reads; the Board that makes them is board/board.ts's.
import type { PackMessageMeta } from "./code.ts";
import type { EventName } from "./events.ts";
import type { Kind } from "./kinds.ts";

export type RunId = number;
/** What a merge's rebase met, as the board records it: the conflicted files (repository-relative,
 *  maybe none), or unknown and why (board D13). The CLI's conflicts.ts answers in it. */
export type Conflicts = { files: string[] } | { unknown: "old-git" | "no-reflog" };
export type Declared = { path: string }; // repository-relative
export type MessageKind = "msg" | "agreement" | "endorsement" | "urgent" | "event";

export interface Participant {
  id: number;
  run: RunId;
  repo: string;
  kind: Kind;
  plan: string;
  seat: string; // "orchestrator" for a run's orchestrator
  name: string; // "<plan>/<seat>"
  nick: string; // the funny name given at join (D43), and to an orchestrator at open (plan D17)
  ended: boolean;
  /** The folder it works in, registered at join (a code member's worktree); null for the orchestrator or a member with no pack. */
  place: string | null;
  /** A `wait --mentions` of this participant is pending (D49, D61). */
  listening: boolean;
  /** Its pack, chosen once at join from the registry (board-split#D11, D22); null: core only; an orchestrator's reads
   *  as its kind's default. */
  pack: string | null;
  /** It carries the verify setting (a `verifier` seat, D11). */
  verify: boolean;
  /** The pack its run's kind gives by default, see Run.kindPack. */
  kindPack: string | null;
}

/** A merged path and another member that holds it, or held it during the merger's run (D63). */
export interface Sharer {
  path: string;
  member: string; // "<plan>/<seat>"
}

export interface Message {
  seq: number;
  repo: string;
  from: string; // the author's name
  body: string;
  about: string | null;
  kind: MessageKind;
  mentions: string[]; // "<plan>/<seat>" or "<plan>/*"
  at: string;
  /** The author's run: a run is a label on the item, not a place (plan D1, D13). */
  run: RunId;
  /** The agreement an endorsement backs; null otherwise. */
  endorses: number | null;
  /** The board event it is, as posted (D59); null on a plain post. */
  event: EventName | null;
  /** On delivery only, to a holder of `about` when a member that did not hold it posted about it:
   *  the agreement that answers it (D62). */
  answer?: string;
  /** A merged event's recipients, or a phase event's name, as data (D11); null elsewhere. */
  meta?: MessageMeta | null;
}

/** A phase event's name, as data: `phase <name> <text>` stores `<name>`. */
type PhaseMeta = { phase: string };
/** An unlocked event's data (idea 4): the lock's name. */
type UnlockedMeta = { unlocked: string };
/** A breach event's data (idea 4): the member, `<group>/<id>`, that killed by name, pattern or an unlocked port. */
type BreachMeta = { breach: string };
/** A pause event's data (idea 2, B12): whether it waits on the person, and its text. */
type PauseMeta = { person: boolean; text: string };
/** An all-joined event's data: whether a post had already been made to one of the run's seats. */
export type AllJoinedMeta = { tasked: boolean };
/** board-fixes#D4: an awaited event's task (its seq) and the awaited seat it tells of. */
export type AwaitedMeta = { task: number; seat: string };
export type MessageMeta = PackMessageMeta | PhaseMeta | PauseMeta | UnlockedMeta | BreachMeta | AllJoinedMeta | AwaitedMeta;
