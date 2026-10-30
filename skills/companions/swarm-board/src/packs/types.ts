// The one entry of a pack (board-split#D1, D7): what a member's pack adds to the core, as pack methods returning
// typed facts; every line a pack causes is the answer module's (D8), so a pack has no answer method. A pack runs in
// the board server and reaches only its own tables and `insertMessage` (D9); it holds no module-level state, every
// call scoped to one run through its `PackCtx` (D10). Git and other slow work run in `run`, before any transaction
// opens (D19).
import type { Declared, Kind, Message, Participant, RunId } from "../board/board.ts";
import type { EventDef } from "../board/events.ts";
import type { StatsFigures } from "../board/stats.ts";
import type { Claims, ClaimsDeps } from "./code/claims.ts";
import type { CodeSnapshot, CodeSnapshotDeps } from "./code/snapshot.ts";
import type { CodeMemberFact } from "./code/types.ts";

/** A verb a pack adds to the CLI's dispatch (D12: listed under the pack's section of the static help). */
export interface VerbSpec {
  name: string;
}

/** What `onJoin` records for the member, for the answer module to word. */
export type JoinFacts = Record<string, unknown>;
/** What `onPost` made of a post (a claim taken by it, in the code pack). */
export type PostFacts = Record<string, unknown>;
/** Why `end` cannot go on, for the answer module to word: `left` says what the member still holds. */
export type Refusal = { reason: string } & Record<string, unknown>;
/** What a member's end frees for others, inside the end's transaction: a line added to its `ended` event (null: none),
 *  whom it mentions (the code pack: the members refused the merge lock it held), and the doing its card keeps (D66). */
export type EndedFreed = { note: string | null; mentions: string[]; lastDoing: string };
/** What `afterEnd` released. */
export type EndFacts = Record<string, unknown>;

/** A pack verb called by a member whose stored pack lacks it (D12): the answer module words the refusal. `seatKind`
 *  says what the caller is instead: a verifier, or a seat with no pack. A git failure is `reason: "git"` (D19). */
export type PackRefusal = { refused: { reason: "no-pack"; verb: string; seatKind: "verifier" | "seat" } | { reason: "git"; verb: string; detail: string } };

/** The pack's own tables (board-split#D20), opened by the board through the registry and reached through the run's
 *  context only. One pack ships in this plan, so its store is the type. */
export type PackTables = Claims;
/** What the core gives a pack to open its tables with: its database and the core's helpers. */
export type PackTablesDeps = ClaimsDeps;

/** What a pack says of a member beside its core state (D36): it reads instead of working or waiting. One pack ships,
 *  so its facts are the type. */
export type MemberFact = CodeMemberFact;

/** The pack's part of the page's snapshot of one repository (D18); one pack ships, so its snapshot is the type. */
export type PackSnapshot = CodeSnapshot;
export type PackSnapshotDeps = CodeSnapshotDeps;

/** One run's view for a pack call (D10): its run, group and base, its repository, the pack's tables, and the core's
 *  insertMessage. */
export interface PackCtx {
  run: RunId;
  repo: string;
  group: string;
  /** The branch the run's work starts from and lands in; null before it was recorded. */
  base: string | null;
  tables: PackTables;
  insertMessage(author: Participant, body: string, about: string | null): Message;
}

/** A pack verb's input as the CLI sent it over the wire: plain data, the caller's checkout among it. */
export type PackVerbInput = Record<string, unknown>;

/** A member's verb that writes the pack's tables (D9, D19): the core's `packCall` runs `apply` inside its own
 *  transaction, after `run` did any slow work, and counts the call under `countedAs` (none when null), as progress
 *  when `progress`. An ended member is refused it. */
export interface PackWrite {
  countedAs: string | null;
  progress: boolean;
  apply(member: Participant, input: PackVerbInput, ctx: PackCtx): unknown;
}

export interface Pack {
  /** The registry's name of it; "code" in this plan. */
  name: string;
  verbs: VerbSpec[];
  /** The events the pack posts, by name; the registry adds them to the core's (D18), so they parse and wake alike. */
  events?: Record<string, EventDef<string>>;
  /** Opens the pack's tables, once per board. */
  openTables?(deps: PackTablesDeps): PackTables;
  /** The server side of a pack verb, called before the core's transaction (D19): the facts it gives the CLI, or a
   *  refusal. `member` is null for a call no member makes (a run's close, a prune); `tables` are the pack's own, for a
   *  call with no run and so no `ctx`. */
  run?(verb: string, member: Participant | null, input: PackVerbInput, ctx: PackCtx | null, tables: PackTables): unknown;
  /** The member verbs that write its tables, by verb, each after `run` (D9). */
  writes?: Record<string, PackWrite>;
  /** At every join and re-join, after the member's row is written: `declared` the files its join declared. */
  onJoin?(member: Participant, ctx: PackCtx, declared: Declared[]): JoinFacts;
  onPost?(member: Participant, message: Message, ctx: PackCtx): PostFacts | null;
  alsoFor?(member: Participant, message: Message, ctx: PackCtx): boolean;
  defaultParties?(about: string, ctx: PackCtx): string[];
  busy?(member: Participant, ctx: PackCtx): boolean;
  /** What it says of the member now (D36), shown instead of working or waiting; null: nothing. */
  memberFact?(member: Participant, ctx: PackCtx): MemberFact | null;
  /** board-split D52: a stall of the pack's own at `t` (ms epoch), as the stalled badge's reason and since; null: none. */
  memberStall?(member: Participant, ctx: PackCtx, t: number): { reason: string; since: number } | null;
  beforeEnd?(member: Participant, ctx: PackCtx): Refusal | null;
  /** Inside the end's transaction: releases what the member held in the pack's tables; null: nothing to say. */
  onEnded?(member: Participant, ctx: PackCtx): EndedFreed | null;
  afterEnd?(member: Participant, ctx: PackCtx): EndFacts;
  /** Its part of one repository's snapshot, from its tables; `people` are the snapshot's participant rows. */
  snapshot?(deps: PackSnapshotDeps, repo: string, people: Record<string, unknown>[], orchestratorSeat: string): PackSnapshot;
  /** What the member holds now, for the roster's `held` (F27). */
  held?(db: PackTablesDeps["db"], member: number): { path: string; interface: boolean }[];
  /** The paths the member ever claimed, repository-relative: a declared file it claimed and released since is no longer waited on (S28). */
  everClaimed?(db: PackTablesDeps["db"], member: number): string[];
  /** Deletes its rows of a pruned member, or of a pruned run (D20): only the pack touches its tables. */
  forget?(db: PackTablesDeps["db"], scope: { member: number } | { run: RunId }): void;
  /** Its part of `swarm stats`: fields on runs, members and totals, read from the store (D15). */
  stats?: StatsFigures;
}

/** What a member is given at join (D11, D22): its pack, none for core only, and whether it carries the verify setting. */
export interface MemberPackRow {
  pack: Pack | null;
  verify: boolean;
}

export type { Kind };
