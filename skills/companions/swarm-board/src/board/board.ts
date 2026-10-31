// The board — with claims.ts (D35), the only module that sees SQL. Runs, the plan's slices,
// participants, the thread of each project, who has had what, who is calling,
// and waking a `wait`; claims and the merge lock live in claims.ts, behind this Board. Callers hold the typed Board openBoard() returns; the schema,
// member names, mention parsing, path normalisation, refusal wording and the waking
// mechanism stay in here.
import fs from "node:fs";
import path from "node:path";
import { SQLITE_PATH } from "./home.ts";
import { BOARD_AUTHOR, nameHandle, parseMentions, planCode } from "./mentions.ts";
import { type Kind, profileOf } from "./kinds.ts";
import { registry, type PackCtx, type PackRefusal, type PackMessageMeta, type PackSnapshotFields, type PackVerbInput } from "../packs/registry.ts";
import type { MemberFact, Pack } from "../packs/types.ts";
import { type EventName, type Subscription, carries, currentEventName, EVENTS, eventDef, eventOf, isEvent, formatSubscriptions, mentions as mentionsMe, parseSubscriptions as parseOn, wakes } from "./events.ts";
import { funnyName } from "./names.ts";
import { CARRY_MAX_MS, LOST_MS, NO_TRANSCRIPT_MS, READINGS_KEPT_MS, STALL_MS_DEFAULT, stallMsFloor, badgeConfirmMs, coreStateOf, type CoreMemberState, type SeatState } from "./liveness.ts";
export type { CoreMemberState, SeatState } from "./liveness.ts";
import type { MemberActivity } from "../wire.ts";
import { callLabel } from "./call-label.ts";

export type RunId = number;
export type { Kind } from "./kinds.ts";
export type { EventName, Subscription } from "./events.ts";
export type { PackRefusal } from "../packs/registry.ts";
/** What a merge's rebase met, as the board records it: the conflicted files (repository-relative,
 *  maybe none), or unknown and why (board D13). The CLI's conflicts.ts answers in it. */
export type Conflicts = { files: string[] } | { unknown: "old-git" | "no-reflog" };
/** A seat of a run (D22). `link`: the slice document's URL, opaque to the board (D44). */
export type SeatSpec = { id: string; role?: string; area?: string; blockers: string[]; link?: string | null; on?: string[]; transcript?: string | null };
export type Seat = SeatSpec & { state: SeatState };
/** One place of a run's composition (D3): a declared seat, who sits in it, and whether they do. */
export type CompositionEntry = { seat: string; member: string | null; nick: string | null; role?: string; area?: string; state: SeatState };
/** Who is in a run and in which role (D3, D6). `showRole`: the declared seats do not all share one role; `lines`: one per entry, as the CLI prints them. */
export type Composition = { run: number; entries: CompositionEntry[]; showRole: boolean; lines: string[] };
export type Declared = { path: string; interface: boolean }; // repository-relative
export type MessageKind = "msg" | "agreement" | "endorsement" | "urgent" | "event";

/** The phase a run's orchestrator opened last (`phase <name> <text>`). */
export type Phase = { name: string; text: string };
// board-split D62: the phase's done count has one home, owing.ts; the JSON key `gone` stays, frozen for readers
import { everyOwingDone, owesPhase, phaseCount, phaseIsForSeat, progressText, type PhaseMember, type PhaseProgress, type PhaseScope } from "./owing.ts";
export { progressText, type PhaseProgress };
/** Why a member's done is not in the open phase's count (D62, V-28): parked, or the phase is for other seats. */
export type NotOwed = { parked: true } | { forSeats: string[] } | null;
/** A project is keyed by its common git dir (the code pack's repository); without an aiview project it is shown by its
 *  checkout's folder name. */
export const projectFolderName = (repo: string): string => {
  const base = path.basename(repo);
  return base.toLowerCase() === ".git" ? path.basename(path.dirname(repo)) : base.replace(/\.git$/i, "");
};
/** The lost members as a line's suffix: ` (1 lost: idea/b)`, empty when none (D41). */
export const goneSuffix = (gone: string[]): string => (gone.length ? ` (${gone.length} lost: ${gone.join(", ")})` : "");
/** A member's activity from its transcript and its link (swarm-relay D9, D31, E12, D12): what it does, never trouble. */
export type MemberStateName = "working" | "busy" | "waiting";
/** board-split D36: trouble, beside the state, never a state. lost: its link dropped while it owed the open phase;
 *  blocked: it waits on the person (D44). */
export type BadgeName = "lost" | "blocked";
/** A badge with its reason (shown on hover) and since when it holds, ms epoch (null: unknown). */
export type Badge = { name: BadgeName; reason: string; since: number | null };
/** `doing`: the open tool, else the last; `since`: ms epoch the state counts from; `badge`: its trouble, null when none.
 *  A lost member keeps the last activity read of it. */
export type MemberState = { member: string; state: MemberStateName; doing: string | null; since: number | null; badge: Badge | null };
/** board-split D55: why a link dropped, as its server saw it. */
export type LinkDropCause = "member-closed" | "server-restart" | "superseded" | "version" | "socket";
/** board-split D55: a member's link as the server keeps it (a row of `member_links`): connected, else since when it
 *  dropped (`lostAt`, null: never linked) and why; `seenAt` its last heartbeat (ms epoch). */
export type LinkFact = { connected: boolean; lostAt: number | null; seenAt?: number | null; cause?: LinkDropCause | null };
/** A member's link facts, kept by the server. */
export type Presence = (member: string) => LinkFact;
/** A member's liveness as the page draws it (D20): its state, its counter from its link's last activity, and its two
 *  ages (swarm-relay D38): `progressAt` its last progress, `aliveAt` its last sign of life by its link, the time
 *  read while the link is up (ms epoch; null: never linked). */
export type Liveness = Omit<MemberState, "member"> & { tokens: number | null; movedAt: string | null; progressAt: number | null; aliveAt: number | null; note?: string };

/** A protocol's name: lower case, digits and dashes. */
export const PROTOCOL_NAME = /^[a-z0-9][a-z0-9-]*$/;
/** A role of a run's authority (board-split#D28): plain strings, the core knows no list of them (D18, D24). */
export const AUTHORITY_ROLE = /^[a-z0-9][a-z0-9-]*$/;
/** The stored authority column read back: the roles in order, [] for none or a store from before it. */
const authorityOf = (stored: unknown): string[] => {
  if (stored == null) return [];
  try {
    const roles = JSON.parse(String(stored));
    return Array.isArray(roles) ? roles.map(String) : [];
  } catch {
    return [];
  }
};

export interface Run {
  id: RunId;
  repo: string;
  kind: Kind;
  plan: string;
  /** = plan, the same column (D44) */
  group: string;
  title: string;
  link: string | null; // the plan document's URL, opaque (D44)
  state: "open" | "closed";
  seats: Seat[];
  /** The current phase; null until the orchestrator opens one. */
  phase: Phase | null;
  /** Set by `pause`, the orchestrator's reason ("" when it gave none); null when the run is not paused. */
  paused: string | null;
  /** `pause --person`: the pause waits on the person (idea 2). */
  pausedPerson: boolean;
  /** The protocol the run follows, null when it names none. */
  protocol: string | null;
  /** The roles its orchestrator holds (`open --authority`, board-split#D28), [] when it names none. */
  authority: string[];
  /** The branch (else the commit) the repository's checkout stood on at open: a code run's worktrees branch from it; null before it was recorded. */
  base: string | null;
  /** The pack its kind gives a member by default (board-split#D22); null: core only. What a run's close and an
   *  interface change are judged by; a member's verbs read the member's own `pack` (D11). */
  kindPack: string | null;
}

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
  /** board-split D30, D60: parked by the orchestrator; its own calls answer parked first. */
  parked: boolean;
  /** The folder it works in, registered at join (a code member's worktree); null for the orchestrator or a member with no pack. */
  place: string | null;
  /** A `wait --mentions` of this participant is pending (D49, D61). */
  listening: boolean;
  /** The events that wake its `wait --mentions`, besides mentions and urgent posts (D59). */
  subscriptions: Subscription[];
  /** Its pack, chosen once at join from the registry (board-split#D11, D22); null: core only. A row from before reads
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

export interface RosterEntry {
  name: string;
  nick: string;
  run: RunId;
  plan: string;
  seat: string;
  doing: string;
  files: Declared[];
  /** The claims it holds now (F27), repository-relative. */
  held: Declared[];
  /** S28: the paths it ever claimed, released ones included; a declared file among them is no longer waited on. */
  everClaimed: string[];
  /** board-split D36: its trouble beside its state (lost, blocked), null when none. */
  badge: Badge | null;
  subscriptions: Subscription[];
  worktree: string | null; // AGENTS EXCEPTION (rule D24): the roster's JSON key, frozen (answers unchanged); its member's place, null for a seat or an orchestrator (D64)
  /** Its one state (working, stopped, away, lost, ended); what it does is `activity`. */
  state: SnapshotMemberState;
  /** Parked by the orchestrator (its state reads away); absent when not. */
  parked?: true;
  /** D34 (T36): the phase a parked member sleeps until, when its park named one. */
  parkedUntil?: string;
  /** What its pack says of it now (D36); absent when nothing. */
  fact?: MemberFact;
  activity: string | null;
  /** Its two ages (swarm-relay D38), ms epoch: its last progress, its last sign of life by its link (null: never linked). */
  progressAt: number | null;
  aliveAt: number | null;
  /** Messages for it (a mention, an urgent post, an event it subscribed to) not yet delivered to it (swarm-relay D43). */
  unread: number;
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
  /** The board event it is, as posted (D59); null on a plain post and on rows from before. */
  event: EventName | null;
  /** On delivery only, to a holder of `about` when a member that did not hold it posted about it:
   *  the agreement that answers it (D62). */
  answer?: string;
  /** A merged event's recipients, or a phase event's name, as data (D11); null elsewhere and on rows from before. */
  meta?: MessageMeta | null;
  /** On post only: the refused claim this post settled (D7). */
  claimed?: { path: string; sharedWith: string[] };
}

/** Mentions in full, the rest one line each. `superseded`: a newer `wait` of the same member
 *  started, so this one returned empty (D64). */
export type Delivery = { full: Message[]; lines: string[]; superseded?: true };

/** What the page draws (D39). */
export type RunSummary = {
  /** `done`/`of`: the open phase's count (D62) when a phase is open; before one, the seats done of the seats */
  run: number; kind: Kind; plan: string; group: string; code: string; title: string; link: string | null; open: boolean; members: number; done: number; of: number;
  /** The run's current phase, null until one is opened; absent from a reader before it. */
  phase?: Phase | null;
  /** The current phase's done count, null before the first phase. */
  progress?: PhaseProgress | null;
  /** The run's stall window: a member whose tokens did not move this long reads stopped. */
  stallMs?: number;
  /** The protocol the run follows (build-verify, debate…), null when it names none; absent from a reader before it. */
  protocol?: string | null;
  /** The roles its orchestrator holds (board-split#D28), [] when none; absent from a reader before it. */
  authority?: string[];
  /** The run's pause: its text and whether it waits on the person (`pause --person`); null when not paused; absent from a reader before it. */
  paused?: { text: string; person: boolean } | null;
};
export type RepoSummary = { repo: string; name: string; runs: RunSummary[] };
/** A member's one state (liveness.ts); a pack's fact (merging) is its `fact`, never its state. */
export type SnapshotMemberState = CoreMemberState;
export type SnapshotMember = {
  /** The run the member sat in: a group can hold several runs, its members are told apart by this; absent from a reader before it. */
  run?: number;
  member: string;
  nick: string;
  plan: string;
  seat: string;
  role?: string;
  area?: string;
  doing: string;
  state: SnapshotMemberState;
  /** What its pack says of it now (merging); absent when nothing. */
  fact?: MemberFact;
  /** Deprecated by board-split D36 (the badge says it): no call for STALE_MS; kept for aiview until T16 reads `badge`. */
  stale: boolean;
  /** board-split D36: its trouble beside its state (lost, blocked), reason on hover; null when none, always for a parked or ended member (D30). */
  badge: Badge | null;
  files: (Declared & { shared: boolean })[]; // shared: another live member holds it too (D40)
  joined: string;
  /** When the member ended, stored at `end`; null while it has not (D66). */
  ended: string | null;
  calls: number;
  /** A background `wait --mentions` is pending: the member hears the board while it works (D49). */
  listening: boolean;
  /** Parked by the orchestrator (its state reads away); absent when not. */
  parked?: true;
  /** board-split D34: the phase a parked seat sleeps until (`park --until`); absent when parked with none, or not parked. */
  parkedUntil?: string;
  /** board-split D31, D32: what the member runs now, from its link: its oldest open call and its awaited background
   *  task; absent from a server before it, or with no activity. Times ms epoch. */
  activity?: {
    /** `label`: the call's own description, `command`: its whole command (D45); null when the transcript gave none */
    open: { name: string; target: string; since: number; boardWait: boolean; label: string | null; command: string | null } | null;
    background: { target: string; since: number; outputGrewAt: number | null; label: string | null; command: string | null } | null;
  };
  /** Its subscriptions, as `formatSubscriptions` writes each (D59). */
  on: string[];
  /** Its last call to the board, else when it joined (D20: quiet n min). */
  lastCall: string;
  /** Its token counter; absent from a reader before it. */
  liveness?: Liveness;
  /** Messages for it not yet delivered (swarm-relay D43); absent from a reader before it. */
  unread?: number;
};
/** A phase event's name, as data: `phase <name> <text>` stores `<name>`. */
export type PhaseMeta = { phase: string };
/** An unlocked event's data (idea 4): the lock's name. */
export type UnlockedMeta = { unlocked: string };
/** A breach event's data (idea 4): the member, `<group>/<id>`, that killed by name, pattern or an unlocked port. */
export type BreachMeta = { breach: string };
/** A link-down liveness's data, stored by an older server: the member, `<group>/<id>`, whose link was lost while its transcript grew. */
export type LinkDownMeta = { linkDown: string; linkDowns?: string[] };
/** A pause event's data (idea 2, B12): whether it waits on the person, and its text. */
export type PauseMeta = { person: boolean; text: string };
/** What an event carries as data, by its event: merged, phase, stalled, a link-down liveness or a pause. */
export type MessageMeta = PackMessageMeta | PhaseMeta | LinkDownMeta | PauseMeta | UnlockedMeta | BreachMeta;
/** `event`, `mentions`, `meta`: absent on rows written before D11. */
export type SnapshotEvent = {
  seq: number;
  at: string;
  kind: MessageKind;
  from: string;
  body: string;
  about: string | null;
  /** The author's run; an old main row (stored null) reads its author's run (D13). */
  run: RunId;
  /** Kept beside `run`, equal to it, for the page until it reads `run`. */
  channel: RunId;
  event?: EventName | null;
  mentions?: string[];
  meta?: MessageMeta | null;
  /** board-split D51: the member, `<group>/<id>`, a board alarm tells of; absent on any other item or an alarm about a run. */
  subject?: string;
};
/** board-split D51: the board's own alarms about a member. Stored under the orchestrator's row (its run, its wake), they
 *  are always served as the board's (`from: swarm`), never the orchestrator's (D51 over D36), with the member they tell of as `subject`. */
export const BOARD_ALARMS: ReadonlySet<string> = new Set(["stopped", "lost", "gone", "stalled"]);
export { BOARD_AUTHOR };
/** The member a board alarm tells of: an older stall's member in its run's group, a lost link's member, else the body's head. */
function alarmSubjectOf(m: Message): string | null {
  const meta = m.meta as Record<string, unknown> | null | undefined;
  const group = m.from.split("/")[0];
  if (meta && typeof meta.rule === "string" && typeof meta.member === "string") return `${group}/${meta.member}`;
  if (meta && typeof meta.linkDown === "string") return meta.linkDown;
  // `lost <group>/<id>: …`; a swarm stopped (`stopped <group>: …`) names none
  const head = /^\S+ (\S+?\/\S+?):? /.exec(m.body)?.[1];
  return head ?? null;
}
export type QueueSeat = { seat: string; role?: string; area?: string; link: string | null; state: string; blockers: string[]; member: string | null };
/** The edit goes through; `notice` names the other holders the first time only, per member and path. */
export type EditAllowed = { allowed: true; sharedWith: { member: string; doing: string }[]; notice: string | null };
/** The edit is held (D41): another member holds `path`; the answer module words the post to make (board-split V-13). */
export type EditHeld = { allowed: false; path: string; holders: { member: string; nick: string; doing: string }[] };
export type { LockTurn, SnapshotFile } from "../packs/registry.ts";
/** One project as the page reads it: the core's fields and the pack's (board-split#D18). */
export type BoardSnapshot = PackSnapshotFields & {
  repo: string;
  name: string;
  runs: RunSummary[];
  roster: SnapshotMember[];
  events: SnapshotEvent[];
  queues: Record<string, QueueSeat[]>;
};

export interface Board {
  /** `kind` defaults to plan; throws on an unknown kind. The group is stored as the plan (D44). */
  /** `transcript`: the orchestrator's, registered at once; none posts a liveness warning. `stallMs`: the run's stall window, default 5 min (board-split D54). */
  openRun(input: { repo: string; kind?: Kind; group: string; title: string; link?: string | null; seats: SeatSpec[]; transcript?: string | null; stallMs?: number; protocol?: string | null; authority?: string[]; base?: string | null }): Run;
  /** `done` also releases the seat member's claims and lock: the orchestrator's way to free a stale member. */
  /** A seat added mid-run (D60): after the last, `ready`; refused on an id already in the run, an
   *  unknown blocker or a closed run. Posts an event with the run. */
  addSeat(run: RunId, spec: SeatSpec): Seat;
  /** Also archives the run: read-only from then on, `run <n> is closed` (D19). Posts the `closed` event with the run, before it closes (D67). */
  closeRun(run: RunId): void;
  /** The orchestrator opens phase `name` with `text`, the current one ending with it: a `phase` event in its run,
   *  body `phase <name>: <text>`, mentioning `<group>/*` so every member of the run wakes; sets the run's
   *  current phase and clears its done marks. Refused to anyone else and on a closed run, whatever the kind.
   *  `stillOwed`: the members that owed the phase it replaces, not done (board-split D62, V-6). */
  phase(p: Participant, name: string, text: string, opts?: { watch?: string[]; for?: string[] }): Message & { stillOwed: string[] };
  /** True when `p`, a member, has nothing to do: its last two `wait --mentions` in a row returned empty on their hold,
   *  and it owes no phase part and holds no claim (an unread mention would have ended the wait). */
  idle(p: Participant): boolean;
  /** How many undelivered messages wake `p` (mentions, urgent posts, its subscribed events): `end` refuses while any. */
  unreadMentions(p: Participant): number;
  /** Of `guides`, those not yet named to `p`, now marked named: a guide is told to a member once. */
  guidesUntold(p: Participant, guides: string[]): string[];
  /** The run's current phase, as `phase` last set it; null until one is opened. Throws on an unknown run. */
  currentPhase(run: RunId): Phase | null;
  /** The current phase for `p`'s header (B15): `first` the first time it is asked for this member since the phase
   *  opened, recorded here; null when no phase is open. */
  showPhase(p: Participant): { phase: Phase; first: boolean } | null;
  /** The orchestrator pauses its run: every member is told to stop and wait, a `pause` event mentioning
   *  `<group>/*`; claim and merge-lock are refused until `resume`. Refused to anyone else, on a closed run and
   *  on a run already paused. */
  pause(p: Participant, text?: string, opts?: { person?: boolean }): Message;
  /** The orchestrator lifts the pause: a `resume` event mentioning `<group>/*`, its body the message when given.
   *  Refused to anyone else, on a closed run and on a run not paused. */
  resume(p: Participant, text?: string): Message & { held: string[] };
  /** The run's pause reason ("" when none was given), null when it is not paused. Throws on an unknown run. */
  pausedOf(run: RunId): string | null;
  /** board-split D30: the orchestrator parks a seat of its run: the member is parked, told to end its turn without
   *  `end`; it raises no lost or stopped and all-done does not wait for it, until its next
   *  call or `unpark`. Refused to anyone else, on a closed run and on a seat with no live member. */
  park(p: Participant, seat: string, until?: string): Message;
  /** The orchestrator lifts a park; refused on a seat not parked. */
  unpark(p: Participant, seat: string): Message;
  /** board-split D44: the orchestrator marks a seat of its run blocked on the person, `reason` its badge's reason: a
   *  `block` event mentioning the seat. Refused to anyone else, on a closed run, a seat with no live member, an empty reason. */
  block(p: Participant, seat: string, reason: string): Message;
  /** The orchestrator lifts a block: an `unblock` event mentioning the seat; refused on a seat not blocked. */
  unblock(p: Participant, seat: string): Message;
  /** A member finished the current phase `name`: stored once per run, member and phase, a `done` event to the
   *  orchestrator; when every member is done, one `all-done` event to it. Refused to the orchestrator, before any
   *  phase and on a phase that is not the current one. `already`: it had run done for it before (no event). */
  /** `unmerged`: the member's branch holding work not merged (board-split D63), carried in the done's body.
   *  `owesNow`: for a late done, the phase the member owes now (D62, V-5). `notOwed`: why the open phase's count leaves
   *  this member out, parked or not in its --for seats (D62, V-28); null when it is counted. */
  done(p: Participant, name: string, opts?: { unmerged?: string }): { progress: PhaseProgress; all: boolean; already: boolean; late: boolean; owesNow: string | null; notOwed: NotOwed; message: Message | null };
  /** The current phase's done count; null before the first phase. */
  phaseProgress(run: RunId): PhaseProgress | null;
  /** The run's last activity, ISO: its open, a member's join or call, a message by one of its members. Throws on an unknown run. */
  lastActivity(run: RunId): string;
  /** The run's current phase when `p` owes it: a member (not the orchestrator), not ended, that has not run
   *  `done` for it; null otherwise, and before the first phase. */
  owedPhase(p: Participant): Phase | null;
  /** A member's link sent its activity (`member`: its seat or seat id, or `orchestrator`): its row in
   *  member_activity and a token reading. Ignored for a closed run or a member not live in it. */
  recordActivity(run: RunId, member: string, a: MemberActivity, at: Date): void;
  /** Every live member's state at `at` (D9, D31), through the presence the server's tick last gave. */
  memberStates(run: RunId, at: Date): MemberState[];
  /** One tick of the server (D13): states from activity and presence; `lost <member>` once per episode (D12);
   *  `stopped <group>` once when no member's tokens moved for the run's stall window. False when the run is closed or unknown. */
  livenessTick(run: RunId, at: Date, presence: Presence): boolean;
  /** Past the retention: closed runs (closed_at older), their seats, members not referenced by a
   *  kept message, their channels and deliveries; main messages older, agreements and the
   *  endorsements of kept agreements kept. Open runs never. The run's row stays, stamped `pruned_at`,
   *  never listed, so its id is never reused (D61). `now` for tests (D19, D20). */
  prune(now?: Date): { messages: number; runs: number };
  /** Reads, or writes then reads, a board setting. retention-days: a positive integer, default 30 (D32). */
  setting(name: "retention-days", value?: number): number;
  /** The board's upkeep when due (D16): `prune`, when the last upkeep, kept in the
   *  store for every process, is older than UPKEEP_EVERY_MS. The time is recorded first, so a
   *  process due at the same moment skips, and a failure waits for the next due upkeep. True when it ran. */
  upkeepIfDue(now?: Date): boolean;
  /** The open runs, every project. */
  runs(): Run[];

  /** `place` is ignored when the member has no pack; `files` are refused when it has no claims.
   *  Declared files become claims where free (*interface* or *inside*); a held one stays declared only. */
  /** `on`, else the seat row's `on`, else the kind's defaults for a member (D59). */
  join(input: { run: RunId; seat: string; doing: string; files: Declared[]; place?: string; on?: Subscription[] }): {
    member: Participant;
    roster: RosterEntry[];
    composition: Composition;
  };
  /** The run's composition now (D3): the orchestrator, then every declared seat in order. */
  composition(run: RunId): Composition;
  /** "<plan>/<seat>" or "<plan>/orchestrator"; `repo`: the caller's project, whose run of that group is taken first (D58). */
  participant(name: string, repo?: string | null): Participant | null;
  /** Who is calling (D28): the one live member whose place holds `place` (the caller's folder). */
  identify(who: { place?: string }): Participant | null;
  setDoing(p: Participant, doing: string): void;
  /** Adds to the member's subscriptions; returns them after (D59). */
  subscribe(p: Participant, subs: Subscription[]): Subscription[];
  unsubscribe(p: Participant, subs: Subscription[]): Subscription[];
  /** Ends the member and releases its claims and any merge lock it holds; its doing becomes
   *  "merged and ended" when it merged since it joined, else "ended" (D66). */
  end(p: Participant): void;
  roster(repo: string): RosterEntry[];
  /** Members of the project's open runs who have ended, as `<plan>/<seat>`: a mention of one reaches nobody. */
  endedMembers(repo: string): string[];
  /** The repository-relative paths `p` holds a claim on now. */
  heldBy(p: Participant): string[];

  /** Stored with the author's run, always (plan D1, D13). */
  /** `with`: an agreement's explicit parties, as seats or `<plan>/<seat>` (F25). */
  /** `task` (board-split D50): the orchestrator's task to the one member it mentions, recorded as that member's task
   *  for the open phase; a post without it never becomes a task. */
  post(p: Participant, body: string, opts?: { about?: string; kind?: MessageKind; with?: string[] }): Message;
  /** An agreement backed; throws on a message that is not an agreement, or on one's own. */
  endorse(p: Participant, seq: number): Message;
  /** `by`: the member reading, when known, counted as a call of its own (D66). */
  read(seq: number, by?: Participant): Message;
  /** Every post of `p`'s run since its phase `name` was last opened (its current phase when omitted), events left
   *  out: the whole discussion a member reads before it decides or adds to it. Empty before the first phase. */
  thread(p: Participant, name?: string): Message[];
  /** A run read from outside it, open or closed, by no member (G30): its phase `name`, or every post of the run when
   *  omitted, events left out. Reads only; counts no call. */
  runThread(run: RunId, name?: string): Message[];
  deliver(p: Participant): Delivery; // own run's items + what wakes p from any run (plan D2); undelivered since last time; marks them delivered; stamps the last call
  /** The first delivery, or empty on timeout or once `p` has ended (D49). `mentionsOnly`: only a
   *  message that mentions `p`, is urgent, or is an event `p` subscribed to (D59) ends it, and only those are marked delivered; the rest
   *  stays for the next `deliver`. A member has one live wait (D64): a newer `wait` of `p`, from
   *  any process, makes this one return at once, empty, with `superseded`. */
  /** `signal`: aborting it ends the wait at once, empty, its waiting cleared (swarm-relay D16). */
  wait(p: Participant, opts?: { timeoutMs?: number; mentionsOnly?: boolean; signal?: AbortSignal }): Promise<Delivery>;
  /** What is for `p` now (a mention, an urgent post, an event it subscribed to), never blocking: marked delivered, the rest
   *  left for `deliver`. The delivery hook's call at each tool call and each stop of the member's agent (swarm-relay D43). */
  deliverMentions(p: Participant): Delivery;

  /** A pack verb's server side (board-split#D9, D19): the member's pack answers, before any transaction, with facts or a
   *  `PackRefusal`; `p` null for a call no member makes (a seat's place before its join, a close, a prune). */
  packCall(p: Participant | null, verb: string, input: PackVerbInput): unknown;

  // the page (D39)
  /** Every project with an open run or a closed run within the retention (D46); a run kept only as a pruned author never. */
  repos(): RepoSummary[];
  /** Everything the page draws for one project; throws `no project <key>` for one it does not list. */
  snapshot(repo: string): BoardSnapshot;
  /** Called with the project of every write, from this process or any other. Returns the unsubscribe. */
  onChange(listener: (repo: string) => void): () => void;

  close(): void;

  /** A member's link connected, or lost at `lostAt` (ms epoch): kept in the store, so presence outlives a
   *  server restart (swarm-relay D37). */
  recordLink(run: RunId, member: string, link: LinkFact): void;
  /** Every link the store keeps, as the last server left them: read by a server at its start (D37). */
  savedLinks(): ({ run: RunId; member: string } & LinkFact)[];
  /** board-split D55: the board server started at `at` (ms epoch): no member is lost within LOST_MS of it. */
  recordServerUp(at: number): void;
}

/** A phase's name: one word. */
const PHASE_NAME = /^[\w.-]+$/;

/** board-split D36: a seat's state from its member, never stored: the `seats.state` column predating it is left unread.
 *  A correlated subquery over a seats row aliased `s`. */
const SEAT_STATE_SQL = `(SELECT CASE WHEN p.id IS NULL OR p.parked = 1 OR (p.ended_at IS NOT NULL AND p.idle_ended = 1) THEN 'ready' WHEN p.ended_at IS NULL THEN 'running' ELSE 'done' END
  FROM (SELECT 1) LEFT JOIN participants p ON p.run = s.run AND p.seat = s.id)`;
/** V-16: the closed run a seat stands for: a run of the same project whose group is the seat's id (the decisions run
 *  seats one per authority run, named for its group), when the latest of that group is closed; else NULL. A correlated
 *  subquery over a seats row aliased `s`. */
const SEAT_STOOD_FOR_CLOSED_SQL = `(SELECT CASE WHEN o.state = 'closed' THEN o.id END FROM runs o
  WHERE o.repo = (SELECT repo FROM runs WHERE id = s.run) AND o.plan = s.id AND o.id != s.run ORDER BY (o.state = 'open') DESC, o.id DESC LIMIT 1)`;
/** The events a member receives though it is their author: the board posts them in its name. */
const TO_AUTHOR = Object.values(EVENTS).filter((e) => e.toAuthor).map((e) => `'${e.name}'`).join(", ");
const ORCHESTRATOR = "orchestrator";
/** A watch event can be missed (a coalesced write, a platform quirk); the store is re-read
 *  this often regardless, so a missed event costs at most this much. */
const WAIT_POLL_MS = 1000;
/** G31: liveness alerts due within this window after one told are held and told together. */
const ALERT_WINDOW_MS = 10 * 1000;
const LINE_WIDTH = 100;
const STALE_MS = 10 * 60 * 1000;
/** A pending wait's looks are logged in call_log at most this often: well under STALE_MS, never a row per tick. */
const WAIT_LOG_EVERY_MS = 60 * 1000;
/** The board's upkeep runs at most this often, from any process (D16). */
export const UPKEEP_EVERY_MS = 5 * 60 * 1000;
/** The settings row holding the last upkeep's time, ISO: the board's own, never a user setting. */
const LAST_UPKEEP = "last-upkeep";
/** The settings row holding when the analytics records began, ISO: the board's own (D33). */
const RETENTION_DEFAULT_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
/** The page shows the last this many messages of a thread. */
const EVENTS_SHOWN = 500;
const CASELESS = process.platform === "win32";

type Row = Record<string, unknown>;

/** One line for a message a member was not named in. */
export function messageLine(m: Message): string {
  const first = m.body.split(/\r?\n/)[0];
  const text = first.length > LINE_WIDTH ? `${first.slice(0, LINE_WIDTH - 1)}…` : first;
  const kind = m.kind === "msg" ? "" : ` (${m.kind})`;
  const about = m.about ? ` about ${m.about}` : "";
  return `#${m.seq} ${m.from}${kind}${about}: ${text}`;
}

export async function openBoard(dbPath: string = SQLITE_PATH): Promise<Board> {
  // node:sqlite prints an ExperimentalWarning on import; keep every other warning. Imported
  // here, not at module load, so a verb that never opens the store never pays for it.
  process.removeAllListeners("warning");
  process.on("warning", (w) => {
    if (w.name !== "ExperimentalWarning") console.warn(w);
  });
  const { DatabaseSync } = await import("node:sqlite");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  // the busy timeout set at open, not by the pragma below: the first reads already need it, and
  // without it a verb that opens while another process writes fails outright with SQLITE_BUSY
  const db = new DatabaseSync(dbPath, { timeout: 5000 });
  // D16: a store from before the seat vocabulary: table `slices` is `seats`, `participants.slice` is `seat`, a seat has no title
  const hasTable = (name: string): boolean => db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;
  const columnsOf = (table: string): string[] => (db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map((c) => String(c.name));
  if (hasTable("slices") && !hasTable("seats")) db.exec("ALTER TABLE slices RENAME TO seats");
  if (hasTable("seats") && columnsOf("seats").includes("title")) db.exec("ALTER TABLE seats DROP COLUMN title");
  if (hasTable("participants") && columnsOf("participants").includes("slice")) db.exec("ALTER TABLE participants RENAME COLUMN slice TO seat");
  // board-split T12 (D18): a member's working folder is its neutral `place`; a store from before named the column for the code pack
  if (hasTable("participants") && columnsOf("participants").includes("worktree") && !columnsOf("participants").includes("place")) db.exec("ALTER TABLE participants RENAME COLUMN worktree TO place"); // AGENTS EXCEPTION (rule D24): the old column's name, read once to rename it
  db.exec(`
    PRAGMA journal_mode = DELETE;
    -- Several CLI processes write, and aiview reads, concurrently; without a busy timeout a
    -- concurrent verb fails outright with SQLITE_BUSY.
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY,
      repo TEXT NOT NULL,
      plan TEXT NOT NULL,
      title TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'open',
      opened_at TEXT NOT NULL,
      closed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS seats (
      run INTEGER NOT NULL,
      id TEXT NOT NULL,
      role TEXT,
      area TEXT,
      blockers TEXT NOT NULL DEFAULT '[]',
      state TEXT NOT NULL DEFAULT 'ready',
      ord INTEGER NOT NULL,
      PRIMARY KEY (run, id)
    );
    CREATE TABLE IF NOT EXISTS participants (
      id INTEGER PRIMARY KEY,
      run INTEGER NOT NULL,
      seat TEXT NOT NULL,
      place TEXT,
      doing TEXT NOT NULL DEFAULT '',
      files TEXT NOT NULL DEFAULT '[]',
      since_seq INTEGER NOT NULL DEFAULT 0,
      joined_at TEXT NOT NULL,
      ended_at TEXT,
      last_call TEXT,
      UNIQUE (run, seat)
    );
    CREATE TABLE IF NOT EXISTS messages (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      repo TEXT NOT NULL,
      author INTEGER NOT NULL,
      body TEXT NOT NULL,
      about TEXT,
      kind TEXT NOT NULL DEFAULT 'msg',
      mentions TEXT NOT NULL DEFAULT '[]',
      at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_repo ON messages (repo, seq);
    CREATE TABLE IF NOT EXISTS deliveries (
      participant INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      PRIMARY KEY (participant, seq)
    );
    -- a version per project, moved by every write: what onChange compares (D39)
    CREATE TABLE IF NOT EXISTS changes (
      repo TEXT PRIMARY KEY,
      version INTEGER NOT NULL
    );
    -- one row per counted call, written by countCall in the verb's transaction (D25); deleted with its run
    CREATE TABLE IF NOT EXISTS call_log (participant INTEGER NOT NULL, at TEXT NOT NULL, verb TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS call_log_by_participant ON call_log (participant, at);
    -- board settings (D32): retention-days; the board's own last-upkeep (D16)
    CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value TEXT NOT NULL);
    -- the identities and hook_seen tables, left in stores from before D58, are no longer read or written
    -- a member done with a phase, once per run, member and phase; a phase opened again clears its rows
    CREATE TABLE IF NOT EXISTS phase_done (run INTEGER NOT NULL, participant INTEGER NOT NULL, phase TEXT NOT NULL, at TEXT NOT NULL,
      PRIMARY KEY (run, participant, phase));
    -- a member's transcript (member: its seat id, or orchestrator) and where its token counter stands
    CREATE TABLE IF NOT EXISTS transcripts (run INTEGER NOT NULL, member TEXT NOT NULL, path TEXT NOT NULL, adapter TEXT,
      offset INTEGER NOT NULL DEFAULT 0, tokens INTEGER NOT NULL DEFAULT 0, readable INTEGER NOT NULL DEFAULT 0,
      read_at TEXT, moved_at TEXT, PRIMARY KEY (run, member));
    -- the poller's readings, pruned past READINGS_KEPT_MS
    CREATE TABLE IF NOT EXISTS token_readings (run INTEGER NOT NULL, member TEXT NOT NULL, t TEXT NOT NULL, tokens INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS token_readings_by_run ON token_readings (run, t);
    -- a liveness warning posted, once per member and condition (none, unreadable); a good read clears unreadable
    CREATE TABLE IF NOT EXISTS liveness_warned (run INTEGER NOT NULL, member TEXT NOT NULL, cond TEXT NOT NULL, PRIMARY KEY (run, member, cond));
    -- board-split D55: a member's lost or stalled episode: pending at its predicate's first tick, opened at the second
    -- (its alarm), closed when the predicate is false (recovered), or at park or end
    CREATE TABLE IF NOT EXISTS badge_episodes (run INTEGER NOT NULL, member TEXT NOT NULL, badge TEXT NOT NULL, pending_at INTEGER NOT NULL, opened_at INTEGER, closed_at INTEGER);
    CREATE INDEX IF NOT EXISTS badge_episodes_open ON badge_episodes (run, member, badge, closed_at);
    -- a member's latest activity, from its link's frames (swarm-relay D9);
    CREATE TABLE IF NOT EXISTS member_activity (
      run INTEGER NOT NULL, member TEXT NOT NULL,
      grew_at INTEGER, tokens INTEGER NOT NULL DEFAULT 0, context INTEGER,
      open_tool TEXT, open_target TEXT, open_since INTEGER, last_tool TEXT,
      finished INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL,
      PRIMARY KEY (run, member));
    -- a member's link as the server last saw it: connected, else lost since lost_at (ms epoch); swarm-relay D37
    CREATE TABLE IF NOT EXISTS member_links (
      run INTEGER NOT NULL, member TEXT NOT NULL, connected INTEGER NOT NULL, lost_at INTEGER,
      PRIMARY KEY (run, member));
    -- board-split D55: the board server's own facts (server_up_at, ms epoch)
    CREATE TABLE IF NOT EXISTS server_facts (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
  `);
  // Schema upkeep for stores created by earlier versions: add a column when it is missing.
  const upkeep = (table: string, column: string, ddl: string): void => {
    const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };
  upkeep("participants", "place", "place TEXT");
  // board-split D55: a link's last heartbeat and its drop cause
  upkeep("member_links", "seen_at", "seen_at INTEGER");
  upkeep("member_links", "cause", "cause TEXT");
  upkeep("participants", "last_call", "last_call TEXT");
  upkeep("participants", "calls", "calls INTEGER NOT NULL DEFAULT 0");
  upkeep("participants", "waiting", "waiting INTEGER NOT NULL DEFAULT 0");
  upkeep("member_activity", "open_wait", "open_wait INTEGER NOT NULL DEFAULT 0");
  // 1 while a `wait --mentions` is pending: a listener, not a wait (D49)
  upkeep("participants", "listening", "listening INTEGER NOT NULL DEFAULT 0");
  upkeep("participants", "nick", "nick TEXT");
  // the member's pack and verify setting, chosen at join (board-split#D11, D22); pack_chosen 0 on a row from before,
  // read as its kind's default
  upkeep("participants", "pack", "pack TEXT");
  upkeep("participants", "verify", "verify INTEGER NOT NULL DEFAULT 0");
  upkeep("participants", "pack_chosen", "pack_chosen INTEGER NOT NULL DEFAULT 0");
  // moved by every `wait` start: a pending wait whose number is no longer this one is superseded (D64)
  upkeep("participants", "wait_gen", "wait_gen INTEGER NOT NULL DEFAULT 0");
  // 1: written by the board itself in a member's name (a flag, a merge notice), never a member's own word
  upkeep("messages", "by_board", "by_board INTEGER NOT NULL DEFAULT 0");
  upkeep("runs", "link", "link TEXT");
  // a board event's data beside its text: a merged event's recipients (D11)
  upkeep("messages", "meta", "meta TEXT");
  upkeep("seats", "link", "link TEXT");
  upkeep("seats", "role", "role TEXT");
  upkeep("seats", "area", "area TEXT");
  // what kind of work a run is (D25); a run from before is a plan run
  upkeep("runs", "kind", "kind TEXT NOT NULL DEFAULT 'plan'");
  // a message's run (D31, plan D13): its author's run; null on an old main row, read as its author's run
  upkeep("messages", "run", "run INTEGER");
  upkeep("messages", "endorses", "endorses INTEGER");
  // 1 once the run's stale event is in main; any member call resets it (D19)
  upkeep("runs", "stale_flagged", "stale_flagged INTEGER NOT NULL DEFAULT 0");
  // 1 once an orchestrator's quiet event is posted; its next call posts back and resets it (D15)
  // the member's last post, done or doing (swarm-relay D36)
  upkeep("participants", "progress_at", "progress_at TEXT");
  // board-split D49: the member's last board call that is not a self-report (a post, `doing`, an endorsement): what a
  // stall is measured from out of a wait
  upkeep("participants", "board_call_at", "board_call_at TEXT");
  upkeep("participants", "quiet_flagged", "quiet_flagged INTEGER NOT NULL DEFAULT 0");
  // simple-states: whether the member owed the open phase when its link dropped (1/0); null while its link is up
  upkeep("participants", "dropped_owing", "dropped_owing INTEGER");
  // set when prune removed the run's contents; the row stays so its id is never reused (D61): never listed
  upkeep("runs", "pruned_at", "pruned_at TEXT");
  // the board event a message is (D59); null on plain posts and rows from before
  upkeep("messages", "event", "event TEXT");
  // board-split D54: when a message was delivered to its member, so a task's owing clock starts at its delivery
  upkeep("deliveries", "at", "at TEXT");
  // a member's subscriptions, JSON (D59)
  upkeep("participants", "subs", "subs TEXT NOT NULL DEFAULT '[]'");
  // board-split D55 (amended, U-F27): since when an open episode's predicate reads false, its close pending
  upkeep("badge_episodes", "clearing_at", "clearing_at INTEGER");
  // the seats file's `on`, JSON (D59)
  upkeep("seats", "on_events", "on_events TEXT");
  // the run's current phase, set by `phase`: its name and its text; null until one is opened
  upkeep("runs", "phase", "phase TEXT");
  upkeep("runs", "phase_text", "phase_text TEXT");
  // set by pause, the orchestrator's reason; null when the run is not paused
  upkeep("runs", "paused", "paused TEXT");
  // when resume last lifted a pause: the stall check counts silence from it, never through the pause
  upkeep("runs", "resumed_at", "resumed_at TEXT");
  // the run's stall threshold, and the stalled events posted since a counter last moved
  upkeep("runs", "stall_ms", `stall_ms INTEGER NOT NULL DEFAULT ${STALL_MS_DEFAULT}`);
  upkeep("runs", "protocol", "protocol TEXT");
  // board-split#D28: the roles the run's orchestrator holds, a JSON array; null on an old row reads as []
  upkeep("runs", "authority", "authority TEXT");
  // the branch a code run's worktrees branch from, recorded at open
  upkeep("runs", "base", "base TEXT");
  upkeep("runs", "stall_posts", "stall_posts INTEGER NOT NULL DEFAULT 0");
  // idea 2: a pause waiting on the person; the current phase's watched members (JSON ids); the phase a member was last shown
  upkeep("runs", "paused_person", "paused_person INTEGER NOT NULL DEFAULT 0");
  upkeep("runs", "phase_watch", "phase_watch TEXT");
  upkeep("participants", "phase_shown", "phase_shown TEXT");
  // the seats the current phase is for (`phase --for`, JSON ids); null: every member
  upkeep("runs", "phase_for", "phase_for TEXT");
  // board-split D49: when the current phase opened; a member owes it, and can stall on it, only from then
  upkeep("runs", "phase_at", "phase_at TEXT");
  // the member's `wait --mentions` that returned empty on their hold, in a row: two while it owes nothing make it idle
  upkeep("participants", "empty_waits", "empty_waits INTEGER NOT NULL DEFAULT 0");
  // ended on an idle answer: the seat stays in the run's later phases, owing until a member is dispatched into it again
  // board-split D48: `idle_ended`, the word the board uses; a store from before named it otherwise
  if (columnsOf("participants").includes("dormant") && !columnsOf("participants").includes("idle_ended")) db.exec("ALTER TABLE participants RENAME COLUMN dormant TO idle_ended"); // AGENTS EXCEPTION (rule D24): the old column's name, read once to rename it
  upkeep("participants", "idle_ended", "idle_ended INTEGER NOT NULL DEFAULT 0");
  // board-split D48 (U-F2): the doing an older server wrote for a park or an unpark is no member's own: cleared
  db.exec("UPDATE participants SET doing = '' WHERE doing = 'unparked' OR doing LIKE 'parked until %' OR doing LIKE 'dormant until %'"); // AGENTS EXCEPTION (rule D24): an older server's words, read once to clear them
  // board-split D30: parked by the orchestrator (`park <seat>`): no alert of any kind, out of all-done, until
  // its next call or `unpark`
  upkeep("participants", "parked", "parked INTEGER NOT NULL DEFAULT 0");
  // S22 (board-split D25): when the seat's current member joined, a re-join included; joined_at keeps the seat's first
  // join. Null on a row from before: read as joined_at
  upkeep("participants", "seated_at", "seated_at TEXT");
  // D34: the phase `park --until` named; null when none was
  upkeep("participants", "parked_until", "parked_until TEXT");
  // board-split D44: `block <seat> <reason>`: the seat waits on the person, the reason its badge's; null when not blocked
  upkeep("participants", "blocked", "blocked TEXT");
  upkeep("participants", "blocked_at", "blocked_at INTEGER");
  // the architecture guides already named to a member, each once
  db.exec("CREATE TABLE IF NOT EXISTS guides_told (participant INTEGER NOT NULL, guide TEXT NOT NULL, PRIMARY KEY (participant, guide))");
  // idea 2: a carried message past CARRY_MAX_MS for a member, marked by the tick: it wakes that member's wait
  db.exec("CREATE TABLE IF NOT EXISTS carry_due (participant INTEGER NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY (participant, seq))");
  // idea 1: the turn state, the last line, the awaited background task and the transcript's path, from the link
  upkeep("member_activity", "in_turn", "in_turn INTEGER");
  upkeep("member_activity", "last_line", "last_line TEXT");
  upkeep("member_activity", "bg_target", "bg_target TEXT");
  upkeep("member_activity", "bg_since", "bg_since INTEGER");
  upkeep("member_activity", "bg_grew_at", "bg_grew_at INTEGER");
  upkeep("member_activity", "transcript", "transcript TEXT");
  // board-split D45: the open call's and the background task's own description and whole command, for the card's line
  upkeep("member_activity", "open_label", "open_label TEXT");
  upkeep("member_activity", "open_command", "open_command TEXT");
  upkeep("member_activity", "bg_label", "bg_label TEXT");
  upkeep("member_activity", "bg_command", "bg_command TEXT");
  // board-split D55: a lost told by an older server (liveness_warned 'gone') is an open lost episode, never told again
  db.exec(`INSERT INTO badge_episodes (run, member, badge, pending_at, opened_at)
             SELECT w.run, w.member, 'lost', 0, 0 FROM liveness_warned w WHERE w.cond = 'gone'
               AND NOT EXISTS (SELECT 1 FROM badge_episodes e WHERE e.run = w.run AND e.member = w.member AND e.badge = 'lost' AND e.closed_at IS NULL);
           DELETE FROM liveness_warned WHERE cond = 'gone';`);
  // D4 (G16): the link's report of the member's background listener; null from an older link, which leaves the in-wait column
  upkeep("member_activity", "listener_running", "listener_running INTEGER");
  upkeep("member_activity", "listener_ended_at", "listener_ended_at INTEGER");
  db.exec("CREATE INDEX IF NOT EXISTS messages_channel ON messages (repo, run, seq)");
  // Waking and watching: every write moves its project's version; once committed, the waits
  // and watchers of this process are woken at once (swarm-relay D14): the server is the one
  // process that writes, so no file carries the wake to another (no `.signal`, D14). The poll
  // stays as the floor.
  const localWakers = new Set<() => void>();
  const touch = (): void => {
    for (const wake of [...localWakers]) queueMicrotask(wake);
  };

  const now = (): string => new Date().toISOString();

  // Re-entrant: an inner call inside an open transaction joins it. The wakers are woken
  // once, after the outermost commit, so a watcher never looks before the write is there.
  let depth = 0;
  let dirty = false;
  const transaction = <T>(fn: () => T): T => {
    if (depth > 0) return fn();
    db.exec("BEGIN IMMEDIATE");
    depth++;
    let ok = false;
    try {
      const out = fn();
      db.exec("COMMIT");
      ok = true;
      return out;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      depth--;
      if (dirty) {
        dirty = false;
        if (ok) touch();
      }
    }
  };
  /** A write to `repo`: its version moves, and the wakers are woken after the commit. */
  const bump = (repo: string): void => {
    db.prepare("INSERT INTO changes (repo, version) VALUES (?, 1) ON CONFLICT (repo) DO UPDATE SET version = version + 1").run(repo);
    if (depth > 0) dirty = true;
    else touch();
  };

  /** Every post of `run` since its phase `phase` was last opened, to the next phase event or to now, events left out. */
  const phasePosts = (run: RunId, phase: string): Message[] => {
    const opened = db
      .prepare("SELECT MAX(seq) AS s FROM messages WHERE run = ? AND event = ? AND json_extract(meta, '$.phase') = ?")
      .get(run, EVENTS.phase.name, phase) as Row;
    if (opened.s == null) throw new Error(`thread: phase ${phase} was never opened in run ${run}`);
    const next = db.prepare("SELECT MIN(seq) AS s FROM messages WHERE run = ? AND event = ? AND seq > ?").get(run, EVENTS.phase.name, Number(opened.s)) as Row;
    return (
      db
        .prepare("SELECT * FROM messages WHERE run = ? AND seq > ? AND seq < ? AND kind != 'event' ORDER BY seq")
        .all(run, Number(opened.s), next.s == null ? Number.MAX_SAFE_INTEGER : Number(next.s)) as Row[]
    ).map(toMessage);
  };

  const runRow = (id: RunId): Row => {
    const r = db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as Row | undefined;
    if (!r) throw new Error(`unknown run ${id}`);
    return r;
  };

  const phaseOf = (r: Row): Phase | null => (r.phase == null ? null : { name: String(r.phase), text: String(r.phase_text ?? "") });

  /** A seat's state: its member's (liveness.ts), `empty` while nobody sat in it; `ended` when it stands for a closed run (V-16). */
  const seatStateOf = (run: Row, seat: string, standsForClosed: boolean): SeatState => {
    if (standsForClosed) return "ended";
    const p = db.prepare("SELECT * FROM participants WHERE run = ? AND seat = ?").get(Number(run.id), seat) as Row | undefined;
    return p ? memberStateOf(p, run) : "empty";
  };
  const toRun = (r: Row): Run => ({
    phase: phaseOf(r),
    paused: r.paused == null ? null : String(r.paused),
    pausedPerson: r.paused != null && Number(r.paused_person ?? 0) === 1,
    protocol: r.protocol == null ? null : String(r.protocol),
    authority: authorityOf(r.authority),
    base: r.base == null ? null : String(r.base),
    kindPack: kindPackOf(String(r.kind ?? "plan")),
    id: Number(r.id),
    repo: String(r.repo),
    kind: profileOf(String(r.kind ?? "plan")).kind,
    plan: String(r.plan),
    group: String(r.plan),
    title: String(r.title),
    link: r.link == null ? null : String(r.link),
    state: r.state === "closed" ? "closed" : "open",
    seats: (db.prepare(`SELECT s.*, ${SEAT_STATE_SQL} AS derived, ${SEAT_STOOD_FOR_CLOSED_SQL} AS stood_for FROM seats s WHERE s.run = ? ORDER BY s.ord`).all(Number(r.id)) as Row[]).map((s) => ({
      id: String(s.id),
      ...(s.role == null ? {} : { role: String(s.role) }),
      ...(s.area == null ? {} : { area: String(s.area) }),
      link: s.link == null ? null : String(s.link),
      blockers: JSON.parse(String(s.blockers)) as string[],
      state: seatStateOf(r, String(s.id), s.stood_for != null),
    })),
  });

  /** A store from before D43 has members with no funny name: their seat stands in (an orchestrator's before plan D17 too). */
  const nickOf = (r: Row): string => (r.nick == null ? String(r.seat) : String(r.nick));

  /** A subscription stored scoped `main` (before plan D1) reads as `any`. */
  /** A funny name no active member of the project carries (D43, plan D17), kept for the run. */
  const unusedNick = (repo: string): string => {
    const rows = db.prepare(`${PARTICIPANT_SQL} WHERE r.repo = ? AND r.state = 'open' AND p.ended_at IS NULL`).all(repo) as Row[];
    return funnyName(rows.map(nickOf));
  };

  const subsOf = (r: Row): Subscription[] =>
    (JSON.parse(String(r.subs ?? "[]")) as { event: Subscription["event"]; scope: string; carry?: boolean }[]).map((x) => ({
      event: currentEventName(x.event) as Subscription["event"], // board-split D36: a stored old name reads as its new one
      scope: x.scope === "run" ? "run" : "any",
      ...(x.carry === true ? { carry: true as const } : {}),
    }));

  /** The pack a run of `kind` gives a member by default (D22): a member from before the registry, an orchestrator,
   *  a run's close. A member's verbs read its own `pack` (D11, D12). */
  const kindPackOf = (kind: string): string | null => registry.forMember(kind, null).pack?.name ?? null;

  const PARTICIPANT_SQL = `SELECT p.*, r.repo, r.plan, r.kind, a.listener_running, a.listener_ended_at FROM participants p JOIN runs r ON r.id = p.run
    LEFT JOIN member_activity a ON a.run = p.run AND a.member = p.seat`;
  /** D4 (G16), V3: the member listens while its link reports a background listener running, or while a `wait --mentions`
   *  of its own is held (a foreground one too); a listener whose task ended without a re-arm is no listener. */
  const listensNow = (r: Row): boolean => Number(r.listening) === 1 || Number(r.listener_running) === 1;

  const toParticipant = (r: Row): Participant => ({
    id: Number(r.id),
    run: Number(r.run),
    repo: String(r.repo),
    kind: profileOf(String(r.kind ?? "plan")).kind,
    plan: String(r.plan),
    seat: String(r.seat),
    name: `${r.plan}/${r.seat}`,
    nick: nickOf(r),
    ended: r.ended_at != null,
    parked: Number(r.parked ?? 0) === 1,
    place: r.place == null ? null : String(r.place),
    listening: listensNow(r),
    subscriptions: subsOf(r),
    // pack_chosen 0: a member from before the registry (or an orchestrator), read as its kind's default (D22)
    ...(Number(r.pack_chosen ?? 0) === 1
      ? { pack: r.pack == null ? null : String(r.pack), verify: Number(r.verify) === 1 }
      : { pack: kindPackOf(String(r.kind ?? "plan")), verify: registry.forMember(String(r.kind ?? "plan"), null).verify }),
    kindPack: kindPackOf(String(r.kind ?? "plan")),
  });

  const participantById = (id: number): Participant => toParticipant(db.prepare(`${PARTICIPANT_SQL} WHERE p.id = ?`).get(id) as Row);

  const toMessage = (r: Row): Message => {
    const author = participantById(Number(r.author));
    return {
    seq: Number(r.seq),
    repo: String(r.repo),
    from: author.name,
    body: String(r.body),
    about: r.about == null ? null : String(r.about),
    kind: String(r.kind) as MessageKind,
    mentions: JSON.parse(String(r.mentions)) as string[],
    at: String(r.at),
    // an old main row (null) is labelled with its author's run (plan D13)
    run: r.run == null ? author.run : Number(r.run),
    endorses: r.endorses == null ? null : Number(r.endorses),
    event: r.event == null || !isEvent(currentEventName(String(r.event))) ? null : (currentEventName(String(r.event)) as EventName),
    meta: r.meta == null ? null : (JSON.parse(String(r.meta)) as MessageMeta),
    };
  };

  const lastSeq = (): number => Number((db.prepare("SELECT COALESCE(MAX(seq), 0) AS s FROM messages").get() as Row).s);

  const openPlans = (repo: string): string[] =>
    (db.prepare("SELECT DISTINCT plan FROM runs WHERE repo = ? AND state = 'open'").all(repo) as Row[]).map((r) => String(r.plan));

  /** The project's active members: their funny names, as a mention writes them, to their names (D43). */
  const activeNames = (repo: string): Map<string, string> => {
    const rows = db
      .prepare(`${PARTICIPANT_SQL} WHERE r.repo = ? AND r.state = 'open' AND p.ended_at IS NULL AND p.seat != '${ORCHESTRATOR}'`)
      .all(repo) as Row[];
    return new Map(rows.map((r) => [nameHandle(nickOf(r)), `${r.plan}/${r.seat}`]));
  };

  /** `named` overrides mention parsing: the board's own notices name their targets. */
  const insertMessage = (
    p: Participant,
    body: string,
    about: string | null,
    kind: MessageKind,
    named?: string[],
    extra: { endorses?: number; event?: EventName; meta?: MessageMeta; parties?: string[] } = {},
  ): Message => {
    const mentions = named ?? extra.parties ?? (kind === "event" ? [] : parseMentions(body, p.plan, openPlans(p.repo), activeNames(p.repo)));
    // every item is stored with its author's run (plan D1, D13)
    const run = p.run;
    // a closed run is read-only (D19)
    if (runRow(run).state === "closed") throw new Error(`run ${run} is closed`);
    const r = db
      .prepare("INSERT INTO messages (repo, author, body, about, kind, mentions, at, by_board, run, endorses, event, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(p.repo, p.id, body, about, kind, JSON.stringify(mentions), now(), named ? 1 : 0, run, extra.endorses ?? null, extra.event ?? null, extra.meta ? JSON.stringify(extra.meta) : null);
    const seq = Number(r.lastInsertRowid);
    bump(p.repo);
    return board.read(seq);
  };

  const live = (p: Participant): Participant => {
    const fresh = participantById(p.id);
    if (fresh.ended) throw new Error(`member ${p.name} has ended`);
    return fresh;
  };

  const isLive = (id: number): boolean =>
    db.prepare("SELECT 1 FROM participants p JOIN runs r ON r.id = p.run WHERE p.id = ? AND p.ended_at IS NULL AND r.state = 'open'").get(id) !== undefined;

  // Paths: a claim is keyed by repository-relative path with forward slashes, so a file in a
  // worktree and the same file in the main checkout are one claim.
  const fold = (s: string): string => (CASELESS ? s.toLowerCase() : s);
  const slashes = (rel: string): string =>
    rel
      .split(/[\\/]+/)
      .filter((x) => x && x !== ".")
      .join("/");
  /** The checkout and every worktree registered on the repository, deepest first. */
  const roots = (repo: string): string[] => {
    const out = new Set<string>();
    if (path.basename(repo).toLowerCase() === ".git") out.add(path.resolve(path.dirname(repo)));
    const rows = db
      .prepare("SELECT DISTINCT p.place FROM participants p JOIN runs r ON r.id = p.run WHERE r.repo = ? AND p.place IS NOT NULL")
      .all(repo) as Row[];
    for (const r of rows) out.add(path.resolve(String(r.place)));
    return [...out].sort((a, b) => b.length - a.length);
  };
  /** Repository-relative with forward slashes; null for an absolute path outside every root. */
  const relPath = (repo: string, file: string): string | null => {
    if (!path.isAbsolute(file) && !file.startsWith("/")) return slashes(file) || null;
    const abs = fold(path.resolve(file));
    for (const root of roots(repo)) {
      const r = fold(root);
      if (abs.startsWith(r.endsWith(path.sep) ? r : r + path.sep)) return slashes(path.resolve(file).slice(root.length)) || null;
    }
    return null;
  };

  const doingOf = (id: number): string => String((db.prepare("SELECT doing FROM participants WHERE id = ?").get(id) as Row).doing) || "no note";
  // the code pack's tables, opened through the registry (board-split#D20)
  const packTables = registry.openTables({ db, transaction, bump, now, lastSeq, participantById, isLive, insertMessage, relPath, fold, slashes, doingOf, kindHasPack: (kind) => kindPackOf(kind) !== null });

  /** One run's context for a pack call (D10). */
  const runPackCtx = (runId: RunId): PackCtx => {
    const r = runRow(runId);
    return {
      run: runId,
      repo: String(r.repo),
      group: String(r.plan),
      base: r.base == null ? null : String(r.base),
      tables: packTables,
      insertMessage: (author, body, about) => insertMessage(author, body, about, "msg"),
    };
  };
  /** The member's own pack, chosen at its join (D11), and its run's context for one call (D9, D10). */
  const packOf = (p: Participant) => registry.packNamed(p.pack);
  const packCtxOf = (p: Participant): PackCtx => runPackCtx(p.run);
  /** What the member's pack says of it now (D36), as the roster's `fact`; nothing when the pack says nothing. */
  const factEntry = (p: Participant): { fact?: MemberFact } => {
    const fact = packOf(p)?.memberFact?.(p, packCtxOf(p)) ?? null;
    return fact ? { fact } : {};
  };
  /** The messages not yet delivered to `me`, oldest first: its own run's and any other's (the caller filters). */
  const unseenRows = (me: Participant): Row[] =>
    db
      .prepare(
        `SELECT m.* FROM messages m
         WHERE m.repo = ? AND m.seq > ? AND (m.author != ? OR m.event IN (${TO_AUTHOR}))
           AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.participant = ? AND d.seq = m.seq)
         ORDER BY m.seq`,
      )
      .all(me.repo, Number((db.prepare("SELECT since_seq FROM participants WHERE id = ?").get(me.id) as Row).since_seq), me.id, me.id) as Row[];
  /** How many undelivered messages wake `me`: a mention, an urgent post, an event it subscribed to (swarm-relay D43). */
  const unreadOf = (id: number): number => {
    const me = participantById(id);
    return unseenRows(me).filter((r) => {
      const m = toMessage(r);
      return mentionsMe(m, me) || wakes(m, me, me.subscriptions);
    }).length;
  };

  /** `fromWait`: a wait's own look, not a call of the member's.
   *  `mentionsOnly`: only what mentions `p` or is urgent is taken and marked; the rest stays. */
  const deliverTo = (p: Participant, fromWait: boolean, mentionsOnly = false): Delivery => {
    const me = participantById(p.id);
    // a mention, or what the caller's pack says is for it too (the code pack: an agreement about a path it holds)
    const pack = packOf(me);
    const named = (m: Message): boolean => mentionsMe(m, me) || (pack?.alsoFor?.(me, m, packCtxOf(me)) ?? false);
    const whole = profileOf(me.kind).wholeThread;
    // a post of the caller's own run, not an event, in a whole-thread run: everyone's in full
    const ownPost = (m: Message): boolean => whole && m.run === me.run && m.kind !== "event";
    const messages = transaction(() => {
      const unseen = unseenRows(me);

      // idea 2, D8: a paused run is silent for everyone in it: nothing wakes a member but urgent (and the pause itself,
      // for a member other than the orchestrator), and nothing is carried; what came meanwhile stays for the resume
      const silentWhilePaused = runRow(me.run).paused != null;
      const due = db.prepare("SELECT 1 FROM carry_due WHERE participant = ? AND seq = ?");
      // G27: an agreement answering the caller's own post about its path; G35: an endorsement, to the orchestrator.
      // Both ride on the caller's next wake instead of waking it
      const asked = db.prepare("SELECT 1 FROM messages WHERE author = ? AND about = ? AND kind = 'msg' AND seq < ? LIMIT 1");
      const ridesOn = (m: Message): boolean =>
        m.from !== me.name &&
        ((m.kind === "agreement" && m.about != null && asked.get(me.id, m.about, m.seq) != null) || (m.kind === "endorsement" && me.seat === ORCHESTRATOR));
      // idea 2: carried to the caller, riding on its next wake; one the tick marked due wakes by itself
      const carried = (r: Row): boolean => !silentWhilePaused && (ridesOn(toMessage(r)) || carries(toMessage(r), me, me.subscriptions));
      // a wake (D59): a mention, an urgent post, or an event the caller subscribed to in its scope
      const woken = (r: Row): boolean =>
        silentWhilePaused
          ? eventOf(toMessage(r)) === "urgent" || (me.seat !== ORCHESTRATOR && eventOf(toMessage(r)) === "pause")
          : ridesOn(toMessage(r))
            ? due.get(me.id, Number(r.seq)) != null
            : named(toMessage(r)) || wakes(toMessage(r), me, me.subscriptions) || (carried(r) && due.get(me.id, Number(r.seq)) != null);
      // of its own run, everything; of another run, only what wakes the caller (plan D2)
      const heard = unseen.filter((r) => toMessage(r).run === me.run || woken(r) || carried(r));
      // a wake in a whole-thread run brings every unread post of the run with it, never the waking one alone; a wake
      // brings every carried message with it (idea 2)
      const rows = silentWhilePaused && fromWait
        ? heard.some(woken) ? heard.filter(woken) : []
        : !mentionsOnly
        ? heard
        : !heard.some(woken)
          ? []
          : heard.filter((r) => woken(r) || carried(r) || (whole && ownPost(toMessage(r))));
      const mark = db.prepare("INSERT INTO deliveries (participant, seq, at) VALUES (?, ?, ?)");
      for (const r of rows) mark.run(me.id, Number(r.seq), now());
      // a delivery is a call to the board: the member's last call (D31)
      const at = now();
      db.prepare("UPDATE participants SET last_call = ? WHERE id = ?").run(at, me.id);
      // a wait's look is a sign of life by the stale rule, so the timeline logs it too (board D12, D37); a wait looks
      // every second, so at most one row a minute. A deliver verb is logged by countCall instead
      if (fromWait) {
        const last = db.prepare("SELECT MAX(at) AS at FROM call_log WHERE participant = ?").get(me.id) as Row;
        if (last.at == null || Date.parse(at) - Date.parse(String(last.at)) >= WAIT_LOG_EVERY_MS) {
          db.prepare("INSERT INTO call_log (participant, at, verb) VALUES (?, ?, 'deliver')").run(me.id, at);
        }
      }
      if (!fromWait) {
        // a call after a wait that never returned (killed): the member is no longer waiting
        const r = db.prepare("UPDATE participants SET waiting = 0 WHERE id = ? AND waiting = 1").run(me.id);
        if (Number(r.changes) > 0) bump(me.repo);
      }
      return rows.map((r) => {
        const m = toMessage(r);
        const rel = r.by_board || m.kind !== "msg" || !m.about || !named(m) ? null : packTables.askedAbout(me, Number(r.author), m);
        return rel ? { ...m, answer: `answer with an agreement on who changes what: swarm agree "<who changes what in ${rel}>" --about ${rel}` } : m;
      });
    });
    // a wait --mentions gives what woke it in full; deliver, mentions in full and the rest one line; a whole-thread
    // run gives its members' posts in full too
    const full = (m: Message): boolean => named(m) || (mentionsOnly && wakes(m, me, me.subscriptions)) || ownPost(m);
    return {
      full: messages.filter(full),
      lines: messages.filter((m) => !full(m)).map(messageLine),
    };
  };

  /** G23: a member done with a phase has had the event that opened it; a later wait never brings it back as news. */
  const markPhaseOpenDelivered = (p: Participant, phase: string): void => {
    const opened = (db.prepare("SELECT seq, meta FROM messages WHERE run = ? AND event = ?").all(p.run, EVENTS.phase.name) as Row[]).filter(
      (r) => r.meta != null && (JSON.parse(String(r.meta)) as { phase?: string }).phase === phase,
    );
    const mark = db.prepare("INSERT OR IGNORE INTO deliveries (participant, seq, at) VALUES (?, ?, ?)");
    for (const r of opened) mark.run(p.id, Number(r.seq), now());
  };

  const retentionDays = (): number => {
    const r = db.prepare("SELECT value FROM settings WHERE name = 'retention-days'").get() as Row | undefined;
    return r ? Number(r.value) : RETENTION_DEFAULT_DAYS;
  };
  const retentionCutoff = (at: Date): string => new Date(at.getTime() - retentionDays() * DAY_MS).toISOString();

  // The page's view (D39, D46): open runs and every closed run within the retention.
  const listedRuns = (): Row[] =>
    db
      .prepare("SELECT * FROM runs WHERE pruned_at IS NULL AND (state = 'open' OR (state = 'closed' AND closed_at >= ?)) ORDER BY id")
      .all(retentionCutoff(new Date())) as Row[];
  const runSummary = (r: Row): RunSummary => {
    const id = Number(r.id);
    const count = (sql: string): number => Number((db.prepare(sql).get(id) as Row).n);
    const open = r.state === "open";
    // board-split D62 (U-F40): one count per run; with a phase open, done/of are the phase's count, never a second one
    const progress = progressOf(id, r.phase == null ? null : String(r.phase));
    return {
      run: id,
      kind: profileOf(String(r.kind ?? "plan")).kind,
      plan: String(r.plan),
      group: String(r.plan),
      code: planCode(String(r.plan)),
      title: String(r.title),
      link: r.link == null ? null : String(r.link),
      open,
      members: open ? count(`SELECT COUNT(*) AS n FROM participants WHERE run = ? AND seat != '${ORCHESTRATOR}' AND ended_at IS NULL`) : 0,
      done: progress ? progress.done : count(`SELECT COUNT(*) AS n FROM seats s WHERE s.run = ? AND ${SEAT_STATE_SQL} = 'done'`),
      of: progress ? progress.of : count("SELECT COUNT(*) AS n FROM seats WHERE run = ?"),
      phase: phaseOf(r),
      progress,
      stallMs: Number(r.stall_ms ?? STALL_MS_DEFAULT),
      protocol: r.protocol == null ? null : String(r.protocol),
      authority: authorityOf(r.authority),
      paused: r.paused == null ? null : { text: String(r.paused), person: Number(r.paused_person ?? 0) === 1 },
    };
  };

  // onChange: one watcher per open Board, shared by its listeners.
  const listeners = new Set<(repo: string) => void>();
  let watching: { close(): void } | null = null;
  let versions = new Map<string, number>();
  const readVersions = (): Map<string, number> =>
    new Map((db.prepare("SELECT repo, version FROM changes").all() as Row[]).map((r) => [String(r.repo), Number(r.version)]));


  const insertSeat = (run: RunId, s: SeatSpec, ord: number): void => {
    if (s.on) parseOn(s.on); // an unknown event name is refused at open, not at join
    db.prepare("INSERT INTO seats (run, id, role, area, blockers, link, ord, on_events) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      run,
      s.id,
      s.role ?? null,
      s.area ?? null,
      JSON.stringify(s.blockers ?? []),
      s.link ?? null,
      ord,
      s.on ? JSON.stringify(s.on) : null,
    );
  };

  /** The run's composition (D3, D6): the orchestrator first, then every declared seat in order. */
  const compositionOf = (run: RunId): Composition => {
    const seats = db.prepare(`SELECT s.*, ${SEAT_STOOD_FOR_CLOSED_SQL} AS stood_for FROM seats s WHERE s.run = ? ORDER BY s.ord`).all(run) as Row[];
    const people = db.prepare(`${PARTICIPANT_SQL} WHERE p.run = ?`).all(run) as Row[];
    const r = runRow(run);
    const plan = String(r.plan);
    const showRole = new Set(seats.map((s) => (s.role == null ? "" : String(s.role)))).size > 1;
    const entry = (seat: string, s?: Row): CompositionEntry => {
      const p = people.find((x) => String(x.seat) === seat);
      // V-16: a seat standing for a run that has closed is ended with it, never read as owing
      const standsForClosed = s?.stood_for != null;
      return {
        seat,
        member: p ? `${plan}/${seat}` : null,
        nick: p ? nickOf(p) : null,
        ...(s?.role == null ? {} : { role: String(s.role) }),
        ...(s?.area == null ? {} : { area: String(s.area) }),
        state: standsForClosed ? "ended" : p ? memberStateOf(p, r) : "empty",
      };
    };
    const entries = [entry(ORCHESTRATOR), ...seats.map((s) => entry(String(s.id), s))];
    const lines = entries.map((e) => `${e.seat}${e.nick ? ` ${e.nick}` : ""}${showRole && e.role ? ` ${e.role}` : ""}${e.area ? ` (${e.area})` : ""}: ${e.state}`);
    return { run, entries, showRole, lines };
  };
  /** A change of the run's composition, one carried line to every member (D4): `+ w4 worker (the app) added`, `- w2 gone`. */
  const seatWho = (run: RunId, seat: string): string => {
    const c = compositionOf(run);
    const e = c.entries.find((x) => x.seat === seat);
    return `${seat}${e?.nick ? ` ${e.nick}` : ""}${c.showRole && e?.role ? ` ${e.role}` : ""}${e?.area ? ` (${e.area})` : ""}`;
  };
  const postComposition = (author: Participant, seat: string, sign: "+" | "-", tag: string): void => {
    insertMessage(author, `${sign} ${seatWho(author.run, seat)}${tag ? ` ${tag}` : ""}`, null, "event", undefined, { event: EVENTS.composition.name });
  };

  const setSubs = (p: Participant, subs: Subscription[]): Subscription[] => {
    db.prepare("UPDATE participants SET subs = ? WHERE id = ?").run(JSON.stringify(subs), p.id);
    bump(p.repo);
    return subs;
  };
  const sameSub = (a: Subscription, b: Subscription): boolean => a.event === b.event && a.scope === b.scope;

  // ── liveness: member states from activity (swarm-relay D9, D11, D12, D31) ─────────────
  /** G31: the liveness alerts (gone, liveness, stalled) of a run. The first goes out at once; those due within
   *  ALERT_WINDOW_MS after it are held and told together as one wake when the window ends, unless a gone is due:
   *  it goes at once, the held ones with it (D43). */
  type DueAlert = { body: string; event: EventName; meta?: MessageMeta };
  const alertsDue = new Map<RunId, { lastToldAt: number | null; items: DueAlert[] }>();
  const raiseAlert = (run: RunId, item: DueAlert): void => {
    const due = alertsDue.get(run) ?? { lastToldAt: null, items: [] };
    due.items.push(item);
    alertsDue.set(run, due);
  };
  /** One tick's end: the held alerts, together, once the window allows. */
  const flushAlerts = (run: RunId, t: number, orch: Participant): void => {
    const due = alertsDue.get(run);
    if (!due || !due.items.length) return;
    // board-split#D43 (G31 amended): a lost is never held by the window; what is held rides along with it
    const lostDue = due.items.some((i) => i.event === EVENTS.lost.name);
    if (!lostDue && due.lastToldAt != null && t - due.lastToldAt < ALERT_WINDOW_MS) return;
    const items = due.items.splice(0);
    due.lastToldAt = t;
    // posted at one moment, they reach a waiting orchestrator in one wake, each line its own event
    for (const i of items) insertMessage(orch, i.body, null, "event", [orch.name], { event: i.event, ...(i.meta ? { meta: i.meta } : {}) });
  };
  /** The presence each run's tick last gave: the snapshot and the roster read states through it. */
  const presenceOf = new Map<RunId, Presence>();
  const noPresence: Presence = () => ({ connected: false, lostAt: null });
  /** The waits this process holds, by participant id, and since when (ms epoch): the waiting of D35. */
  const heldWaits = new Map<number, number>();
  /** U-F20: per run, the badges its last tick read, so a badge changing with time alone tells the readers. */
  const badgesShown = new Map<RunId, string>();
  const orchestratorIn = (run: RunId): Participant =>
    participantById(Number((db.prepare("SELECT id FROM participants WHERE run = ? AND seat = ?").get(run, ORCHESTRATOR) as Row).id));
  const activityOf = (run: RunId, member: string): Row | undefined =>
    db.prepare("SELECT * FROM member_activity WHERE run = ? AND member = ?").get(run, member) as Row | undefined;
  /** board-split D49 (A1-5): in a board wait this server holds, set and cleared by the wait itself, and that wait is the
   *  member's open call (its link says so; with no link yet, the held wait alone): a background listener is not. */
  /** V-26, V-46: the pack's lock `p` is queued on (the holder and the lock's name), as its pack says; null: none. */
  const packLockWaitOf = (p: Row): { queuedBehind: string; lock: string } | null => {
    if (String(p.seat) === ORCHESTRATOR || p.ended_at != null) return null;
    const m = participantById(Number(p.id));
    return packOf(m)?.lockQueue?.(m, packCtxOf(m)) ?? null;
  };
  const inHeldWaitOf = (p: Row): boolean => {
    if (!heldWaits.has(Number(p.id))) return false;
    const a = activityOf(Number(p.run), String(p.seat));
    // V-46: a member queued on a pack's lock, its wait held, is waiting on that lock, whatever else it runs
    return a == null || Number(a.open_wait) === 1 || packLockWaitOf(p) != null;
  };
  /** A participant row's one state (liveness.ts), the same for snapshot, roster, status, seats and reader. */
  const memberStateOf = (p: Row, run: Row | undefined, t = Date.now()): CoreMemberState =>
    coreStateOf({
      runOpen: run?.state === "open",
      ended: p.ended_at != null,
      parked: Number(p.parked) === 1,
      linkDown: run != null && lostOf(p, run, t) != null,
      owedAtDrop: run != null && owedAtDropOf(p, run),
      moving: run != null && t - tokensMovedAtOf(p, run) < stallWindowOf(run),
    });
  /** simple-states (#48): whether the member owed the open phase when its link dropped, as the tick recorded it; before
   *  the tick saw the drop, whether it owes now. A drop while owing nothing stays away whatever phase opens after. */
  const owedAtDropOf = (p: Row, run: Row): boolean => (p.dropped_owing == null ? owesOf(p, run) : Number(p.dropped_owing) === 1);
  /** simple-states: when its tokens last moved (its transcript grew, as its link sent it), at the earliest its seating. */
  const tokensMovedAtOf = (p: Row, run: Row): number => {
    const a = activityOf(Number(run.id), String(p.seat));
    return Math.max(a?.grew_at == null ? 0 : Number(a.grew_at), Date.parse(seatedAtOf(p)));
  };
  /** The run's stall window, never under the floor (gate G5). */
  const stallWindowOf = (run: Row): number => Math.max(Number(run.stall_ms ?? STALL_MS_DEFAULT), stallMsFloor());
  /** Whether a member owes work: the orchestrator always; a member the open phase undone, else a task not reported. */
  const owesOf = (p: Row, run: Row): boolean => String(p.seat) === ORCHESTRATOR || owedNameOf(p, run) != null;
  /** A participant row's state at `t`: gone, waiting (its open call is the board wait), busy, working, else quiet. */
  /** S22: when the seat's current member joined (a re-join included), ISO. */
  const seatedAtOf = (p: Row): string => String(p.seated_at ?? p.joined_at);
  /** When the member's last progress was (D36): its transcript growing, or a post, `done` or `doing`; never through
   *  a pause (from the resume), else from the join. */
  const progressAtOf = (p: Row, run: Row, a: Row | undefined): number =>
    Math.max(
      a?.grew_at == null ? 0 : Number(a.grew_at),
      p.progress_at == null ? 0 : Date.parse(String(p.progress_at)),
      Date.parse(seatedAtOf(p)),
      run.resumed_at == null ? 0 : Date.parse(String(run.resumed_at)),
    );
  /** board-split D31, D32: the snapshot's `activity` of a live member, from its link's last report; {} with none. */
  const activityShown = (run: RunId, seat: string): { activity?: SnapshotMember["activity"] } => {
    const a = activityOf(run, seat);
    if (!a) return {};
    const text = (v: unknown): string | null => (v == null ? null : String(v));
    const open =
      a.open_tool == null
        ? null
        : { name: String(a.open_tool), target: String(a.open_target ?? ""), since: Number(a.open_since), boardWait: Number(a.open_wait) === 1, label: callLabel({ name: String(a.open_tool), target: String(a.open_target ?? ""), label: text(a.open_label), command: text(a.open_command) }), command: text(a.open_command) };
    const background =
      a.bg_target == null
        ? null
        : { target: String(a.bg_target), since: Number(a.bg_since), outputGrewAt: a.bg_grew_at == null ? null : Number(a.bg_grew_at), label: callLabel({ target: String(a.bg_target), label: text(a.bg_label), command: text(a.bg_command) }), command: text(a.bg_command) };
    return { activity: { open, background } };
  };
  /** board-split D30: park or unpark a seat of the orchestrator's run, one event mentioning the seat. */
  const setParked = (p: Participant, seat: string, parked: boolean, until?: string): Message => {
    const fresh = live(p);
    const verb = parked ? "park" : "unpark";
    if (fresh.seat !== ORCHESTRATOR) throw new Error(`${verb}: only the orchestrator parks a seat; ${fresh.name} is not ${fresh.plan}/${ORCHESTRATOR}`);
    if (runRow(fresh.run).state !== "open") throw new Error(`run ${fresh.run} is closed`);
    const row = db.prepare("SELECT id, parked FROM participants WHERE run = ? AND seat = ? AND ended_at IS NULL").get(fresh.run, seat) as Row | undefined;
    if (!row || seat === ORCHESTRATOR) throw new Error(`${verb}: no live member in seat ${seat} of run ${fresh.run}`);
    if ((Number(row.parked) === 1) === parked) throw new Error(`${verb}: ${fresh.plan}/${seat} is ${parked ? "already parked" : "not parked"}`);
    return transaction(() => {
      // D34 (S38): a parked seat says until which phase it sleeps, in its state (`parkedUntil`); board-split D48 (U-F2):
      // the member's `doing` is its own, never written by the board
      const until_ = until?.trim() || null;
      // board-split D55: an unpark seats the member afresh (seated_at), so no lost for LOST_MS after it
      if (parked) db.prepare("UPDATE participants SET parked = 1, parked_until = ? WHERE id = ?").run(until_, Number(row.id));
      else db.prepare("UPDATE participants SET parked = 0, parked_until = NULL, dropped_owing = NULL, seated_at = ? WHERE id = ?").run(new Date().toISOString(), Number(row.id));
      return insertMessage(fresh, parked ? `parked @${fresh.plan}/${seat}` : `unparked @${fresh.plan}/${seat}`, null, "event", [`${fresh.plan}/${seat}`], { event: (parked ? EVENTS.park : EVENTS.unpark).name });
    });
  };
  /** board-split D44: block a seat of the orchestrator's run on the person (`reason`), or lift it (null). */
  const setBlocked = (p: Participant, seat: string, reason: string | null): Message => {
    const fresh = live(p);
    const verb = reason == null ? "unblock" : "block";
    if (fresh.seat !== ORCHESTRATOR) throw new Error(`${verb}: only the orchestrator blocks a seat; ${fresh.name} is not ${fresh.plan}/${ORCHESTRATOR}`);
    if (runRow(fresh.run).state !== "open") throw new Error(`run ${fresh.run} is closed`);
    const row = db.prepare("SELECT id, blocked FROM participants WHERE run = ? AND seat = ? AND ended_at IS NULL").get(fresh.run, seat) as Row | undefined;
    if (!row || seat === ORCHESTRATOR) throw new Error(`${verb}: no live member in seat ${seat} of run ${fresh.run}`);
    const why = reason?.trim() ?? null;
    if (why === "") throw new Error(`block: say what ${fresh.plan}/${seat} waits on the person for`);
    if (why == null && row.blocked == null) throw new Error(`unblock: ${fresh.plan}/${seat} is not blocked`);
    return transaction(() => {
      db.prepare("UPDATE participants SET blocked = ?, blocked_at = ? WHERE id = ?").run(why, why == null ? null : Date.now(), Number(row.id));
      return insertMessage(fresh, why == null ? `unblocked @${fresh.plan}/${seat}` : `blocked @${fresh.plan}/${seat}: ${why}`, null, "event", [`${fresh.plan}/${seat}`], { event: (why == null ? EVENTS.unblock : EVENTS.block).name });
    });
  };
  /** board-split D44: blocked: its seat blocked, or its run paused on the person; null otherwise. */
  const blockedOf = (p: Row, run: Row): Badge | null => {
    if (p.blocked != null) return { name: "blocked", reason: String(p.blocked), since: p.blocked_at == null ? null : Number(p.blocked_at) };
    if (run.paused != null && Number(run.paused_person ?? 0) === 1 && String(p.seat) !== ORCHESTRATOR)
      return { name: "blocked", reason: String(run.paused) || "the run is paused on the person", since: null };
    return null;
  };
  /** The member's activity as shown (D31, D45): busy on an open call or a background task, waiting in a board wait, else
   *  working, with what it is on. Never a badge: that is `memberView`'s, from board facts alone (board-split D49). */
  const activityShownOf = (p: Row, run: Row, t: number): Omit<MemberState, "badge"> => {
    const member = String(p.seat);
    const a = activityOf(Number(run.id), member);
    // D35: waiting is the board's own fact, a wait this server holds for the member, whatever command ran it
    const heldSince = heldWaits.get(Number(p.id)) ?? null;
    // S40: a subagent that ends its turn on a background task of its own is busy on that task (D31)
    if (a && Number(a.finished) === 1 && a.bg_target != null) return { member, state: "busy", doing: `background ${String(a.bg_target)}`, since: Number(a.bg_since) };
    if (!a) return { member, state: heldSince != null ? "waiting" : "working", doing: null, since: heldSince ?? Date.parse(seatedAtOf(p)) };
    const open = a.open_tool == null ? null : `${a.open_tool} ${String(a.open_target ?? "")}`.trim();
    if (open && heldSince != null && Number(a.open_wait) === 1) {
      // V-46: queued on a pack's lock: `lock <name>, held by <holder>`
      const packWait = packLockWaitOf(p);
      if (packWait) return { member, state: "waiting", doing: `lock ${packWait.lock}, held by ${packWait.queuedBehind}`, since: Number(a.open_since) };
      // board-split D31 (S37): a board wait over an un-notified background task of its own is busy on that task
      if (a.bg_target != null) return { member, state: "busy", doing: `${minutes(t - Number(a.bg_since))} min · background ${String(a.bg_target)}`, since: Number(a.bg_since) };
      return { member, state: "waiting", doing: open, since: Number(a.open_since) };
    }
    if (open) return { member, state: "busy", doing: open, since: Number(a.open_since) };
    if (a.bg_target != null) return { member, state: "busy", doing: `background ${String(a.bg_target)}`, since: Number(a.bg_since) };
    // U-F6 (D45, D49): the last call ended; it is not what the member is on, so working names none
    return { member, state: "working", doing: null, since: progressAtOf(p, run, a) };
  };
  /** board-split D64: the oldest post of a run's member mentioning its orchestrator that the orchestrator has not posted
   *  after; null when none waits on it. A member's own post or urgent only: a board notice in its name never is (D51, V-23). */
  const unansweredOf = (run: RunId, orch: Participant): { seq: number; from: string } | null => {
    const lastAnswer = Number((db.prepare("SELECT MAX(seq) AS s FROM messages WHERE author = ? AND kind = 'msg' AND event IS NULL").get(orch.id) as Row).s ?? 0);
    const q = db
      .prepare("SELECT m.seq, p.seat FROM messages m JOIN participants p ON p.id = m.author WHERE m.run = ? AND m.seq > ? AND m.author != ? AND m.kind IN ('msg', 'urgent') AND m.mentions LIKE ? ORDER BY m.seq LIMIT 1")
      .get(run, lastAnswer, orch.id, `%${JSON.stringify(orch.name)}%`) as Row | undefined;
    return q ? { seq: Number(q.seq), from: String(q.seat) } : null;
  };
  /** board-split D64: the suffix a stopped line carries while a question to the orchestrator waits. */
  const unansweredSuffix = (run: RunId, orch: Participant): string => {
    const q = unansweredOf(run, orch);
    return q ? `; unanswered @orchestrator #${q.seq} from ${orch.plan}/${q.from}` : "";
  };
  /** board-split D55: the newest sign of life of a member: a board call, a held wait (now, for its whole hold), its link's
   *  heartbeat or drop, transcript growth its link sent, an open call's start; ms epoch, 0 with none. */
  const signAtOf = (p: Row, run: Row, link: LinkFact, t: number): number => {
    if (heldWaits.has(Number(p.id))) return t;
    const a = activityOf(Number(run.id), String(p.seat));
    const ms = (iso: unknown): number => (iso == null ? 0 : Date.parse(String(iso)));
    const num = (v: unknown): number => (v == null ? 0 : Number(v));
    return Math.max(ms(p.last_call), ms(p.board_call_at), num(link.seenAt), num(link.lostAt), num(a?.grew_at), a?.open_tool == null ? 0 : num(a.open_since));
  };
  /** board-split D55: when the board server came up, ms epoch; null when none recorded it (a board opened alone). */
  const serverUpAt = (): number | null => {
    const r = db.prepare("SELECT value FROM server_facts WHERE name = 'server_up_at'").get() as Row | undefined;
    return r == null ? null : Number(r.value);
  };
  /** board-split D55: lost iff not parked/ended, link unseen >= LOST_MS, sign older than LOST_MS, no held wait, server
   *  up >= LOST_MS, seated >= LOST_MS. A restart, a reconnect, a join or an unpark never raises it. */
  const lostOf = (p: Row, run: Row, t: number): Badge | null => {
    if (Number(p.parked) === 1 || p.ended_at != null || heldWaits.has(Number(p.id))) return null;
    const link = (presenceOf.get(Number(run.id)) ?? noPresence)(String(p.seat));
    if (link.connected) return null;
    const old = (at: number | null): boolean => at == null || t - at >= LOST_MS;
    const up = serverUpAt();
    const seatedAt = Date.parse(seatedAtOf(p));
    const linkSeenAt = Math.max(link.seenAt ?? 0, link.lostAt ?? 0) || null;
    const signAt = signAtOf(p, run, link, t);
    if (!old(linkSeenAt) || !old(signAt || null) || !old(up) || !old(seatedAt)) return null;
    const since = Math.max(signAt, seatedAt, up ?? 0) + LOST_MS;
    if (link.lostAt == null || link.lostAt < seatedAt) return { name: "lost", reason: "no link since its join", since };
    return { name: "lost", reason: `its link was lost${link.cause ? ` (${link.cause})` : ""}`, since };
  };
  /** board-split D55 (amended, U-F27): a lost badge holds only once its episode opened (its predicate true
   *  for BADGE_CONFIRM_MS, by time, not by tick count); `predicate`: the tick's own read, before that confirm. */
  const episodeOpenOf = (run: RunId, member: string, badge: string): boolean =>
    db.prepare("SELECT 1 FROM badge_episodes WHERE run = ? AND member = ? AND badge = ? AND opened_at IS NOT NULL AND closed_at IS NULL").get(run, member, badge) != null;
  /** board-split D55: one tick of a member's episode of `badge`: its predicate true opens a pending row, true again
   *  at a later tick opens it ("opened"); false drops a pending row, or closes an open one ("closed"). `silent`: close
   *  without a word (an outranking badge took over). */
  const episodeStep = (run: RunId, member: string, badge: string, on: boolean, t: number, silent = false): "opened" | "closed" | null => {
    const row = db.prepare("SELECT rowid AS id, pending_at, opened_at, clearing_at FROM badge_episodes WHERE run = ? AND member = ? AND badge = ? AND closed_at IS NULL").get(run, member, badge) as Row | undefined;
    if (on) {
      if (!row) {
        db.prepare("INSERT INTO badge_episodes (run, member, badge, pending_at) VALUES (?, ?, ?, ?)").run(run, member, badge, t);
        return null;
      }
      if (row.opened_at != null) {
        // true again before the close was confirmed: the episode goes on, nothing told
        if (row.clearing_at != null) db.prepare("UPDATE badge_episodes SET clearing_at = NULL WHERE rowid = ?").run(Number(row.id));
        return null;
      }
      if (row.clearing_at != null) db.prepare("UPDATE badge_episodes SET clearing_at = NULL WHERE rowid = ?").run(Number(row.id));
      if (t - Number(row.pending_at) < badgeConfirmMs()) return null;
      db.prepare("UPDATE badge_episodes SET opened_at = ?, clearing_at = NULL WHERE rowid = ?").run(t, Number(row.id));
      return "opened";
    }
    if (!row) return null;
    if (row.opened_at == null) {
      // a pending episode false for less than BADGE_CONFIRM_MS (a re-arm's second) is kept; longer, it is dropped
      if (row.clearing_at == null) db.prepare("UPDATE badge_episodes SET clearing_at = ? WHERE rowid = ?").run(t, Number(row.id));
      else if (t - Number(row.clearing_at) >= badgeConfirmMs()) db.prepare("DELETE FROM badge_episodes WHERE rowid = ?").run(Number(row.id));
      return null;
    }
    // board-split D55 (amended, U-F27): an open episode closes once its predicate held false BADGE_CONFIRM_MS (a
    // re-arm's second out of its wait never closes it); an outranking badge closes it at once
    if (!silent) {
      if (row.clearing_at == null) {
        db.prepare("UPDATE badge_episodes SET clearing_at = ? WHERE rowid = ?").run(t, Number(row.id));
        return null;
      }
      if (t - Number(row.clearing_at) < badgeConfirmMs()) return null;
    }
    db.prepare("UPDATE badge_episodes SET closed_at = ? WHERE rowid = ?").run(t, Number(row.id));
    return silent ? null : "closed";
  };
  /** Closes, without a word, the episodes of a run's members not in `watched` (parked, ended), dropping pending ones. */
  const closeEpisodesOutside = (run: RunId, watched: string[], t: number): void => {
    const keep = new Set(watched);
    for (const e of db.prepare("SELECT rowid AS id, member, opened_at FROM badge_episodes WHERE run = ? AND closed_at IS NULL").all(run) as Row[]) {
      if (keep.has(String(e.member))) continue;
      if (e.opened_at == null) db.prepare("DELETE FROM badge_episodes WHERE rowid = ?").run(Number(e.id));
      else db.prepare("UPDATE badge_episodes SET closed_at = ? WHERE rowid = ?").run(t, Number(e.id));
    }
  };
  /** board-split D55: the one view of a member, from its facts at `t`: its activity, its badge (blocked > lost; none
   *  parked or ended) and the badge's reason. The snapshot, roster, status and the tick all read it. */
  const memberView = (p: Row, run: Row, t: number, opts: { predicate?: boolean } = {}): MemberState => {
    const activity = activityShownOf(p, run, t);
    if (Number(p.parked) === 1 || p.ended_at != null) return { ...activity, badge: null };
    const blocked = blockedOf(p, run);
    if (blocked) return { ...activity, badge: blocked };
    // board-split D55: lost shows only once its episode opened; `predicate`: the tick's raw read. A link dropped while
    // owing raises lost; one dropped owing nothing is away, with nothing to tell (#48)
    const lost = lostOf(p, run, t);
    const shows = opts.predicate === true || episodeOpenOf(Number(run.id), String(p.seat), "lost");
    return { ...activity, badge: lost && owedAtDropOf(p, run) && shows ? lost : null };
  };
  const minutes = (ms: number): number => Math.round(ms / 60000);
  /** False for a seat the run's current phase is not for (`phase --for`); true when the phase is for every member. */
  const phaseIsFor = (run: Row, seat: string): boolean => phaseIsForSeat(phaseScopeOf(run, String(run.phase)), seat);
  /** board-split D62: the scope `phase` is counted in: the run's open phase carries its --for, an earlier one none. */
  const phaseScopeOf = (run: Row, phase: string): PhaseScope => {
    const open = run.phase === phase;
    return { open, forSeats: open && run.phase_for != null ? (JSON.parse(String(run.phase_for)) as string[]) : null };
  };
  /** board-split D62: the run's members (the orchestrator apart, or only participant `onlyId`) as owing.ts counts them for `phase`. */
  const phaseMembersOf = (run: RunId, phase: string, onlyId?: number): PhaseMember[] =>
    (
      db
        .prepare(
          `SELECT (SELECT r.plan FROM runs r WHERE r.id = p.run) AS plan, p.seat, p.ended_at, p.idle_ended, p.parked, EXISTS (SELECT 1 FROM phase_done d WHERE d.run = p.run AND d.participant = p.id AND d.phase = ?) AS done,
             EXISTS (SELECT 1 FROM badge_episodes e WHERE e.run = p.run AND e.member = p.seat AND e.badge = 'lost' AND e.opened_at IS NOT NULL AND e.closed_at IS NULL) AS lost
           FROM participants p WHERE p.run = ? AND p.seat != '${ORCHESTRATOR}' AND (? IS NULL OR p.id = ?) ORDER BY p.id`,
        )
        .all(phase, run, onlyId ?? null, onlyId ?? null) as Row[]
    ).map((r) => ({
      member: `${r.plan}/${r.seat}`,
      seat: String(r.seat),
      done: Number(r.done) === 1,
      ended: r.ended_at != null,
      idleEnded: Number(r.idle_ended) === 1,
      // board-split D30, D62: a parked member is out of the count, done or not, until resumed
      parked: Number(r.parked) === 1,
      // D41: lost as the last tick told it
      lost: Number(r.lost) === 1,
    }));
  /** The phase `p` owes now (D62's one owing rule): the run's open phase, for its seat, not parked, not ended, not done;
   *  null for the orchestrator or none open. */
  const owedNameOf = (p: Row, run: Row): string | null => {
    if (String(p.seat) === ORCHESTRATOR || run.state !== "open" || run.phase == null) return null;
    const phase = String(run.phase);
    const [me] = phaseMembersOf(Number(run.id), phase, Number(p.id));
    return me && owesPhase(me, phaseScopeOf(run, phase)) ? phase : null;
  };
  /** The states of a run's live members (not ended), keyed by member. */
  const statesOf = (run: RunId, t: number, predicate = false): Map<string, MemberState> => {
    const r = db.prepare("SELECT * FROM runs WHERE id = ?").get(run) as Row | undefined;
    if (!r) return new Map();
    const live = db.prepare("SELECT * FROM participants WHERE run = ? AND ended_at IS NULL ORDER BY id").all(run) as Row[];
    return new Map(live.map((p) => [String(p.seat), memberView(p, r, t, { predicate })]));
  };

  const livenessOf =(run: RunId, st: MemberState | undefined, t: number): Liveness | undefined => {
    if (!st) return undefined;
    const a = activityOf(run, st.member);
    const r = db.prepare("SELECT * FROM runs WHERE id = ?").get(run) as Row;
    const p = db.prepare("SELECT * FROM participants WHERE run = ? AND seat = ?").get(run, st.member) as Row;
    const link = (presenceOf.get(run) ?? noPresence)(st.member);
    const { member: _, ...state } = st;
    return {
      ...state,
      badge: st.badge,
      tokens: a ? Number(a.tokens) : null,
      movedAt: a?.grew_at == null ? null : new Date(Number(a.grew_at)).toISOString(),
      // D38: the two ages, since its last progress and since its last sign of life
      progressAt: progressAtOf(p, r, a),
      aliveAt: link.connected ? t : link.lostAt,
      // board-split D55: no link activity NO_TRANSCRIPT_MS after its seating: a card note, never an alarm
      ...(!a && t - Date.parse(seatedAtOf(p)) >= NO_TRANSCRIPT_MS ? { note: "no transcript found: its state is presence only" } : {}),
    };
  };
  const agesOf = (l: Liveness | undefined): { progressAt: number | null; aliveAt: number | null } => ({ progressAt: l?.progressAt ?? null, aliveAt: l?.aliveAt ?? null });
  /** Idea 2: why `p`'s `done` of the current phase `name` wakes the orchestrator, the case as its body names it; null
   *  when none holds and the done is carried. The person's cases: a watched member (`phase --watch`), a done without
   *  its deliverable (the orchestrator mentioned the member in this phase and it posted nothing since), the straggler. */
  const doneWakeCase = (p: Participant, name: string, progress: PhaseProgress): string | null => {
    const r = runRow(p.run);
    const watch = r.phase_watch == null ? [] : (JSON.parse(String(r.phase_watch)) as string[]);
    if (watch.includes(p.seat)) return "watched";
    const opened = Number((db.prepare("SELECT MAX(seq) AS seq FROM messages WHERE run = ? AND event = ?").get(p.run, EVENTS.phase.name) as Row).seq ?? 0);
    const orch = db.prepare("SELECT id FROM participants WHERE run = ? AND seat = ?").get(p.run, ORCHESTRATOR) as Row | undefined;
    if (orch) {
      const asked = (db.prepare("SELECT seq, mentions FROM messages WHERE run = ? AND author = ? AND seq > ? AND kind != 'event' ORDER BY seq DESC").all(p.run, Number(orch.id), opened) as Row[]).find(
        (m) => (JSON.parse(String(m.mentions)) as string[]).includes(p.name),
      );
      if (asked) {
        const answered = db.prepare("SELECT 1 FROM messages WHERE author = ? AND seq > ? AND kind != 'event' LIMIT 1").get(p.id, Number(asked.seq));
        if (!answered) return `no post since the orchestrator's #${Number(asked.seq)}`;
      }
    }
    if (progress.of - progress.done === 1) {
      const scope = phaseScopeOf(r, name);
      const straggler = phaseMembersOf(p.run, name).find((m) => owesPhase(m, scope) && !progress.gone.includes(m.member));
      if (straggler) return `all but ${straggler.seat}`;
    }
    return null;
  };
  /** The phase's done count (board-split D62): owing.ts's one count over the run's members. */
  const progressOf = (run: RunId, phase: string | null): PhaseProgress | null =>
    phase == null ? null : phaseCount(phase, phaseMembersOf(run, phase), phaseScopeOf(runRow(run), phase));
  /** `all-done` to the orchestrator, once per run and phase whoever reaches it first: the last `done`, or the tick
   *  that finds the last member not done gone (D41). */
  const allDoneOnce = (author: Participant, progress: PhaseProgress): boolean => {
    if (!everyOwingDone(progress)) return false;
    if (Number(db.prepare("INSERT OR IGNORE INTO liveness_warned (run, member, cond) VALUES (?, ?, ?)").run(author.run, ORCHESTRATOR, `all-done ${progress.phase}`).changes) !== 1) return false;
    // V-35: "every member" only when no member owing the phase is lost; a lost one is named with the move it needs
    const body = progress.gone.length
      ? `all done ${progress.phase} but the lost: ${progress.done}/${progress.of} done; lost, not done: ${progress.gone.join(", ")}: dispatch each again or end its seat, then open the next phase`
      : `all done ${progress.phase}: every member is done (${progress.done}/${progress.of}); open the next phase`;
    insertMessage(author, body, null, "event", [`${author.plan}/${ORCHESTRATOR}`], {
      event: EVENTS["all-done"].name,
      meta: { phase: progress.phase },
    });
    return true;
  };

  const board: Board = {
    openRun({ repo, kind = "plan", group, title, link, seats, transcript, stallMs, protocol, authority = [], base }) {
      const profile = profileOf(kind);
      if (protocol != null && !PROTOCOL_NAME.test(protocol)) throw new Error(`a protocol is named in lower case, digits and dashes (build-verify), got ${protocol}`);
      const badRole = authority.find((role) => !AUTHORITY_ROLE.test(role));
      if (badRole !== undefined) throw new Error(`a role of the authority is named in lower case, digits and dashes (tech-lead), got ${badRole}`);
      const roles = [...new Set(authority)];
      if (stallMs !== undefined && !(Number.isInteger(stallMs) && stallMs > 0)) throw new Error(`the stall threshold takes a positive whole number of ms, got ${stallMs}`);
      const id = transaction(() => {
        // board-split#D58: a group names one open run per project, so `--as <group>/<seat>` names one member
        const sameGroup = db.prepare("SELECT id FROM runs WHERE repo = ? AND plan = ? AND state = 'open'").get(repo, group) as Row | undefined;
        if (sameGroup) throw new Error(`group ${group} already has run ${sameGroup.id} open on this project`);
        // the group is stored as the plan (D44)
        const r = db
          .prepare("INSERT INTO runs (repo, kind, plan, title, link, opened_at, stall_ms, protocol, authority, base) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(repo, profile.kind, group, title, link ?? null, now(), stallMs ?? STALL_MS_DEFAULT, protocol ?? null, roles.length ? JSON.stringify(roles) : null, base ?? null);
        const run = Number(r.lastInsertRowid);
        seats.forEach((s, i) => insertSeat(run, s, i));
        // a funny name as a member gets at join (plan D17)
        const orchestrator = db.prepare("INSERT INTO participants (run, seat, since_seq, joined_at, subs, nick) VALUES (?, ?, ?, ?, ?, ?)").run(
          run,
          ORCHESTRATOR,
          lastSeq(),
          now(),
          JSON.stringify(profile.defaults.orchestrator),
          unusedNick(repo),
        );
        // stored with the run it opens; a member subscribed to any:opened wakes (D69)
        insertMessage(participantById(Number(orchestrator.lastInsertRowid)), `run ${run} opened: ${profile.kind} ${group}, ${title}`, null, "event", undefined, {
          event: EVENTS.opened.name,
        });
        bump(repo);
        return run;
      });
      return toRun(runRow(id));
    },

    addSeat(run, spec) {
      const r = runRow(run);
      if (r.state !== "open") throw new Error(`run ${run} is closed`);
      if (spec.id === ORCHESTRATOR) throw new Error(`"${ORCHESTRATOR}" is not a seat`);
      return transaction(() => {
        const ids = (db.prepare("SELECT id FROM seats WHERE run = ?").all(run) as Row[]).map((x) => String(x.id));
        if (ids.includes(spec.id)) throw new Error(`seat ${spec.id} is already in run ${run}`);
        const unknown = (spec.blockers ?? []).filter((b) => !ids.includes(b));
        if (unknown.length) throw new Error(`unknown blocker ${unknown.join(", ")} in run ${run}`);
        const ord = Number((db.prepare("SELECT COALESCE(MAX(ord), -1) AS o FROM seats WHERE run = ?").get(run) as Row).o) + 1;
        insertSeat(run, spec, ord);
        const orchestrator = db.prepare("SELECT id FROM participants WHERE run = ? AND seat = ?").get(run, ORCHESTRATOR) as Row;
        postComposition(participantById(Number(orchestrator.id)), spec.id, "+", "added");
        return toRun(runRow(run)).seats.find((x) => x.id === spec.id)!;
      });
    },

    closeRun(run) {
      runRow(run);
      transaction(() => {
        // stored with the run it closes, before it closes; a member subscribed to any:closed wakes (D67)
        const author = (db.prepare("SELECT id FROM participants WHERE run = ? AND seat = ?").get(run, ORCHESTRATOR) ??
          db.prepare("SELECT id FROM participants WHERE run = ? ORDER BY id LIMIT 1").get(run)) as Row | undefined;
        if (author) insertMessage(participantById(Number(author.id)), `run ${run} closed`, null, "event", undefined, { event: EVENTS.closed.name });
        db.prepare("UPDATE runs SET state = 'closed', closed_at = ? WHERE id = ?").run(now(), run);
        bump(String(runRow(run).repo));
        db.prepare("UPDATE participants SET ended_at = COALESCE(ended_at, ?) WHERE run = ?").run(now(), run);
        for (const p of db.prepare("SELECT id FROM participants WHERE run = ?").all(run) as Row[]) packTables.releaseAll(Number(p.id));
      });
    },

    prune(at = new Date()) {
      return transaction(() => {
        const cutoff = retentionCutoff(at);
        const expired = db.prepare("SELECT id, repo FROM runs WHERE state = 'closed' AND closed_at < ? AND pruned_at IS NULL").all(cutoff) as Row[];
        const touched = new Set(expired.map((r) => String(r.repo)));
        const runIds = expired.map((r) => Number(r.id));
        const inExpired = runIds.length ? `run IN (${runIds.join(", ")})` : "0";
        // kept: every agreement in main, and the endorsements of those agreements (D20)
        const doomed = db
          .prepare(
            `SELECT seq, repo FROM messages WHERE ${inExpired}
               OR (run IS NULL AND at < ? AND kind != 'agreement'
                   AND NOT (kind = 'endorsement' AND endorses IN (SELECT seq FROM messages WHERE run IS NULL AND kind = 'agreement')))`,
          )
          .all(cutoff) as Row[];
        const dropDeliveries = db.prepare("DELETE FROM deliveries WHERE seq = ?");
        const dropMessage = db.prepare("DELETE FROM messages WHERE seq = ?");
        for (const m of doomed) {
          dropDeliveries.run(Number(m.seq));
          dropMessage.run(Number(m.seq));
          touched.add(String(m.repo));
        }
        for (const run of runIds) {
          for (const r of db.prepare("SELECT id FROM participants WHERE run = ?").all(run) as Row[]) {
            const id = Number(r.id);
            for (const table of ["deliveries", "call_log"]) db.prepare(`DELETE FROM ${table} WHERE participant = ?`).run(id);
            // the packs' own rows of the member (D20)
            registry.forgetMember(db, id);
            // a member authoring a kept message stays, so the message still reads its author
            if (!db.prepare("SELECT 1 FROM messages WHERE author = ? LIMIT 1").get(id)) db.prepare("DELETE FROM participants WHERE id = ?").run(id);
          }
          db.prepare("DELETE FROM seats WHERE run = ?").run(run);
          registry.forgetRun(db, run);
          for (const table of ["phase_done", "transcripts", "token_readings", "liveness_warned", "badge_episodes", "member_activity", "member_links"]) db.prepare(`DELETE FROM ${table} WHERE run = ?`).run(run);
          // the row stays, stamped: its id is never handed to a new run (D61)
          db.prepare("UPDATE runs SET pruned_at = ? WHERE id = ?").run(at.toISOString(), run);
        }
        for (const repo of touched) bump(repo);
        return { messages: doomed.length, runs: runIds.length };
      });
    },

    setting(name, value) {
      if (name !== "retention-days") throw new Error(`unknown setting ${name}`);
      if (value !== undefined) {
        if (!Number.isInteger(value) || value < 1) throw new Error(`${name} takes a positive whole number of days, got ${value}`);
        db.prepare("INSERT INTO settings (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value").run(name, String(value));
      }
      return retentionDays();
    },

    upkeepIfDue(at = new Date()) {
      // never ran, or an unreadable time: due
      const due = (): boolean => {
        const r = db.prepare("SELECT value FROM settings WHERE name = ?").get(LAST_UPKEEP) as Row | undefined;
        return !(at.getTime() - Date.parse(String(r?.value)) < UPKEEP_EVERY_MS);
      };
      // a plain read first: a pending wait asks every tick, and only a due upkeep takes the write lock
      if (!due()) return false;
      const recorded = transaction(() => {
        if (!due()) return false; // another process recorded it between the read and the lock
        db.prepare("INSERT INTO settings (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value").run(LAST_UPKEEP, at.toISOString());
        return true;
      });
      if (!recorded) return false;
      board.prune(at);
      return true;
    },

    runs() {
      return (db.prepare("SELECT * FROM runs WHERE state = 'open' ORDER BY id").all() as Row[]).map(toRun);
    },

    join({ run, seat, doing, files, place, on }) {
      const r = runRow(run);
      if (r.state !== "open") throw new Error(`run ${run} is closed`);
      if (seat === ORCHESTRATOR) throw new Error(`"${ORCHESTRATOR}" is not a seat`);
      const profile = profileOf(String(r.kind ?? "plan"));
      // the member's pack, chosen once here from the registry, never re-checked per verb (D11, D22)
      const role = db.prepare("SELECT role FROM seats WHERE run = ? AND id = ?").get(run, seat) as Row | undefined;
      const given = registry.forMember(profile.kind, role?.role == null ? null : String(role.role));
      const packName = given.pack?.name ?? null;
      const verify = given.verify ? 1 : 0;
      if (files.length && packName === null) throw new Error(registry.declaredRefused(profile.kind));
      // a member with no pack records no place, whatever the caller passed (D21, D11)
      const where = place && packName !== null ? path.resolve(place) : null;
      // one transaction: the page sees a join as one change
      return transaction(() => {
      let entry = "new" as "new" | "back" | "again";
      const id = transaction(() => {
        const existing = db.prepare("SELECT id, nick, ended_at, subs FROM participants WHERE run = ? AND seat = ?").get(run, seat) as Row | undefined;
        // --on, else the seat row's on, else the kind's defaults (D59)
        const seatRow = db.prepare("SELECT on_events FROM seats WHERE run = ? AND id = ?").get(run, seat) as Row | undefined;
        // D17: a seat is declared before anyone sits in it
        if (!seatRow && !existing) throw new Error(`seat ${seat} is not declared in run ${run}: declare it first with \`seat add ${seat}\``);
        const seatOn = seatRow?.on_events != null ? parseOn(JSON.parse(String(seatRow.on_events)) as string[]) : null;
        // U-F29: a rejoin keeps the subscriptions the seat's row holds (the member's own `subscribe`), unless --on replaces them
        const kept = existing?.subs == null ? [] : (JSON.parse(String(existing.subs)) as Subscription[]);
        const subs = on != null ? JSON.stringify(on) : kept.length > 0 ? String(existing!.subs) : JSON.stringify(seatOn ?? profile.defaults.member);
        const fresh = (): string => unusedNick(String(r.repo));
        if (existing) {
          entry = existing.ended_at == null ? "again" : "back";
          // S24: a re-join is the member's call, so its row reads fresh in the roster, never stale from the seat's last member
          db.prepare("UPDATE participants SET doing = ?, files = ?, place = ?, ended_at = NULL, idle_ended = 0, dropped_owing = NULL, subs = ?, nick = COALESCE(nick, ?), pack = ?, verify = ?, pack_chosen = 1, last_call = ?, seated_at = ? WHERE id = ?").run(
            doing,
            JSON.stringify(files),
            where,
            subs,
            existing.nick == null ? fresh() : null,
            packName,
            verify,
            now(),
            now(),
            Number(existing.id),
          );
          // D7, G18: a re-join starts its liveness afresh: the earlier member's activity (a finished agent, a lost link
          // with its transcript) and the alerts told of it never carry into the new one
          db.prepare("DELETE FROM member_activity WHERE run = ? AND member = ?").run(run, seat);
          db.prepare("DELETE FROM liveness_warned WHERE run = ? AND member = ?").run(run, seat);
          db.prepare("DELETE FROM badge_episodes WHERE run = ? AND member = ? AND opened_at IS NULL").run(run, seat);
          db.prepare("UPDATE badge_episodes SET closed_at = ? WHERE run = ? AND member = ? AND closed_at IS NULL").run(Date.now(), run, seat);
          db.prepare("DELETE FROM member_links WHERE run = ? AND member = ?").run(run, seat);
          return Number(existing.id);
        }
        // a post that already names this seat (a task posted before the member joined) is still
        // the member's to read: its cursor starts just before the earliest one, else at now
        const earliest = db
          .prepare("SELECT MIN(seq) AS seq FROM messages WHERE run = ? AND mentions LIKE ?")
          .get(run, `%"${String(r.plan)}/${seat}"%`) as Row | undefined;
        const since = earliest?.seq != null ? Math.min(lastSeq(), Number(earliest.seq) - 1) : lastSeq();
        const ins = db
          .prepare("INSERT INTO participants (run, seat, place, doing, files, since_seq, joined_at, nick, subs, pack, verify, pack_chosen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)")
          .run(run, seat, where, doing, JSON.stringify(files), since, now(), fresh(), subs, packName, verify);
        return Number(ins.lastInsertRowid);
      });
      const member = participantById(id);
      // the member's pack takes what it declared, and reads it fresh (the code pack: its claims, merged since its join)
      packOf(member)?.onJoin?.(member, packCtxOf(member), files);
      // G5, D4: one line per join: the joined event names the seat as a composition line would, and every
      // member of the run hears it carried (events.ts), so no composition line beside it
      // break-flow V-15: a re-join posts no second joined: a seat whose member had ended reads as one `<seat> back`
      // line (`+ <seat> <nick> back: <doing>`); the same member joining again while seated posts nothing
      if (entry === "new") insertMessage(member, `joined: ${doing} · + ${seatWho(run, seat)}`, null, "event", undefined, { event: EVENTS.joined.name });
      else if (entry === "back") insertMessage(member, `+ ${seatWho(run, seat)} back: ${doing}`, null, "event", undefined, { event: EVENTS.joined.name });
      // D5: the last declared seat to get a member tells the orchestrator once
      if (entry === "new") {
        const declared = Number((db.prepare("SELECT COUNT(*) AS n FROM seats WHERE run = ?").get(run) as Row).n);
        const seated = Number((db.prepare("SELECT COUNT(*) AS n FROM participants WHERE run = ? AND seat != ?").get(run, ORCHESTRATOR) as Row).n);
        const phased = db.prepare("SELECT 1 FROM messages WHERE run = ? AND event = ?").get(run, EVENTS.phase.name) !== undefined;
        if (!phased && declared > 0 && seated >= declared && (db.prepare("SELECT 1 FROM seats s WHERE s.run = ? AND NOT EXISTS (SELECT 1 FROM participants p WHERE p.run = s.run AND p.seat = s.id)").get(run) === undefined)) {
          insertMessage(member, `all joined: ${declared} seat${declared === 1 ? "" : "s"}`, null, "event", undefined, { event: EVENTS["all-joined"].name });
        }
      }
      return { member, roster: board.roster(member.repo), composition: compositionOf(run) };
      });
    },

    composition(run) {
      runRow(run);
      return compositionOf(run);
    },

    participant(name, repo = null) {
      const i = name.lastIndexOf("/");
      if (i <= 0) return null;
      const plan = name.slice(0, i);
      const seat = name.slice(i + 1);
      // board-split#D58: the caller's project first, then its one open run of that group, then the latest closed one
      const r = db
        .prepare(`${PARTICIPANT_SQL} WHERE r.plan = ? AND p.seat = ? ORDER BY (r.repo = ?) DESC, (r.state = 'open') DESC, r.id DESC LIMIT 1`)
        .get(plan, seat, repo ?? "") as Row | undefined;
      return r ? toParticipant(r) : null;
    },

    identify({ place }) {
      if (!place) return null;
      const here = fold(path.resolve(place));
      const rows = (db.prepare(`${PARTICIPANT_SQL} WHERE p.place IS NOT NULL AND p.ended_at IS NULL AND r.state = 'open'`).all() as Row[]).filter(
        (r) => {
          const root = fold(String(r.place));
          return here === root || here.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
        },
      );
      if (!rows.length) return null;
      // the deepest place holding it; several members on that one place is no answer
      const deepest = Math.max(...rows.map((r) => String(r.place).length));
      const best = rows.filter((r) => String(r.place).length === deepest);
      return best.length === 1 ? toParticipant(best[0]) : null;
    },

    setDoing(p, doing) {
      const fresh = live(p);
      db.prepare("UPDATE participants SET doing = ? WHERE id = ?").run(doing, fresh.id);
      insertMessage(fresh, `doing: ${doing}`, null, "event");
    },

    subscribe(p, subs) {
      const fresh = live(p);
      // idea 2: an explicit subscription wakes, and replaces a carried one of the same event and scope
      const kept = fresh.subscriptions.filter((o) => !subs.some((s) => sameSub(o, s) && o.carry && !s.carry));
      const next = [...kept, ...subs.filter((s) => !kept.some((o) => sameSub(o, s)))];
      return transaction(() => {
        // U-F23: a subscription starts from now: what it would newly reach, already on the board, is marked had, never replayed
        const before = fresh.subscriptions;
        const mark = db.prepare("INSERT OR IGNORE INTO deliveries (participant, seq, at) VALUES (?, ?, ?)");
        for (const r of unseenRows(fresh)) {
          const m = toMessage(r);
          // what only rode on a wake before (a composition line, V-27) is no wake of its own now either
          const wokeBefore = mentionsMe(m, fresh) || wakes(m, fresh, before);
          const carriedBefore = carries(m, fresh, before);
          if (!wokeBefore && (wakes(m, fresh, next) || (!carriedBefore && carries(m, fresh, next)))) mark.run(fresh.id, m.seq, now());
        }
        return setSubs(fresh, next);
      });
    },

    unsubscribe(p, subs) {
      const fresh = live(p);
      return setSubs(fresh, fresh.subscriptions.filter((o) => !subs.some((s) => sameSub(o, s))));
    },

    end(p) {
      const fresh = live(p);
      // ended on an idle answer: idle-ended, the seat still owes the run's later phases
      const idleEnded = board.idle(fresh) ? 1 : 0;
      transaction(() => {
        // what the end frees in the member's pack (the code pack: its holds, and whoever was refused the lock it held)
        const freed = packOf(fresh)?.onEnded?.(fresh, packCtxOf(fresh)) ?? null;
        const lastDoing = freed?.lastDoing ?? "ended";
        const ended = { event: EVENTS.ended.name };
        // break-flow V-27: one post per end, the composition line as the ended event's body
        const said = `- ${seatWho(fresh.run, fresh.seat)} ended`;
        insertMessage(fresh, freed?.note ? `${said}
${freed.note}` : said, null, "event", freed?.mentions, ended);
        // the card's last word: what the member's run came to, not its last doing (D66)
        db.prepare("UPDATE participants SET ended_at = ?, idle_ended = ?, doing = ? WHERE id = ?").run(now(), idleEnded, lastDoing, fresh.id);
      });
    },

    phase(p, name, text, opts = {}) {
      const fresh = live(p);
      if (fresh.seat !== ORCHESTRATOR) throw new Error(`phase: only the orchestrator opens a phase; ${fresh.name} is not ${fresh.plan}/${ORCHESTRATOR}`);
      if (!PHASE_NAME.test(name)) throw new Error(`phase: a phase name is one word, got ${JSON.stringify(name)}`);
      const said = text.trim();
      if (!said) throw new Error(`phase ${name}: what does it ask?`);
      if (runRow(fresh.run).state !== "open") throw new Error(`run ${fresh.run} is closed`);
      return transaction(() => {
        // the run's current phase, the header of every delivery from now on
        // idea 2: the members whose `done` wakes the orchestrator in this phase (`--watch`), by id
        const seatOf = (w: string): string => w.slice(w.lastIndexOf("/") + 1).replace(/^@/, "");
        const watch = (opts.watch ?? []).map(seatOf).filter(Boolean);
        // `--for`: only these seats are woken and owe their done; the others read the phase as their next header
        const only = [...new Set((opts.for ?? []).map(seatOf).filter(Boolean))];
        const unknown = only.filter((s) => s === ORCHESTRATOR || (!db.prepare("SELECT 1 FROM seats WHERE run = ? AND id = ?").get(fresh.run, s) && !db.prepare("SELECT 1 FROM participants WHERE run = ? AND seat = ?").get(fresh.run, s)));
        if (unknown.length) throw new Error(`phase ${name}: --for names no seat of run ${fresh.run}: ${unknown.join(", ")}`);
        // board-split D62 (V-6): who owed the phase this one replaces, read before it is replaced
        const before = runRow(fresh.run);
        const stillOwed = before.phase == null ? [] : (() => {
          const scope = phaseScopeOf(before, String(before.phase));
          return phaseMembersOf(fresh.run, String(before.phase)).filter((m) => owesPhase(m, scope)).map((m) => m.member);
        })();
        db.prepare("UPDATE runs SET phase = ?, phase_text = ?, phase_watch = ?, phase_for = ?, phase_at = ? WHERE id = ?").run(name, said, watch.length ? JSON.stringify(watch) : null, only.length ? JSON.stringify(only) : null, now(), fresh.run);
        // a phase opened again starts with no member done
        db.prepare("DELETE FROM phase_done WHERE run = ? AND phase = ?").run(fresh.run, name);
        // D41: its all-done told once per opening
        db.prepare("DELETE FROM liveness_warned WHERE run = ? AND member = ? AND cond = ?").run(fresh.run, ORCHESTRATOR, `all-done ${name}`);
        const woken = only.length ? only.map((s) => `${fresh.plan}/${s}`) : [`${fresh.plan}/*`];
        return { ...insertMessage(fresh, `phase ${name}: ${said}`, null, "event", woken, { event: EVENTS.phase.name, meta: { phase: name } }), stillOwed };
      });
    },

    currentPhase(run) {
      return phaseOf(runRow(run));
    },

    showPhase(p) {
      const fresh = participantById(p.id);
      const phase = phaseOf(runRow(fresh.run));
      if (!phase) return null;
      // the phase is "shown" per opening: the phase event's seq, so a phase opened again is shown in full once more
      const opened = db.prepare("SELECT MAX(seq) AS seq FROM messages WHERE run = ? AND event = ?").get(fresh.run, EVENTS.phase.name) as Row;
      const key = `${phase.name}#${opened.seq ?? 0}`;
      const shown = db.prepare("SELECT phase_shown FROM participants WHERE id = ?").get(fresh.id) as Row;
      if (shown.phase_shown === key) return { phase, first: false };
      db.prepare("UPDATE participants SET phase_shown = ? WHERE id = ?").run(key, fresh.id);
      return { phase, first: true };
    },

    pause(p, text = "", opts = {}) {
      const fresh = live(p);
      if (fresh.seat !== ORCHESTRATOR) throw new Error(`pause: only the orchestrator pauses its run; ${fresh.name} is not ${fresh.plan}/${ORCHESTRATOR}`);
      const r = runRow(fresh.run);
      if (r.state !== "open") throw new Error(`run ${fresh.run} is closed`);
      if (r.paused != null) throw new Error(`run ${fresh.run} is already paused`);
      const said = text.trim();
      return transaction(() => {
        const person = opts.person === true;
        db.prepare("UPDATE runs SET paused = ?, paused_person = ? WHERE id = ?").run(said, person ? 1 : 0, fresh.run);
        const why = person ? `: waiting on the person${said ? `: ${said}` : ""}` : said ? `: ${said}` : "";
        return insertMessage(fresh, `pause: stop where you are and wait for the resume${why}`, null, "event", [`${fresh.plan}/*`], { event: EVENTS.pause.name, meta: { person, text: said } });
      });
    },

    park(p, seat, until) {
      return setParked(p, seat, true, until);
    },

    unpark(p, seat) {
      return setParked(p, seat, false);
    },

    block(p, seat, reason) {
      return setBlocked(p, seat, reason);
    },

    unblock(p, seat) {
      return setBlocked(p, seat, null);
    },

    resume(p, text = "") {
      const fresh = live(p);
      if (fresh.seat !== ORCHESTRATOR) throw new Error(`resume: only the orchestrator resumes its run; ${fresh.name} is not ${fresh.plan}/${ORCHESTRATOR}`);
      const r = runRow(fresh.run);
      if (r.state !== "open") throw new Error(`run ${fresh.run} is closed`);
      if (r.paused == null) throw new Error(`run ${fresh.run} is not paused`);
      const said = text.trim();
      return transaction(() => {
        // idea 2: what the pause held from the orchestrator (what would have woken it, or been carried to it) comes in
        // resume's answer, one line each, and is delivered with it; a carried one's deadline then counts from the resume
        const me = participantById(fresh.id);
        const held = unseenRows(me)
          .map(toMessage)
          .filter((m) => m.run === me.run && (mentionsMe(m, me) || wakes(m, me, me.subscriptions) || carries(m, me, me.subscriptions)));
        const mark = db.prepare("INSERT OR IGNORE INTO deliveries (participant, seq, at) VALUES (?, ?, ?)");
        for (const m of held) mark.run(me.id, m.seq, now());
        db.prepare("UPDATE runs SET paused = NULL, paused_person = 0, resumed_at = ?, stall_posts = 0 WHERE id = ?").run(now(), fresh.run);
        const message = insertMessage(fresh, `resume: continue${said ? `: ${said}` : ""}`, null, "event", [`${fresh.plan}/*`], { event: EVENTS.resume.name });
        return { ...message, held: held.map(messageLine) };
      });
    },

    pausedOf(run) {
      const r = runRow(run);
      return r.paused == null ? null : String(r.paused);
    },

    done(p, name, opts = {}) {
      const fresh = live(p);
      // board-split D63: the orchestrator's done line carries the branch still holding work not merged
      const unmergedSuffix = opts.unmerged ? `; unmerged ${opts.unmerged}` : "";
      if (fresh.seat === ORCHESTRATOR) throw new Error("done: the orchestrator opens phases; a member runs done");
      const current = phaseOf(runRow(fresh.run));
      if (!current) throw new Error(`done ${name}: no phase is open in run ${fresh.run}`);
      const orch = `${fresh.plan}/${ORCHESTRATOR}`;
      // board-split D62 (V-5): what the member owes once this done is recorded, so its answer names it
      // V-28: a seat the count leaves out is told so, never shown a count it is not in
      const notOwedOf = (): NotOwed => {
        const r = runRow(fresh.run);
        if (fresh.parked) return { parked: true };
        const scope = phaseScopeOf(r, name);
        return phaseIsForSeat(scope, fresh.seat) ? null : { forSeats: scope.forSeats ?? [] };
      };
      const owesNow = (): string | null => owedNameOf(db.prepare("SELECT * FROM participants WHERE id = ?").get(fresh.id) as Row, runRow(fresh.run));
      // idea 2: a done for a phase opened earlier in the run, not the current one, is accepted, recorded, and wakes
      if (current.name !== name) {
        const opened = (db.prepare("SELECT meta FROM messages WHERE run = ? AND event = ?").all(fresh.run, EVENTS.phase.name) as Row[]).some(
          (r) => r.meta != null && (JSON.parse(String(r.meta)) as { phase?: string }).phase === name,
        );
        if (!opened) throw new Error(`done ${name}: the current phase is ${current.name}`);
        return transaction(() => {
          const added = Number(db.prepare("INSERT OR IGNORE INTO phase_done (run, participant, phase, at) VALUES (?, ?, ?, ?)").run(fresh.run, fresh.id, name, now()).changes) > 0;
          const progress = progressOf(fresh.run, name)!;
          if (!added) return { progress, all: false, already: true, late: true, owesNow: owesNow(), notOwed: null, message: null };
          const message = insertMessage(fresh, `late done ${name}; the current phase is ${current.name}${unmergedSuffix}`, null, "event", [orch], { event: EVENTS.done.name, meta: { phase: name } });
          return { progress, all: false, already: false, late: true, owesNow: owesNow(), notOwed: null, message };
        });
      }
      return transaction(() => {
        const added = Number(db.prepare("INSERT OR IGNORE INTO phase_done (run, participant, phase, at) VALUES (?, ?, ?, ?)").run(fresh.run, fresh.id, name, now()).changes) > 0;
        const progress = progressOf(fresh.run, name)!;
        const all = everyOwingDone(progress);
        if (!added) return { progress, all, already: true, late: false, owesNow: null, notOwed: notOwedOf(), message: null };
        // board-split D33 (S35): the done is the member's latest fact, shown over an older doing
        db.prepare("UPDATE participants SET doing = ? WHERE id = ?").run(`done ${name}`, fresh.id);
        // idea 2: the done wakes the orchestrator only in the person's cases, named in its body; otherwise it is carried
        const wakeCase = doneWakeCase(fresh, name, progress);
        // V-27: the count and who still owes it together, the unmerged branch last
        const body = `done ${name} (${progress.done}/${progress.of})${goneSuffix(progress.gone)}${wakeCase ? `: ${wakeCase}` : ""}${unmergedSuffix}`;
        const message = insertMessage(fresh, body, null, "event", wakeCase ? [orch] : [], { event: EVENTS.done.name, meta: { phase: name } });
        markPhaseOpenDelivered(fresh, name);
        allDoneOnce(fresh, progress);
        return { progress, all, already: false, late: false, owesNow: null, notOwed: notOwedOf(), message };
      });
    },

    lastActivity(run) {
      // what the board posts on its own clock (stopped, lost) is no member's activity: counted, a forgotten run's
      // stale flag would unforget it (S31)
      const r = runRow(run);
      const row = db
        .prepare("SELECT MAX(COALESCE(p.last_call, p.joined_at)) AS calls, (SELECT MAX(m.at) FROM messages m JOIN participants q ON q.id = m.author WHERE q.run = ? AND m.by_board = 0) AS posts FROM participants p WHERE p.run = ?")
        .get(run, run) as Row | undefined;
      return [String(r.opened_at), row?.calls, row?.posts].filter((v): v is string => typeof v === "string").sort().at(-1)!;
    },

    phaseProgress(run) {
      const r = runRow(run);
      return progressOf(run, r.phase == null ? null : String(r.phase));
    },

    owedPhase(p) {
      // board-split D62: the one owing rule, owedNameOf's
      const row = db.prepare("SELECT * FROM participants WHERE id = ?").get(p.id) as Row | undefined;
      if (!row || row.ended_at != null) return null;
      const r = db.prepare("SELECT * FROM runs WHERE id = ?").get(Number(row.run)) as Row | undefined;
      return r && owedNameOf(row, r) != null ? phaseOf(r) : null;
    },

    recordActivity(run, member, act, at) {
      const r = db.prepare("SELECT * FROM runs WHERE id = ?").get(run) as Row | undefined;
      if (!r || r.state !== "open") return;
      if (!db.prepare("SELECT 1 FROM participants WHERE run = ? AND seat = ? AND ended_at IS NULL").get(run, member)) return;
      transaction(() => {
        const o = act.openTool;
        db.prepare(
          `INSERT INTO member_activity (run, member, grew_at, tokens, context, open_tool, open_target, open_since, open_wait, last_tool, finished, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (run, member) DO UPDATE SET grew_at = excluded.grew_at, tokens = excluded.tokens, context = excluded.context, open_tool = excluded.open_tool,
             open_target = excluded.open_target, open_since = excluded.open_since, open_wait = excluded.open_wait, last_tool = excluded.last_tool, finished = excluded.finished, at = excluded.at`,
        ).run(run, member, act.grewAt, act.tokens, act.context, o?.name ?? null, o?.target ?? null, o?.since ?? null, o?.boardWait ? 1 : 0, act.lastTool, act.finished ? 1 : 0, at.getTime());
        // idea 1: the turn state, last line, awaited background task and transcript path; absent from an older link, kept null
        const bg = act.background ?? null;
        db.prepare("UPDATE member_activity SET in_turn = ?, last_line = ?, bg_target = ?, bg_since = ?, bg_grew_at = ?, transcript = ? WHERE run = ? AND member = ?").run(
          act.inTurn == null ? null : act.inTurn ? 1 : 0,
          act.lastLine ?? null,
          bg?.target ?? null,
          bg?.since ?? null,
          bg?.outputGrewAt ?? null,
          act.transcript ?? null,
          run,
          member,
        );
        db.prepare("UPDATE member_activity SET open_label = ?, open_command = ?, bg_label = ?, bg_command = ? WHERE run = ? AND member = ?").run(
          o?.label ?? null,
          o?.command ?? null,
          bg?.label ?? null,
          bg?.command ?? null,
          run,
          member,
        );
        const listener = act.listener ?? null;
        db.prepare("UPDATE member_activity SET listener_running = ?, listener_ended_at = ? WHERE run = ? AND member = ?").run(
          listener == null ? null : listener.running ? 1 : 0,
          listener?.endedAt ?? null,
          run,
          member,
        );
        db.prepare("INSERT INTO token_readings (run, member, t, tokens) VALUES (?, ?, ?, ?)").run(run, member, at.toISOString(), act.tokens);
        // idea 4: a kill the link saw, by name, pattern or port: to the orchestrator alone, once per distinct command per member
        const kill = act.breach ?? null;
        const me = kill ? (db.prepare("SELECT id, joined_at FROM participants WHERE run = ? AND seat = ? AND ended_at IS NULL").get(run, member) as Row) : null;
        // G2: only a kill after the member joined (the orchestrator: after the open) is judged; the transcript's earlier lines are not the run's
        if (kill && me && kill.at >= Date.parse(String(me.joined_at))) {
          const ports = kill.ports ?? [];
          const breached = kill.kind === "pattern" || ports.length > 0;
          const command = kill.command.slice(0, 120);
          if (breached && Number(db.prepare("INSERT OR IGNORE INTO liveness_warned (run, member, cond) VALUES (?, ?, ?)").run(run, member, `breach ${command}`).changes) === 1) {
            const orch = orchestratorIn(run);
            const onPorts = kill.kind === "port" ? ` (port ${ports.join(", ")})` : "";
            insertMessage(orch, `breach ${String(r.plan)}/${member}: ${command}${onPorts}`, null, "event", [orch.name], { event: EVENTS.breach.name, meta: { breach: `${String(r.plan)}/${member}` } });
          }
        }
        bump(String(r.repo));
      });
    },

    memberStates(run, at) {
      return [...statesOf(run, at.getTime()).values()];
    },

    livenessTick(run, at, presence) {
      const r = db.prepare("SELECT * FROM runs WHERE id = ?").get(run) as Row | undefined;
      if (!r || r.state !== "open") {
        presenceOf.delete(run);
        return false;
      }
      presenceOf.set(run, presence);
      const t = at.getTime();
      transaction(() => {
        db.prepare("DELETE FROM token_readings WHERE run = ? AND t < ?").run(run, new Date(t - READINGS_KEPT_MS).toISOString());
        const orch = orchestratorIn(run);
        let moved = false;
        // simple-states (#48): owing is judged when the link drops, and kept until the link is back
        for (const p of db.prepare("SELECT * FROM participants WHERE run = ? AND ended_at IS NULL").all(run) as Row[]) {
          const up = presence(String(p.seat)).connected;
          if (!up && p.dropped_owing == null) db.prepare("UPDATE participants SET dropped_owing = ? WHERE id = ?").run(owesOf(p, r) ? 1 : 0, Number(p.id));
          else if (up && p.dropped_owing != null) db.prepare("UPDATE participants SET dropped_owing = NULL WHERE id = ?").run(Number(p.id));
        }
        const states = statesOf(run, t, true);
        // board-split D30: a parked member raises nothing and is not waited on
        const parkedSeats = new Set((db.prepare("SELECT seat FROM participants WHERE run = ? AND ended_at IS NULL AND parked = 1").all(run) as Row[]).map((x) => String(x.seat)));
        const others = [...states.values()].filter((st) => st.member !== ORCHESTRATOR && !parkedSeats.has(st.member));
        for (const st of others) {
          // board-split D55: lost is an episode, opened once its predicate held BADGE_CONFIRM_MS, told once; never re-fired by a timer
          const lostStep = episodeStep(run, st.member, "lost", st.badge?.name === "lost", t);
          if (lostStep === "opened") {
            raiseAlert(run, { body: `lost ${orch.plan}/${st.member}: ${st.badge!.reason}`, event: EVENTS.lost.name });
            postComposition(orch, st.member, "-", "lost");
            const lostRow = db.prepare("SELECT id FROM participants WHERE run = ? AND seat = ? AND ended_at IS NULL").get(run, st.member) as Row | undefined;
            if (lostRow) {
              // board-split D59: what its pack holds that others wait on (the merge lock) is released at once, the
              // orchestrator and the waiters told, as the lost member, as a release by its holder would be
              const lostMember = participantById(Number(lostRow.id));
              const freed = packOf(lostMember)?.onLost?.(lostMember, packCtxOf(lostMember)) ?? null;
              if (freed) insertMessage(lostMember, freed.body, null, "event", [...new Set([...freed.mentions, orch.name])], { event: EVENTS.unlocked.name, meta: { unlocked: freed.unlocked } });
            }
            moved = true;
          } else if (lostStep === "closed") {
            postComposition(orch, st.member, "+", "back");
            moved = true;
          }
        }
        // a member parked or ended closes its episodes without a word (D30)
        closeEpisodesOutside(run, others.map((st) => st.member), t);
        flushAlerts(run, t, orch);
        // D41: the lost members this tick told are out of the count; the last one not done lost means all-done now
        const progress = progressOf(run, r.phase == null ? null : String(r.phase));
        const where = progress ? `phase ${progress.phase} ${progressText(progress)}` : "no phase open";
        if (progress?.gone.length) allDoneOnce(orch, progress);
        // simple-states: swarm stopped: no member's tokens moved for the run's stall window; told once per still
        // spell (a move re-arms it), never while paused
        const members = (db.prepare("SELECT * FROM participants WHERE run = ? AND ended_at IS NULL AND seat != ? AND parked = 0").all(run, ORCHESTRATOR) as Row[]);
        const lastMove = Math.max(0, r.resumed_at == null ? 0 : Date.parse(String(r.resumed_at)), ...members.map((p) => tokensMovedAtOf(p, r)));
        if (r.paused == null && members.length && t - lastMove >= stallWindowOf(r) &&
          Number(db.prepare("INSERT OR IGNORE INTO liveness_warned (run, member, cond) VALUES (?, ?, ?)").run(run, ORCHESTRATOR, `stopped ${lastMove}`).changes) === 1) {
          insertMessage(orch, `stopped ${orch.plan}: no member's tokens moved for ${minutes(t - lastMove)} min; ${where}${unansweredSuffix(run, orch)}`, null, "event", [orch.name], { event: EVENTS.stopped.name });
        }
        // idea 2: a carried message pending CARRY_MAX_MS (from its post, or the resume) is due: it wakes its member's
        // wait by itself. Never while paused: the deadline does not run
        if (r.paused == null) {
          const resumedAt = r.resumed_at == null ? 0 : Date.parse(String(r.resumed_at));
          const markDue = db.prepare("INSERT OR IGNORE INTO carry_due (participant, seq) VALUES (?, ?)");
          for (const row of db.prepare("SELECT id FROM participants WHERE run = ? AND ended_at IS NULL").all(run) as Row[]) {
            const me = participantById(Number(row.id));
            if (!me.subscriptions.some((s) => s.carry)) continue;
            for (const m of unseenRows(me).map(toMessage)) {
              if (!carries(m, me, me.subscriptions) || eventDef(eventOf(m)!).ambient || t - Math.max(Date.parse(m.at), resumedAt) < CARRY_MAX_MS) continue;
              if (Number(markDue.run(me.id, m.seq).changes) === 1) moved = true;
            }
          }
        }
        // U-F20: a state or badge that came or went with time alone (stopped, lost) is a change too, so a reader's card follows it
        // plan D55 (4): the whole drawn view (state, badge and since when) is compared, never the reason's text,
        // whose age moves every tick
        // board-split D55: the badges as shown, so an episode opened at this tick is drawn
        const live = db.prepare("SELECT * FROM participants WHERE run = ? AND ended_at IS NULL ORDER BY id").all(run) as Row[];
        const badgesNow = live.map((p) => { const st = memberView(p, r, t); return `${st.member}:${memberStateOf(p, r, t)}:${st.state}:${st.badge?.name ?? ""}:${st.badge?.since ?? ""}`; }).join(",");
        // a server's first tick only learns them: what a reader drew at its connect is this already
        if (badgesShown.get(run) !== badgesNow) {
          if (badgesShown.has(run)) moved = true;
          badgesShown.set(run, badgesNow);
        }
        if (moved) bump(String(r.repo));
      });
      return true;
    },

    endedMembers(repo) {
      const rows = db.prepare(`${PARTICIPANT_SQL} WHERE r.repo = ? AND r.state = 'open' AND p.ended_at IS NOT NULL`).all(repo) as Row[];
      return [...new Set(rows.map((r) => `${r.plan}/${r.seat}`))];
    },

    heldBy(p) {
      return (packOf(p)?.held?.(db, p.id) ?? []).map((d) => d.path);
    },

    roster(repo) {
      const rows = db
        .prepare(`${PARTICIPANT_SQL} WHERE r.repo = ? AND r.state = 'open' AND p.ended_at IS NULL ORDER BY r.id, p.id`)
        .all(repo) as Row[];
      const t = Date.now();
      const cutoff = t - STALE_MS;
      const statesByRun = new Map<RunId, Map<string, MemberState>>();
      const stateIn = (run: RunId, member: string): MemberState | undefined => {
        if (!statesByRun.has(run)) statesByRun.set(run, statesOf(run, t));
        return statesByRun.get(run)!.get(member);
      };
      return rows.map((r) => ({
        name: `${r.plan}/${r.seat}`,
        nick: nickOf(r),
        run: Number(r.run),
        plan: String(r.plan),
        seat: String(r.seat),
        doing: String(r.doing),
        files: JSON.parse(String(r.files)) as Declared[],
        held: registry.heldOf(db, Number(r.id)),
        everClaimed: registry.everClaimedOf(db, Number(r.id)),
        badge: stateIn(Number(r.run), String(r.seat))?.badge ?? null,
        subscriptions: subsOf(r),
        worktree: r.place == null ? null : String(r.place), // AGENTS EXCEPTION (rule D24): the roster's JSON key, frozen
        // board-split D49: the one state; what it does (busy on a call or a background task) is its activity
        // U-F12: the pack's fact (merging) is the state word here too, as in the snapshot
        state: memberStateOf(r, db.prepare("SELECT * FROM runs WHERE id = ?").get(Number(r.run)) as Row | undefined, t),
        ...(Number(r.parked) === 1 ? { parked: true as const } : {}),
        ...(Number(r.parked) === 1 && r.parked_until != null ? { parkedUntil: String(r.parked_until) } : {}),
        activity: Number(r.parked) === 1 ? null : (stateIn(Number(r.run), String(r.seat))?.doing ?? null),
        ...agesOf(livenessOf(Number(r.run), stateIn(Number(r.run), String(r.seat)), t)),
        unread: unreadOf(Number(r.id)),
        ...factEntry(toParticipant(r)),
      }));
    },

    post(p, body, opts = {}) {
      const fresh = live(p);
      let named: string[] | undefined;
      if (opts.kind === "agreement") {
        // an agreement's parties (F25): its mentions, then --with, else the other holders of the file it is about
        const parsed = parseMentions(body, fresh.plan, openPlans(fresh.repo), activeNames(fresh.repo));
        const extra = (opts.with ?? []).map((w) => w.trim().replace(/^@/, "")).filter(Boolean);
        const given = extra.length ? parseMentions(extra.map((w) => `@${w}`).join(" "), fresh.plan, openPlans(fresh.repo), activeNames(fresh.repo)) : [];
        const holders = !parsed.length && !given.length && opts.about ? (packOf(fresh)?.defaultParties?.(opts.about, packCtxOf(fresh)) ?? []).filter((n) => n !== fresh.name) : [];
        named = [...new Set([...parsed, ...given, ...holders])].filter((n) => n !== fresh.name);
        // on a code run an agreement binds two: with no other party it is refused (F25); a brainswarm agreement binds the room
        if (!named.length && fresh.pack !== null) throw new Error("agree needs another party: @<seat> or --with <seat>; to inform, use post");
      }
      const m = insertMessage(fresh, body, opts.about ?? null, opts.kind ?? "msg", undefined, named ? { parties: named } : {});
      // posting is claiming (D7), on a kind with claims
      const facts = packOf(fresh)?.onPost?.(fresh, m, packCtxOf(fresh)) ?? null;
      return facts ? { ...m, ...facts } : m;
    },

    endorse(p, seq) {
      const fresh = live(p);
      const r = db.prepare("SELECT * FROM messages WHERE seq = ?").get(seq) as Row | undefined;
      if (!r) throw new Error(`unknown message #${seq}`);
      if (r.kind !== "agreement") throw new Error(`#${seq} is not an agreement`);
      if (Number(r.author) === fresh.id) throw new Error(`#${seq} is your own agreement`);
      const author = participantById(Number(r.author));
      const about = r.about == null ? null : String(r.about);
      return insertMessage(fresh, `endorses #${seq}`, about, "endorsement", [author.name], { endorses: seq });
    },

    thread(p, name) {
      const fresh = participantById(p.id);
      const phase = name ?? phaseOf(runRow(fresh.run))?.name;
      // board-split F5: a run with no phase (a brainstorm) gives every post of the run
      if (!phase) return this.runThread(fresh.run);
      return phasePosts(fresh.run, phase);
    },

    runThread(run, name) {
      runRow(run);
      if (name !== undefined) return phasePosts(run, name);
      return (db.prepare("SELECT * FROM messages WHERE run = ? AND kind != 'event' ORDER BY seq").all(run) as Row[]).map(toMessage);
    },

    read(seq, by) {
      const r = db.prepare("SELECT * FROM messages WHERE seq = ?").get(seq) as Row | undefined;
      if (!r) throw new Error(`unknown message #${seq}`);
      // G23, V6: a member that read a message in full has had it; its next wait never brings it again
      if (by) db.prepare("INSERT OR IGNORE INTO deliveries (participant, seq, at) VALUES (?, ?, ?)").run(by.id, seq, now());
      return toMessage(r);
    },

    deliver(p) {
      return deliverTo(p, false);
    },

    deliverMentions(p) {
      return deliverTo(p, false, true);
    },

    idle(p) {
      const row = db.prepare("SELECT * FROM participants WHERE id = ?").get(p.id) as Row | undefined;
      if (!row || row.ended_at != null || String(row.seat) === ORCHESTRATOR || Number(row.empty_waits) < 2) return false;
      if (owedNameOf(row, runRow(Number(row.run))) != null) return false;
      // a member its pack calls busy (the code pack: holding a claim or the merge lock) is never idle
      const fresh = participantById(p.id);
      if (packOf(fresh)?.busy?.(fresh, packCtxOf(fresh))) return false;
      // rechecked at answer time: a mention landed since the wait returned empty means work
      return unreadOf(p.id) === 0;
    },

    unreadMentions(p) {
      return unreadOf(p.id);
    },

    guidesUntold(p, guides) {
      const tell = db.prepare("INSERT OR IGNORE INTO guides_told (participant, guide) VALUES (?, ?)");
      return transaction(() => guides.filter((g) => tell.run(p.id, g).changes > 0));
    },

    wait(p, opts = {}) {
      const { timeoutMs, mentionsOnly = false, signal: abort } = opts;
      const column = mentionsOnly ? "listening" : "waiting";
      // a member inside a `wait` shows `waiting` on the page; inside a `wait --mentions`, `listening`
      // beside its state. One live wait per member (D64): this one takes the next number and the page's state, and any
      // older pending wait, here or in another process, sees the number move and returns superseded
      const gen = transaction(() => {
        const me = participantById(p.id);
        db.prepare("UPDATE participants SET wait_gen = wait_gen + 1, waiting = ?, listening = ? WHERE id = ?").run(mentionsOnly ? 0 : 1, mentionsOnly ? 1 : 0, me.id);
        bump(me.repo);
        return Number((db.prepare("SELECT wait_gen FROM participants WHERE id = ?").get(me.id) as Row).wait_gen);
      });
      const current = (): boolean => Number((db.prepare("SELECT wait_gen FROM participants WHERE id = ?").get(p.id) as Row).wait_gen) === gen;
      // D35: held from now until it returns; a newer wait of the member takes it over
      const held = Date.now();
      heldWaits.set(p.id, held);
      return new Promise<Delivery>((resolve, reject) => {
        let settled = false;
        let poll: NodeJS.Timeout | undefined;
        let timer: NodeJS.Timeout | undefined;
        let timedOut = false;
        const finish = (d: Delivery | Error): void => {
          if (settled) return;
          settled = true;
          localWakers.delete(check);
          abort?.removeEventListener("abort", onAbort);
          clearInterval(poll);
          clearTimeout(timer);
          if (heldWaits.get(p.id) === held) heldWaits.delete(p.id);
          // a wait --mentions that held to its end with nothing counts toward idle; a delivery starts the count again
          const got = !(d instanceof Error) && (d.full.length > 0 || d.lines.length > 0);
          if (got || timedOut) {
            try {
              db.prepare(`UPDATE participants SET empty_waits = ${got || !mentionsOnly ? "0" : "empty_waits + 1"} WHERE id = ?`).run(p.id);
            } catch {}
          }
          try {
            // the page's state is this wait's only while no newer one took it
            transaction(() => {
              const r = db.prepare(`UPDATE participants SET ${column} = 0 WHERE id = ? AND wait_gen = ? AND ${column} = 1`).run(p.id, gen);
              if (Number(r.changes) > 0) bump(participantById(p.id).repo);
            });
          } catch {}
          if (d instanceof Error) reject(d);
          else resolve(d);
        };
        const check = (): void => {
          if (settled) return;
          try {
            // `end`, from this process or another, releases a pending wait of that member
            if (participantById(p.id).ended) return finish({ full: [], lines: [] });
            // the look and the superseded test in one transaction: a superseded wait takes nothing
            const d = transaction(() => (current() ? deliverTo(p, true, mentionsOnly) : null));
            if (!d) return finish({ full: [], lines: [], superseded: true });
            if (d.full.length || d.lines.length) finish(d);
          } catch (e) {
            finish(e as Error);
          }
        };
        // listen first, then look: a post landing between the two is still seen
        const onAbort = (): void => finish({ full: [], lines: [] });
        if (abort?.aborted) return onAbort();
        abort?.addEventListener("abort", onAbort);
        localWakers.add(check);
        poll = setInterval(check, WAIT_POLL_MS);
        if (timeoutMs !== undefined)
          timer = setTimeout(() => {
            timedOut = true;
            finish({ full: [], lines: [] });
          }, timeoutMs);
        check();
      });
    },
    packCall(p, verb, input) {
      const member = p ? participantById(p.id) : null;
      // an ended member's verb has nothing for its pack to do (the verb itself answers it); afterEnd runs once it has
      if (member?.ended && verb !== "afterEnd") {
        // a write to an ended member's name is refused, as any verb of an ended member is
        if (registry.all().some((k) => Object.hasOwn(k.writes ?? {}, verb))) live(member);
        return null;
      }
      // whose pack answers: the member's own; a seat not joined yet, its seat's row; a run's call, its kind's; else every pack
      const runId = member ? member.run : typeof input.run === "number" ? input.run : null;
      const packs = member
        ? [registry.packNamed(member.pack)]
        : runId !== null && typeof input.seat === "string"
          ? [registry.forMember(String(runRow(runId).kind ?? "plan"), (db.prepare("SELECT role FROM seats WHERE run = ? AND id = ?").get(runId, input.seat) as Row | undefined)?.role as string | null ?? null).pack]
          : runId !== null
            ? [registry.packNamed(kindPackOf(String(runRow(runId).kind ?? "plan")))]
            : registry.all();
      const ctx = runId !== null ? runPackCtx(runId) : null;
      // a pack verb called by a member whose pack lacks it: the refusal fact the answer module words (D12)
      const offers = (k: Pack | null | undefined): boolean => !!k && (k.verbs.some((v) => v.name === verb) || Object.hasOwn(k.writes ?? {}, verb));
      const known = registry.all().some(offers);
      const own = packs[0];
      if (member && known && !offers(own)) {
        const refusal: PackRefusal = { refused: { reason: "no-pack", verb, seatKind: member.verify ? "verifier" : "seat" } };
        return refusal;
      }
      if (member && ctx && own && verb === "beforeEnd") return own.beforeEnd?.(member, ctx) ?? null;
      if (member && ctx && own && verb === "afterEnd") return own.afterEnd?.(member, ctx) ?? {};
      // a member's write: the pack's tables, in the core's transaction with the call counted (D9, D19)
      const write = member && own?.writes && Object.hasOwn(own.writes, verb) ? own.writes[verb] : null;
      if (member && write && own && ctx)
        return transaction(() => {
          const out = write.apply(live(member), input, ctx);
          if (write.countedAs !== null) countCall(member, write.countedAs, write.progress);
          return out;
        });
      const answers = packs.filter((k): k is NonNullable<typeof k> => !!k?.run).map((k) => k.run!(verb, member, input, ctx, packTables));
      return answers.length <= 1 ? (answers[0] ?? null) : answers.flat();
    },


    repos() {
      const byRepo = new Map<string, RunSummary[]>();
      for (const r of listedRuns()) {
        const list = byRepo.get(String(r.repo)) ?? [];
        list.push(runSummary(r));
        byRepo.set(String(r.repo), list);
      }
      // repositories with an open run first, then the most recent run first
      const latest = (runs: RunSummary[]): number => Math.max(...runs.map((x) => x.run));
      return [...byRepo.entries()]
        .map(([repo, runs]) => ({ repo, name: projectFolderName(repo), runs }))
        .sort((a, b) => Number(b.runs.some((x) => x.open)) - Number(a.runs.some((x) => x.open)) || latest(b.runs) - latest(a.runs));
    },

    snapshot(repo) {
      const runRows = listedRuns().filter((r) => r.repo === repo);
      if (!runRows.length) throw new Error(`no project ${repo}`);
      const runIds = runRows.map((r) => Number(r.id));
      const marks = runIds.map(() => "?").join(", ");


      const sliceRows = db.prepare(`SELECT s.* FROM seats s WHERE s.run IN (${marks}) ORDER BY s.run, s.ord`).all(...runIds) as Row[];
      const sliceOf = new Map(sliceRows.map((s) => [`${s.run}/${s.id}`, s]));
      const people = db.prepare(`${PARTICIPANT_SQL} WHERE p.run IN (${marks}) ORDER BY p.run, p.id`).all(...runIds) as Row[];
      const runOpen = new Map(runRows.map((r) => [Number(r.id), r.state === "open"]));
      const t = Date.now();
      const statesByRun = new Map<RunId, Map<string, MemberState>>();
      const stateIn = (run: RunId, member: string): MemberState | undefined => {
        if (!statesByRun.has(run)) statesByRun.set(run, statesOf(run, t));
        return statesByRun.get(run)!.get(member);
      };
      const cutoff = t - STALE_MS;
      // the pack's fields of the project: the lock and its turns, the files held, the flags (D18)
      const packPart = registry.snapshot({ db, isLive, nameOf: (id) => participantById(id).name, relPath }, repo, people, ORCHESTRATOR);

      const runsById = new Map(runRows.map((x) => [Number(x.id), x]));
      const runById = (id: number): Row | undefined => runsById.get(id);
      const roster: SnapshotMember[] = people.map((r) => {
        const id = Number(r.id);
        const seat = String(r.seat);
        const orchestrator = seat === ORCHESTRATOR;
        const s = sliceOf.get(`${r.run}/${seat}`);
        const ended = r.ended_at != null;
        const runR = runById(Number(r.run));
        const owedPhase = runR ? owedNameOf(r, runR) : null;
        const core = memberStateOf(r, runR ?? undefined, t);
        const state: SnapshotMemberState = core;
        // what its pack says of it (merging), beside its state, on a live member only
        const fact = core === "working" || core === "stopped" ? packPart.factOf(id) : null;
        return {
          run: Number(r.run),
          member: `${r.plan}/${seat}`,
          nick: nickOf(r),
          plan: String(r.plan),
          seat,
          ...(orchestrator || s?.role == null ? {} : { role: String(s.role) }),
          ...(orchestrator || s?.area == null ? {} : { area: String(s.area) }),
          doing: String(r.doing),
          state,
          ...(fact ? { fact } : {}),
          stale: !ended && !orchestrator && Date.parse(String(r.last_call ?? r.joined_at)) < cutoff,
          files: packPart.heldFilesOf(id),
          joined: String(r.joined_at),
          ended: r.ended_at == null ? null : String(r.ended_at),
          calls: Number(r.calls ?? 0),
          listening: !ended && Number(r.listening) === 1,
          on: subsOf(r).map((x) => formatSubscriptions([x])),
          lastCall: String(r.last_call ?? r.joined_at),
          liveness: ended ? undefined : livenessOf(Number(r.run), stateIn(Number(r.run), seat), t),
          badge: ended ? null : (livenessOf(Number(r.run), stateIn(Number(r.run), seat), t)?.badge ?? null),
          unread: ended ? 0 : unreadOf(id),
          ...(Number(r.parked) === 1 ? { parked: true as const } : {}),
          ...(Number(r.parked) === 1 && r.parked_until != null ? { parkedUntil: String(r.parked_until) } : {}),
          // U-F13: a parked or ended seat runs nothing the card should show; its last calls are stale
          ...(ended || Number(r.parked) === 1 ? {} : activityShown(Number(r.run), seat)),
        };
      });

      const events = (
        db.prepare("SELECT * FROM (SELECT * FROM messages WHERE repo = ? ORDER BY seq DESC LIMIT ?) ORDER BY seq").all(repo, EVENTS_SHOWN) as Row[]
      ).map((r) => {
        const m = toMessage(r);
        const alarm = Number(r.by_board) === 1 && m.kind === "event" && !!m.event && BOARD_ALARMS.has(m.event);
        const subject = alarm ? alarmSubjectOf(m) : null;
        return {
          seq: m.seq,
          at: m.at,
          kind: m.kind,
          from: alarm ? BOARD_AUTHOR : m.from,
          ...(subject ? { subject } : {}),
          body: m.body,
          about: m.about,
          run: m.run,
          channel: m.run,
          event: m.event,
          mentions: m.mentions,
          meta: m.meta ?? null,
        };
      });

      const nameOf = new Map(people.map((r) => [`${r.run}/${r.seat}`, `${r.plan}/${r.seat}`]));
      const queues: Record<string, QueueSeat[]> = {};
      for (const run of runRows) {
        // a later run of the same plan on the project replaces the earlier one
        queues[String(run.plan)] = sliceRows
          .filter((s) => Number(s.run) === Number(run.id))
          .map((s) => ({
            seat: String(s.id),
            ...(s.role == null ? {} : { role: String(s.role) }),
            ...(s.area == null ? {} : { area: String(s.area) }),
            link: s.link == null ? null : String(s.link),
            state: seatStateOf(run, String(s.id), false),
            blockers: JSON.parse(String(s.blockers)) as string[],
            member: nameOf.get(`${run.id}/${s.id}`) ?? null,
          }));
      }


      return {
        repo,
        name: projectFolderName(repo),
        runs: runRows.map(runSummary),
        ...packPart.fields,
        roster,
        events,
        queues,
      };
    },

    onChange(listener) {
      listeners.add(listener);
      if (!watching) {
        versions = readVersions();
        const check = (): void => {
          let next: Map<string, number>;
          try {
            next = readVersions();
          } catch {
            return; // the store is busy or closing: the next look catches up
          }
          const moved = [...next].filter(([repo, v]) => versions.get(repo) !== v).map(([repo]) => repo);
          versions = next;
          for (const repo of moved) for (const l of [...listeners]) l(repo);
        };
        localWakers.add(check);
        const poll = setInterval(check, WAIT_POLL_MS);
        // watching must never be what keeps a process alive
        poll.unref?.();
        watching = { close: () => (localWakers.delete(check), clearInterval(poll)) };
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size && watching) {
          watching.close();
          watching = null;
        }
      };
    },

    recordLink(run, member, link) {
      // board-split D55: a heartbeat alone (connected before and after) changes no view, so it moves no version
      const before = db.prepare("SELECT connected, cause FROM member_links WHERE run = ? AND member = ?").get(run, member) as Row | undefined;
      db.prepare("INSERT OR REPLACE INTO member_links (run, member, connected, lost_at, seen_at, cause) VALUES (?, ?, ?, ?, ?, ?)").run(run, member, link.connected ? 1 : 0, link.lostAt, link.seenAt ?? null, link.cause ?? null);
      const heartbeatOnly = before != null && link.connected && Number(before.connected) === 1;
      // plan D55 (4): a link up or down is a fact; its write moves the version, so a reader redraws at once
      const linkRun = heartbeatOnly ? undefined : (db.prepare("SELECT repo FROM runs WHERE id = ?").get(run) as Row | undefined);
      if (linkRun) bump(String(linkRun.repo));
    },

    recordServerUp(at) {
      db.prepare("INSERT OR REPLACE INTO server_facts (name, value) VALUES ('server_up_at', ?)").run(at);
    },

    savedLinks() {
      return (db.prepare("SELECT * FROM member_links").all() as Row[]).map((r) => ({
        run: Number(r.run),
        member: String(r.member),
        connected: Number(r.connected) === 1,
        lostAt: r.lost_at == null ? null : Number(r.lost_at),
        seenAt: r.seen_at == null ? null : Number(r.seen_at),
        cause: r.cause == null ? null : (String(r.cause) as LinkDropCause),
      }));
    },

    close() {
      watching?.close();
      watching = null;
      listeners.clear();
      db.close();
    },
  };
  // Every verb a member calls is one call to the board, counted here and nowhere else (D66):
  // what the card's call count shows, and the last sign of life "stale" is measured from.
  // `reconcileWrites` is part of `merge-lock` and `end`, not a call.
  /** The verbs that are a member's progress (swarm-relay D36). */
  const PROGRESS_VERBS: ReadonlySet<string> = new Set(["post", "done", "setDoing", "endorse"]);
  /** board-split D49: the verbs where a member reports on itself; they never reset its stall. */
  const SELF_REPORT_VERBS: ReadonlySet<string> = new Set(["post", "setDoing", "endorse"]);
  /** `progress`: a pack's verb that is progress of its own (D36), beside the core's PROGRESS_VERBS. */
  const countCall = (p: Participant, verb: string, progress = false): void => {
    const at = now();
    // board-split D49 (A1-1): a parked member's own call changes nothing of its park; only the orchestrator's unpark lifts it
    db.prepare("UPDATE participants SET calls = calls + 1, last_call = ? WHERE id = ?").run(at, p.id);
    // D36: a post, `done` or `doing` is progress, a look at the board is not
    if (progress || PROGRESS_VERBS.has(verb)) db.prepare("UPDATE participants SET progress_at = ? WHERE id = ?").run(at, p.id);
    // board-split D49: a self-report never resets a stall
    if (!SELF_REPORT_VERBS.has(verb)) db.prepare("UPDATE participants SET board_call_at = ? WHERE id = ?").run(at, p.id);
    // the call itself, for the member's timeline (D25)
    db.prepare("INSERT INTO call_log (participant, at, verb) VALUES (?, ?, ?)").run(p.id, at, verb);
    bump(participantById(p.id).repo);
  };
  // the verb and its count in one transaction: the page sees one change, and a refused call
  // (an ended member, an unknown path) counts none
  const counted = <A extends unknown[], R>(name: string, verb: (p: Participant, ...rest: A) => R) =>
    (p: Participant, ...rest: A): R =>
      transaction(() => {
        const out = verb(p, ...rest);
        countCall(p, name);
        return out;
      });
  board.setDoing = counted("setDoing", board.setDoing);
  board.subscribe = counted("subscribe", board.subscribe);
  board.unsubscribe = counted("unsubscribe", board.unsubscribe);
  board.end = counted("end", board.end);
  board.post = counted("post", board.post);
  board.phase = counted("phase", board.phase);
  board.pause = counted("pause", board.pause);
  board.park = counted("park", board.park);
  board.unpark = counted("unpark", board.unpark);
  board.block = counted("block", board.block);
  board.unblock = counted("unblock", board.unblock);
  board.resume = counted("resume", board.resume);
  board.done = counted("done", board.done);
  board.endorse = counted("endorse", board.endorse);
  board.deliver = counted("deliver", board.deliver);
  board.wait = counted("wait", board.wait);
  const read = board.read;
  board.read = (seq, by) => {
    const m = read(seq, by);
    if (by) transaction(() => countCall(by, "read"));
    return m;
  };
  return board;
}
