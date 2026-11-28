// The server's clock (codebase-rework#D8): a link's activity and presence recorded, and each tick's states, lost and
// stopped alarms.
import type { Participant, RunId } from "../../contract/board.ts";
import { EVENTS } from "../../contract/events.ts";
import { READINGS_KEPT_MS, badgeConfirmMs } from "./liveness.ts";
import { progressText } from "../progress-line.ts";
import type { LinkDropCause, Board } from "../types.ts";
import { ORCHESTRATOR, type Row, type Rows } from "../rows.ts";
import type { Messages } from "../conversation/messages.ts";
import type { PackBridge } from "../pack-bridge.ts";
import type { PhaseReads } from "../phases/phase-reads.ts";
import type { MemberView } from "./member-view.ts";
import type { AllDoneOnce } from "../phases/phases.ts";
import type { Store } from "../../store/store.ts";

export function makeMemberStates(store: Store, rows: Rows, messages: Messages, packs: PackBridge, owing: PhaseReads, view: MemberView, allDoneOnce: AllDoneOnce) {
  const { db } = store;
  const transaction = store.tx;
  const bump = store.changes.bump;
  const { runRowOrNone, participantById, orchestratorIn } = rows;
  const { insertMessage, tellAwaiting } = messages;
  const { packOf, packCtxOf } = packs;
  const { progressOf } = owing;
  const { postComposition, presenceOf, memberStateOf, tokensMovedAtOf, stallWindowOf, owesOf, memberView, minutes, statesOf } = view;
  /** U-F20: per run, the badges its last tick read, so a badge changing with time alone tells the readers. */
  const badgesShown = new Map<RunId, string>();
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
  /** Closes, without a word, the episodes of a run's members not in `watched` (ended), dropping pending ones. */
  const closeEpisodesOutside = (run: RunId, watched: string[], t: number): void => {
    const keep = new Set(watched);
    for (const e of db.prepare("SELECT rowid AS id, member, opened_at FROM badge_episodes WHERE run = ? AND closed_at IS NULL").all(run) as Row[]) {
      if (keep.has(String(e.member))) continue;
      if (e.opened_at == null) db.prepare("DELETE FROM badge_episodes WHERE rowid = ?").run(Number(e.id));
      else db.prepare("UPDATE badge_episodes SET closed_at = ? WHERE rowid = ?").run(t, Number(e.id));
    }
  };
  const verbs: Pick<Board, "recordActivity" | "memberStates" | "livenessTick" | "recordLink" | "recordServerUp" | "savedLinks"> = {
    recordActivity(run, member, act, at) {
      const r = runRowOrNone(run);
      if (!r || r.state !== "open") return;
      if (!db.prepare("SELECT 1 FROM participants WHERE run = ? AND seat = ? AND ended_at IS NULL").get(run, member)) return;
      transaction(() => {
        const o = act.openTool;
        db.prepare(
          `INSERT INTO member_activity (run, member, grew_at, tokens, context, context_at, open_tool, open_target, open_since, open_wait, last_tool, finished, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (run, member) DO UPDATE SET grew_at = excluded.grew_at, tokens = excluded.tokens,
             context = COALESCE(excluded.context, member_activity.context), context_at = CASE WHEN excluded.context IS NULL THEN member_activity.context_at ELSE excluded.context_at END,
             open_tool = excluded.open_tool, open_target = excluded.open_target, open_since = excluded.open_since, open_wait = excluded.open_wait, last_tool = excluded.last_tool, finished = excluded.finished, at = excluded.at`,
          // product-shape#D3: a null size keeps the last one and its time; an older link's size is dated by its arrival
        ).run(run, member, act.grewAt, act.tokens, act.context, act.context == null ? null : (act.contextAt ?? at.getTime()), o?.name ?? null, o?.target ?? null, o?.since ?? null, o?.boardWait ? 1 : 0, act.lastTool, act.finished ? 1 : 0, at.getTime());
        // idea 1: the turn state, last line, awaited background task and transcript path; null when the link has none
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
        // idea 4: a kill the link saw, by name, pattern or port: to the member itself, once per distinct command per member
        const kill = act.breach ?? null;
        const me = kill ? (db.prepare("SELECT id, joined_at FROM participants WHERE run = ? AND seat = ? AND ended_at IS NULL").get(run, member) as Row) : null;
        // G2: only a kill after the member joined (the orchestrator: after the open) is judged; the transcript's earlier lines are not the run's
        if (kill && me && kill.at >= Date.parse(String(me.joined_at))) {
          const ports = kill.ports ?? [];
          const breached = kill.kind === "pattern" || ports.length > 0;
          const command = kill.command.slice(0, 120);
          if (breached && Number(db.prepare("INSERT OR IGNORE INTO liveness_warned (run, member, cond) VALUES (?, ?, ?)").run(run, member, `breach ${command}`).changes) === 1) {
            // board-fixes#D7: no orchestrator post; the event, in the member's name and to it alone, is its next answer's line
            const self = participantById(Number(me.id));
            const onPorts = kill.kind === "port" ? ` (port ${ports.join(", ")})` : "";
            insertMessage(self, `breach ${self.name}: ${command}${onPorts}`, null, "event", [self.name], { event: EVENTS.breach.name, meta: { breach: self.name } });
          }
        }
        bump(String(r.repo));
      });
    },

    memberStates(run, at) {
      return [...statesOf(run, at.getTime()).values()];
    },

    livenessTick(run, at, presence) {
      const r = runRowOrNone(run);
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
        const others = [...states.values()].filter((st) => st.member !== ORCHESTRATOR);
        for (const st of others) {
          // board-split D55: lost is an episode, opened once its predicate held BADGE_CONFIRM_MS, told once; never re-fired by a timer
          const lostStep = episodeStep(run, st.member, "lost", st.badge?.name === "lost", t);
          if (lostStep === "opened") {
            insertMessage(orch, `lost ${orch.plan}/${st.member}: ${st.badge!.reason}`, null, "event", [orch.name], { event: EVENTS.lost.name });
            postComposition(orch, st.member, "-", "lost");
            const lostRow = db.prepare("SELECT id FROM participants WHERE run = ? AND seat = ? AND ended_at IS NULL").get(run, st.member) as Row | undefined;
            if (lostRow) {
              // board-split D59: what its pack holds that others wait on (the merge lock) is released at once, the
              // orchestrator and the waiters told, as the lost member, as a release by its holder would be
              const lostMember = participantById(Number(lostRow.id));
              tellAwaiting(lostMember, "lost");
              const freed = packOf(lostMember)?.onLost?.(lostMember, packCtxOf(lostMember)) ?? null;
              if (freed) insertMessage(lostMember, freed.body, null, "event", [...new Set([...freed.mentions, orch.name])], { event: EVENTS.unlocked.name, meta: { unlocked: freed.unlocked } });
            }
            moved = true;
          } else if (lostStep === "closed") {
            postComposition(orch, st.member, "+", "back");
            moved = true;
          }
        }
        // a member ended closes its episodes without a word (D30)
        closeEpisodesOutside(run, others.map((st) => st.member), t);
        // D41: the lost members this tick told are out of the count; the last one not done lost means all-done now
        const progress = progressOf(run, r.phase == null ? null : String(r.phase));
        const where = progress ? `phase ${progress.phase} ${progressText(progress)}` : "no phase open";
        if (progress?.gone.length) allDoneOnce(orch, progress);
        // simple-states: swarm stopped: no member's tokens moved for the run's stall window; told once per still
        // spell (a move re-arms it), never while paused
        const members = (db.prepare("SELECT * FROM participants WHERE run = ? AND ended_at IS NULL AND seat != ?").all(run, ORCHESTRATOR) as Row[]);
        const lastMove = Math.max(0, r.resumed_at == null ? 0 : Date.parse(String(r.resumed_at)), ...members.map((p) => tokensMovedAtOf(p, r)));
        if (r.paused == null && members.length && t - lastMove >= stallWindowOf(r) &&
          Number(db.prepare("INSERT OR IGNORE INTO liveness_warned (run, member, cond) VALUES (?, ?, ?)").run(run, ORCHESTRATOR, `stopped ${lastMove}`).changes) === 1) {
          insertMessage(orch, `stopped ${orch.plan}: no member's tokens moved for ${minutes(t - lastMove)} min; ${where}${unansweredSuffix(run, orch)}`, null, "event", [orch.name], { event: EVENTS.stopped.name });
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
  };
  return verbs;
}
