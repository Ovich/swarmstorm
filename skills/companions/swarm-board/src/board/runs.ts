// Runs (codebase-rework#D8): opened, given seats, closed, listed.
import { profileOf } from "../contract/kinds.ts";
import type { RunId } from "../contract/board.ts";
import { EVENTS } from "../contract/events.ts";
import { STALL_MS_DEFAULT } from "./liveness.ts";
import { ORCHESTRATORS_GROUP } from "../contract/wire.ts";
import type { Run, SeatSpec, Board } from "./types.ts";
import { SEAT_STATE_SQL, SEAT_STOOD_FOR_CLOSED_SQL, ORCHESTRATOR, type Row, authorityOf, type Rows } from "./rows.ts";
import { kindPackOf, type PackBridge } from "./pack-bridge.ts";
import type { Messages } from "./messages.ts";
import type { MemberView } from "./member-view.ts";
import type { Store } from "./store/store.ts";

/** A protocol's name: lower case, digits and dashes. */
const PROTOCOL_NAME = /^[a-z0-9][a-z0-9-]*$/;

/** A role of a run's authority (board-split#D28): plain strings, the core knows no list of them (D18, D24). */
const AUTHORITY_ROLE = /^[a-z0-9][a-z0-9-]*$/;

export function makeRuns(store: Store, rows: Rows, messages: Messages, packs: PackBridge, view: MemberView) {
  const { db, now } = store;
  const transaction = store.tx;
  const bump = store.changes.bump;
  const { runRow, phaseOf, unusedNick, participantById, lastSeq } = rows;
  const { insertMessage } = messages;
  const { packTables } = packs;
  const { seatStateOf, compositionOf, postComposition } = view;
  /** board-fixes#D12: ends (never deletes) each orchestrators-board seat whose team has no open run left in its project;
   *  idempotent: run at every open and at every close. */
  const endClosedOrchestratorSeats = (): void => {
    const at = new Date().toISOString();
    db.prepare(
      `UPDATE participants SET ended_at = ?, doing = 'ended' WHERE ended_at IS NULL AND seat != 'orchestrator' AND run IN (
         SELECT b.id FROM runs b WHERE b.plan = ? AND b.state = 'open')
       AND NOT EXISTS (SELECT 1 FROM runs t JOIN runs b ON b.id = participants.run WHERE t.repo = b.repo AND t.plan = participants.seat AND t.state = 'open')`,
    ).run(at, ORCHESTRATORS_GROUP);
  };
  endClosedOrchestratorSeats();
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
  const insertSeat = (run: RunId, s: SeatSpec, ord: number): void => {
    db.prepare("INSERT INTO seats (run, id, role, area, blockers, link, ord) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      run,
      s.id,
      s.role ?? null,
      s.area ?? null,
      JSON.stringify(s.blockers ?? []),
      s.link ?? null,
      ord,
    );
  };
  const verbs: Pick<Board, "openRun" | "addSeat" | "closeRun" | "runs" | "composition"> = {
    openRun({ repo, kind = "plan", group, title, link, seats, stallMs, protocol, authority = [], base }) {
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
        const orchestrator = db.prepare("INSERT INTO participants (run, seat, since_seq, joined_at, nick) VALUES (?, ?, ?, ?, ?)").run(
          run,
          ORCHESTRATOR,
          lastSeq(),
          now(),
          unusedNick(repo),
        );
        // stored with the run it opens (D69)
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
        // stored with the run it closes, before it closes (D67)
        const author = (db.prepare("SELECT id FROM participants WHERE run = ? AND seat = ?").get(run, ORCHESTRATOR) ??
          db.prepare("SELECT id FROM participants WHERE run = ? ORDER BY id LIMIT 1").get(run)) as Row | undefined;
        if (author) insertMessage(participantById(Number(author.id)), `run ${run} closed`, null, "event", undefined, { event: EVENTS.closed.name });
        db.prepare("UPDATE runs SET state = 'closed', closed_at = ? WHERE id = ?").run(now(), run);
        bump(String(runRow(run).repo));
        db.prepare("UPDATE participants SET ended_at = COALESCE(ended_at, ?) WHERE run = ?").run(now(), run);
        for (const p of db.prepare("SELECT id FROM participants WHERE run = ?").all(run) as Row[]) packTables.releaseAll(Number(p.id));
        // board-fixes#D12: the run's orchestrator leaves the orchestrators board with it
        endClosedOrchestratorSeats();
      });
    },

    runs() {
      return (db.prepare("SELECT * FROM runs WHERE state = 'open' ORDER BY id").all() as Row[]).map(toRun);
    },

    composition(run) {
      runRow(run);
      return compositionOf(run);
    },
  };
  return verbs;
}
