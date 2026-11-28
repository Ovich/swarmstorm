// The run's phase history (codebase-rework#D8): each opening in order, its posts and its done count.
import type { Row, Rows } from "../rows.ts";
import type { Board } from "../types.ts";
import { makeRunThread } from "../openings.ts";
import type { Store } from "../../store/store.ts";

export function makePhaseHistory(store: Store, rows: Rows) {
  const { db } = store;
  const { threadOf, runMessages } = makeRunThread(store, rows);
  const verbs: Pick<Board, "phases"> = {
    phases(repo, run) {
      const { openings } = threadOf(repo, run);
      const rows = runMessages(run);
      const current = openings.at(-1)?.seq ?? null;
      return openings.map((o, i) => {
        const end = openings[i + 1]?.seq ?? Infinity;
        const inside = rows.filter((r) => Number(r.seq) > o.seq && Number(r.seq) < end);
        const latest = !openings.some((x, j) => j > i && x.name === o.name);
        const done = latest ? Number((db.prepare("SELECT COUNT(*) AS n FROM phase_done WHERE run = ? AND phase = ?").get(run, o.name) as Row).n) : null;
        return { name: o.name, seq: o.seq, at: o.at, current: o.seq === current, posts: inside.filter((r) => r.kind !== "event").length, urgent: inside.filter((r) => r.kind === "urgent").length, done };
      });
    },
  };
  return verbs;
}
