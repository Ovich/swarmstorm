// The board's surface (codebase-rework#D8): the Board every caller holds, and every shape it takes and gives. What makes
// it is board.ts's composition; nothing here runs.
import type { Kind } from "../contract/kinds.ts";
import type { PackVerbInput, MemberFact } from "../packs/types.ts";
import type { CodeSnapshotFields } from "../contract/code.ts";
import type { Declared, Message, MessageKind, MessageMeta, Participant, RunId } from "../contract/board.ts";
import type { EventName } from "../contract/events.ts";
import type { CoreMemberState, SeatState } from "./members/liveness.ts";
import type { MemberActivity } from "../contract/wire.ts";
import type { PhaseProgress } from "./phases/owing.ts";
import { RPC_METHODS, type RpcMethod } from "../contract/wire.ts";

export type { Message, Participant } from "../contract/board.ts";
export type { PackRefusal } from "../packs/types.ts";
export type { PhaseProgress } from "./phases/owing.ts";
/** A seat of a run (D22). `link`: the slice document's URL, opaque to the board (D44). */
export type SeatSpec = { id: string; role?: string; area?: string; blockers: string[]; link?: string | null; transcript?: string | null };
export type Seat = SeatSpec & { state: SeatState };
/** One place of a run's composition (D3): a declared seat, who sits in it, and whether they do. */
export type CompositionEntry = { seat: string; member: string | null; nick: string | null; role?: string; area?: string; state: SeatState };
/** Who is in a run and in which role (D3, D6). `showRole`: the declared seats do not all share one role; `lines`: one per entry, as the CLI prints them. */
export type Composition = { run: number; entries: CompositionEntry[]; showRole: boolean; lines: string[] };
/** The phase a run's orchestrator opened last (`phase <name> <text>`). */
export type Phase = { name: string; text: string };
/** Why a member's done is not in the open phase's count (D62, V-28): the phase is for other seats. */
export type NotOwed = { forSeats: string[] } | null;
/** A member's activity from its transcript and its link (swarm-relay D9, D31, E12, D12): what it does, never trouble. */
export type MemberStateName = "working" | "busy" | "waiting";
/** board-split D36: trouble, beside the state, never a state. lost: its link dropped while it owed the open phase. */
export type BadgeName = "lost";
/** A badge with its reason (shown on hover) and since when it holds, ms epoch (null: unknown). */
export type Badge = { name: BadgeName; reason: string; since: number | null };
/** `doing`: the open tool, else the last; `since`: ms epoch the state counts from; `badge`: its trouble, null when none.
 *  A lost member keeps the last activity read of it. */
/** How full a member is (product-shape#D1): its last call's input and cache tokens, and when that line was written, ms epoch. */
export type MemberContext = { tokens: number; at: number };
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
  /** board-split D36: its trouble beside its state (lost), null when none. */
  badge: Badge | null;
  /** product-shape#D1: its context size and its age; null while its link has told none. */
  context: MemberContext | null;
  worktree: string | null; // AGENTS EXCEPTION (rule D24): the roster's JSON key, frozen (answers unchanged); its member's place, null for a seat or an orchestrator (D64)
  /** Its one state (working, stopped, away, lost, ended); what it does is `activity`. */
  state: SnapshotMemberState;
  /** What its pack says of it now (D36); absent when nothing. */
  fact?: MemberFact;
  activity: string | null;
  /** Its two ages (swarm-relay D38), ms epoch: its last progress, its last sign of life by its link (null: never linked). */
  progressAt: number | null;
  aliveAt: number | null;
  /** Messages for it (a message to it, an urgent post) not yet delivered to it (swarm-relay D43). */
  unread: number;
  /** board-fixes#D13: the seq of its open task (`post --task`), null when none. */
  task: number | null;
  /** board-fixes#D5: when its doing text was set, ms epoch; `doingStale` once it merged, or an event to it came, since. */
  doingAt: number;
  doingStale: boolean;
}
/** One opening of a phase (a phase opened again is a second opening): its event's seq, its posts (not events) and
 *  urgent posts counted up to the next opening; `done` the members done with it, for the latest opening of its name. */
export type PhaseOpening = { name: string; seq: number; at: string; current: boolean; posts: number; urgent: number; done: number | null };
/** `phase`: `current` (the default), `all`, or a phase's name (its latest opening). `by`/`to`/`with`: a seat (`w1`,
 *  `<group>/w1`, `@w1`): its posts, the posts naming it, or both. `about`: a path or decision id, posted about or named
 *  in the body. `events`: the board's own events too, beyond phase, done, pause, resume, closed and a pack's landing events. */
export type ThreadQuery = { phase?: string; from?: number; before?: number; limit?: number; by?: string; to?: string; with?: string; about?: string; events?: boolean };
/** `earlier`: the oldest seq shown, when posts before it match (page back with `before` it); `later`: the seq after
 *  the newest shown, when posts after it match (page on with `from` it). `matched`: every post the query matches. */
export type ThreadPage = { run: RunId; group: string; title: string; phase: { name: string; seq: number } | null; posts: Message[]; matched: number; earlier: number | null; later: number | null };
/** What woke the member, in full (a whole-thread run: every unread post of the run with it). `superseded`: a newer
 *  `wait` of the same member started, so this one returned empty (D64). */
/** `ended`: the wait returned because its member was ended (release-prep: the CLI then answers with no further call,
 *  its link being stopped by the end). */
export type Delivery = { full: Message[]; superseded?: true; ended?: true };
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
  /** board-split D36: its trouble beside its state (lost), reason on hover; null when none, always for an ended member. */
  badge: Badge | null;
  files: (Declared & { shared: boolean })[]; // shared: another live member holds it too (D40)
  joined: string;
  /** When the member ended, stored at `end`; null while it has not (D66). */
  ended: string | null;
  calls: number;
  /** A background `wait --mentions` is pending: the member hears the board while it works (D49). */
  listening: boolean;
  /** board-split D31, D32: what the member runs now, from its link: its oldest open call and its awaited background
   *  task; absent from a server before it, or with no activity. Times ms epoch. */
  activity?: {
    /** `label`: the call's own description, `command`: its whole command (D45); null when the transcript gave none */
    open: { name: string; target: string; since: number; boardWait: boolean; label: string | null; command: string | null } | null;
    background: { target: string; since: number; outputGrewAt: number | null; label: string | null; command: string | null } | null;
  };
  /** Its last call to the board, else when it joined (D20: quiet n min). */
  lastCall: string;
  /** Its token counter; absent from a reader before it. */
  liveness?: Liveness;
  /** product-shape#D1: its context size and its age; null while its link has told none. */
  context: MemberContext | null;
  /** Messages for it not yet delivered (swarm-relay D43); absent from a reader before it. */
  unread?: number;
};
export type SnapshotEvent = {
  seq: number;
  at: string;
  kind: MessageKind;
  from: string;
  body: string;
  about: string | null;
  /** The author's run (D13). */
  run: RunId;
  event?: EventName | null;
  mentions?: string[];
  meta?: MessageMeta | null;
  /** board-split D51: the member, `<group>/<id>`, a board alarm tells of; absent on any other item or an alarm about a run. */
  subject?: string;
};
export type QueueSeat = { seat: string; role?: string; area?: string; link: string | null; state: string; blockers: string[]; member: string | null };
/** The edit goes through; `notice` names the other holders the first time only, per member and path. */
export type EditAllowed = { allowed: true; sharedWith: { member: string; doing: string }[]; notice: string | null };
/** The edit is held (D41): another member holds `path`; the answer module words the post to make (board-split V-13). */
export type EditHeld = { allowed: false; path: string; holders: { member: string; nick: string; doing: string }[] };
/** One project as the page reads it: the core's fields and the pack's (board-split#D18). */
export type BoardSnapshot = CodeSnapshotFields & {
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
  phase(p: Participant, name: string, text: string, opts?: { watch?: string[]; for?: string[] }): Message & { stillOwed: string[]; earlier: string[] };
  /** True when `p`, a member, has nothing to do: its last two `wait --mentions` in a row returned empty on their hold,
   *  and it owes no phase part and holds no claim (an unread mention would have ended the wait). */
  idle(p: Participant): boolean;
  /** How many undelivered messages wake `p` (a message to it, an urgent post): `end` refuses while any. */
  unreadMentions(p: Participant): number;
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
  /** A member finished the current phase `name`: stored once per run, member and phase, a `done` event to the
   *  orchestrator; when every member is done, one `all-done` event to it. Refused to the orchestrator, before any
   *  phase and on a phase that is not the current one. `already`: it had run done for it before (no event). */
  /** `unmerged`: the member's branch holding work not merged (board-split D63), carried in the done's body.
   *  `owesNow`: for a late done, the phase the member owes now (D62, V-5). `notOwed`: why the open phase's count leaves
   *  this member out, not in its --for seats (D62, V-28); null when it is counted. */
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
   *  kept message, their messages and deliveries. Open runs never. The run's row stays, stamped `pruned_at`,
   *  never listed, so its id is never reused (D61). `now` for tests (D19, D20). */
  prune(now?: Date): { messages: number; runs: number };
  /** The board's upkeep when due (D16): `prune`, when the last upkeep, kept in the
   *  store for every process, is older than UPKEEP_EVERY_MS. The time is recorded first, so a
   *  process due at the same moment skips, and a failure waits for the next due upkeep. True when it ran. */
  upkeepIfDue(now?: Date): boolean;
  /** The open runs, every project. */
  runs(): Run[];

  /** `place` is ignored when the member has no pack; `files` are refused when it has no claims.
   *  Declared files become claims where free (*interface* or *inside*); a held one stays declared only. */
  join(input: { run: RunId; seat: string; doing: string; files: Declared[]; place?: string }): {
    member: Participant;
    roster: RosterEntry[];
    composition: Composition;
    /** `back`: the seat had a member before, ended; `again`: the same member, still seated. */
    entry: "new" | "back" | "again";
  };
  /** The run's composition now (D3): the orchestrator, then every declared seat in order. */
  composition(run: RunId): Composition;
  /** "<plan>/<seat>" or "<plan>/orchestrator"; `repo`: the caller's project, whose run of that group is taken first (D58). */
  participant(name: string, repo?: string | null): Participant | null;
  /** Who is calling (D28): the one live member whose place holds `place` (the caller's folder). */
  identify(who: { place?: string }): Participant | null;
  setDoing(p: Participant, doing: string): void;
  /** Ends the member and releases its claims and any merge lock it holds; its doing becomes
   *  "merged and ended" when it merged since it joined, else "ended" (D66). */
  end(p: Participant): void;
  roster(repo: string): RosterEntry[];
  /** Members of the project's open runs who have ended, as `<plan>/<seat>`: a mention of one reaches nobody. */
  endedMembers(repo: string): string[];
  /** board-fixes#D6: the run's members (never the orchestrator) that owe work now, `<plan>/<seat>`: what a first `close` lists. */
  owingMembers(run: RunId): string[];
  /** The repository-relative paths `p` holds a claim on now. */
  heldBy(p: Participant): string[];

  /** Stored with the author's run, always (plan D1, D13). */
  /** `with`: an agreement's explicit parties, as seats or `<plan>/<seat>` (F25). */
  /** `task` (board-split D50): the orchestrator's task to the one member it mentions, recorded as that member's task
   *  for the open phase; a post without it never becomes a task. */
  /** board-fixes#D13: `task`, the orchestrator's task to the one seat it mentions, open until that seat's next `done` or a
   *  later task to it; `after` (implies `task`): the seats whose merged, done or leaving wake the task's seat (D4). */
  post(p: Participant, body: string, opts?: { about?: string; kind?: MessageKind; with?: string[]; task?: boolean; after?: string[] }): Message;
  /** An agreement backed; throws on a message that is not an agreement, or on one's own. */
  endorse(p: Participant, seq: number): Message;
  /** The first delivery, or empty on timeout or once `p` has ended (D49): only a message to `p` (a mention, its group's
   *  broadcast, an event addressed to it) or an urgent post ends it, and only what it brings is marked delivered. A
   *  member has one live wait (D64): a newer `wait` of `p`, from any process, makes this one return at once, empty,
   *  with `superseded`. `mentionsOnly`: the member listens (`wait --mentions`) rather than waits. */
  /** `signal`: aborting it ends the wait at once, empty, its waiting cleared (swarm-relay D16). */
  wait(p: Participant, opts?: { timeoutMs?: number; mentionsOnly?: boolean; signal?: AbortSignal }): Promise<Delivery>;
  /** What a wait would bring `p` now, never blocking, marked delivered: join's posts that waited for the seat (S1). */
  deliverMentions(p: Participant): Delivery;

  /** A pack verb's server side (board-split#D9, D19): the member's pack answers, before any transaction, with facts or a
   *  `PackRefusal`; `p` null for a call no member makes (a seat's place before its join, a close, a prune). */
  packCall(p: Participant | null, verb: string, input: PackVerbInput): unknown;

  // the page (D39)
  /** Every project with an open run or a closed run within the retention (D46); a run kept only as a pruned author never. */
  repos(): RepoSummary[];
  /** Everything the page draws for one project; throws `no project <key>` for one it does not list. */
  snapshot(repo: string): BoardSnapshot;

  // reading the thread back, pull only: a long run read in pages, never whole
  /** A run's phase openings, in order, each with its posts counted; throws on a run not of `repo`. */
  phases(repo: string, run: RunId): PhaseOpening[];
  /** A page of a run's thread: the posts of one phase (the current by default) matching the query, the last `limit`
   *  (or the first from `from`), and the seqs to page on. Throws on a run not of `repo` or a phase it never opened. */
  thread(repo: string, run: RunId, q: ThreadQuery): ThreadPage;
  /** One post of `repo`, in full; null when there is none by that seq. */
  message(repo: string, seq: number): Message | null;
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

// RPC_METHODS (contract/wire.ts) are Board methods; with ServerOnly, every one of them: a Board method added later must be
// put on one side or the other, and this fails to compile until it is.
RPC_METHODS satisfies readonly (keyof Board)[];
/** The Board methods kept off the wire, which only the server's own process runs. */
type ServerOnly = "onChange" | "close" | "livenessTick" | "recordActivity" | "memberStates" | "upkeepIfDue" | "prune" | "recordLink" | "savedLinks" | "recordServerUp";
type Unlisted = Exclude<keyof Board, RpcMethod | ServerOnly>;
const everyMethodPlaced: [Unlisted] extends [never] ? true : Unlisted = true;
void everyMethodPlaced;
