// Reading the thread back (codebase-rework#D8), pull only: a long run read in pages, never whole.
import type { Message } from "../../contract/board.ts";
import { eventDef, isEvent } from "../../contract/events.ts";
import type { Row, Rows } from "../rows.ts";
import type { Board } from "../types.ts";
import type { Store } from "../../store/store.ts";
import { makeRunThread } from "../openings.ts";

/** The board's events a thread page shows without `events`: the ones that mark the work, not the members' comings and
 *  goings; a pack's landing events (`lands`) beside them. */
const THREAD_EVENTS: ReadonlySet<string> = new Set(["phase", "done", "pause", "resume", "closed"]);

const shownInThread = (event: string | null): boolean => event !== null && (THREAD_EVENTS.has(event) || (isEvent(event) && !!eventDef(event).lands));

/** A page's posts by default, and its most at once. */
export const THREAD_LIMIT = 20;

const THREAD_LIMIT_MAX = 200;

export function makeThreadRead(store: Store, rows: Rows) {
  const { db } = store;
  const { memoizedParticipants, toMessage } = rows;
  const { threadOf, runMessages } = makeRunThread(store, rows);
  const verbs: Pick<Board, "thread" | "message"> = {
    thread(repo, run, q) {
      const { row, openings } = threadOf(repo, run);
      const asked = q.phase ?? "current";
      const opening = asked === "all" ? null : asked === "current" ? (openings.at(-1) ?? null) : ([...openings].reverse().find((o) => o.name === asked) ?? null);
      if (asked !== "all" && asked !== "current" && !opening)
        throw new Error(`thread: run ${run} never opened phase ${asked}${openings.length ? `; its phases: ${[...new Set(openings.map((o) => o.name))].join(", ")}` : ""}`);
      const start = opening?.seq ?? 0;
      const end = opening ? (openings.find((o) => o.seq > opening.seq)?.seq ?? Infinity) : Infinity;
      const authorOf = memoizedParticipants();
      const seatOf = (w: string): string => w.trim().replace(/^@/, "").slice(w.trim().replace(/^@/, "").lastIndexOf("/") + 1);
      const said = (m: Message, seat: string): boolean => seatOf(m.from) === seat;
      const named = (m: Message, seat: string): boolean => m.mentions.some((n) => n !== `${row.plan}/*` && n.endsWith(`/${seat}`));
      const about = q.about?.trim();
      const matches = (m: Message): boolean =>
        (q.events || m.kind !== "event" || shownInThread(m.event)) &&
        (!q.by || said(m, seatOf(q.by))) &&
        (!q.to || named(m, seatOf(q.to))) &&
        (!q.with || said(m, seatOf(q.with)) || named(m, seatOf(q.with))) &&
        (!about || (m.about ?? "").includes(about) || m.body.includes(about));
      const all = runMessages(run)
        .filter((r) => Number(r.seq) >= start && Number(r.seq) < end)
        .map((r) => toMessage(r, authorOf))
        .filter(matches);
      const limit = Math.min(Math.max(1, Math.floor(q.limit ?? THREAD_LIMIT)), THREAD_LIMIT_MAX);
      const window = q.from !== undefined ? all.filter((m) => m.seq >= q.from!) : q.before !== undefined ? all.filter((m) => m.seq < q.before!) : all;
      const posts = q.from !== undefined ? window.slice(0, limit) : window.slice(-limit);
      const first = posts[0]?.seq;
      const last = posts.at(-1)?.seq;
      return {
        run,
        group: String(row.plan),
        title: String(row.title),
        phase: opening ? { name: opening.name, seq: opening.seq } : null,
        posts,
        matched: all.length,
        earlier: first !== undefined && all.some((m) => m.seq < first) ? first : null,
        later: last !== undefined && all.some((m) => m.seq > last) ? last + 1 : null,
      };
    },

    message(repo, seq) {
      const r = db.prepare("SELECT * FROM messages WHERE seq = ? AND repo = ?").get(seq, repo) as Row | undefined;
      return r ? toMessage(r, memoizedParticipants()) : null;
    },
  };
  return verbs;
}
