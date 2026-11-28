// Retention (codebase-rework#D8): closed runs pruned past the retention, at most once per UPKEEP_EVERY_MS.
import type { Row } from "../rows.ts";
import type { PackBridge } from "../pack-bridge.ts";
import type { Deliveries } from "../conversation/delivery.ts";
import type { Board } from "../types.ts";
import type { Store } from "../../store/store.ts";

/** The board's upkeep runs at most this often, from any process (D16). */
export const UPKEEP_EVERY_MS = 5 * 60 * 1000;

/** The settings row holding the last upkeep's time, ISO: the board's own, never a user setting. */
const LAST_UPKEEP = "last-upkeep";

/** Closed runs and main's talk are kept this many days (D32). */
const RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export const retentionCutoff = (at: Date): string => new Date(at.getTime() - RETENTION_DAYS * DAY_MS).toISOString();

export function makeRetention(store: Store, packs: PackBridge, delivery: Deliveries) {
  const { db } = store;
  const transaction = store.tx;
  const bump = store.changes.bump;
  const { registry } = packs;
  const { forgetWaking } = delivery;
  const verbs: Pick<Board, "prune" | "upkeepIfDue"> = {
    prune(at = new Date()) {
      return transaction(() => {
        const cutoff = retentionCutoff(at);
        const expired = db.prepare("SELECT id, repo FROM runs WHERE state = 'closed' AND closed_at < ? AND pruned_at IS NULL").all(cutoff) as Row[];
        const touched = new Set(expired.map((r) => String(r.repo)));
        const runIds = expired.map((r) => Number(r.id));
        const inExpired = runIds.length ? `run IN (${runIds.join(", ")})` : "0";
        const doomed = db.prepare(`SELECT seq, repo FROM messages WHERE ${inExpired}`).all() as Row[];
        const dropDeliveries = db.prepare("DELETE FROM deliveries WHERE seq = ?");
        const dropMessage = db.prepare("DELETE FROM messages WHERE seq = ?");
        if (doomed.length) forgetWaking();
        for (const m of doomed) {
          dropDeliveries.run(Number(m.seq));
          dropMessage.run(Number(m.seq));
          touched.add(String(m.repo));
        }
        for (const run of runIds) {
          for (const r of db.prepare("SELECT id FROM participants WHERE run = ?").all(run) as Row[]) {
            const id = Number(r.id);
            for (const table of ["deliveries", "call_log"]) db.prepare(`DELETE FROM ${table} WHERE participant = ?`).run(id);
            // the packs' own rows of the member (D20)
            registry.forgetMember(db, id);
            // a member authoring a kept message stays, so the message still reads its author
            if (!db.prepare("SELECT 1 FROM messages WHERE author = ? LIMIT 1").get(id)) db.prepare("DELETE FROM participants WHERE id = ?").run(id);
          }
          db.prepare("DELETE FROM seats WHERE run = ?").run(run);
          registry.forgetRun(db, run);
          for (const table of ["phase_done", "transcripts", "token_readings", "liveness_warned", "badge_episodes", "member_activity", "member_links"]) db.prepare(`DELETE FROM ${table} WHERE run = ?`).run(run);
          // the row stays, stamped: its id is never handed to a new run (D61)
          db.prepare("UPDATE runs SET pruned_at = ? WHERE id = ?").run(at.toISOString(), run);
        }
        for (const repo of touched) bump(repo);
        return { messages: doomed.length, runs: runIds.length };
      });
    },

    upkeepIfDue(at = new Date()) {
      // never ran, or an unreadable time: due
      const due = (): boolean => {
        const r = db.prepare("SELECT value FROM settings WHERE name = ?").get(LAST_UPKEEP) as Row | undefined;
        return !(at.getTime() - Date.parse(String(r?.value)) < UPKEEP_EVERY_MS);
      };
      // a plain read first: a pending wait asks every tick, and only a due upkeep takes the write lock
      if (!due()) return false;
      const recorded = transaction(() => {
        if (!due()) return false; // another process recorded it between the read and the lock
        db.prepare("INSERT INTO settings (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value").run(LAST_UPKEEP, at.toISOString());
        return true;
      });
      if (!recorded) return false;
      verbs.prune(at);
      return true;
    },
  };
  return verbs;
}
