// The board's rows read back (codebase-rework#D8): a run, a participant, a message, as the store keeps them.
import { nameHandle } from "./mentions.ts";
import { profileOf } from "../contract/kinds.ts";
import type { Message, MessageKind, MessageMeta, Participant, RunId } from "../contract/board.ts";
import { type EventName, isEvent } from "../contract/events.ts";
import { funnyName } from "./names.ts";
import type { Phase } from "./types.ts";
import { kindPackOf, kindVerifyOf } from "./pack-bridge.ts";
import type { Store } from "./store/store.ts";

/** board-split D36: a seat's state from its member, never stored: the `seats.state` column predating it is left unread.
 *  A correlated subquery over a seats row aliased `s`. */
export const SEAT_STATE_SQL = `(SELECT CASE WHEN p.id IS NULL OR (p.ended_at IS NOT NULL AND p.idle_ended = 1) THEN 'ready' WHEN p.ended_at IS NULL THEN 'running' ELSE 'done' END
  FROM (SELECT 1) LEFT JOIN participants p ON p.run = s.run AND p.seat = s.id)`;

/** V-16: the closed run a seat stands for: a run of the same project whose group is the seat's id (the decisions run
 *  seats one per authority run, named for its group), when the latest of that group is closed; else NULL. A correlated
 *  subquery over a seats row aliased `s`. */
export const SEAT_STOOD_FOR_CLOSED_SQL = `(SELECT CASE WHEN o.state = 'closed' THEN o.id END FROM runs o
  WHERE o.repo = (SELECT repo FROM runs WHERE id = s.run) AND o.plan = s.id AND o.id != s.run ORDER BY (o.state = 'open') DESC, o.id DESC LIMIT 1)`;

export const ORCHESTRATOR = "orchestrator";

export type Row = Record<string, unknown>;

/** The stored authority column read back: the roles in order, [] for none. */
export const authorityOf = (stored: unknown): string[] => {
  if (stored == null) return [];
  try {
    const roles = JSON.parse(String(stored));
    return Array.isArray(roles) ? roles.map(String) : [];
  } catch {
    return [];
  }
};

export function makeRows(store: Store) {
  const { db } = store;
  /** A run's row: undefined for an unknown run, where runRow throws. */
  const runRowOrNone = (id: RunId): Row | undefined => db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as Row | undefined;
  const runRow = (id: RunId): Row => runRowOrNone(id) ?? ((): never => { throw new Error(`unknown run ${id}`); })();
  const phaseOf = (r: Row): Phase | null => (r.phase == null ? null : { name: String(r.phase), text: String(r.phase_text ?? "") });
  const nickOf = (r: Row): string => String(r.nick);
  /** A funny name no active member of the project carries (D43, plan D17), kept for the run; nor any member of `run`,
   *  ended included, so one name in a run's record always means one seat. */
  const unusedNick = (repo: string, run?: RunId): string => {
    const rows = db
      .prepare(`${PARTICIPANT_SQL} WHERE r.repo = ? AND ((r.state = 'open' AND p.ended_at IS NULL) OR p.run = ?)`)
      .all(repo, run ?? -1) as Row[];
    return funnyName(rows.map(nickOf));
  };
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
    place: r.place == null ? null : String(r.place),
    listening: listensNow(r),
    // pack_chosen 0: an orchestrator, read as its kind's default (D22)
    ...(Number(r.pack_chosen ?? 0) === 1
      ? { pack: r.pack == null ? null : String(r.pack), verify: Number(r.verify) === 1 }
      : { pack: kindPackOf(String(r.kind ?? "plan")), verify: kindVerifyOf(String(r.kind ?? "plan")) }),
    kindPack: kindPackOf(String(r.kind ?? "plan")),
  });
  /** One read per participant for the length of one call: a caller turning many messages reads each author once. */
  const memoizedParticipants = (): ((id: number) => Participant) => {
    const read = new Map<number, Participant>();
    return (id) => read.get(id) ?? read.set(id, participantById(id)).get(id)!;
  };
  const participantById = (id: number): Participant => toParticipant(db.prepare(`${PARTICIPANT_SQL} WHERE p.id = ?`).get(id) as Row);
  /** `authorOf`: how its author is read; a caller turning many rows passes one memo, each author read once (board-fixes#D1). */
  const toMessage = (r: Row, authorOf: (id: number) => Participant): Message => {
    const author = authorOf(Number(r.author));
    return {
    seq: Number(r.seq),
    repo: String(r.repo),
    from: author.name,
    body: String(r.body),
    about: r.about == null ? null : String(r.about),
    kind: String(r.kind) as MessageKind,
    mentions: JSON.parse(String(r.mentions)) as string[],
    at: String(r.at),
    run: Number(r.run),
    endorses: r.endorses == null ? null : Number(r.endorses),
    event: r.event == null || !isEvent(String(r.event)) ? null : (String(r.event) as EventName),
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
  const live = (p: Participant): Participant => {
    const fresh = participantById(p.id);
    if (fresh.ended) throw new Error(`member ${p.name} has ended`);
    return fresh;
  };
  const isLive = (id: number): boolean =>
    db.prepare("SELECT 1 FROM participants p JOIN runs r ON r.id = p.run WHERE p.id = ? AND p.ended_at IS NULL AND r.state = 'open'").get(id) !== undefined;
  const orchestratorIn = (run: RunId): Participant =>
    participantById(Number((db.prepare("SELECT id FROM participants WHERE run = ? AND seat = ?").get(run, ORCHESTRATOR) as Row).id));
  return { runRowOrNone, runRow, phaseOf, nickOf, unusedNick, PARTICIPANT_SQL, listensNow, toParticipant, memoizedParticipants, participantById, toMessage, lastSeq, openPlans, activeNames, live, isLive, orchestratorIn };
}
export type Rows = ReturnType<typeof makeRows>;
