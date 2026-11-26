// The code pack's tables (board-split#D20): their DDL, run once per board by the pack's `openTables`, after the core's
// schema and before any code verb; only `src/packs/code/` reads them.
import type { DatabaseSync } from "node:sqlite";

/** The code tables keyed by member (`participant`), every row of a pruned member deleted. */
const MEMBER_TABLES = ["claims","lock_waiters", "merge_locks", "flag_posts", "lock_requests"];

/** Creates the code tables a store lacks, and the pack's column on the core's members. */
export function migrateCodeTables(db: DatabaseSync): void {
  db.exec(`
    -- claims are global by repository-relative path, across every run on a repository (D12, D20);
    -- a path may have several holders (D40). since_seq: the thread's last seq when it was claimed.
    -- A claim is a path its member's worktree changes now, as its link last read it: made when the path enters the
    -- changes, gone when it leaves them, at its merge, and at the member's end.
    CREATE TABLE IF NOT EXISTS claims (
      repo TEXT NOT NULL,
      path TEXT NOT NULL,
      participant INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'inside',
      since_seq INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (repo, path, participant)
    );
    CREATE TABLE IF NOT EXISTS merge_locks (
      repo TEXT PRIMARY KEY,
      participant INTEGER NOT NULL,
      at TEXT NOT NULL,
      -- the branch a merge lands in, named by merge-lock --onto (D9)
      onto TEXT,
      -- the holder's HEAD reflog length at the grant: merged replays only a rebase past it (D36)
      reflog_mark INTEGER,
      -- the paths the holder's branch changed, as its CLI read them from git at the grant, JSON: the files of its merge
      files TEXT
    );
    -- a member refused the merge lock since its holder took it: mentioned when it is released (D65)
    CREATE TABLE IF NOT EXISTS lock_waiters (
      repo TEXT NOT NULL,
      participant INTEGER NOT NULL,
      PRIMARY KEY (repo, participant)
    );
    -- an overlap posted, once per member, path and other holder (D8); a path's rows go once nobody changes it
    CREATE TABLE IF NOT EXISTS flag_posts (
      repo TEXT NOT NULL,
      path TEXT NOT NULL,
      participant INTEGER NOT NULL,
      holder INTEGER NOT NULL,
      PRIMARY KEY (repo, path, participant, holder)
    );
    -- one row per merge-lock turn: asked, granted, merged; refused counts the refusals (D25); deleted with its run
    CREATE TABLE IF NOT EXISTS lock_requests (repo TEXT NOT NULL, participant INTEGER NOT NULL, asked_at TEXT NOT NULL,
      granted_at TEXT, merged_at TEXT, refused INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS lock_requests_by_participant ON lock_requests (participant, asked_at);
    -- read by member (board-fixes#D14)
    CREATE INDEX IF NOT EXISTS claims_by_participant ON claims (participant);
  `);
  // 1 once the member has called `merged` since it joined: what `end` writes as its doing (D66); the pack's column on the
  // core's members, added once
  const cols = (db.prepare("PRAGMA table_info(participants)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("merged")) db.exec("ALTER TABLE participants ADD COLUMN merged INTEGER NOT NULL DEFAULT 0");
}

/** Deletes a pruned member's code rows, of every table. */
export function forgetMemberRows(db: DatabaseSync, participant: number): void {
  for (const table of MEMBER_TABLES) db.prepare(`DELETE FROM ${table} WHERE participant = ?`).run(participant);
}
