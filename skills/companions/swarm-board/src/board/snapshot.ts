// The snapshot (codebase-rework#D8, D39): every project listed, and everything the page draws for one.
import path from "node:path";
import { BOARD_AUTHOR, planCode } from "./conversation/mentions.ts";
import { profileOf } from "../contract/kinds.ts";
import type { Message, RunId } from "../contract/board.ts";
import { STALL_MS_DEFAULT } from "./members/liveness.ts";
import type { MemberState, RunSummary, SnapshotMember, SnapshotMemberState, QueueSeat, Board } from "./types.ts";
import { SEAT_STATE_SQL, ORCHESTRATOR, type Row, authorityOf, type Rows } from "./rows.ts";
import { retentionCutoff } from "./run/retention.ts";
import type { Paths } from "./paths.ts";
import type { PackBridge } from "./pack-bridge.ts";
import type { PhaseReads } from "./phases/phase-reads.ts";
import type { MemberView } from "./members/member-view.ts";
import type { Deliveries } from "./conversation/delivery.ts";
import type { Store } from "../store/store.ts";

/** A project is keyed by its common git dir (the code pack's repository); without an aiview project it is shown by its
 *  checkout's folder name. */
export const projectFolderName = (repo: string): string => {
  const base = path.basename(repo);
  return base.toLowerCase() === ".git" ? path.basename(path.dirname(repo)) : base.replace(/\.git$/i, "");
};

/** board-split D51: the board's own alarms about a member. Stored under the orchestrator's row (its run, its wake), they
 *  are always served as the board's (`from: swarm`), never the orchestrator's (D51 over D36), with the member they tell of as `subject`. */
const BOARD_ALARMS: ReadonlySet<string> = new Set(["stopped", "lost"]);

/** The member a board alarm tells of: the body's head. */
function alarmSubjectOf(m: Message): string | null {
  // `lost <group>/<id>: …`; a swarm stopped (`stopped <group>: …`) names none
  const head = /^\S+ (\S+?\/\S+?):? /.exec(m.body)?.[1];
  return head ?? null;
}

/** The page shows the last this many messages of a thread. */
const EVENTS_SHOWN = 500;

export function makeSnapshot(store: Store, rows: Rows, paths: Paths, packs: PackBridge, owing: PhaseReads, view: MemberView, delivery: Deliveries) {
  const { db } = store;
  const { phaseOf, nickOf, PARTICIPANT_SQL, memoizedParticipants, toMessage, isLive } = rows;
  const { relPath } = paths;
  const { registry } = packs;
  const { progressOf } = owing;
  const { seatStateOf, memberStateOf, activityShown, statesOf, livenessOf, contextOf } = view;
  const { unreadOf } = delivery;
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
  const verbs: Pick<Board, "repos" | "snapshot"> = {
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
      const t = Date.now();
      const statesByRun = new Map<RunId, Map<string, MemberState>>();
      const stateIn = (run: RunId, member: string): MemberState | undefined => {
        if (!statesByRun.has(run)) statesByRun.set(run, statesOf(run, t));
        return statesByRun.get(run)!.get(member);
      };
      // board-fixes#D1: one read per participant for the whole snapshot, shared by the pack, the roster's unread and the events
      const authorOf = memoizedParticipants();
      // the pack's fields of the project: the lock and its turns, the files held (D18)
      const packPart = registry.snapshot({ db, isLive, nameOf: (id) => authorOf(id).name, relPath }, repo, people, ORCHESTRATOR);

      const runsById = new Map(runRows.map((x) => [Number(x.id), x]));
      const runById = (id: number): Row | undefined => runsById.get(id);
      const roster: SnapshotMember[] = people.map((r) => {
        const id = Number(r.id);
        const seat = String(r.seat);
        const orchestrator = seat === ORCHESTRATOR;
        const s = sliceOf.get(`${r.run}/${seat}`);
        const ended = r.ended_at != null;
        const runR = runById(Number(r.run));
        const core = memberStateOf(r, runR ?? undefined, t);
        const state: SnapshotMemberState = core;
        // what its pack says of it (merging), beside its state, on a live member only
        const fact = core === "working" || core === "stopped" ? packPart.factOf(id) : null;
        const liveness = ended ? undefined : livenessOf(Number(r.run), stateIn(Number(r.run), seat), t);
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
          files: packPart.heldFilesOf(id),
          joined: String(r.joined_at),
          ended: r.ended_at == null ? null : String(r.ended_at),
          calls: Number(r.calls ?? 0),
          listening: !ended && Number(r.listening) === 1,
          lastCall: String(r.last_call ?? r.joined_at),
          liveness,
          context: contextOf(Number(r.run), seat),
          badge: liveness?.badge ?? null,
          unread: ended ? 0 : unreadOf(id, authorOf),
          // U-F13: an ended seat runs nothing the card should show; its last calls are stale
          ...(ended ? {} : activityShown(Number(r.run), seat)),
        };
      });

      const events = (
        db.prepare("SELECT * FROM (SELECT * FROM messages WHERE repo = ? ORDER BY seq DESC LIMIT ?) ORDER BY seq").all(repo, EVENTS_SHOWN) as Row[]
      ).map((r) => {
        const m = toMessage(r, authorOf);
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
  };
  return verbs;
}
