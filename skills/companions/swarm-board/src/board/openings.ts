// A run's phase openings and messages read back (codebase-rework#D8): what a thread page and the phase history share.
import type { RunId } from "../contract/board.ts";
import { EVENTS } from "../contract/events.ts";
import type { Row, Rows } from "./rows.ts";
import type { Store } from "../store/store.ts";

/** The reads a thread page and the phase history share: a run's row, refused when it is not of `repo`, its phase openings, its messages. */
export function makeRunThread(store: Store, rows: Rows) {
  const { db } = store;
  const { runRowOrNone } = rows;
  /** The seq of the `phase` event that opened `run`'s current phase (0 before any): the one "since the phase opened". */
  /** Reading the thread back: the run's row, refused when it is not of `repo`, and its phase openings in order. */
  const threadOf = (repo: string, run: RunId): { row: Row; openings: { name: string; seq: number; at: string }[] } => {
    const row = runRowOrNone(run);
    if (!row || String(row.repo) !== repo) throw new Error(`no run ${run} in this project`);
    const openings = (db.prepare("SELECT seq, at, meta FROM messages WHERE run = ? AND event = ? ORDER BY seq").all(run, EVENTS.phase.name) as Row[]).map((r) => ({
      name: String(JSON.parse(String(r.meta ?? "{}")).phase ?? ""),
      seq: Number(r.seq),
      at: String(r.at),
    }));
    return { row, openings };
  };
  const runMessages = (run: RunId): Row[] => db.prepare("SELECT * FROM messages WHERE run = ? ORDER BY seq").all(run) as Row[];
  return { threadOf, runMessages };
}
