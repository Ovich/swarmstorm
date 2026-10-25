// The board — with claims.ts (D35), the only module that sees SQL. Runs, the plan's slices,
// participants, the thread of each repository, who has had what, who is calling,
// and waking a `wait`; claims and the merge lock live in claims.ts, behind this Board. Callers hold the typed Board openBoard() returns; the schema,
// runner names, mention parsing, path normalisation, refusal wording and the waking
// mechanism stay in here.
import fs from "node:fs";
import path from "node:path";
import { SQLITE_PATH } from "./home.ts";
import { nameHandle, parseMentions, planCode } from "./mentions.ts";
import { claimsOf, type HeldMergeLock } from "./claims.ts";
import { statsOf, summarize, type Stats, type StatsScope } from "./stats.ts";
import { type Kind, profileOf } from "./kinds.ts";
import { type EventName, type Subscription, EVENTS, formatSubscriptions, mentions as mentionsMe, parseSubscriptions as parseOn, wakes } from "./events.ts";
import { funnyName } from "./names.ts";
import { BUSY_MAX_MS, IDLE_MS, IN_TURN_MS, LINK_LOST_MS, OWE_WAIT_MS, NO_TRANSCRIPT_MS, READINGS_KEPT_MS, STALLED_AGAIN_MS, STALL_MS_DEFAULT } from "./liveness.ts";
import type { MemberActivity } from "../wire.ts";

export type RunId = number;
export type { Kind } from "./kinds.ts";
export type { EventName, Subscription } from "./events.ts";
export type { HeldMergeLock } from "./claims.ts";
/** What a merge's rebase met, as the board records it: the conflicted files (repository-relative,
 *  maybe none), or unknown and why (board D13). The CLI's conflicts.ts answers in it. */
export type Conflicts = { files: string[] } | { unknown: "old-git" | "no-reflog" };
export type { Stats, StatsScope, Totals, RunStats, MemberStats, PlanRunStats, SharedFile, FileAcrossRuns, Interval, Mark, QuestionStats, BrainstormRunStats } from "./stats.ts";
/** A seat of a run (D22). `link`: the slice document's URL, opaque to the board (D44). */
export type SeatSpec = { id: string; title: string; role?: string; blockers: string[]; link?: string | null; on?: string[]; transcript?: string | null };
/** Kept: the plan's own word (D41). */
export type SliceSpec = SeatSpec;
export type SliceState = "ready" | "running" | "done" | "blocked";
export type Slice = SliceSpec & { state: SliceState };
export type Declared = { path: string; interface: boolean }; // repository-relative
export type MessageKind = "msg" | "agreement" | "endorsement" | "urgent" | "event";
/** A file written outside its writer's claim while another runner holds it. */
export type Flag = { path: string; holder: string; seq: number };

/** The phase a run's orchestrator opened last (`phase <name> <text>`). */
export type Phase = { name: string; text: string };
/** How many of the run's members (the orchestrator apart) ran `done` for its current phase. */
/** `of` leaves out the members gone and not done (swarm-relay D41); `gone` names them, `<group>/<member>`. */
export type PhaseProgress = { phase: string; done: number; of: number; gone: string[] };
/** The progress as every line prints it: `3/3 done`, and `, 1 gone` only when a member is gone (D41). */
export const progressText = (p: PhaseProgress): string => `${p.done}/${p.of} done${p.gone.length ? `, ${p.gone.length} gone` : ""}`;
/** The gone members as a line's suffix: ` (1 gone: idea/b)`, empty when none (D41). */
export const goneSuffix = (gone: string[]): string => (gone.length ? ` (${gone.length} gone: ${gone.join(", ")})` : "");
/** A member's state from its activity and its link (swarm-relay D9, D31, E12, D12). */
export type MemberStateName = "working" | "busy" | "waiting" | "quiet" | "gone";
/** `doing`: the open tool, else the last; `since`: ms epoch the state counts from; `reason`: why quiet or gone. */
export type MemberState = { member: string; state: MemberStateName; doing: string | null; since: number | null; reason?: string; rule?: StallRule; owes?: string };
/** Whether a member's link is connected, and since when it is lost (null: connected, or never linked). Kept by the server.
 *  `transcriptGrewAt`: for a member whose link is lost, its transcript's mtime (ms epoch), null when it cannot be read. */
export type Presence = (member: string) => { connected: boolean; lostAt: number | null; transcriptGrewAt?: number | null };
/** A member's liveness as the page draws it (D20): its state, its counter from its link's last activity, and its two
 *  ages (swarm-relay D38): `progressAt` its last progress, `aliveAt` its last sign of life by its link, the time
 *  read while the link is up (ms epoch; null: never linked). */
export type Liveness = Omit<MemberState, "member"> & { tokens: number | null; movedAt: string | null; progressAt: number | null; aliveAt: number | null };

/** A protocol's name: lower case, digits and dashes. */
export const PROTOCOL_NAME = /^[a-z0-9][a-z0-9-]*$/;

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
  slices: Slice[];
  /** The current phase; null until the orchestrator opens one. */
  phase: Phase | null;
  /** Set by `pause`, the orchestrator's reason ("" when it gave none); null when the run is not paused. */
  paused: string | null;
  /** The protocol the run follows, null when it names none. */
  protocol: string | null;
}

export interface Participant {
  id: number;
  run: RunId;
  repo: string;
  kind: Kind;
  plan: string;
  slice: string; // "orchestrator" for a run's orchestrator
  name: string; // "<plan>/<slice>"
  nick: string; // the funny name given at join (D43), and to an orchestrator at open (plan D17)
  ended: boolean;
  worktree: string | null; // registered at join; null for the orchestrator
  /** A `wait --mentions` of this participant is pending (D49, D61). */
  listening: boolean;
  /** The events that wake its `wait --mentions`, besides mentions and urgent posts (D59). */
  subscriptions: Subscription[];
}

/** A merged path and another runner that holds it, or held it during the merger's run (D63). */
export interface Sharer {
  path: string;
  runner: string; // "<plan>/<slice>"
}

export interface RosterEntry {
  name: string;
  nick: string;
  run: RunId;
  plan: string;
  slice: string;
  doing: string;
  files: Declared[];
  stale: boolean; // no tool call for ten minutes (D31)
  subscriptions: Subscription[];
  worktree: string | null; // null for a seat or an orchestrator (D64)
  /** Its state from its activity (D9), and the open or last tool. */
  state: MemberStateName;
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
  mentions: string[]; // "<plan>/<slice>" or "<plan>/*"
  at: string;
  /** The author's run: a run is a label on the item, not a place (plan D1, D13). */
  run: RunId;
  /** The agreement an endorsement backs; null otherwise. */
  endorses: number | null;
  /** The board event it is, as posted (D59); null on a plain post and on rows from before. */
  event: EventName | null;
  /** On delivery only, to a holder of `about` when a runner that did not hold it posted about it:
   *  the agreement that answers it (D62). */
  answer?: string;
  /** A merged event's recipients, or a phase event's name, as data (D11); null elsewhere and on rows from before. */
  meta?: MessageMeta | null;
  /** On post only: the refused claim this post settled (D7). */
  claimed?: { path: string; sharedWith: string[] };
}

/** Mentions in full, the rest one line each. `superseded`: a newer `wait` of the same runner
 *  started, so this one returned empty (D64). */
export type Delivery = { full: Message[]; lines: string[]; superseded?: true };

/** What the page draws (D39). */
export type RunSummary = {
  run: number; kind: Kind; plan: string; group: string; code: string; title: string; link: string | null; open: boolean; runners: number; done: number; of: number;
  /** The run's current phase, null until one is opened; absent from a reader before it. */
  phase?: Phase | null;
  /** The current phase's done count, null before the first phase. */
  progress?: PhaseProgress | null;
  /** The run's stall threshold: no token counter moved this long posts `stalled`. */
  stallMs?: number;
  /** The protocol the run follows (build-verify, debate…), null when it names none; absent from a reader before it. */
  protocol?: string | null;
};
export type RepoSummary = { repo: string; name: string; runs: RunSummary[] };
export type RunnerState = "working" | "waiting" | "merging" | "watching" | "ended" | "done";
export type SnapshotRunner = {
  /** The run the member sat in: a group can hold several runs, its members are told apart by this; absent from a reader before it. */
  run?: number;
  runner: string;
  nick: string;
  plan: string;
  slice: string;
  title: string;
  doing: string;
  state: RunnerState;
  stale: boolean;
  files: (Declared & { shared: boolean })[]; // shared: another live runner holds it too (D40)
  joined: string;
  /** When the runner ended, stored at `end`; null while it has not (D66). */
  ended: string | null;
  calls: number;
  /** A background `wait --mentions` is pending: the runner hears the board while it works (D49). */
  listening: boolean;
  /** Its subscriptions, as `formatSubscriptions` writes each (D59). */
  on: string[];
  /** Its last call to the board, else when it joined (D20: quiet n min). */
  lastCall: string;
  /** Its token counter; absent from a reader before it. */
  liveness?: Liveness;
  /** Messages for it not yet delivered (swarm-relay D43); absent from a reader before it. */
  unread?: number;
};
/** What a merged event told, as data (D11): `rebase` holds or declared a changed file, `tell` is whom to tell of a resolved conflict,
 *  of a conflicted path only once the conflicts are known (D5). */
export type MergedMeta = { rebase: string[]; tell: string[] };
/** A phase event's name, as data: `phase <name> <text>` stores `<name>`. */
export type PhaseMeta = { phase: string };
/** Which rule made a member quiet (idea 1, rule 6): the `stalled` stores it, and its `next` prints that rule's move. */
export type StallRule = "ended" | "in-turn" | "background" | "call" | "owing";
/** A stalled event's data: its rule, the member's id, and for `owing` the phase it owes. */
export type StalledMeta = { rule: StallRule; member: string; phase?: string };
/** What an event carries as data, by its event: merged, phase or stalled. */
export type MessageMeta = MergedMeta | PhaseMeta | StalledMeta;
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
};
export type QueueSlice = { slice: string; title: string; link: string | null; state: string; blockers: string[]; runner: string | null };
/** A held file and every runner holding it, in claim order (D40): the FileMap's rows. */
export type SnapshotFile = { path: string; holders: string[]; interface: boolean };
/** The edit goes through; `notice` names the other holders the first time only, per runner and path. */
export type EditAllowed = { allowed: true; sharedWith: { runner: string; doing: string }[]; notice: string | null };
export type EditHeld = { allowed: false; refusal: string };
export type LockTurn = { runner: string; askedAt: string; grantedAt: string | null; mergedAt: string | null; refused: number };
export type BoardSnapshot = {
  repo: string;
  name: string;
  runs: RunSummary[];
  lock: { holder: string; since: string } | null;
  /** The repository's merge-lock turns, newest first (at most 50): asked, granted, merged, refusals counted. */
  lockHistory: LockTurn[];
  roster: SnapshotRunner[];
  events: SnapshotEvent[];
  queues: Record<string, QueueSlice[]>;
  files: SnapshotFile[];
  flags: { path: string; runner: string }[];
};

export interface Board {
  /** `kind` defaults to plan; throws on an unknown kind. The group is stored as the plan (D44). */
  /** `transcript`: the orchestrator's, registered at once; none posts a liveness warning. `stallMs`: the run's stall threshold, default 60000. */
  openRun(input: { repo: string; kind?: Kind; group: string; title: string; link?: string | null; seats: SeatSpec[]; transcript?: string | null; stallMs?: number; protocol?: string | null }): Run;
  /** `done` also releases the slice runner's claims and lock: the orchestrator's way to free a stale runner. */
  setSliceState(run: RunId, slice: string, state: SliceState): void;
  /** A seat added mid-run (D60): after the last, `ready`; refused on an id already in the run, an
   *  unknown blocker or a closed run. Posts an event with the run. */
  addSlice(run: RunId, spec: SeatSpec): Slice;
  /** Also archives the run: read-only from then on, `run <n> is closed` (D19). Posts the `closed` event with the run, before it closes (D67). */
  closeRun(run: RunId): void;
  /** The orchestrator opens phase `name` with `text`, the current one ending with it: a `phase` event in its run,
   *  body `phase <name>: <text>`, mentioning `<group>/*` so every member of the run wakes; sets the run's
   *  current phase and clears its done marks. Refused to anyone else and on a closed run, whatever the kind. */
  phase(p: Participant, name: string, text: string): Message;
  /** The run's current phase, as `phase` last set it; null until one is opened. Throws on an unknown run. */
  currentPhase(run: RunId): Phase | null;
  /** The orchestrator pauses its run: every member is told to stop and wait, a `pause` event mentioning
   *  `<group>/*`; claim and merge-lock are refused until `resume`. Refused to anyone else, on a closed run and
   *  on a run already paused. */
  pause(p: Participant, text?: string): Message;
  /** The orchestrator lifts the pause: a `resume` event mentioning `<group>/*`, its body the message when given.
   *  Refused to anyone else, on a closed run and on a run not paused. */
  resume(p: Participant, text?: string): Message;
  /** The run's pause reason ("" when none was given), null when it is not paused. Throws on an unknown run. */
  pausedOf(run: RunId): string | null;
  /** A member finished the current phase `name`: stored once per run, member and phase, a `done` event to the
   *  orchestrator; when every member is done, one `all-done` event to it. Refused to the orchestrator, before any
   *  phase and on a phase that is not the current one. `already`: it had run done for it before (no event). */
  done(p: Participant, name: string): { progress: PhaseProgress; all: boolean; already: boolean; message: Message | null };
  /** The current phase's done count; null before the first phase. */
  phaseProgress(run: RunId): PhaseProgress | null;
  /** The run's last activity, ISO: its open, a member's join or call, a message by one of its members. Throws on an unknown run. */
  lastActivity(run: RunId): string;
  /** The run's current phase when `p` owes it: a member (not the orchestrator), not ended, that has not run
   *  `done` for it; null otherwise, and before the first phase. */
  owedPhase(p: Participant): Phase | null;
  /** A member's link sent its activity (`member`: its seat or slice id, or `orchestrator`): its row in
   *  member_activity and a token reading. Ignored for a closed run or a member not live in it. */
  recordActivity(run: RunId, member: string, a: MemberActivity, at: Date): void;
  /** Every live member's state at `at` (D9, D31), through the presence the server's tick last gave. */
  memberStates(run: RunId, at: Date): MemberState[];
  /** One tick of the server (D13): states from activity and presence; `stalled <member>` to the orchestrator
   *  for a member quiet past the run's threshold, again after STALLED_AGAIN_MS (D11); `gone` once (D12); `idle`
   *  at each whole IDLE_MS while every member but the orchestrator waits. False when the run is closed or unknown. */
  livenessTick(run: RunId, at: Date, presence: Presence): boolean;
  /** Past the retention: closed runs (closed_at older), their seats, members not referenced by a
   *  kept message, their channels and deliveries; main messages older, agreements and the
   *  endorsements of kept agreements kept. Open runs never. The run's row stays, stamped `pruned_at`,
   *  never listed, so its id is never reused (D61). `now` for tests (D19, D20). */
  prune(now?: Date): { messages: number; runs: number };
  /** Reads, or writes then reads, a board setting. retention-days: a positive integer, default 30 (D32). */
  setting(name: "retention-days", value?: number): number;
  /** Flags in main, once, each open run whose every member made no call for ten minutes;
   *  a call by a member clears its run's mark. Returns the runs flagged now. */
  flagStale(now?: Date): RunId[];
  /** The board's upkeep when due (D16): `prune` then `flagStale`, when the last upkeep, kept in the
   *  store for every process, is older than UPKEEP_EVERY_MS. The time is recorded first, so a
   *  process due at the same moment skips, and a failure waits for the next due upkeep. True when it ran. */
  upkeepIfDue(now?: Date): boolean;
  /** The open runs, every repository. */
  runs(): Run[];

  /** `worktree` is ignored when the run's kind has none; `files` are refused when it has no claims.
   *  Declared files become claims where free (*interface* or *inside*); a held one stays declared only. */
  /** `on`, else the seat row's `on`, else the kind's defaults for a member (D59). */
  join(input: { run: RunId; slice: string; doing: string; files: Declared[]; worktree?: string; on?: Subscription[] }): {
    runner: Participant;
    roster: RosterEntry[];
  };
  participant(name: string): Participant | null; // "<plan>/<slice>" or "<plan>/orchestrator"
  /** Who is calling (D28): the one live runner whose worktree holds `worktree`. */
  identify(who: { worktree?: string }): Participant | null;
  setDoing(p: Participant, doing: string): void;
  /** Adds to the member's subscriptions; returns them after (D59). */
  subscribe(p: Participant, subs: Subscription[]): Subscription[];
  unsubscribe(p: Participant, subs: Subscription[]): Subscription[];
  /** Ends the runner and releases its claims and any merge lock it holds; its doing becomes
   *  "merged and ended" when it merged since it joined, else "ended" (D66). */
  end(p: Participant): void;
  roster(repo: string): RosterEntry[];
  /** Members of the repository's open runs who have ended, as `<plan>/<slice>`: a mention of one reaches nobody. */
  endedMembers(repo: string): string[];
  /** The repository-relative paths `p` holds a claim on now. */
  heldBy(p: Participant): string[];

  /** Stored with the author's run, always (plan D1, D13). */
  post(p: Participant, body: string, opts?: { about?: string; kind?: MessageKind }): Message;
  /** An agreement backed; throws on a message that is not an agreement, or on one's own. */
  endorse(p: Participant, seq: number): Message;
  /** `by`: the runner reading, when known, counted as a call of its own (D66). */
  read(seq: number, by?: Participant): Message;
  /** Every post of `p`'s run since its phase `name` was last opened (its current phase when omitted), events left
   *  out: the whole discussion a member reads before it decides or adds to it. Empty before the first phase. */
  thread(p: Participant, name?: string): Message[];
  deliver(p: Participant): Delivery; // own run's items + what wakes p from any run (plan D2); undelivered since last time; marks them delivered; stamps the last call
  /** The first delivery, or empty on timeout or once `p` has ended (D49). `mentionsOnly`: only a
   *  message that mentions `p`, is urgent, or is an event `p` subscribed to (D59) ends it, and only those are marked delivered; the rest
   *  stays for the next `deliver`. A runner has one live wait (D64): a newer `wait` of `p`, from
   *  any process, makes this one return at once, empty, with `superseded`. */
  /** `signal`: aborting it ends the wait at once, empty, its waiting cleared (swarm-relay D16). */
  wait(p: Participant, opts?: { timeoutMs?: number; mentionsOnly?: boolean; signal?: AbortSignal }): Promise<Delivery>;
  /** What is for `p` now (a mention, an urgent post, an event it subscribed to), never blocking: marked delivered, the rest
   *  left for `deliver`. The delivery hook's call at each tool call and each stop of the member's agent (swarm-relay D43). */
  deliverMentions(p: Participant): Delivery;

  /** A claim before an edit of `path` (absolute, or repository-relative), `swarm claim` (D58).
   *  Free: claimed, silently. Held by others (D40, D41): `p`'s first claim is held until `p` has
   *  posted about the path mentioning every holder; then `p` holds it too, the other holders named
   *  once. `interface`: claimed as an interface, an `inside` claim of `p` widened. */
  checkEdit(p: Participant, path: string, opts?: { interface?: boolean }): EditAllowed | EditHeld;
  // checkEdit, reconcileWrites, release, lockMerge, merged: refused when the caller's kind has no claims
  /** Paths written outside the claim: a free one is claimed, a held one flagged on the thread. */
  reconcileWrites(p: Participant, changed: string[]): Flag[];
  release(p: Participant, path: string): void;
  /** `reflogMark`: the length of the caller's HEAD reflog at the call, kept with a new grant so `merged` replays only a later rebase (D36). */
  lockMerge(p: Participant, onto?: string, reflogMark?: number): { granted: true } | { granted: false; holder: string };
  /** Releases the lock; tells whoever holds or declared one of `files` to rebase onto `sha`,
   *  every plan on the repository when one of them is an interface (D26). Returns, for each
   *  merged path, every other runner that holds it, or held it during `p`'s run (D63); once `conflicts` are known,
   *  of a conflicted path only (D5). Records the merge with its conflicts, absent recorded as unknown (D25). */
  merged(p: Participant, sha: string, files: string[], conflicts?: Conflicts): Sharer[];
  /** The merge lock `p` holds, its grant time, branch and reflog mark, for the CLI to replay the rebase since (D33, D36); null when it holds none. */
  heldMergeLock(p: Participant): HeldMergeLock | null;
  /** The figures of the scope's runs (D33, D34): one read, no write; a figure not recorded or not computed yet is null, never 0. */
  stats(scope: StatsScope): Stats;

  // the page (D39)
  /** Every repository with an open run or a closed run within the retention (D46); a run kept only as a pruned author never. */
  repos(): RepoSummary[];
  /** Everything the page draws for one repository; throws `no repository <id>` for one it does not list. */
  snapshot(repo: string): BoardSnapshot;
  /** Called with the repository of every write, from this process or any other. Returns the unsubscribe. */
  onChange(listener: (repo: string) => void): () => void;

  close(): void;

  /** A member's link connected, or lost at `lostAt` (ms epoch): kept in the store, so presence outlives a
   *  server restart (swarm-relay D37). */
  recordLink(run: RunId, member: string, link: { connected: boolean; lostAt: number | null }): void;
  /** Every link the store keeps, as the last server left them: read by a server at its start (D37). */
  savedLinks(): { run: RunId; member: string; connected: boolean; lostAt: number | null }[];
}

/** A phase's name: one word. */
const PHASE_NAME = /^[\w.-]+$/;

const SLICE_STATES = new Set<SliceState>(["ready", "running", "done", "blocked"]);
/** The events a member receives though it is their author: the board posts them in its name. */
const TO_AUTHOR = Object.values(EVENTS).filter((e) => e.toAuthor).map((e) => `'${e.name}'`).join(", ");
const ORCHESTRATOR = "orchestrator";
/** A watch event can be missed (a coalesced write, a platform quirk); the store is re-read
 *  this often regardless, so a missed event costs at most this much. */
const WAIT_POLL_MS = 1000;
const LINE_WIDTH = 100;
const STALE_MS = 10 * 60 * 1000;
/** A pending wait's looks are logged in call_log at most this often: well under STALE_MS, never a row per tick. */
const WAIT_LOG_EVERY_MS = 60 * 1000;
/** The board's upkeep runs at most this often, from any process (D16). */
export const UPKEEP_EVERY_MS = 5 * 60 * 1000;
/** The settings row holding the last upkeep's time, ISO: the board's own, never a user setting. */
const LAST_UPKEEP = "last-upkeep";
/** The settings row holding when the analytics records began, ISO: the board's own (D33). */
const RECORDS_SINCE = "records-since";
/** The settings row holding when the shares record began, ISO: a run opened before has no shares known (D39). */
const SHARES_SINCE = "shares-since";
const RETENTION_DEFAULT_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
/** The page shows the last this many messages of a thread. */
const EVENTS_SHOWN = 500;
const CASELESS = process.platform === "win32";

type Row = Record<string, unknown>;

/** One line for a message a runner was not named in. */
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
  // the analytics records (call_log, lock_requests, run_stats) start with the store that first creates them:
  // a run opened before reads recorded: false (D33)
  const recordsAreNew = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'call_log'").get() === undefined;
  // the shares record starts with the store that first creates it, the same way (D39)
  const sharesAreNew = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'shares'").get() === undefined;
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
    CREATE TABLE IF NOT EXISTS slices (
      run INTEGER NOT NULL,
      id TEXT NOT NULL,
      title TEXT NOT NULL,
      blockers TEXT NOT NULL DEFAULT '[]',
      state TEXT NOT NULL DEFAULT 'ready',
      ord INTEGER NOT NULL,
      PRIMARY KEY (run, id)
    );
    CREATE TABLE IF NOT EXISTS participants (
      id INTEGER PRIMARY KEY,
      run INTEGER NOT NULL,
      slice TEXT NOT NULL,
      worktree TEXT,
      doing TEXT NOT NULL DEFAULT '',
      files TEXT NOT NULL DEFAULT '[]',
      since_seq INTEGER NOT NULL DEFAULT 0,
      joined_at TEXT NOT NULL,
      ended_at TEXT,
      last_call TEXT,
      UNIQUE (run, slice)
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
    -- claims are global by repository-relative path, across every run on a repository (D12, D20);
    -- a path may have several holders (D40). since_seq: the thread's last seq when it was claimed
    CREATE TABLE IF NOT EXISTS claims (
      repo TEXT NOT NULL,
      path TEXT NOT NULL,
      participant INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'inside',
      since_seq INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (repo, path, participant)
    );
    -- every claim made, kept past its release: who held a path during a run (D63), and whether as an
    -- interface: widened to 'interface' when the claim is made or widened so, never narrowed (D42)
    CREATE TABLE IF NOT EXISTS claim_log (
      repo TEXT NOT NULL,
      path TEXT NOT NULL,
      participant INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'inside',
      PRIMARY KEY (repo, path, participant)
    );
    -- a claim granted beside a live holder of the path, kept past both claims' release: who held a path
    -- at the same time as whom during a run, from the seq it began (D39); append-only, deleted with its run
    CREATE TABLE IF NOT EXISTS shares (
      repo TEXT NOT NULL,
      path TEXT NOT NULL,
      participant INTEGER NOT NULL,
      other INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      PRIMARY KEY (repo, path, participant, other)
    );
    -- a holder of a shared path already told of another holder (D41): once per runner and path
    CREATE TABLE IF NOT EXISTS notices (
      repo TEXT NOT NULL,
      path TEXT NOT NULL,
      participant INTEGER NOT NULL,
      other INTEGER NOT NULL,
      PRIMARY KEY (repo, path, participant, other)
    );
    CREATE TABLE IF NOT EXISTS merge_locks (
      repo TEXT PRIMARY KEY,
      participant INTEGER NOT NULL,
      at TEXT NOT NULL
    );
    -- a runner refused the merge lock since its holder took it: mentioned when it is released (D65)
    CREATE TABLE IF NOT EXISTS lock_waiters (
      repo TEXT NOT NULL,
      participant INTEGER NOT NULL,
      PRIMARY KEY (repo, participant)
    );
    -- a path written outside its writer's claim, by reconcileWrites; lives while a claim on it does (D39)
    CREATE TABLE IF NOT EXISTS flags (
      repo TEXT NOT NULL,
      path TEXT NOT NULL,
      participant INTEGER NOT NULL,
      PRIMARY KEY (repo, path, participant)
    );
    -- a claim refused as held: the post that settles it claims it (D7)
    CREATE TABLE IF NOT EXISTS claim_requests (
      repo TEXT NOT NULL,
      path TEXT NOT NULL,
      participant INTEGER NOT NULL,
      kind TEXT NOT NULL,
      PRIMARY KEY (repo, path, participant)
    );
    -- a flag posted, once per writer, path and holder (D8)
    CREATE TABLE IF NOT EXISTS flag_posts (
      repo TEXT NOT NULL,
      path TEXT NOT NULL,
      participant INTEGER NOT NULL,
      holder INTEGER NOT NULL,
      PRIMARY KEY (repo, path, participant, holder)
    );
    -- a version per repository, moved by every write: what onChange compares (D39)
    CREATE TABLE IF NOT EXISTS changes (
      repo TEXT PRIMARY KEY,
      version INTEGER NOT NULL
    );
    -- one row per merge, written by merged, deleted with its run by prune (D25): files and conflicts JSON, conflicts NULL for unknown
    CREATE TABLE IF NOT EXISTS merges (
      participant INTEGER NOT NULL,
      run INTEGER NOT NULL,
      sha TEXT NOT NULL,
      at TEXT NOT NULL,
      files TEXT NOT NULL,
      conflicts TEXT
    );
    CREATE INDEX IF NOT EXISTS merges_run ON merges (run);
    -- one row per counted call, written by countCall in the verb's transaction (D25); deleted with its run
    CREATE TABLE IF NOT EXISTS call_log (participant INTEGER NOT NULL, at TEXT NOT NULL, verb TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS call_log_by_participant ON call_log (participant, at);
    -- one row per merge-lock turn: asked, granted, merged; refused counts the refusals (D25); deleted with its run
    CREATE TABLE IF NOT EXISTS lock_requests (repo TEXT NOT NULL, participant INTEGER NOT NULL, asked_at TEXT NOT NULL,
      granted_at TEXT, merged_at TEXT, refused INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS lock_requests_by_participant ON lock_requests (participant, asked_at);
    -- a closed run's figures, RunStats JSON, written once at close or by prune first; never pruned (D20, D21)
    CREATE TABLE IF NOT EXISTS run_stats (run INTEGER PRIMARY KEY, repo TEXT NOT NULL, kind TEXT NOT NULL,
      closed_at TEXT NOT NULL, body TEXT NOT NULL);
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
    -- a member's latest activity, from its link's frames (swarm-relay D9); stalled_at: the last stalled told of it (D11)
    CREATE TABLE IF NOT EXISTS member_activity (
      run INTEGER NOT NULL, member TEXT NOT NULL,
      grew_at INTEGER, tokens INTEGER NOT NULL DEFAULT 0, context INTEGER,
      open_tool TEXT, open_target TEXT, open_since INTEGER, last_tool TEXT,
      finished INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, stalled_at INTEGER,
      PRIMARY KEY (run, member));
    -- a member's link as the server last saw it: connected, else lost since lost_at (ms epoch); swarm-relay D37
    CREATE TABLE IF NOT EXISTS member_links (
      run INTEGER NOT NULL, member TEXT NOT NULL, connected INTEGER NOT NULL, lost_at INTEGER,
      PRIMARY KEY (run, member));
  `);
  if (recordsAreNew) db.prepare("INSERT OR IGNORE INTO settings (name, value) VALUES (?, ?)").run(RECORDS_SINCE, new Date().toISOString());
  if (sharesAreNew) db.prepare("INSERT OR IGNORE INTO settings (name, value) VALUES (?, ?)").run(SHARES_SINCE, new Date().toISOString());
  // Schema upkeep for stores created by earlier versions: add a column when it is missing.
  const upkeep = (table: string, column: string, ddl: string): void => {
    const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };
  upkeep("participants", "worktree", "worktree TEXT");
  // a claim's kind kept past its release, so a closed run read live still knows its interfaces (D42)
  upkeep("claim_log", "kind", "kind TEXT NOT NULL DEFAULT 'inside'");
  upkeep("participants", "last_call", "last_call TEXT");
  upkeep("participants", "calls", "calls INTEGER NOT NULL DEFAULT 0");
  upkeep("participants", "waiting", "waiting INTEGER NOT NULL DEFAULT 0");
  upkeep("member_activity", "open_wait", "open_wait INTEGER NOT NULL DEFAULT 0");
  // 1 while a `wait --mentions` is pending: a listener, not a wait (D49)
  upkeep("participants", "listening", "listening INTEGER NOT NULL DEFAULT 0");
  upkeep("participants", "nick", "nick TEXT");
  // moved by every `wait` start: a pending wait whose number is no longer this one is superseded (D64)
  upkeep("participants", "wait_gen", "wait_gen INTEGER NOT NULL DEFAULT 0");
  // 1 once the runner has called `merged` since it joined: what `end` writes as its doing (D66)
  upkeep("participants", "merged", "merged INTEGER NOT NULL DEFAULT 0");
  // 1: written by the board itself in a runner's name (a flag, a merge notice), never a runner's own word
  upkeep("messages", "by_board", "by_board INTEGER NOT NULL DEFAULT 0");
  upkeep("runs", "link", "link TEXT");
  // a board event's data beside its text: a merged event's recipients (D11)
  upkeep("messages", "meta", "meta TEXT");
  // the branch a merge lands in, named by merge-lock --onto (D9)
  upkeep("merge_locks", "onto", "onto TEXT");
  // the holder's HEAD reflog length at the grant: merged replays only a rebase past it (D36)
  upkeep("merge_locks", "reflog_mark", "reflog_mark INTEGER");
  upkeep("slices", "link", "link TEXT");
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
  upkeep("participants", "quiet_flagged", "quiet_flagged INTEGER NOT NULL DEFAULT 0");
  // set when prune removed the run's contents; the row stays so its id is never reused (D61): never listed
  upkeep("runs", "pruned_at", "pruned_at TEXT");
  // the board event a message is (D59); null on plain posts and rows from before
  upkeep("messages", "event", "event TEXT");
  // a member's subscriptions, JSON (D59)
  upkeep("participants", "subs", "subs TEXT NOT NULL DEFAULT '[]'");
  // the seats file's `on`, JSON (D59)
  upkeep("slices", "on_events", "on_events TEXT");
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
  upkeep("runs", "stall_posts", "stall_posts INTEGER NOT NULL DEFAULT 0");
  // idea 1: the turn state, the last line, the awaited background task and the transcript's path, from the link
  upkeep("member_activity", "in_turn", "in_turn INTEGER");
  upkeep("member_activity", "last_line", "last_line TEXT");
  upkeep("member_activity", "bg_target", "bg_target TEXT");
  upkeep("member_activity", "bg_since", "bg_since INTEGER");
  upkeep("member_activity", "bg_grew_at", "bg_grew_at INTEGER");
  upkeep("member_activity", "transcript", "transcript TEXT");
  // the owing span (idea 1, rule 5): since when the member waits while owing the phase, and when its last wait returned
  upkeep("member_activity", "owe_since", "owe_since INTEGER");
  upkeep("member_activity", "wait_left_at", "wait_left_at INTEGER");
  db.exec("CREATE INDEX IF NOT EXISTS messages_channel ON messages (repo, run, seq)");
  // a store from before D40 keys a claim by path alone: rebuild it keyed by holder too
  const claimKey = (db.prepare("PRAGMA table_info(claims)").all() as { name: string; pk: number }[]).find((c) => c.name === "participant");
  if (claimKey && claimKey.pk === 0) {
    db.exec(`
      BEGIN;
      ALTER TABLE claims RENAME TO claims_before_d40;
      CREATE TABLE claims (
        repo TEXT NOT NULL,
        path TEXT NOT NULL,
        participant INTEGER NOT NULL,
        kind TEXT NOT NULL DEFAULT 'inside',
        since_seq INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (repo, path, participant)
      );
      INSERT INTO claims (repo, path, participant, kind) SELECT repo, path, participant, kind FROM claims_before_d40;
      DROP TABLE claims_before_d40;
      COMMIT;
    `);
  }

  // Waking and watching: every write moves its repository's version; once committed, the waits
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

  const runRow = (id: RunId): Row => {
    const r = db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as Row | undefined;
    if (!r) throw new Error(`unknown run ${id}`);
    return r;
  };

  const phaseOf = (r: Row): Phase | null => (r.phase == null ? null : { name: String(r.phase), text: String(r.phase_text ?? "") });

  const toRun = (r: Row): Run => ({
    phase: phaseOf(r),
    paused: r.paused == null ? null : String(r.paused),
    protocol: r.protocol == null ? null : String(r.protocol),
    id: Number(r.id),
    repo: String(r.repo),
    kind: profileOf(String(r.kind ?? "plan")).kind,
    plan: String(r.plan),
    group: String(r.plan),
    title: String(r.title),
    link: r.link == null ? null : String(r.link),
    state: r.state === "closed" ? "closed" : "open",
    slices: (db.prepare("SELECT * FROM slices WHERE run = ? ORDER BY ord").all(Number(r.id)) as Row[]).map((s) => ({
      id: String(s.id),
      title: String(s.title),
      link: s.link == null ? null : String(s.link),
      blockers: JSON.parse(String(s.blockers)) as string[],
      state: String(s.state) as SliceState,
    })),
  });

  /** A store from before D43 has members with no funny name: their slice stands in (an orchestrator's before plan D17 too). */
  const nickOf = (r: Row): string => (r.nick == null ? String(r.slice) : String(r.nick));

  /** A subscription stored scoped `main` (before plan D1) reads as `any`. */
  /** A funny name no active member of the repository carries (D43, plan D17), kept for the run. */
  const unusedNick = (repo: string): string => {
    const rows = db.prepare(`${PARTICIPANT_SQL} WHERE r.repo = ? AND r.state = 'open' AND p.ended_at IS NULL`).all(repo) as Row[];
    return funnyName(rows.map(nickOf));
  };

  const subsOf = (r: Row): Subscription[] =>
    (JSON.parse(String(r.subs ?? "[]")) as { event: Subscription["event"]; scope: string }[]).map((x) => ({ event: x.event, scope: x.scope === "run" ? "run" : "any" }));

  const PARTICIPANT_SQL = `SELECT p.*, r.repo, r.plan, r.kind FROM participants p JOIN runs r ON r.id = p.run`;

  const toParticipant = (r: Row): Participant => ({
    id: Number(r.id),
    run: Number(r.run),
    repo: String(r.repo),
    kind: profileOf(String(r.kind ?? "plan")).kind,
    plan: String(r.plan),
    slice: String(r.slice),
    name: `${r.plan}/${r.slice}`,
    nick: nickOf(r),
    ended: r.ended_at != null,
    worktree: r.worktree == null ? null : String(r.worktree),
    listening: Number(r.listening) === 1,
    subscriptions: subsOf(r),
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
    event: r.event == null || !Object.hasOwn(EVENTS, String(r.event)) ? null : (String(r.event) as EventName),
    meta: r.meta == null ? null : (JSON.parse(String(r.meta)) as MessageMeta),
    };
  };

  const lastSeq = (): number => Number((db.prepare("SELECT COALESCE(MAX(seq), 0) AS s FROM messages").get() as Row).s);

  const openPlans = (repo: string): string[] =>
    (db.prepare("SELECT DISTINCT plan FROM runs WHERE repo = ? AND state = 'open'").all(repo) as Row[]).map((r) => String(r.plan));

  /** The repository's active runners: their funny names, as a mention writes them, to their names (D43). */
  const activeNames = (repo: string): Map<string, string> => {
    const rows = db
      .prepare(`${PARTICIPANT_SQL} WHERE r.repo = ? AND r.state = 'open' AND p.ended_at IS NULL AND p.slice != '${ORCHESTRATOR}'`)
      .all(repo) as Row[];
    return new Map(rows.map((r) => [nameHandle(nickOf(r)), `${r.plan}/${r.slice}`]));
  };

  /** `named` overrides mention parsing: the board's own notices name their targets. */
  const insertMessage = (
    p: Participant,
    body: string,
    about: string | null,
    kind: MessageKind,
    named?: string[],
    extra: { endorses?: number; event?: EventName; meta?: MessageMeta } = {},
  ): Message => {
    const mentions = named ?? (kind === "event" ? [] : parseMentions(body, p.plan, openPlans(p.repo), activeNames(p.repo)));
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

  /** A code verb on a kind with no claims is refused before any write (D22, D25). */
  const gated = (p: Participant, verb: string): Participant => {
    if (!profileOf(p.kind).claims) throw new Error(`${verb}: a ${p.kind} run has no claims`);
    return p;
  };

  const live = (p: Participant): Participant => {
    const fresh = participantById(p.id);
    if (fresh.ended) throw new Error(`runner ${p.name} has ended`);
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
      .prepare("SELECT DISTINCT p.worktree FROM participants p JOIN runs r ON r.id = p.run WHERE r.repo = ? AND p.worktree IS NOT NULL")
      .all(repo) as Row[];
    for (const r of rows) out.add(path.resolve(String(r.worktree)));
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
  const claims = claimsOf({ db, transaction, bump, now, lastSeq, participantById, isLive, insertMessage, relPath, fold, slashes, doingOf });
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

  /** `fromWait`: a wait's own look, not a call of the runner's.
   *  `mentionsOnly`: only what mentions `p` or is urgent is taken and marked; the rest stays. */
  const deliverTo = (p: Participant, fromWait: boolean, mentionsOnly = false): Delivery => {
    const me = participantById(p.id);
    // from any run, an agreement or endorsement about a path the caller holds is for it too (D26, plan D2)
    const named = (m: Message): boolean =>
      mentionsMe(m, me) ||
      ((m.kind === "agreement" || m.kind === "endorsement") && m.about != null && claims.holds(me, m.about));
    const whole = profileOf(me.kind).wholeThread;
    // a post of the caller's own run, not an event, in a whole-thread run: everyone's in full
    const ownPost = (m: Message): boolean => whole && m.run === me.run && m.kind !== "event";
    const messages = transaction(() => {
      const unseen = unseenRows(me);

      // a wake (D59): a mention, an urgent post, or an event the caller subscribed to in its scope
      const woken = (r: Row): boolean => named(toMessage(r)) || wakes(toMessage(r), me, me.subscriptions);
      // of its own run, everything; of another run, only what wakes the caller (plan D2)
      const heard = unseen.filter((r) => toMessage(r).run === me.run || woken(r));
      // a wake in a whole-thread run brings every unread post of the run with it, never the waking one alone
      const rows = !mentionsOnly
        ? heard
        : !heard.some(woken) || !whole
          ? heard.filter(woken)
          : heard.filter((r) => woken(r) || ownPost(toMessage(r)));
      const mark = db.prepare("INSERT INTO deliveries (participant, seq) VALUES (?, ?)");
      for (const r of rows) mark.run(me.id, Number(r.seq));
      // a delivery is a call to the board: the runner's last call (D31)
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
        // a call after a wait that never returned (killed): the runner is no longer waiting
        const r = db.prepare("UPDATE participants SET waiting = 0 WHERE id = ? AND waiting = 1").run(me.id);
        if (Number(r.changes) > 0) bump(me.repo);
      }
      return rows.map((r) => {
        const m = toMessage(r);
        const rel = r.by_board || m.kind !== "msg" || !m.about || !named(m) ? null : claims.askedAbout(me, Number(r.author), m);
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
    return {
      run: id,
      kind: profileOf(String(r.kind ?? "plan")).kind,
      plan: String(r.plan),
      group: String(r.plan),
      code: planCode(String(r.plan)),
      title: String(r.title),
      link: r.link == null ? null : String(r.link),
      open,
      runners: open ? count(`SELECT COUNT(*) AS n FROM participants WHERE run = ? AND slice != '${ORCHESTRATOR}' AND ended_at IS NULL`) : 0,
      done: count("SELECT COUNT(*) AS n FROM slices WHERE run = ? AND state = 'done'"),
      of: count("SELECT COUNT(*) AS n FROM slices WHERE run = ?"),
      phase: phaseOf(r),
      progress: progressOf(id, r.phase == null ? null : String(r.phase)),
      stallMs: Number(r.stall_ms ?? STALL_MS_DEFAULT),
      protocol: r.protocol == null ? null : String(r.protocol),
    };
  };
  /** A repository is its common git dir; it is shown by its checkout's folder name. */
  const repoName = (repo: string): string => {
    const base = path.basename(repo);
    return base.toLowerCase() === ".git" ? path.basename(path.dirname(repo)) : base.replace(/\.git$/i, "");
  };

  // onChange: one watcher per open Board, shared by its listeners.
  const listeners = new Set<(repo: string) => void>();
  let watching: { close(): void } | null = null;
  let versions = new Map<string, number>();
  const readVersions = (): Map<string, number> =>
    new Map((db.prepare("SELECT repo, version FROM changes").all() as Row[]).map((r) => [String(r.repo), Number(r.version)]));


  const insertSlice = (run: RunId, s: SeatSpec, ord: number): void => {
    if (s.on) parseOn(s.on); // an unknown event name is refused at open, not at join
    db.prepare("INSERT INTO slices (run, id, title, blockers, link, ord, on_events) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      run,
      s.id,
      s.title,
      JSON.stringify(s.blockers ?? []),
      s.link ?? null,
      ord,
      s.on ? JSON.stringify(s.on) : null,
    );
  };

  const setSubs = (p: Participant, subs: Subscription[]): Subscription[] => {
    db.prepare("UPDATE participants SET subs = ? WHERE id = ?").run(JSON.stringify(subs), p.id);
    bump(p.repo);
    return subs;
  };
  const sameSub = (a: Subscription, b: Subscription): boolean => a.event === b.event && a.scope === b.scope;

  // ── liveness: member states from activity (swarm-relay D9, D11, D12, D31) ─────────────
  /** Since when every member of a run (the orchestrator aside) has been waiting, and when its last idle was posted. */
  const idleSince = new Map<RunId, { since: number; postedAt: number | null }>();
  /** The presence each run's tick last gave: the snapshot and the roster read states through it. */
  const presenceOf = new Map<RunId, Presence>();
  const noPresence: Presence = () => ({ connected: false, lostAt: null });
  /** The waits this process holds, by participant id, and since when (ms epoch): the waiting of D35. */
  const heldWaits = new Map<number, number>();
  const orchestratorIn = (run: RunId): Participant =>
    participantById(Number((db.prepare("SELECT id FROM participants WHERE run = ? AND slice = ?").get(run, ORCHESTRATOR) as Row).id));
  const activityOf = (run: RunId, member: string): Row | undefined =>
    db.prepare("SELECT * FROM member_activity WHERE run = ? AND member = ?").get(run, member) as Row | undefined;
  /** A participant row's state at `t`: gone, waiting (its open call is the board wait), busy, working, else quiet. */
  /** When the member's last progress was (D36): its transcript growing, or a post, `done` or `doing`; never through
   *  a pause (from the resume), else from the join. */
  const progressAtOf = (p: Row, run: Row, a: Row | undefined): number =>
    Math.max(
      a?.grew_at == null ? 0 : Number(a.grew_at),
      p.progress_at == null ? 0 : Date.parse(String(p.progress_at)),
      Date.parse(String(p.joined_at)),
      run.resumed_at == null ? 0 : Date.parse(String(run.resumed_at)),
    );
  const stateOf = (p: Row, run: Row, t: number, presence: Presence): MemberState => {
    const member = String(p.slice);
    const a = activityOf(Number(run.id), member);
    // D35: waiting is the board's own fact, a wait this server holds for the member, whatever command ran it
    const heldSince = heldWaits.get(Number(p.id)) ?? null;
    const inWait = heldSince != null;
    if (a && Number(a.finished) === 1) return { member, state: "gone", doing: null, since: Number(a.at), reason: "its agent finished without end" };
    const link = presence(member);
    // idea 1, rule 4: a lost link is gone only once the transcript too has been still LINK_LOST_MS; lost but growing is working
    const linkLost = !link.connected && link.lostAt != null && t - link.lostAt >= LINK_LOST_MS;
    const transcriptGrowing = link.transcriptGrewAt != null && t - link.transcriptGrewAt < LINK_LOST_MS;
    if (linkLost && !transcriptGrowing) return { member, state: "gone", doing: null, since: link.lostAt, reason: "its link was lost" };
    if (linkLost) return { member, state: "working", doing: a?.last_tool == null ? null : String(a.last_tool), since: link.transcriptGrewAt ?? null, reason: "link down" };
    // no activity (no link has spoken): presence only, never working without evidence (D9, D33)
    if (!a) {
      if (inWait) return { member, state: "waiting", doing: null, since: null };
      const joined = Date.parse(String(p.joined_at));
      return { member, state: "quiet", doing: null, since: joined, reason: t - joined >= NO_TRANSCRIPT_MS ? "no transcript found" : "no activity yet" };
    }
    const open = a.open_tool == null ? null : `${a.open_tool} ${String(a.open_target ?? "")}`.trim();
    // D31, D35, D45: waiting is the open call that runs the board's own `wait`, while the board holds the member's wait; any
    // other open call (a browser's wait_for, a test run) is work, even with a background listener held
    const stallMs = Number(run.stall_ms ?? STALL_MS_DEFAULT);
    const last = a.last_tool == null ? null : String(a.last_tool);
    // idea 1, rule 6: every reason ends on the member's last line, its last text or its last call
    const lastLine = a.last_line == null ? last : String(a.last_line);
    const said = `; last: "${lastLine ?? ""}"`;
    if (open && heldSince != null && Number(a.open_wait) === 1) {
      // idea 1, rule 5: a wait while owing the phase is quiet once the owing span is long enough
      const owing = owingOf(p, run, a, t, stallMs);
      if (owing) return { member, state: "quiet", doing: open, since: owing.since, reason: `waiting, not done ${owing.phase}${said}`, rule: "owing", owes: owing.phase };
      return { member, state: "waiting", doing: open, since: Number(a.open_since) };
    }
    // busy for as long as the call is open, its true state; past BUSY_MAX_MS its reason says so, and the orchestrator is
    // told by the stalled check, since a call that long may be hung (swarm-relay D46)
    if (open) {
      const since = Number(a.open_since);
      const long = t - since >= BUSY_MAX_MS;
      return { member, state: "busy", doing: open, since, ...(long ? { reason: `call open ${minutes(BUSY_MAX_MS)} min, may be long or hung${said}`, rule: "call" as const } : {}) };
    }
    const progressed = progressAtOf(p, run, a);
    if (t - progressed < stallMs) return { member, state: "working", doing: last, since: progressed };
    // idea 1, rule 1: in turn, a member is quiet only after IN_TURN_MS with no line
    const inTurn = a.in_turn == null ? null : Number(a.in_turn) === 1;
    if (inTurn === true && t - progressed < IN_TURN_MS) return { member, state: "working", doing: last, since: progressed };
    // idea 1, rule 2: an awaited background task keeps it busy while its output grows, up to BUSY_MAX_MS from its start
    if (a.bg_target != null) {
      const target = String(a.bg_target);
      const bgSince = Number(a.bg_since);
      const outputAt = a.bg_grew_at == null ? bgSince : Number(a.bg_grew_at);
      const capped = t - bgSince >= BUSY_MAX_MS;
      if (!capped && t - outputAt < stallMs) return { member, state: "busy", doing: `background ${target}`, since: bgSince };
      const reason = capped ? `background ${target} ${minutes(BUSY_MAX_MS)} min${said}` : `background ${target} silent ${Math.round(stallMs / 1000)} s`;
      return { member, state: "quiet", doing: `background ${target}`, since: capped ? bgSince : outputAt, reason, rule: "background" };
    }
    if (inTurn === true) return { member, state: "quiet", doing: last, since: progressed, reason: `in turn, no line for ${minutes(IN_TURN_MS)} min (its model may be hung)${said}`, rule: "in-turn" };
    if (inTurn === false) return { member, state: "quiet", doing: last, since: progressed, reason: `turn ended${said}`, rule: "ended" };
    // a link older than idea 1 sends no turn state: the reason names the missing signal, the link, and the last call (D36)
    const reason = `no progress for ${Math.floor((t - progressed) / 1000)}s, link ${link.connected ? "alive" : "down"}${last ? `; last ${last}` : ""}`;
    return { member, state: "quiet", doing: last, since: progressed, reason };
  };
  const minutes = (ms: number): number => Math.round(ms / 60000);
  /** The phase `p` owes now: the run's open phase it has not run `done` for; null for the orchestrator or none open. */
  const owedNameOf = (p: Row, run: Row): string | null => {
    if (String(p.slice) === ORCHESTRATOR || run.state !== "open" || run.phase == null) return null;
    const done = db.prepare("SELECT 1 FROM phase_done WHERE run = ? AND participant = ? AND phase = ?").get(Number(run.id), Number(p.id), String(run.phase));
    return done ? null : String(run.phase);
  };
  /** Since when every other live member (the orchestrator apart) has been in a board wait or done the phase, by run;
   *  the in-memory start of the condition rule 5 holds stall_ms. */
  const othersSettledSince = new Map<number, number>();
  /** Idea 1, rule 5: the owing span of `p`, when it has lasted long enough to be quiet: every other live member waiting
   *  or done for stall_ms, or the span OWE_WAIT_MS; null otherwise. The span itself is kept by the tick (`keepOwingSpan`). */
  const owingOf = (p: Row, run: Row, a: Row, t: number, stallMs: number): { phase: string; since: number } | null => {
    const phase = owedNameOf(p, run);
    if (phase == null || a.owe_since == null) return null;
    const since = Number(a.owe_since);
    if (t - since >= OWE_WAIT_MS) return { phase, since };
    const others = db.prepare("SELECT * FROM participants WHERE run = ? AND ended_at IS NULL AND id != ? AND slice != ?").all(Number(run.id), Number(p.id), ORCHESTRATOR) as Row[];
    const settled = others.every((o) => {
      const oa = activityOf(Number(run.id), String(o.slice));
      const waits = heldWaits.has(Number(o.id)) && (oa == null || Number(oa.open_wait) === 1);
      return waits || owedNameOf(o, run) == null;
    });
    const key = Number(p.id);
    if (!settled) {
      othersSettledSince.delete(key);
      return null;
    }
    const from = othersSettledSince.get(key) ?? t;
    othersSettledSince.set(key, from);
    return t - Math.max(from, since) >= stallMs ? { phase, since } : null;
  };
  /** Idea 1, rule 5: the owing span opens at the first board wait entered while the member owes the phase, carries
   *  across a wait re-entered within stall_ms of the last one returning, and ends on any other progress or on `done`. */
  const keepOwingSpan = (run: Row, p: Row, a: Row, t: number): void => {
    const set = (oweSince: number | null, leftAt: number | null): void => {
      if ((a.owe_since == null ? null : Number(a.owe_since)) === oweSince && (a.wait_left_at == null ? null : Number(a.wait_left_at)) === leftAt) return;
      db.prepare("UPDATE member_activity SET owe_since = ?, wait_left_at = ? WHERE run = ? AND member = ?").run(oweSince, leftAt, Number(run.id), String(p.slice));
    };
    const held = heldWaits.get(Number(p.id));
    const inWait = held != null && a.open_tool != null && Number(a.open_wait) === 1;
    if (owedNameOf(p, run) == null) return set(null, null);
    if (inWait) return set(a.owe_since == null ? held : Number(a.owe_since), null);
    if (a.owe_since == null) return;
    const leftAt = a.wait_left_at == null ? t : Number(a.wait_left_at);
    const progressAt = p.progress_at == null ? 0 : Date.parse(String(p.progress_at));
    const otherCall = a.open_tool != null && Number(a.open_wait) !== 1;
    const lapsed = t - leftAt >= Number(run.stall_ms ?? STALL_MS_DEFAULT);
    if (otherCall || progressAt > leftAt || lapsed) return set(null, null);
    set(Number(a.owe_since), leftAt);
  };
  /** The states of a run's live members (not ended), keyed by member. */
  const statesOf = (run: RunId, t: number): Map<string, MemberState> => {
    const r = db.prepare("SELECT * FROM runs WHERE id = ?").get(run) as Row | undefined;
    if (!r) return new Map();
    const presence = presenceOf.get(run) ?? noPresence;
    const live = db.prepare("SELECT * FROM participants WHERE run = ? AND ended_at IS NULL ORDER BY id").all(run) as Row[];
    return new Map(live.map((p) => [String(p.slice), stateOf(p, r, t, presence)]));
  };
  const livenessOf = (run: RunId, st: MemberState | undefined, t: number): Liveness | undefined => {
    if (!st) return undefined;
    const a = activityOf(run, st.member);
    const r = db.prepare("SELECT * FROM runs WHERE id = ?").get(run) as Row;
    const p = db.prepare("SELECT * FROM participants WHERE run = ? AND slice = ?").get(run, st.member) as Row;
    const link = (presenceOf.get(run) ?? noPresence)(st.member);
    const { member: _, ...state } = st;
    return {
      ...state,
      tokens: a ? Number(a.tokens) : null,
      movedAt: a?.grew_at == null ? null : new Date(Number(a.grew_at)).toISOString(),
      // D38: the two ages, since its last progress and since its last sign of life
      progressAt: progressAtOf(p, r, a),
      aliveAt: link.connected ? t : link.lostAt,
    };
  };
  const agesOf = (l: Liveness | undefined): { progressAt: number | null; aliveAt: number | null } => ({ progressAt: l?.progressAt ?? null, aliveAt: l?.aliveAt ?? null });
  /** The phase's done count: members done, of the members (the orchestrator apart) not ended without their done. */
  const progressOf = (run: RunId, phase: string | null): PhaseProgress | null => {
    if (phase == null) return null;
    const rows = db
      .prepare(
        `SELECT (SELECT r.plan FROM runs r WHERE r.id = p.run) AS plan, p.slice, p.ended_at, EXISTS (SELECT 1 FROM phase_done d WHERE d.run = p.run AND d.participant = p.id AND d.phase = ?) AS done,
           EXISTS (SELECT 1 FROM liveness_warned w WHERE w.run = p.run AND w.member = p.slice AND w.cond = 'gone') AS gone
         FROM participants p WHERE p.run = ? AND p.slice != '${ORCHESTRATOR}'`,
      )
      .all(phase, run) as Row[];
    // D41: a member gone (as the last tick told it) and not done holds no phase; it counts again once back
    const live = rows.filter((r) => Number(r.done) === 1 || r.ended_at == null);
    const gone = live.filter((r) => Number(r.done) !== 1 && Number(r.gone) === 1);
    const counted = live.filter((r) => !gone.includes(r));
    return { phase, done: counted.filter((r) => Number(r.done) === 1).length, of: counted.length, gone: gone.map((r) => `${r.plan}/${r.slice}`) };
  };
  /** `all-done` to the orchestrator, once per run and phase whoever reaches it first: the last `done`, or the tick
   *  that finds the last member not done gone (D41). */
  const allDoneOnce = (author: Participant, progress: PhaseProgress): boolean => {
    if (!(progress.of > 0 && progress.done === progress.of)) return false;
    if (Number(db.prepare("INSERT OR IGNORE INTO liveness_warned (run, member, cond) VALUES (?, ?, ?)").run(author.run, ORCHESTRATOR, `all-done ${progress.phase}`).changes) !== 1) return false;
    insertMessage(author, `all done ${progress.phase}: every member is done (${progress.done}/${progress.of})${goneSuffix(progress.gone)}; open the next phase`, null, "event", [`${author.plan}/${ORCHESTRATOR}`], {
      event: EVENTS["all-done"].name,
      meta: { phase: progress.phase },
    });
    return true;
  };

  /** The closed run's summary into run_stats (D20); summarize reads, this writes. */
  const storeRunStats = (run: RunId): void => {
    const body = summarize(db, run, STALE_MS);
    const r = runRow(run);
    db.prepare("INSERT OR REPLACE INTO run_stats (run, repo, kind, closed_at, body) VALUES (?, ?, ?, ?, ?)").run(run, String(r.repo), body.kind, String(r.closed_at), JSON.stringify(body));
  };

  const board: Board = {
    openRun({ repo, kind = "plan", group, title, link, seats, transcript, stallMs, protocol }) {
      const profile = profileOf(kind);
      if (protocol != null && !PROTOCOL_NAME.test(protocol)) throw new Error(`a protocol is named in lower case, digits and dashes (build-verify), got ${protocol}`);
      if (stallMs !== undefined && !(Number.isInteger(stallMs) && stallMs > 0)) throw new Error(`the stall threshold takes a positive whole number of ms, got ${stallMs}`);
      const id = transaction(() => {
        // the group is stored as the plan (D44)
        const r = db
          .prepare("INSERT INTO runs (repo, kind, plan, title, link, opened_at, stall_ms, protocol) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .run(repo, profile.kind, group, title, link ?? null, now(), stallMs ?? STALL_MS_DEFAULT, protocol ?? null);
        const run = Number(r.lastInsertRowid);
        seats.forEach((s, i) => insertSlice(run, s, i));
        // a funny name as a member gets at join (plan D17)
        const orchestrator = db.prepare("INSERT INTO participants (run, slice, since_seq, joined_at, subs, nick) VALUES (?, ?, ?, ?, ?, ?)").run(
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

    setSliceState(run, slice, state) {
      runRow(run);
      if (!SLICE_STATES.has(state)) throw new Error(`unknown slice state ${state}`);
      transaction(() => {
        const r = db.prepare("UPDATE slices SET state = ? WHERE run = ? AND id = ?").run(state, run, slice);
        if (Number(r.changes) === 0) throw new Error(`unknown slice ${slice} in run ${run}`);
        bump(String(runRow(run).repo));
        if (state !== "done") return;
        const p = db.prepare("SELECT id FROM participants WHERE run = ? AND slice = ?").get(run, slice) as Row | undefined;
        if (p) claims.releaseAll(Number(p.id));
      });
    },

    addSlice(run, spec) {
      const r = runRow(run);
      if (r.state !== "open") throw new Error(`run ${run} is closed`);
      if (spec.id === ORCHESTRATOR) throw new Error(`"${ORCHESTRATOR}" is not a slice`);
      return transaction(() => {
        const ids = (db.prepare("SELECT id FROM slices WHERE run = ?").all(run) as Row[]).map((x) => String(x.id));
        if (ids.includes(spec.id)) throw new Error(`slice ${spec.id} is already in run ${run}`);
        const unknown = (spec.blockers ?? []).filter((b) => !ids.includes(b));
        if (unknown.length) throw new Error(`unknown blocker ${unknown.join(", ")} in run ${run}`);
        const ord = Number((db.prepare("SELECT COALESCE(MAX(ord), -1) AS o FROM slices WHERE run = ?").get(run) as Row).o) + 1;
        insertSlice(run, spec, ord);
        const orchestrator = db.prepare("SELECT id FROM participants WHERE run = ? AND slice = ?").get(run, ORCHESTRATOR) as Row;
        insertMessage(participantById(Number(orchestrator.id)), `added ${spec.id}: ${spec.title}`, null, "event");
        return toRun(runRow(run)).slices.find((x) => x.id === spec.id)!;
      });
    },

    closeRun(run) {
      runRow(run);
      transaction(() => {
        // stored with the run it closes, before it closes; a member subscribed to any:closed wakes (D67)
        const author = (db.prepare("SELECT id FROM participants WHERE run = ? AND slice = ?").get(run, ORCHESTRATOR) ??
          db.prepare("SELECT id FROM participants WHERE run = ? ORDER BY id LIMIT 1").get(run)) as Row | undefined;
        if (author) insertMessage(participantById(Number(author.id)), `run ${run} closed`, null, "event", undefined, { event: EVENTS.closed.name });
        db.prepare("UPDATE runs SET state = 'closed', closed_at = ? WHERE id = ?").run(now(), run);
        bump(String(runRow(run).repo));
        db.prepare("UPDATE participants SET ended_at = COALESCE(ended_at, ?) WHERE run = ?").run(now(), run);
        // the run's figures, kept past pruning, read while its claims still say which are interfaces (D37); the summary
        // only reads before its one write, so a failure leaves the close whole: close succeeds, prune writes it later (D25)
        try {
          storeRunStats(run);
        } catch {}
        for (const p of db.prepare("SELECT id FROM participants WHERE run = ?").all(run) as Row[]) claims.releaseAll(Number(p.id));
      });
    },

    prune(at = new Date()) {
      return transaction(() => {
        const cutoff = retentionCutoff(at);
        // a run with no summary is summarized before its raw rows go; one whose summary throws keeps them for the next upkeep (D33)
        const expired = (db.prepare("SELECT id, repo FROM runs WHERE state = 'closed' AND closed_at < ? AND pruned_at IS NULL").all(cutoff) as Row[]).filter((r) => {
          if (db.prepare("SELECT 1 FROM run_stats WHERE run = ?").get(Number(r.id))) return true;
          try {
            storeRunStats(Number(r.id));
            return true;
          } catch {
            return false;
          }
        });
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
            for (const table of ["claim_log", "shares", "notices", "flags", "claims", "lock_waiters", "merge_locks", "deliveries", "claim_requests", "flag_posts", "call_log", "lock_requests"]) {
              db.prepare(`DELETE FROM ${table} WHERE participant = ?`).run(id);
            }
            db.prepare("DELETE FROM notices WHERE other = ?").run(id);
            db.prepare("DELETE FROM shares WHERE other = ?").run(id);
            // a member authoring a kept message stays, so the message still reads its author
            if (!db.prepare("SELECT 1 FROM messages WHERE author = ? LIMIT 1").get(id)) db.prepare("DELETE FROM participants WHERE id = ?").run(id);
          }
          db.prepare("DELETE FROM slices WHERE run = ?").run(run);
          db.prepare("DELETE FROM merges WHERE run = ?").run(run);
          for (const table of ["phase_done", "transcripts", "token_readings", "liveness_warned", "member_activity", "member_links"]) db.prepare(`DELETE FROM ${table} WHERE run = ?`).run(run);
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
      board.flagStale(at);
      return true;
    },

    flagStale(at = new Date()) {
      const silentBefore = at.getTime() - STALE_MS;
      return transaction(() => {
        // an orchestrator silent STALE_MS: one quiet event in its run, until it calls again (D15)
        const quiet = db
          .prepare("SELECT p.id, p.last_call, p.joined_at FROM participants p JOIN runs r ON r.id = p.run WHERE r.state = 'open' AND r.paused IS NULL AND p.slice = ? AND p.ended_at IS NULL AND p.quiet_flagged = 0")
          .all(ORCHESTRATOR) as Row[];
        for (const o of quiet) {
          const silentSince = Date.parse(String(o.last_call ?? o.joined_at));
          if (silentSince >= silentBefore) continue;
          const minutes = Math.floor((at.getTime() - silentSince) / 60_000);
          insertMessage(participantById(Number(o.id)), `quiet ${minutes} min`, null, "event", [], { event: EVENTS.quiet.name });
          db.prepare("UPDATE participants SET quiet_flagged = 1 WHERE id = ?").run(Number(o.id));
        }
        const flagged: RunId[] = [];
        for (const r of db.prepare("SELECT id, plan FROM runs WHERE state = 'open' AND paused IS NULL AND stale_flagged = 0 ORDER BY id").all() as Row[]) {
          const id = Number(r.id);
          const members = db.prepare("SELECT id, slice, last_call, joined_at FROM participants WHERE run = ? AND ended_at IS NULL").all(id) as Row[];
          if (!members.length || members.some((m) => Date.parse(String(m.last_call ?? m.joined_at)) >= silentBefore)) continue;
          const author = members.find((m) => String(m.slice) === ORCHESTRATOR) ?? members[0];
          const group = String(r.plan);
          insertMessage(participantById(Number(author.id)), `run ${id} (${group}) is stale: every member silent; close it or dispatch again`, null, "event", [`${group}/${ORCHESTRATOR}`], {
            event: EVENTS.stale.name,
          });
          db.prepare("UPDATE runs SET stale_flagged = 1 WHERE id = ?").run(id);
          flagged.push(id);
        }
        return flagged;
      });
    },

    runs() {
      return (db.prepare("SELECT * FROM runs WHERE state = 'open' ORDER BY id").all() as Row[]).map(toRun);
    },

    join({ run, slice, doing, files, worktree, on }) {
      const r = runRow(run);
      if (r.state !== "open") throw new Error(`run ${run} is closed`);
      if (slice === ORCHESTRATOR) throw new Error(`"${ORCHESTRATOR}" is not a slice`);
      const profile = profileOf(String(r.kind ?? "plan"));
      if (files.length && !profile.claims) throw new Error(`join: a ${profile.kind} run has no claims`);
      // a kind with no worktree records none, whatever the caller passed (D21)
      const where = worktree && profile.worktree ? path.resolve(worktree) : null;
      // one transaction: the page sees a join as one change
      return transaction(() => {
      const id = transaction(() => {
        const existing = db.prepare("SELECT id, nick FROM participants WHERE run = ? AND slice = ?").get(run, slice) as Row | undefined;
        // --on, else the seat row's on, else the kind's defaults (D59)
        const seatRow = db.prepare("SELECT on_events FROM slices WHERE run = ? AND id = ?").get(run, slice) as Row | undefined;
        const seatOn = seatRow?.on_events != null ? parseOn(JSON.parse(String(seatRow.on_events)) as string[]) : null;
        const subs = JSON.stringify(on ?? seatOn ?? profile.defaults.member);
        const fresh = (): string => unusedNick(String(r.repo));
        if (existing) {
          db.prepare("UPDATE participants SET doing = ?, files = ?, worktree = ?, ended_at = NULL, merged = 0, subs = ?, nick = COALESCE(nick, ?) WHERE id = ?").run(
            doing,
            JSON.stringify(files),
            where,
            subs,
            existing.nick == null ? fresh() : null,
            Number(existing.id),
          );
          return Number(existing.id);
        }
        // a post that already names this seat (a task posted before the member joined) is still
        // the member's to read: its cursor starts just before the earliest one, else at now
        const earliest = db
          .prepare("SELECT MIN(seq) AS seq FROM messages WHERE run = ? AND mentions LIKE ?")
          .get(run, `%"${String(r.plan)}/${slice}"%`) as Row | undefined;
        const since = earliest?.seq != null ? Math.min(lastSeq(), Number(earliest.seq) - 1) : lastSeq();
        const ins = db
          .prepare("INSERT INTO participants (run, slice, worktree, doing, files, since_seq, joined_at, nick, subs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(run, slice, where, doing, JSON.stringify(files), since, now(), fresh(), subs);
        return Number(ins.lastInsertRowid);
      });
      const runner = participantById(id);
      claims.claimDeclared(runner, files);
      insertMessage(runner, `joined: ${doing}`, null, "event", undefined, { event: EVENTS.joined.name });
      return { runner, roster: board.roster(runner.repo) };
      });
    },

    participant(name) {
      const i = name.lastIndexOf("/");
      if (i <= 0) return null;
      const plan = name.slice(0, i);
      const slice = name.slice(i + 1);
      // the latest run of that plan holding that slice, an open one first
      const r = db
        .prepare(`${PARTICIPANT_SQL} WHERE r.plan = ? AND p.slice = ? ORDER BY (r.state = 'open') DESC, r.id DESC LIMIT 1`)
        .get(plan, slice) as Row | undefined;
      return r ? toParticipant(r) : null;
    },

    identify({ worktree }) {
      if (!worktree) return null;
      const here = fold(path.resolve(worktree));
      const rows = (db.prepare(`${PARTICIPANT_SQL} WHERE p.worktree IS NOT NULL AND p.ended_at IS NULL AND r.state = 'open'`).all() as Row[]).filter(
        (r) => {
          const root = fold(String(r.worktree));
          return here === root || here.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
        },
      );
      if (!rows.length) return null;
      // the deepest worktree holding it; several runners on that one worktree is no answer
      const deepest = Math.max(...rows.map((r) => String(r.worktree).length));
      const best = rows.filter((r) => String(r.worktree).length === deepest);
      return best.length === 1 ? toParticipant(best[0]) : null;
    },

    setDoing(p, doing) {
      const fresh = live(p);
      db.prepare("UPDATE participants SET doing = ? WHERE id = ?").run(doing, fresh.id);
      insertMessage(fresh, `doing: ${doing}`, null, "event");
    },

    subscribe(p, subs) {
      const fresh = live(p);
      return setSubs(fresh, [...fresh.subscriptions, ...subs.filter((s) => !fresh.subscriptions.some((o) => sameSub(o, s)))]);
    },

    unsubscribe(p, subs) {
      const fresh = live(p);
      return setSubs(fresh, fresh.subscriptions.filter((o) => !subs.some((s) => sameSub(o, s))));
    },

    end(p) {
      const fresh = live(p);
      transaction(() => {
        // a held lock released by the end frees whoever was refused it (D65)
        const waiters = claims.lockWaitersFreedBy(fresh);
        const ended = { event: EVENTS.ended.name };
        if (waiters.length) insertMessage(fresh, `ended\nthe merge lock is free: ${waiters.map((n) => `@${n}`).join(" ")}`, null, "event", waiters, ended);
        else insertMessage(fresh, "ended", null, "event", undefined, ended);
        // the card's last word: what the runner's run came to, not its last doing (D66)
        db.prepare("UPDATE participants SET ended_at = ?, doing = CASE merged WHEN 1 THEN 'merged and ended' ELSE 'ended' END WHERE id = ?").run(now(), fresh.id);
        claims.releaseAll(fresh.id);
      });
    },

    phase(p, name, text) {
      const fresh = live(p);
      if (fresh.slice !== ORCHESTRATOR) throw new Error(`phase: only the orchestrator opens a phase; ${fresh.name} is not ${fresh.plan}/${ORCHESTRATOR}`);
      if (!PHASE_NAME.test(name)) throw new Error(`phase: a phase name is one word, got ${JSON.stringify(name)}`);
      const said = text.trim();
      if (!said) throw new Error(`phase ${name}: what does it ask?`);
      if (runRow(fresh.run).state !== "open") throw new Error(`run ${fresh.run} is closed`);
      return transaction(() => {
        // the run's current phase, the header of every delivery from now on
        db.prepare("UPDATE runs SET phase = ?, phase_text = ? WHERE id = ?").run(name, said, fresh.run);
        // a phase opened again starts with no member done
        db.prepare("DELETE FROM phase_done WHERE run = ? AND phase = ?").run(fresh.run, name);
        // D41: its all-done told once per opening
        db.prepare("DELETE FROM liveness_warned WHERE run = ? AND member = ? AND cond = ?").run(fresh.run, ORCHESTRATOR, `all-done ${name}`);
        return insertMessage(fresh, `phase ${name}: ${said}`, null, "event", [`${fresh.plan}/*`], { event: EVENTS.phase.name, meta: { phase: name } });
      });
    },

    currentPhase(run) {
      return phaseOf(runRow(run));
    },

    pause(p, text = "") {
      const fresh = live(p);
      if (fresh.slice !== ORCHESTRATOR) throw new Error(`pause: only the orchestrator pauses its run; ${fresh.name} is not ${fresh.plan}/${ORCHESTRATOR}`);
      const r = runRow(fresh.run);
      if (r.state !== "open") throw new Error(`run ${fresh.run} is closed`);
      if (r.paused != null) throw new Error(`run ${fresh.run} is already paused`);
      const said = text.trim();
      return transaction(() => {
        db.prepare("UPDATE runs SET paused = ? WHERE id = ?").run(said, fresh.run);
        return insertMessage(fresh, `pause: stop where you are and wait for the resume${said ? `: ${said}` : ""}`, null, "event", [`${fresh.plan}/*`], { event: EVENTS.pause.name });
      });
    },

    resume(p, text = "") {
      const fresh = live(p);
      if (fresh.slice !== ORCHESTRATOR) throw new Error(`resume: only the orchestrator resumes its run; ${fresh.name} is not ${fresh.plan}/${ORCHESTRATOR}`);
      const r = runRow(fresh.run);
      if (r.state !== "open") throw new Error(`run ${fresh.run} is closed`);
      if (r.paused == null) throw new Error(`run ${fresh.run} is not paused`);
      const said = text.trim();
      return transaction(() => {
        db.prepare("UPDATE runs SET paused = NULL, resumed_at = ?, stall_posts = 0 WHERE id = ?").run(now(), fresh.run);
        return insertMessage(fresh, `resume: continue${said ? `: ${said}` : ""}`, null, "event", [`${fresh.plan}/*`], { event: EVENTS.resume.name });
      });
    },

    pausedOf(run) {
      const r = runRow(run);
      return r.paused == null ? null : String(r.paused);
    },

    done(p, name) {
      const fresh = live(p);
      if (fresh.slice === ORCHESTRATOR) throw new Error("done: the orchestrator opens phases; a member runs done");
      const current = phaseOf(runRow(fresh.run));
      if (!current) throw new Error(`done ${name}: no phase is open in run ${fresh.run}`);
      if (current.name !== name) throw new Error(`done ${name}: the current phase is ${current.name}`);
      return transaction(() => {
        const added = Number(db.prepare("INSERT OR IGNORE INTO phase_done (run, participant, phase, at) VALUES (?, ?, ?, ?)").run(fresh.run, fresh.id, name, now()).changes) > 0;
        const progress = progressOf(fresh.run, name)!;
        const all = progress.of > 0 && progress.done === progress.of;
        if (!added) return { progress, all, already: true, message: null };
        const orch = `${fresh.plan}/${ORCHESTRATOR}`;
        const message = insertMessage(fresh, `done ${name} (${progress.done}/${progress.of})${goneSuffix(progress.gone)}`, null, "event", [orch], { event: EVENTS.done.name, meta: { phase: name } });
        allDoneOnce(fresh, progress);
        return { progress, all, already: false, message };
      });
    },

    lastActivity(run) {
      const r = runRow(run);
      const row = db
        .prepare("SELECT MAX(COALESCE(p.last_call, p.joined_at)) AS calls, (SELECT MAX(m.at) FROM messages m JOIN participants q ON q.id = m.author WHERE q.run = ?) AS posts FROM participants p WHERE p.run = ?")
        .get(run, run) as Row | undefined;
      return [String(r.opened_at), row?.calls, row?.posts].filter((v): v is string => typeof v === "string").sort().at(-1)!;
    },

    phaseProgress(run) {
      const r = runRow(run);
      return progressOf(run, r.phase == null ? null : String(r.phase));
    },

    owedPhase(p) {
      const row = db.prepare("SELECT id, run, slice, ended_at FROM participants WHERE id = ?").get(p.id) as Row | undefined;
      if (!row || row.ended_at != null || String(row.slice) === ORCHESTRATOR) return null;
      const r = db.prepare("SELECT * FROM runs WHERE id = ?").get(Number(row.run)) as Row | undefined;
      const current = r && r.state === "open" ? phaseOf(r) : null;
      if (!current) return null;
      const done = db.prepare("SELECT 1 FROM phase_done WHERE run = ? AND participant = ? AND phase = ?").get(Number(row.run), Number(row.id), current.name);
      return done ? null : current;
    },

    recordActivity(run, member, act, at) {
      const r = db.prepare("SELECT * FROM runs WHERE id = ?").get(run) as Row | undefined;
      if (!r || r.state !== "open") return;
      if (!db.prepare("SELECT 1 FROM participants WHERE run = ? AND slice = ? AND ended_at IS NULL").get(run, member)) return;
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
        db.prepare("INSERT INTO token_readings (run, member, t, tokens) VALUES (?, ?, ?, ?)").run(run, member, at.toISOString(), act.tokens);
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
        idleSince.delete(run);
        return false;
      }
      presenceOf.set(run, presence);
      const t = at.getTime();
      transaction(() => {
        db.prepare("DELETE FROM token_readings WHERE run = ? AND t < ?").run(run, new Date(t - READINGS_KEPT_MS).toISOString());
        for (const p of db.prepare("SELECT * FROM participants WHERE run = ? AND ended_at IS NULL").all(run) as Row[]) {
          const a = activityOf(run, String(p.slice));
          if (a) keepOwingSpan(r, p, a, t);
        }
        const states = statesOf(run, t);
        const others = [...states.values()].filter((st) => st.member !== ORCHESTRATOR);
        const orch = orchestratorIn(run);
        let progress = progressOf(run, r.phase == null ? null : String(r.phase));
        let where = progress ? `phase ${progress.phase} ${progressText(progress)}` : "no phase open";
        let moved = false;
        for (const st of others) {
          // D12: gone, once while it lasts, told in the store so a restarted server never tells it again (D37);
          // an ended member is not live, so never gone
          if (st.state !== "gone") {
            // idea 1, rule 4: a member told gone that reads non-gone again: one recovered to the orchestrator
            if (Number(db.prepare("DELETE FROM liveness_warned WHERE run = ? AND member = ? AND cond = 'gone'").run(run, st.member).changes) === 1)
              insertMessage(orch, `recovered ${orch.plan}/${st.member}: ${st.state}`, null, "event", [orch.name], { event: EVENTS.recovered.name });
          } else if (Number(db.prepare("INSERT OR IGNORE INTO liveness_warned (run, member, cond) VALUES (?, ?, 'gone')").run(run, st.member).changes) === 1) {
            insertMessage(orch, `gone ${orch.plan}/${st.member}: ${st.reason}`, null, "event", [orch.name], { event: EVENTS.gone.name });
          }
          // idea 1, rule 4: a lost link with the transcript still growing, once while it lasts
          if (st.reason === "link down" && st.state === "working") {
            if (Number(db.prepare("INSERT OR IGNORE INTO liveness_warned (run, member, cond) VALUES (?, ?, 'link-down')").run(run, st.member).changes) === 1)
              insertMessage(orch, `liveness ${orch.plan}/${st.member}: link lost, transcript still growing: restart its link`, null, "event", [orch.name], { event: EVENTS.liveness.name });
          } else db.prepare("DELETE FROM liveness_warned WHERE run = ? AND member = ? AND cond = 'link-down'").run(run, st.member);
          // D11: stalled per member, to the orchestrator alone; never while paused
          const a = activityOf(run, st.member);
          if (!a) {
            // D33: no link activity 30 s after the join: named once to the orchestrator
            const p = db.prepare("SELECT joined_at FROM participants WHERE run = ? AND slice = ? AND ended_at IS NULL").get(run, st.member) as Row | undefined;
            if (p && t - Date.parse(String(p.joined_at)) >= NO_TRANSCRIPT_MS) {
              const warned = db.prepare("INSERT OR IGNORE INTO liveness_warned (run, member, cond) VALUES (?, ?, 'none')").run(run, st.member);
              if (Number(warned.changes) === 1)
                insertMessage(orch, `no transcript found for ${orch.plan}/${st.member}: its state is presence only`, null, "event", [orch.name], { event: EVENTS.liveness.name });
            }
            continue;
          }
          // D36: stalled needs no progress AND the link alive; a member whose link is down is gone, or about to be
          // D46: a call open past BUSY_MAX_MS is told as stalled too, the member still busy
          const longCall = st.state === "busy" && st.since != null && t - st.since >= BUSY_MAX_MS;
          if ((st.state !== "quiet" && !longCall) || r.paused != null || !presence(st.member).connected) {
            if (a.stalled_at != null) {
              db.prepare("UPDATE member_activity SET stalled_at = NULL WHERE run = ? AND member = ?").run(run, st.member);
              moved = true;
            }
            continue;
          }
          if (a.stalled_at != null && t - Number(a.stalled_at) < STALLED_AGAIN_MS) continue;
          const meta: StalledMeta | undefined = st.rule ? { rule: st.rule, member: st.member, ...(st.owes ? { phase: st.owes } : {}) } : undefined;
          insertMessage(orch, `stalled ${orch.plan}/${st.member}: ${st.reason}; ${where}`, null, "event", [orch.name], { event: EVENTS.stalled.name, ...(meta ? { meta } : {}) });
          db.prepare("UPDATE member_activity SET stalled_at = ? WHERE run = ? AND member = ?").run(t, run, st.member);
        }
        // D41: the gone members this tick told are out of the count; the last one not done gone means all-done now
        progress = progressOf(run, r.phase == null ? null : String(r.phase));
        where = progress ? `phase ${progress.phase} ${progressText(progress)}` : "no phase open";
        if (progress?.gone.length) allDoneOnce(orch, progress);
        // D31: idle only when every member but the orchestrator is truly blocked in a wait; D41: the gone left out
        const gone = others.filter((st) => st.state === "gone").map((st) => `${orch.plan}/${st.member}`);
        const present = others.filter((st) => st.state !== "gone");
        // swarm-relay D44: not while a seat of the run has yet to join (a run filling up is not idle)
        const joined = new Set(others.map((st) => st.member));
        const toJoin = (db.prepare("SELECT id FROM slices WHERE run = ? AND state != 'done'").all(run) as Row[]).some((s) => !joined.has(String(s.id)));
        const allWaiting = r.paused == null && !toJoin && present.length > 0 && present.every((st) => st.state === "waiting");
        if (!allWaiting) {
          // the last post is kept: a member stirring for a moment does not buy a second idle within IDLE_MS (D44)
          const was = idleSince.get(run);
          if (was) idleSince.set(run, { since: Number.NaN, postedAt: was.postedAt });
        } else {
          // D34: once when it begins, then only after IDLE_MS while it lasts
          const kept = idleSince.get(run);
          const idle = kept && !Number.isNaN(kept.since) ? kept : { since: t, postedAt: kept?.postedAt ?? null };
          idleSince.set(run, idle);
          const held = t - idle.since;
          if (idle.postedAt == null || t - idle.postedAt >= IDLE_MS) {
            idle.postedAt = t;
            insertMessage(orch, `idle ${Math.floor(held / 1000)}s: every member is waiting${goneSuffix(gone)}; ${where}`, null, "event", [orch.name], { event: EVENTS.idle.name });
          }
        }
        if (moved) bump(String(r.repo));
      });
      return true;
    },

    endedMembers(repo) {
      const rows = db.prepare(`${PARTICIPANT_SQL} WHERE r.repo = ? AND r.state = 'open' AND p.ended_at IS NOT NULL`).all(repo) as Row[];
      return [...new Set(rows.map((r) => `${r.plan}/${r.slice}`))];
    },

    heldBy(p) {
      return (db.prepare("SELECT path FROM claims WHERE participant = ?").all(p.id) as Row[]).map((r) => String(r.path));
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
        name: `${r.plan}/${r.slice}`,
        nick: nickOf(r),
        run: Number(r.run),
        plan: String(r.plan),
        slice: String(r.slice),
        doing: String(r.doing),
        files: JSON.parse(String(r.files)) as Declared[],
        stale: Date.parse(String(r.last_call ?? r.joined_at)) < cutoff,
        subscriptions: subsOf(r),
        worktree: r.worktree == null ? null : String(r.worktree),
        state: stateIn(Number(r.run), String(r.slice))?.state ?? "working",
        activity: stateIn(Number(r.run), String(r.slice))?.doing ?? null,
        ...agesOf(livenessOf(Number(r.run), stateIn(Number(r.run), String(r.slice)), t)),
        unread: unreadOf(Number(r.id)),
      }));
    },

    post(p, body, opts = {}) {
      const fresh = live(p);
      const m = insertMessage(fresh, body, opts.about ?? null, opts.kind ?? "msg");
      // posting is claiming (D7), on a kind with claims
      const claimed = profileOf(fresh.kind).claims ? claims.claimByPost(fresh, m) : null;
      return claimed ? { ...m, claimed } : m;
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
      if (!phase) return [];
      // the phase event that opened it last: the thread runs from it to the next phase event, or to now
      const opened = db
        .prepare("SELECT MAX(seq) AS s FROM messages WHERE run = ? AND event = ? AND json_extract(meta, '$.phase') = ?")
        .get(fresh.run, EVENTS.phase.name, phase) as Row;
      if (opened.s == null) throw new Error(`thread: phase ${phase} was never opened in run ${fresh.run}`);
      const next = db.prepare("SELECT MIN(seq) AS s FROM messages WHERE run = ? AND event = ? AND seq > ?").get(fresh.run, EVENTS.phase.name, Number(opened.s)) as Row;
      return (
        db
          .prepare("SELECT * FROM messages WHERE run = ? AND seq > ? AND seq < ? AND kind != 'event' ORDER BY seq")
          .all(fresh.run, Number(opened.s), next.s == null ? Number.MAX_SAFE_INTEGER : Number(next.s)) as Row[]
      ).map(toMessage);
    },

    read(seq) {
      const r = db.prepare("SELECT * FROM messages WHERE seq = ?").get(seq) as Row | undefined;
      if (!r) throw new Error(`unknown message #${seq}`);
      return toMessage(r);
    },

    deliver(p) {
      return deliverTo(p, false);
    },

    deliverMentions(p) {
      return deliverTo(p, false, true);
    },

    wait(p, opts = {}) {
      const { timeoutMs, mentionsOnly = false, signal: abort } = opts;
      const column = mentionsOnly ? "listening" : "waiting";
      // a runner inside a `wait` shows `waiting` on the page; inside a `wait --mentions`, `listening`
      // beside its state. One live wait per runner (D64): this one takes the next number and the page's state, and any
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
        const finish = (d: Delivery | Error): void => {
          if (settled) return;
          settled = true;
          localWakers.delete(check);
          abort?.removeEventListener("abort", onAbort);
          clearInterval(poll);
          clearTimeout(timer);
          if (heldWaits.get(p.id) === held) heldWaits.delete(p.id);
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
            // `end`, from this process or another, releases a pending wait of that runner
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
        if (timeoutMs !== undefined) timer = setTimeout(() => finish({ full: [], lines: [] }), timeoutMs);
        check();
      });
    },
    checkEdit(p, file, opts = {}) {
      return claims.checkEdit(gated(live(p), "claim"), file, opts);
    },

    reconcileWrites(p, changed) {
      return claims.reconcileWrites(gated(live(p), "reconcile"), changed);
    },

    release(p, file) {
      claims.release(gated(live(p), "release"), file);
    },

    lockMerge(p, onto, reflogMark) {
      return claims.lockMerge(gated(live(p), "merge-lock"), onto, reflogMark);
    },

    merged(p, sha, files, conflicts) {
      return claims.merged(gated(live(p), "merged"), sha, files, conflicts);
    },

    heldMergeLock(p) {
      return claims.heldMergeLock(p);
    },

    stats(scope) {
      return statsOf(db, scope, STALE_MS);
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
        .map(([repo, runs]) => ({ repo, name: repoName(repo), runs }))
        .sort((a, b) => Number(b.runs.some((x) => x.open)) - Number(a.runs.some((x) => x.open)) || latest(b.runs) - latest(a.runs));
    },

    snapshot(repo) {
      const runRows = listedRuns().filter((r) => r.repo === repo);
      if (!runRows.length) throw new Error(`no repository ${repo}`);
      const runIds = runRows.map((r) => Number(r.id));
      const marks = runIds.map(() => "?").join(", ");

      const lockRow = db.prepare("SELECT participant, at FROM merge_locks WHERE repo = ?").get(repo) as Row | undefined;
      const lockHolder = lockRow && isLive(Number(lockRow.participant)) ? Number(lockRow.participant) : null;

      const sliceRows = db.prepare(`SELECT * FROM slices WHERE run IN (${marks}) ORDER BY run, ord`).all(...runIds) as Row[];
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
      const claimsOf = db.prepare("SELECT path, kind FROM claims WHERE participant = ? ORDER BY rowid");
      // every live claim on the repository, in claim order: the FileMap's rows, and which paths are shared (D40)
      const live = (
        db.prepare("SELECT c.path, c.kind, c.participant, p.slice, r.plan FROM claims c JOIN participants p ON p.id = c.participant JOIN runs r ON r.id = p.run WHERE c.repo = ? ORDER BY c.rowid").all(repo) as Row[]
      ).filter((c) => isLive(Number(c.participant)));
      const files = new Map<string, SnapshotFile>();
      for (const c of live) {
        const f = files.get(String(c.path)) ?? { path: String(c.path), holders: [], interface: false };
        f.holders.push(`${c.plan}/${c.slice}`);
        f.interface ||= c.kind === "interface";
        files.set(f.path, f);
      }
      // a file a live runner declared at join but could not claim, held by another: it holds it too (D62);
      // one it claimed and released since does not come back
      const everClaimed = db.prepare("SELECT 1 FROM claim_log WHERE repo = ? AND path = ? AND participant = ?");
      for (const r of people) {
        if (String(r.slice) === ORCHESTRATOR || !isLive(Number(r.id))) continue;
        const name = `${r.plan}/${r.slice}`;
        for (const d of JSON.parse(String(r.files)) as Declared[]) {
          const f = files.get(relPath(repo, d.path) ?? d.path);
          if (f && !f.holders.includes(name) && !everClaimed.get(repo, f.path, Number(r.id))) f.holders.push(name);
        }
      }
      const sharedBy = (path: string, id: number): boolean => live.some((c) => String(c.path) === path && Number(c.participant) !== id);

      const roster: SnapshotRunner[] = people.map((r) => {
        const id = Number(r.id);
        const slice = String(r.slice);
        const orchestrator = slice === ORCHESTRATOR;
        const s = sliceOf.get(`${r.run}/${slice}`);
        const ended = r.ended_at != null;
        const state: RunnerState = orchestrator
          ? runOpen.get(Number(r.run))
            ? "watching"
            : "done"
          : s?.state === "done"
            ? "done"
            : ended
              ? "ended"
              : lockHolder === id
                ? "merging"
                : Number(r.waiting) === 1
                  ? "waiting"
                  : "working";
        return {
          run: Number(r.run),
          runner: `${r.plan}/${slice}`,
          nick: nickOf(r),
          plan: String(r.plan),
          slice,
          title: orchestrator ? "" : String(s?.title ?? slice),
          doing: String(r.doing),
          state,
          stale: !ended && !orchestrator && Date.parse(String(r.last_call ?? r.joined_at)) < cutoff,
          files: (claimsOf.all(id) as Row[]).map((c) => ({ path: String(c.path), interface: c.kind === "interface", shared: sharedBy(String(c.path), id) })),
          joined: String(r.joined_at),
          ended: r.ended_at == null ? null : String(r.ended_at),
          calls: Number(r.calls ?? 0),
          listening: !ended && Number(r.listening) === 1,
          on: subsOf(r).map((x) => formatSubscriptions([x])),
          lastCall: String(r.last_call ?? r.joined_at),
          liveness: ended ? undefined : livenessOf(Number(r.run), stateIn(Number(r.run), slice), t),
          unread: ended ? 0 : unreadOf(id),
        };
      });

      const events = (
        db.prepare("SELECT * FROM (SELECT * FROM messages WHERE repo = ? ORDER BY seq DESC LIMIT ?) ORDER BY seq").all(repo, EVENTS_SHOWN) as Row[]
      ).map((r) => {
        const m = toMessage(r);
        return {
          seq: m.seq,
          at: m.at,
          kind: m.kind,
          from: m.from,
          body: m.body,
          about: m.about,
          run: m.run,
          channel: m.run,
          event: m.event,
          mentions: m.mentions,
          meta: m.meta ?? null,
        };
      });

      const nameOf = new Map(people.map((r) => [`${r.run}/${r.slice}`, `${r.plan}/${r.slice}`]));
      const queues: Record<string, QueueSlice[]> = {};
      for (const run of runRows) {
        // a later run of the same plan on the repository replaces the earlier one
        queues[String(run.plan)] = sliceRows
          .filter((s) => Number(s.run) === Number(run.id))
          .map((s) => ({
            slice: String(s.id),
            title: String(s.title),
            link: s.link == null ? null : String(s.link),
            state: String(s.state),
            blockers: JSON.parse(String(s.blockers)) as string[],
            runner: nameOf.get(`${run.id}/${s.id}`) ?? null,
          }));
      }

      const flags = (
        db.prepare("SELECT f.path, p.slice, r.plan FROM flags f JOIN participants p ON p.id = f.participant JOIN runs r ON r.id = p.run WHERE f.repo = ? ORDER BY f.rowid").all(repo) as Row[]
      ).map((f) => ({ path: String(f.path), runner: `${f.plan}/${f.slice}` }));

      const lockHistory = (
        db.prepare("SELECT t.asked_at, t.granted_at, t.merged_at, t.refused, p.slice, r.plan FROM lock_requests t JOIN participants p ON p.id = t.participant JOIN runs r ON r.id = p.run WHERE t.repo = ? ORDER BY t.asked_at DESC, t.rowid DESC LIMIT 50").all(repo) as Row[]
      ).map((t) => ({
        runner: `${t.plan}/${t.slice}`,
        askedAt: String(t.asked_at),
        grantedAt: t.granted_at == null ? null : String(t.granted_at),
        mergedAt: t.merged_at == null ? null : String(t.merged_at),
        refused: Number(t.refused),
      }));

      return {
        repo,
        name: repoName(repo),
        runs: runRows.map(runSummary),
        lockHistory,
        lock: lockHolder !== null ? { holder: participantById(lockHolder).name, since: String(lockRow!.at) } : null,
        roster,
        events,
        queues,
        files: [...files.values()],
        flags,
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
      db.prepare("INSERT OR REPLACE INTO member_links (run, member, connected, lost_at) VALUES (?, ?, ?, ?)").run(run, member, link.connected ? 1 : 0, link.lostAt);
    },

    savedLinks() {
      return (db.prepare("SELECT * FROM member_links").all() as Row[]).map((r) => ({
        run: Number(r.run),
        member: String(r.member),
        connected: Number(r.connected) === 1,
        lostAt: r.lost_at == null ? null : Number(r.lost_at),
      }));
    },

    close() {
      watching?.close();
      watching = null;
      listeners.clear();
      db.close();
    },
  };
  // Every verb a runner calls is one call to the board, counted here and nowhere else (D66):
  // what the card's call count shows, and the last sign of life "stale" is measured from.
  // `reconcileWrites` is part of `merge-lock` and `end`, not a call.
  /** The verbs that are a member's progress (swarm-relay D36). */
  const PROGRESS_VERBS: ReadonlySet<string> = new Set(["post", "done", "setDoing", "endorse", "merged"]);
  const countCall = (p: Participant, verb: string): void => {
    const at = now();
    db.prepare("UPDATE participants SET calls = calls + 1, last_call = ? WHERE id = ?").run(at, p.id);
    // D36: a post, `done` or `doing` is progress, a look at the board is not
    if (PROGRESS_VERBS.has(verb)) db.prepare("UPDATE participants SET progress_at = ? WHERE id = ?").run(at, p.id);
    // the call itself, for the member's timeline (D25)
    db.prepare("INSERT INTO call_log (participant, at, verb) VALUES (?, ?, ?)").run(p.id, at, verb);
    // a member's call clears its run's stale mark, so a later silence flags again (D19)
    db.prepare("UPDATE runs SET stale_flagged = 0 WHERE id = ? AND stale_flagged = 1").run(p.run);
    // an orchestrator marked quiet is back: one back event, and the mark cleared (D15)
    if (Number(db.prepare("UPDATE participants SET quiet_flagged = 0 WHERE id = ? AND quiet_flagged = 1").run(p.id).changes) > 0 && runRow(p.run).state === "open")
      insertMessage(participantById(p.id), "back", null, "event", [], { event: EVENTS.back.name });
    bump(participantById(p.id).repo);
  };
  // the verb and its count in one transaction: the page sees one change, and a refused call
  // (an ended runner, an unknown path) counts none
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
  board.resume = counted("resume", board.resume);
  board.done = counted("done", board.done);
  board.endorse = counted("endorse", board.endorse);
  board.deliver = counted("deliver", board.deliver);
  board.wait = counted("wait", board.wait);
  board.checkEdit = counted("checkEdit", board.checkEdit);
  board.release = counted("release", board.release);
  board.lockMerge = counted("lockMerge", board.lockMerge);
  board.merged = counted("merged", board.merged);
  const read = board.read;
  board.read = (seq, by) => {
    const m = read(seq);
    if (by) transaction(() => countCall(by, "read"));
    return m;
  };
  return board;
}
