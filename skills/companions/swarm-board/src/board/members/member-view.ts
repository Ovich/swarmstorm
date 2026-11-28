// A member as the board shows it (codebase-rework#D8): its one state, its activity, its badge, its run's composition.
// Owns the waits this process holds and the presence each run's tick last gave.
import type { Participant, RunId } from "../../contract/board.ts";
import { EVENTS, landingEvents } from "../../contract/events.ts";
import { LOST_MS, NO_TRANSCRIPT_MS, STALL_MS_DEFAULT, stallMsFloor, coreStateOf, type CoreMemberState, type SeatState } from "./liveness.ts";
import { callLabel } from "./call-label.ts";
import type { Composition, CompositionEntry, MemberContext, MemberState, Badge, Presence, Liveness, SnapshotMember } from "../types.ts";
import { SEAT_STOOD_FOR_CLOSED_SQL, ORCHESTRATOR, type Row, type Rows } from "../rows.ts";
import type { PhaseReads } from "../phases/phase-reads.ts";
import type { Messages } from "../conversation/messages.ts";
import type { PackBridge } from "../pack-bridge.ts";
import type { Store } from "../../store/store.ts";

export function makeMemberView(store: Store, rows: Rows, owing: PhaseReads, messages: Messages, packs: PackBridge) {
  const { db } = store;
  const { runRowOrNone, runRow, nickOf, PARTICIPANT_SQL, participantById } = rows;
  const { owedNameOf } = owing;
  const { insertMessage, openTaskOf } = messages;
  const { packOf, packCtxOf } = packs;
  /** A seat's state: its member's (liveness.ts), `empty` while nobody sat in it; `ended` when it stands for a closed run (V-16). */
  const seatStateOf = (run: Row, seat: string, standsForClosed: boolean): SeatState => {
    if (standsForClosed) return "ended";
    const p = db.prepare("SELECT * FROM participants WHERE run = ? AND seat = ?").get(Number(run.id), seat) as Row | undefined;
    return p ? memberStateOf(p, run) : "empty";
  };
  /** board-fixes#D5: the member's doing text is stale once its work landed (a pack's landing event), or an event addressed
   *  to it by name came, after it was set; a broadcast to its group (a phase) never stales it, nor anything for the orchestrator. */
  const doingStaleOf = (r: Row): boolean => {
    if (String(r.seat) === ORCHESTRATOR || !String(r.doing ?? "")) return false;
    const landing = landingEvents();
    const landed = landing.length ? `(author = ? AND event IN (${landing.map(() => "?").join(", ")})) OR ` : "";
    return db
      .prepare(`SELECT 1 FROM messages WHERE run = ? AND seq > ? AND (${landed}(author != ? AND event IS NOT NULL AND mentions LIKE ?)) LIMIT 1`)
      .get(Number(r.run), Number(r.doing_seq ?? r.since_seq), ...(landing.length ? [Number(r.id), ...landing] : []), Number(r.id), `%${JSON.stringify(`${r.plan}/${r.seat}`)}%`) != null;
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
  /** A change of the run's composition, one line on the run's thread (D4): `+ w4 worker (the app) added`, `- w2 gone`. */
  const seatWho = (run: RunId, seat: string): string => {
    const c = compositionOf(run);
    const e = c.entries.find((x) => x.seat === seat);
    return `${seat}${e?.nick ? ` ${e.nick}` : ""}${c.showRole && e?.role ? ` ${e.role}` : ""}${e?.area ? ` (${e.area})` : ""}`;
  };
  const postComposition = (author: Participant, seat: string, sign: "+" | "-", tag: string): void => {
    insertMessage(author, `${sign} ${seatWho(author.run, seat)}${tag ? ` ${tag}` : ""}`, null, "event", undefined, { event: EVENTS.composition.name });
  };
  // ── liveness: member states from activity (swarm-relay D9, D11, D12, D31) ─────────────
  /** The presence each run's tick last gave: the snapshot and the roster read states through it. */
  const presenceOf = new Map<RunId, Presence>();
  const noPresence: Presence = () => ({ connected: false, lostAt: null });
  /** The waits this process holds, by participant id, and since when (ms epoch): the waiting of D35. */
  const heldWaits = new Map<number, number>();
  const activityOf = (run: RunId, member: string): Row | undefined =>
    db.prepare("SELECT * FROM member_activity WHERE run = ? AND member = ?").get(run, member) as Row | undefined;
  /** product-shape#D1: the member's context size and when it was read, from its link's last report; null when none told it. */
  const contextOf = (run: RunId, member: string): MemberContext | null => {
    const a = activityOf(run, member);
    return a?.context == null || a.context_at == null ? null : { tokens: Number(a.context), at: Number(a.context_at) };
  };
  /** board-split D49 (A1-5): in a board wait this server holds, set and cleared by the wait itself, and that wait is the
   *  member's open call (its link says so; with no link yet, the held wait alone): a background listener is not. */
  /** V-26, V-46: the pack's lock `p` is queued on (the holder and the lock's name), as its pack says; null: none. */
  const packLockWaitOf = (p: Row): { queuedBehind: string; lock: string } | null => {
    if (String(p.seat) === ORCHESTRATOR || p.ended_at != null) return null;
    const m = participantById(Number(p.id));
    return packOf(m)?.lockQueue?.(m, packCtxOf(m)) ?? null;
  };
  /** A participant row's one state (liveness.ts), the same for snapshot, roster, status, seats and reader. */
  const memberStateOf = (p: Row, run: Row | undefined, t = Date.now()): CoreMemberState =>
    coreStateOf({
      runOpen: run?.state === "open",
      ended: p.ended_at != null,
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
  /** Whether a member owes work: the orchestrator always; a member the open phase undone, or what its pack says it is
   *  doing (fix2: the code pack's merging, the merge lock held). */
  const owesOf = (p: Row, run: Row): boolean => {
    if (String(p.seat) === ORCHESTRATOR || owedNameOf(p, run) != null) return true;
    // board-fixes#D5: an open task owes, phase or not
    if (openTaskOf(Number(run.id), `${run.plan}/${p.seat}`, Number(p.id)) != null) return true;
    const m = participantById(Number(p.id));
    return packOf(m)?.memberFact?.(m, packCtxOf(m)) != null;
  };
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
  /** board-split D55: when the board server came up, ms epoch; null when none recorded it (a board opened alone). */
  const serverUpAt = (): number | null => {
    const r = db.prepare("SELECT value FROM server_facts WHERE name = 'server_up_at'").get() as Row | undefined;
    return r == null ? null : Number(r.value);
  };
  /** board-split D55: the link is down iff not ended, no held wait, and the link unseen, the server up and the seating
   *  all >= LOST_MS: a restart, a reconnect or a join never reads down. fix2: the link's own fact alone, never the
   *  member's board calls or growth, so the state and the link age read the same (a link down never reads stopped). */
  const lostOf = (p: Row, run: Row, t: number): Badge | null => {
    if (p.ended_at != null || heldWaits.has(Number(p.id))) return null;
    const link = (presenceOf.get(Number(run.id)) ?? noPresence)(String(p.seat));
    if (link.connected) return null;
    const old = (at: number | null): boolean => at == null || t - at >= LOST_MS;
    const up = serverUpAt();
    const seatedAt = Date.parse(seatedAtOf(p));
    const linkSeenAt = Math.max(link.seenAt ?? 0, link.lostAt ?? 0) || null;
    if (!old(linkSeenAt) || !old(up) || !old(seatedAt)) return null;
    const since = Math.max(linkSeenAt ?? 0, seatedAt, up ?? 0) + LOST_MS;
    if (link.lostAt == null || link.lostAt < seatedAt) return { name: "lost", reason: "no link since its join", since };
    return { name: "lost", reason: `its link was lost${link.cause ? ` (${link.cause})` : ""}`, since };
  };
  /** board-split D55 (amended, U-F27): a lost badge holds only once its episode opened (its predicate true
   *  for BADGE_CONFIRM_MS, by time, not by tick count); `predicate`: the tick's own read, before that confirm. */
  const episodeOpenOf = (run: RunId, member: string, badge: string): boolean =>
    db.prepare("SELECT 1 FROM badge_episodes WHERE run = ? AND member = ? AND badge = ? AND opened_at IS NOT NULL AND closed_at IS NULL").get(run, member, badge) != null;
  /** board-split D55: the one view of a member, from its facts at `t`: its activity, its badge (lost; none
   *  ended) and the badge's reason. The snapshot, roster, status and the tick all read it. */
  const memberView = (p: Row, run: Row, t: number, opts: { predicate?: boolean } = {}): MemberState => {
    const activity = activityShownOf(p, run, t);
    if (p.ended_at != null) return { ...activity, badge: null };
    // board-split D55: lost shows only once its episode opened; `predicate`: the tick's raw read. A link dropped while
    // owing raises lost; one dropped owing nothing is away, with nothing to tell (#48)
    const lost = lostOf(p, run, t);
    const shows = opts.predicate === true || episodeOpenOf(Number(run.id), String(p.seat), "lost");
    return { ...activity, badge: lost && owedAtDropOf(p, run) && shows ? lost : null };
  };
  const minutes = (ms: number): number => Math.round(ms / 60000);
  /** The states of a run's live members (not ended), keyed by member. */
  const statesOf = (run: RunId, t: number, predicate = false): Map<string, MemberState> => {
    const r = runRowOrNone(run);
    if (!r) return new Map();
    const live = db.prepare("SELECT * FROM participants WHERE run = ? AND ended_at IS NULL ORDER BY id").all(run) as Row[];
    return new Map(live.map((p) => [String(p.seat), memberView(p, r, t, { predicate })]));
  };
  const livenessOf =(run: RunId, st: MemberState | undefined, t: number): Liveness | undefined => {
    if (!st) return undefined;
    const a = activityOf(run, st.member);
    const r = runRowOrNone(run) as Row;
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
  return { contextOf, seatStateOf, doingStaleOf, compositionOf, seatWho, postComposition, presenceOf, heldWaits, memberStateOf, tokensMovedAtOf, stallWindowOf, owesOf, seatedAtOf, activityShown, memberView, minutes, statesOf, livenessOf, agesOf };
}
export type MemberView = ReturnType<typeof makeMemberView>;
