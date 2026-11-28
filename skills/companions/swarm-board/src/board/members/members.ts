// Members (codebase-rework#D8): a seat taken and left, who is calling, the roster.
import path from "node:path";
import { canonicalPath } from "../../host/place.ts";
import { profileOf } from "../../contract/kinds.ts";
import type { AllJoinedMeta, Declared, RunId } from "../../contract/board.ts";
import { EVENTS } from "../../contract/events.ts";
import type { MemberState, Board } from "../types.ts";
import { ORCHESTRATOR, type Row, type Rows } from "../rows.ts";
import type { Messages } from "../conversation/messages.ts";
import type { PackBridge } from "../pack-bridge.ts";
import type { PhaseReads } from "../phases/phase-reads.ts";
import type { MemberView } from "./member-view.ts";
import type { Deliveries } from "../conversation/delivery.ts";
import type { Store } from "../../store/store.ts";

export function makeMembers(store: Store, rows: Rows, messages: Messages, packs: PackBridge, owing: PhaseReads, view: MemberView, delivery: Deliveries) {
  const { db, now } = store;
  const transaction = store.tx;
  const { runRowOrNone, runRow, nickOf, unusedNick, PARTICIPANT_SQL, toParticipant, memoizedParticipants, participantById, lastSeq, live } = rows;
  const { insertMessage, openTaskOf } = messages;
  const { packOf, packCtxOf, factEntry, registry } = packs;
  const { owedNameOf } = owing;
  const { contextOf, doingStaleOf, compositionOf, seatWho, memberStateOf, owesOf, seatedAtOf, statesOf, livenessOf, agesOf } = view;
  const { unreadOf } = delivery;
  const verbs: Pick<Board, "join" | "participant" | "identify" | "setDoing" | "end" | "roster" | "endedMembers" | "owingMembers" | "heldBy" | "idle"> = {
    join({ run, seat, doing, files, place }) {
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
        const existing = db.prepare("SELECT id, nick, ended_at FROM participants WHERE run = ? AND seat = ?").get(run, seat) as Row | undefined;
        const seatRow = db.prepare("SELECT 1 FROM seats WHERE run = ? AND id = ?").get(run, seat);
        // D17: a seat is declared before anyone sits in it
        if (!seatRow && !existing) throw new Error(`seat ${seat} is not declared in run ${run}: declare it first with \`seat add ${seat}\``);
        const fresh = (): string => unusedNick(String(r.repo), run);
        if (existing) {
          entry = existing.ended_at == null ? "again" : "back";
          // S24: a re-join is the member's call, so its row reads fresh in the roster, never stale from the seat's last member
          db.prepare("UPDATE participants SET doing = ?, files = ?, place = ?, ended_at = NULL, idle_ended = 0, dropped_owing = NULL, nick = COALESCE(nick, ?), pack = ?, verify = ?, pack_chosen = 1, last_call = ?, seated_at = ? WHERE id = ?").run(
            doing,
            JSON.stringify(files),
            where,
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
          .prepare("INSERT INTO participants (run, seat, place, doing, files, since_seq, joined_at, nick, pack, verify, pack_chosen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)")
          .run(run, seat, where, doing, JSON.stringify(files), since, now(), fresh(), packName, verify);
        return Number(ins.lastInsertRowid);
      });
      // board-fixes#D5: the join's doing is set now; what came before it never stales it
      db.prepare("UPDATE participants SET doing_at = ?, doing_seq = ? WHERE id = ?").run(now(), lastSeq(), id);
      const member = participantById(id);
      // the member's pack takes what it declared, and reads it fresh (the code pack: its claims, merged since its join)
      packOf(member)?.onJoin?.(member, packCtxOf(member), files);
      // G5, D4: one line per join: the joined event names the seat as a composition line would, so no composition
      // line beside it
      // break-flow V-15: a re-join posts no second joined: a seat whose member had ended reads as one `<seat> back`
      // line (`+ <seat> <nick> back: <doing>`); the same member joining again while seated posts nothing
      if (entry === "new") insertMessage(member, `joined: ${doing} · + ${seatWho(run, seat)}`, null, "event", undefined, { event: EVENTS.joined.name });
      else if (entry === "back") insertMessage(member, `+ ${seatWho(run, seat)} back: ${doing}`, null, "event", undefined, { event: EVENTS.joined.name });
      // D5: the last declared seat to get a member tells the orchestrator once, addressed to it
      if (entry === "new") {
        const declared = Number((db.prepare("SELECT COUNT(*) AS n FROM seats WHERE run = ?").get(run) as Row).n);
        const seated = Number((db.prepare("SELECT COUNT(*) AS n FROM participants WHERE run = ? AND seat != ?").get(run, ORCHESTRATOR) as Row).n);
        const phased = db.prepare("SELECT 1 FROM messages WHERE run = ? AND event = ?").get(run, EVENTS.phase.name) !== undefined;
        if (!phased && declared > 0 && seated >= declared && (db.prepare("SELECT 1 FROM seats s WHERE s.run = ? AND NOT EXISTS (SELECT 1 FROM participants p WHERE p.run = s.run AND p.seat = s.id)").get(run) === undefined)) {
          // a post already made to a seat (before its join) is a task given: the orchestrator is not told to post them again
          const tasked = db
            .prepare("SELECT 1 FROM messages m JOIN seats s ON s.run = m.run WHERE m.run = ? AND m.kind != 'event' AND m.mentions LIKE '%\"' || ? || '/' || s.id || '\"%'")
            .get(run, String(member.plan)) !== undefined;
          const allJoined: AllJoinedMeta = { tasked };
          insertMessage(member, `all joined: ${declared} seat${declared === 1 ? "" : "s"}`, null, "event", [`${member.plan}/${ORCHESTRATOR}`], { event: EVENTS["all-joined"].name, meta: allJoined });
        }
      }
      return { member, roster: verbs.roster(member.repo), composition: compositionOf(run), entry };
      });
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
      const here = canonicalPath(place);
      const rows = (db.prepare(`${PARTICIPANT_SQL} WHERE p.place IS NOT NULL AND p.ended_at IS NULL AND r.state = 'open'`).all() as Row[]).filter(
        (r) => {
          const root = canonicalPath(String(r.place));
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
      const said = insertMessage(fresh, `doing: ${doing}`, null, "event");
      db.prepare("UPDATE participants SET doing = ?, doing_at = ?, doing_seq = ? WHERE id = ?").run(doing, now(), said.seq, fresh.id);
    },

    end(p) {
      const fresh = live(p);
      // ended on an idle answer: idle-ended, the seat still owes the run's later phases
      const idleEnded = verbs.idle(fresh) ? 1 : 0;
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

    roster(repo) {
      const authorOf = memoizedParticipants();
      const rows = db
        .prepare(`${PARTICIPANT_SQL} WHERE r.repo = ? AND r.state = 'open' AND p.ended_at IS NULL ORDER BY r.id, p.id`)
        .all(repo) as Row[];
      const t = Date.now();
      const statesByRun = new Map<RunId, Map<string, MemberState>>();
      const stateIn = (run: RunId, member: string): MemberState | undefined => {
        if (!statesByRun.has(run)) statesByRun.set(run, statesOf(run, t));
        return statesByRun.get(run)!.get(member);
      };
      // each run's row read once for all its members
      const runsRead = new Map<RunId, Row | undefined>();
      const runOf = (run: RunId): Row | undefined => (runsRead.has(run) ? runsRead.get(run) : runsRead.set(run, runRowOrNone(run)).get(run));
      return rows.map((r) => ({
        name: `${r.plan}/${r.seat}`,
        nick: nickOf(r),
        run: Number(r.run),
        plan: String(r.plan),
        seat: String(r.seat),
        doing: String(r.doing),
        files: JSON.parse(String(r.files)) as Declared[],
        held: registry.heldOf(db, Number(r.id)),
        badge: stateIn(Number(r.run), String(r.seat))?.badge ?? null,
        context: contextOf(Number(r.run), String(r.seat)),
        worktree: r.place == null ? null : String(r.place), // AGENTS EXCEPTION (rule D24): the roster's JSON key, frozen
        // board-split D49: the one state; what it does (busy on a call or a background task) is its activity
        // U-F12: the pack's fact (merging) is the state word here too, as in the snapshot
        state: memberStateOf(r, runOf(Number(r.run)), t),
        activity: stateIn(Number(r.run), String(r.seat))?.doing ?? null,
        ...agesOf(livenessOf(Number(r.run), stateIn(Number(r.run), String(r.seat)), t)),
        unread: unreadOf(Number(r.id), authorOf),
        task: openTaskOf(Number(r.run), `${r.plan}/${r.seat}`, Number(r.id)),
        doingAt: Date.parse(String(r.doing_at ?? seatedAtOf(r))),
        doingStale: doingStaleOf(r),
        ...factEntry(toParticipant(r)),
      }));
    },

    endedMembers(repo) {
      const rows = db.prepare(`${PARTICIPANT_SQL} WHERE r.repo = ? AND r.state = 'open' AND p.ended_at IS NOT NULL`).all(repo) as Row[];
      return [...new Set(rows.map((r) => `${r.plan}/${r.seat}`))];
    },

    owingMembers(run) {
      const r = runRowOrNone(run);
      if (!r) return [];
      const live = db.prepare("SELECT * FROM participants WHERE run = ? AND ended_at IS NULL AND seat != ? ORDER BY id").all(run, ORCHESTRATOR) as Row[];
      return live.filter((p) => owesOf(p, r)).map((p) => `${String(r.plan)}/${String(p.seat)}`);
    },

    heldBy(p) {
      return (packOf(p)?.held?.(db, p.id) ?? []).map((d) => d.path);
    },

    idle(p) {
      const row = db.prepare("SELECT * FROM participants WHERE id = ?").get(p.id) as Row | undefined;
      if (!row || row.ended_at != null || String(row.seat) === ORCHESTRATOR || Number(row.empty_waits) < 2) return false;
      if (owedNameOf(row, runRow(Number(row.run))) != null) return false;
      if (openTaskOf(p.run, p.name, p.id) != null) return false;
      // a member its pack calls busy (the code pack: holding a claim or the merge lock) is never idle
      const fresh = participantById(p.id);
      if (packOf(fresh)?.busy?.(fresh, packCtxOf(fresh))) return false;
      // rechecked at answer time: a mention landed since the wait returned empty means work
      return unreadOf(p.id) === 0;
    },
  };
  return verbs;
}
