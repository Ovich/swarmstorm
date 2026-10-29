// The one entry of a pack (board-split#D1, D7): what a member's pack adds to the core, as pack methods returning
// typed facts; every line a pack causes is the answer module's (D8), so a pack has no answer method. A pack runs in
// the board server inside the core's transaction and reaches only its own tables and `insertMessage` (D9); it holds
// no module-level state, every call scoped to one run through its `PackCtx` (D10). The fact types are open records
// until phase 3 moves the pack's work behind these methods and gives each its fields.
import type { Kind, Message, Participant, RunId } from "../board/board.ts";

/** A verb a pack adds to the CLI's dispatch (D12: listed under the pack's section of the static help). */
export interface VerbSpec {
  name: string;
}

/** What `onJoin` records for the member, for the answer module to word. */
export type JoinFacts = Record<string, unknown>;
/** What `onPost` made of a post (a claim taken by it, in the code pack). */
export type PostFacts = Record<string, unknown>;
/** Why `end` cannot go on, for the answer module to word. */
export type Refusal = { reason: string } & Record<string, unknown>;
/** What `afterEnd` released. */
export type EndFacts = Record<string, unknown>;
/** A pack's figures of one run, beside the core's (D15). */
export type PackStats = Record<string, unknown>;

/** The pack's own tables (board-split#D20), reached through the run's context only. */
export type PackTables = unknown;

/** One run's view for a pack call (D10): its run and repository, the pack's tables, and the core's insertMessage. */
export interface PackCtx {
  run: RunId;
  repo: string;
  tables: PackTables;
  insertMessage(author: Participant, body: string, about: string | null): Message;
}

export interface Pack {
  /** The registry's name of it; "code" in this plan. */
  name: string;
  verbs: VerbSpec[];
  onJoin?(member: Participant, ctx: PackCtx): JoinFacts;
  onPost?(member: Participant, message: Message, ctx: PackCtx): PostFacts | null;
  alsoFor?(member: Participant, message: Message, ctx: PackCtx): boolean;
  defaultParties?(about: string, ctx: PackCtx): string[];
  busy?(member: Participant, ctx: PackCtx): boolean;
  beforeEnd?(member: Participant, ctx: PackCtx): Refusal | null;
  afterEnd?(member: Participant, ctx: PackCtx): EndFacts;
  stats?(run: RunId, ctx: PackCtx): PackStats;
}

/** What a member is given at join (D11, D22): its pack, none for core only, and whether it carries the verify setting. */
export interface MemberPackRow {
  pack: Pack | null;
  verify: boolean;
}

export type { Kind };
