// The code pack's tables (board-split#D20): their DDL and the upkeep of stores from before, run once per board by the
// pack's `openTables`, after the core's schema (the `settings` table) and before any code verb. Names and columns are as
// the core created them before the split, so an old store opens and reads the same; only `src/packs/code/` reads them.
// The tables of earlier designs (shares, notices, flags, claim_requests, merges) are no longer made: nothing wrote
// them. A store that has them keeps them, unread.
import type { DatabaseSync } from "node:sqlite";

/** The code tables keyed by member (`participant`), every row of a pruned member deleted. */
const MEMBER_TABLES = ["claims","lock_waiters", "merge_locks", "flag_posts", "lock_requests"];

/** Creates the code tables a store lacks and brings an older store's up to date. */
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
      at TEXT NOT NULL
    );
    -- a member refused the merge lock since its holder took it: mentioned when it is released (D65)
    CREATE TABLE IF NOT EXISTS lock_waiters (
      repo TEXT NOT NULL,
      participant INTEGER NOT NULL,
      PRIMARY KEY (repo, participant)
    );
    -- an overlap posted, once per member, path and other holder (D8)
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
    -- read by member (board-fixes#D14); an older store's claim log and drift notices go
    CREATE INDEX IF NOT EXISTS claims_by_participant ON claims (participant);
    DROP INDEX IF EXISTS claim_log_by_participant;
    DROP TABLE IF EXISTS claim_log;
    DROP TABLE IF EXISTS drift_notices;
  `);
  const upkeep = (table: string, column: string, ddl: string): void => {
    const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };
  // 1 once the member has called `merged` since it joined: what `end` writes as its doing (D66); on the core's members
  upkeep("participants", "merged", "merged INTEGER NOT NULL DEFAULT 0");
  // the branch a merge lands in, named by merge-lock --onto (D9)
  upkeep("merge_locks", "onto", "onto TEXT");
  // the holder's HEAD reflog length at the grant: merged replays only a rebase past it (D36)
  upkeep("merge_locks", "reflog_mark", "reflog_mark INTEGER");
  // the paths the holder's branch changed, as its CLI read them from git at the grant, JSON: the files of its merge
  upkeep("merge_locks", "files", "files TEXT");
  // a store from before D40 keys a claim by path alone: rebuild it keyed by holder too
  const claimKey = (db.prepare("PRAGMA table_info(claims)").all() as { name: string; pk: number }[]).find((c) => c.name === "participant");
  if (claimKey && claimKey.pk === 0) {
    db.exec(`
      BEGIN;
      ALTER TABLE claims RENAME TO claims_before_d40;
      CREATE TABLE claims (
        repo TEXT NOT NULL,
        path TEXT NOT NULL,
        participant INTEGER NOT NULL,
        kind TEXT NOT NULL DEFAULT 'inside',
        since_seq INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (repo, path, participant)
      );
      INSERT INTO claims (repo, path, participant, kind) SELECT repo, path, participant, kind FROM claims_before_d40;
      DROP TABLE claims_before_d40;
      COMMIT;
    `);
  }
  // a store from when a claim lasted its phase: the claims kept past their work (merged, or out of the changes) go, with
  // the columns that marked them; what is left is what each worktree changed at its link's last look
  const claimCols = (db.prepare("PRAGMA table_info(claims)").all() as { name: string }[]).map((c) => c.name);
  if (claimCols.includes("state")) db.exec("DELETE FROM claims WHERE state != 'active'");
  if (claimCols.includes("in_changes")) db.exec("DELETE FROM claims WHERE in_changes = 0");
  for (const column of ["state", "sha", "in_changes"]) if (claimCols.includes(column)) db.exec(`ALTER TABLE claims DROP COLUMN ${column}`);
}

/** Deletes a pruned member's code rows, of every table. */
export function forgetMemberRows(db: DatabaseSync, participant: number): void {
  for (const table of MEMBER_TABLES) db.prepare(`DELETE FROM ${table} WHERE participant = ?`).run(participant);
}
