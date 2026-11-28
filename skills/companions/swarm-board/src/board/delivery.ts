// Waking and delivering (codebase-rework#D8): what is unread for a member, what wakes it, and its wait.
import { profileOf } from "../contract/kinds.ts";
import type { Message, Participant } from "../contract/board.ts";
import { alwaysEventNames, EVENTS, eventOf, mentions as mentionsMe, toAuthorEventNames, wakes } from "../contract/events.ts";
import { trace } from "../host/trace.ts";
import { WAIT_POLL_MS } from "./store/changes.ts";
import type { Delivery, Board } from "./types.ts";
import { ORCHESTRATOR, type Row, type Rows } from "./rows.ts";
import type { Messages } from "./messages.ts";
import type { PackBridge } from "./pack-bridge.ts";
import type { MemberView } from "./member-view.ts";
import type { Store } from "./store/store.ts";

/** A pending wait's looks are logged in call_log at most this often, never a row per tick. */
const WAIT_LOG_EVERY_MS = 60 * 1000;

export function makeDelivery(store: Store, rows: Rows, messages: Messages, packs: PackBridge, view: MemberView) {
  const { db, now } = store;
  const transaction = store.tx;
  const bump = store.changes.bump;
  const { runRow, memoizedParticipants, participantById, toMessage, lastSeq } = rows;
  const { packTables, packOf, packCtxOf } = packs;
  const { heldWaits } = view;
  /** The messages not yet delivered to `me`, oldest first: its own run's and any other's (the caller filters).
   *  `wakeCandidates`: only the rows that may wake it (board-fixes#D14), as `wakes` reads them: one naming it or its
   *  group, or an always event (by its stored name, or by its kind); `wakes` still decides. */
  const unseenRows = (me: Participant, wakeCandidates = false, afterSeq = 0): Row[] => {
    const always = alwaysEventNames();
    const quoted = (names: string[]) => (names.length ? names.map((n) => `'${n}'`).join(", ") : "NULL");
    const candidate = wakeCandidates
      ? `AND (instr(m.mentions, ?) > 0 OR instr(m.mentions, ?) > 0 OR m.event IN (${quoted(always)}) OR m.kind IN (${quoted(always)}))`
      : "";
    const named = wakeCandidates ? [JSON.stringify(me.name), JSON.stringify(`${me.plan}/*`)] : [];
    return db
      .prepare(
        `SELECT m.* FROM messages m
         WHERE m.repo = ? AND m.seq > ? AND (m.author != ? OR m.event IN (${quoted(toAuthorEventNames())})) ${candidate}
           AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.participant = ? AND d.seq = m.seq)
         ORDER BY m.seq`,
      )
      .all(me.repo, Math.max(afterSeq, sinceSeqOf(me.id)), me.id, ...named, me.id) as Row[];
  };
  const sinceSeqOf = (id: number): number => Number((db.prepare("SELECT since_seq FROM participants WHERE id = ?").get(id) as Row).since_seq);
  /** board-fixes#D14: per member, the messages up to `throughSeq` that wake it, found once: a message's waking never
   *  changes, so each roster reads only the messages since, and the deliveries. Dropped whole when messages are pruned. */
  const wakingSeqs = new Map<number, { sinceSeq: number; throughSeq: number; seqs: Set<number> }>();
  /** How many undelivered messages wake `me`: a message to it, an urgent post (swarm-relay D43).
   *  `authorOf`: a memo the caller shares across members (a roster's), each author read once for all of them. */
  const unreadOf = (id: number, authorOf = memoizedParticipants()): number => {
    const me = participantById(id);
    const sinceSeq = sinceSeqOf(id);
    const known = wakingSeqs.get(id);
    const waking = known && known.sinceSeq === sinceSeq ? known : { sinceSeq, throughSeq: 0, seqs: new Set<number>() };
    // the rows not yet looked at, undelivered: a delivered one can never count again; read through the last seq taken
    // before the scan, so a row written meanwhile is looked at again next time, never skipped
    const through = lastSeq();
    for (const r of unseenRows(me, true, waking.throughSeq)) if (wakes(toMessage(r, authorOf), me)) waking.seqs.add(Number(r.seq));
    waking.throughSeq = through;
    wakingSeqs.set(id, waking);
    if (!waking.seqs.size) return 0;
    for (const d of db.prepare("SELECT seq FROM deliveries WHERE participant = ? AND seq > ?").all(id, sinceSeq) as Row[]) waking.seqs.delete(Number(d.seq));
    return waking.seqs.size;
  };
  /** `fromWait`: a wait's own look, not a call of the member's. Only what wakes `p` is taken and marked (a message to
   *  it, an urgent post); the rest stays, never delivered. */
  const deliverTo = (p: Participant, fromWait: boolean): Delivery => {
    const me = participantById(p.id);
    const authorOf = memoizedParticipants();
    const asMessage = (r: Row): Message => toMessage(r, authorOf);
    // a mention, or what the caller's pack says is for it too (the code pack: an agreement about a path it holds)
    const pack = packOf(me);
    const named = (m: Message): boolean => mentionsMe(m, me) || (pack?.alsoFor?.(me, m, packCtxOf(me)) ?? false);
    const whole = profileOf(me.kind).wholeThread;
    // a post of the caller's own run, not an event, in a whole-thread run: everyone's in full
    const ownPost = (m: Message): boolean => whole && m.run === me.run && m.kind !== "event";
    const messages = transaction(() => {
      const unseen = unseenRows(me);
      // idea 2, D8: a paused run is silent for everyone in it: nothing wakes a member but urgent (and the pause itself,
      // for a member other than the orchestrator); what came meanwhile stays for the resume
      const silentWhilePaused = runRow(me.run).paused != null;
      const woken = (r: Row): boolean =>
        silentWhilePaused
          ? eventOf(asMessage(r)) === "urgent" || (me.seat !== ORCHESTRATOR && eventOf(asMessage(r)) === "pause")
          : named(asMessage(r)) || wakes(asMessage(r), me);
      // a wake in a whole-thread run brings every unread post of the run with it, never the waking one alone
      const rows = !unseen.some(woken) ? [] : unseen.filter((r) => woken(r) || (!(silentWhilePaused && fromWait) && ownPost(asMessage(r))));
      const mark = db.prepare("INSERT INTO deliveries (participant, seq, at) VALUES (?, ?, ?)");
      for (const r of rows) {
        mark.run(me.id, Number(r.seq), now());
        // the trace: how long the message waited for this member
        trace().event("delivered", { run: me.run, member: me.name, seq: Number(r.seq), waitedMs: Date.now() - Date.parse(String(r.at)), fromWait });
      }
      // a delivery is a call to the board: the member's last call (D31)
      const at = now();
      db.prepare("UPDATE participants SET last_call = ? WHERE id = ?").run(at, me.id);
      // a wait's look is a sign of life by the stale rule, so the timeline logs it too (board D12, D37); a wait looks
      // every second, so at most one row a minute
      if (fromWait) {
        const last = db.prepare("SELECT MAX(at) AS at FROM call_log WHERE participant = ?").get(me.id) as Row;
        if (last.at == null || Date.parse(at) - Date.parse(String(last.at)) >= WAIT_LOG_EVERY_MS) {
          db.prepare("INSERT INTO call_log (participant, at, verb) VALUES (?, ?, 'wait')").run(me.id, at);
        }
      }
      if (!fromWait) {
        // a call after a wait that never returned (killed): the member is no longer waiting
        const r = db.prepare("UPDATE participants SET waiting = 0 WHERE id = ? AND waiting = 1").run(me.id);
        if (Number(r.changes) > 0) bump(me.repo);
      }
      return rows.map((r) => {
        const m = asMessage(r);
        const rel = r.by_board || m.kind !== "msg" || !m.about || !named(m) ? null : packTables.askedAbout(me, Number(r.author), m);
        // the asker named by --with (`<group>/<seat>`, so across runs too): the agreement's party is the member that asked
        return rel ? { ...m, answer: `answer with an agreement on who changes what: swarm agree "<who changes what in ${rel}>" --about ${rel} --with ${m.from}` } : m;
      });
    });
    return { full: messages };
  };
  /** G23: a member done with a phase has had the event that opened it; a later wait never brings it back as news. */
  const markPhaseOpenDelivered = (p: Participant, phase: string): void => {
    const opened = (db.prepare("SELECT seq, meta FROM messages WHERE run = ? AND event = ?").all(p.run, EVENTS.phase.name) as Row[]).filter(
      (r) => r.meta != null && (JSON.parse(String(r.meta)) as { phase?: string }).phase === phase,
    );
    const mark = db.prepare("INSERT OR IGNORE INTO deliveries (participant, seq, at) VALUES (?, ?, ?)");
    for (const r of opened) mark.run(p.id, Number(r.seq), now());
  };
  /** Every member's waking messages found so far dropped, as when messages are pruned. */
  const forgetWaking = (): void => wakingSeqs.clear();
  const verbs: Pick<Board, "deliverMentions" | "unreadMentions" | "wait"> = {
    deliverMentions(p) {
      return deliverTo(p, false);
    },

    unreadMentions(p) {
      return unreadOf(p.id);
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
        let offLocal = (): void => {};
        const finish = (d: Delivery | Error): void => {
          if (settled) return;
          settled = true;
          offLocal();
          abort?.removeEventListener("abort", onAbort);
          clearInterval(poll);
          clearTimeout(timer);
          if (heldWaits.get(p.id) === held) heldWaits.delete(p.id);
          // a wait --mentions that held to its end with nothing counts toward idle; a delivery starts the count again
          const got = !(d instanceof Error) && d.full.length > 0;
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
            // its run closed: the close's own line answers it; ended in an open run: `ended`, said at once
            if (participantById(p.id).ended) return finish(runRow(p.run).state === "open" ? { full: [], ended: true } : { full: [] });
            // the look and the superseded test in one transaction: a superseded wait takes nothing
            const d = transaction(() => (current() ? deliverTo(p, true) : null));
            if (!d) return finish({ full: [], superseded: true });
            if (d.full.length) finish(d);
          } catch (e) {
            finish(e as Error);
          }
        };
        // listen first, then look: a post landing between the two is still seen
        const onAbort = (): void => finish({ full: [] });
        if (abort?.aborted) return onAbort();
        abort?.addEventListener("abort", onAbort);
        offLocal = store.changes.onLocal(check);
        poll = setInterval(check, WAIT_POLL_MS);
        if (timeoutMs !== undefined)
          timer = setTimeout(() => {
            timedOut = true;
            finish({ full: [] });
          }, timeoutMs);
        check();
      });
    },
  };
  return { ...verbs, unseenRows, unreadOf, markPhaseOpenDelivered, forgetWaking };
}
export type Deliveries = ReturnType<typeof makeDelivery>;
