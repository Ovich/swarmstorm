// The store: the board's SQLite file opened once per Board, its pragmas, the prepare cache, the re-entrant transaction
// and the schema's migrations (codebase-rework#D8, D10). The board's modules reach the file through this context alone.
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { makeChanges, type Changes } from "./changes.ts";
import { MIGRATIONS } from "./migrations.ts";

export type { Changes };
export type Store = { db: DatabaseSync; tx<T>(fn: () => T): T; now(): string; changes: Changes; close(): void };

export async function openStore(dbPath: string): Promise<Store> {
  // node:sqlite prints an ExperimentalWarning on import; keep every other warning. Imported
  // here, not at module load, so a verb that never opens the store never pays for it.
  process.removeAllListeners("warning");
  process.on("warning", (w) => {
    if (w.name !== "ExperimentalWarning") console.warn(w);
  });
  const { DatabaseSync } = await import("node:sqlite");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  // the busy timeout set at open, not by the pragma below: the first reads already need it, and
  // without it a verb that opens while another process writes fails outright with SQLITE_BUSY
  const db = new DatabaseSync(dbPath, { timeout: 5000 });
  // board-fixes#D14: a statement is prepared once per SQL text and reused, the board's and its packs' alike: a roster
  // runs dozens of small queries per member, and preparing each anew was a large share of its cost. Every use runs
  // a statement to its end (get, all, run; never iterate), so one statement is never used by two callers at once.
  const prepareAnew = db.prepare.bind(db);
  const prepared = new Map<string, ReturnType<typeof prepareAnew>>();
  db.prepare = (sql: string) => prepared.get(sql) ?? prepared.set(sql, prepareAnew(sql)).get(sql)!;
  db.exec(`
    -- WAL: a write appends to the log and returns; NORMAL syncs the log at checkpoints, not at
    -- each commit, so a power cut may lose the last writes but never corrupts the store.
    -- A rollback journal synced every commit and capped the server near 800 writes a second.
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    -- Several CLI processes write, and aiview reads, concurrently; without a busy timeout a
    -- concurrent verb fails outright with SQLITE_BUSY.
    PRAGMA busy_timeout = 5000;
  `);

  // Re-entrant: an inner call inside an open transaction joins it. The wakers are woken
  // once, after the outermost commit, so a watcher never looks before the write is there.
  let depth = 0;
  const changes = makeChanges(db, () => depth > 0);
  const tx = <T>(fn: () => T): T => {
    if (depth > 0) return fn();
    db.exec("BEGIN IMMEDIATE");
    depth++;
    let ok = false;
    try {
      const out = fn();
      db.exec("COMMIT");
      ok = true;
      return out;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      depth--;
      changes.committed(ok);
    }
  };
  migrate(db);
  return {
    db,
    tx,
    now: () => new Date().toISOString(),
    changes,
    close() {
      changes.close();
      db.close();
    },
  };
}

/** The schema brought to the last migration, in one transaction: a failed one rolls back and the open throws. */
function migrate(db: DatabaseSync): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const text of MIGRATIONS) db.exec(text);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
