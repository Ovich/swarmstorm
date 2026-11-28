// Messages written (codebase-rework#D8): every post and event the board stores, and the tasks they open and wake.
import { parseMentions } from "./mentions.ts";
import type { AwaitedMeta, Message, MessageKind, MessageMeta, Participant, RunId } from "../contract/board.ts";
import { awaitedLine, type EventName, EVENTS, eventDef, isAwaitedCause } from "../contract/events.ts";
import { trace } from "../host/trace.ts";
import type { Row, Rows } from "./rows.ts";
import type { Store } from "./store/store.ts";

export function makeMessages(store: Store, rows: Rows, hooks: { awaitedWording(p: Participant, cause: string): string }) {
  const { db, now } = store;
  const bump = store.changes.bump;
  const { runRow, participantById, toMessage, openPlans, activeNames } = rows;
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
    // the trace: the post's facts at debug, its text at debug-extended
    trace().event("post", { run, seq, author: p.name, type: kind, event: extra.event ?? null, lands: extra.event ? !!eventDef(extra.event).lands : false, mentions: mentions.length, about, chars: body.length });
    trace().message(run, { seq, author: p.name, type: kind, event: extra.event ?? null, mentions, about, body });
    // board-fixes#D5: a merge or a done is the member's latest doing, set before its event; older events never stale it
    if (extra.event && (extra.event === EVENTS.done.name || !!eventDef(extra.event).lands)) db.prepare("UPDATE participants SET doing_at = ?, doing_seq = ? WHERE id = ?").run(now(), seq, p.id);
    if (extra.event && isAwaitedCause(extra.event)) tellAwaiting(p, extra.event);
    return toMessage(db.prepare("SELECT * FROM messages WHERE seq = ?").get(seq) as Row, participantById);
  };
  /** board-fixes#D13: the seq of the member's open task, its latest `post --task` until its next `done`; null when none. */
  const openTaskOf = (run: RunId, name: string, id: number): number | null => {
    const t = db.prepare("SELECT seq FROM messages WHERE run = ? AND task = 1 AND mentions = ? ORDER BY seq DESC LIMIT 1").get(run, JSON.stringify([name])) as Row | undefined;
    if (!t) return null;
    const done = db.prepare("SELECT 1 FROM messages WHERE run = ? AND author = ? AND event = ? AND seq > ?").get(run, id, EVENTS.done.name, Number(t.seq));
    return done ? null : Number(t.seq);
  };
  /** board-fixes#D4: wakes the seat of every open task waiting on `subject`, once per awaited seat, on the first of its
   *  merged, done, ended or lost; its posts never do. */
  const tellAwaiting = (subject: Participant, cause: string): void => {
    const tasks = db.prepare("SELECT seq, mentions, after FROM messages WHERE run = ? AND task = 1 AND after IS NOT NULL ORDER BY seq").all(subject.run) as Row[];
    for (const t of tasks) {
      const awaited = JSON.parse(String(t.after)) as string[];
      if (!awaited.includes(subject.seat)) continue;
      const [waiter] = JSON.parse(String(t.mentions)) as string[];
      const waiterRow = db.prepare("SELECT id FROM participants WHERE run = ? AND seat = ?").get(subject.run, waiter.slice(waiter.lastIndexOf("/") + 1)) as Row | undefined;
      // a task whose seat has not joined is open: no done of its seat can have closed it
      const open = waiterRow ? openTaskOf(subject.run, waiter, Number(waiterRow.id)) === Number(t.seq) : true;
      if (!open) continue;
      const told = (db.prepare("SELECT json_extract(meta, '$.seat') AS seat FROM messages WHERE run = ? AND event = ? AND json_extract(meta, '$.task') = ?").all(subject.run, EVENTS.awaited.name, Number(t.seq)) as Row[]).map((r) => String(r.seat));
      if (told.includes(subject.seat)) continue;
      const meta: AwaitedMeta = { task: Number(t.seq), seat: subject.seat };
      const body = awaitedLine(subject.seat, hooks.awaitedWording(subject, cause), told.length + 1, awaited.length);
      insertMessage(subject, body, null, "event", [waiter], { event: EVENTS.awaited.name, meta });
    }
  };
  return { insertMessage, openTaskOf, tellAwaiting };
}
export type Messages = ReturnType<typeof makeMessages>;
