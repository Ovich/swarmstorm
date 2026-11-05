// The code pack's tables (board-split#D20): their DDL and the upkeep of stores from before, run once per board by the
// pack's `openTables`, after the core's schema (the `settings` table) and before any code verb. Names and columns are as
// the core created them before the split, so an old store opens and reads the same; only `src/packs/code/` reads them.
import type { DatabaseSync } from "node:sqlite";

/** The settings row holding when the shares record began, ISO: a run opened before has no shares known (D39). */
export const SHARES_SINCE = "shares-since";

/** The code tables keyed by member (`participant`), every row of a pruned member deleted. */
const MEMBER_TABLES = ["drift_notices", "shares", "notices", "flags", "claims", "lock_waiters", "merge_locks", "claim_requests", "flag_posts", "lock_requests"];

/** Creates the code tables a store lacks and brings an older store's up to date. */
export function migrateCodeTables(db: DatabaseSync): void {
  // the shares record starts with the store that first creates it (D39)
  const sharesAreNew = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'shares'").get() === undefined;
  db.exec(`
    -- claims are global by repository-relative path, across every run on a repository (D12, D20);
    -- a path may have several holders (D40). since_seq: the thread's last seq when it was claimed.
    -- A claim lasts its run's phase (claims-phase): from the member's first change of the path until the next phase
    -- opens or the run closes; state 'active' or 'merged', 'ended' read from the member; sha: its last merge this phase, kept when active again;
    -- in_changes: the path is in the member's worktree changes as its link last read them
    CREATE TABLE IF NOT EXISTS claims (
      repo TEXT NOT NULL,
      path TEXT NOT NULL,
      participant INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'inside',
      since_seq INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'active',
      sha TEXT,
      in_changes INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (repo, path, participant)
    );
    -- a member told that a path merged this phase is not in its branch: once per member and path per phase
    CREATE TABLE IF NOT EXISTS drift_notices (
      repo TEXT NOT NULL,
      path TEXT NOT NULL,
      participant INTEGER NOT NULL,
      PRIMARY KEY (repo, path, participant)
    );
    -- a claim granted beside a live holder of the path, kept past both claims' release: who held a path
    -- at the same time as whom during a run, from the seq it began (D39); append-only, deleted with its run
    CREATE TABLE IF NOT EXISTS shares (
      repo TEXT NOT NULL,
      path TEXT NOT NULL,
      participant INTEGER NOT NULL,
      other INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      PRIMARY KEY (repo, path, participant, other)
    );
    -- a holder of a shared path already told of another holder (D41): once per member and path
    CREATE TABLE IF NOT EXISTS notices (
      repo TEXT NOT NULL,
      path TEXT NOT NULL,
      participant INTEGER NOT NULL,
      other INTEGER NOT NULL,
      PRIMARY KEY (repo, path, participant, other)
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
    -- a path written outside its writer's claim, by reconcileWrites; lives while a claim on it does (D39)
    CREATE TABLE IF NOT EXISTS flags (
      repo TEXT NOT NULL,
      path TEXT NOT NULL,
      participant INTEGER NOT NULL,
      PRIMARY KEY (repo, path, participant)
    );
    -- a claim refused as held: the post that settles it claims it (D7)
    CREATE TABLE IF NOT EXISTS claim_requests (
      repo TEXT NOT NULL,
      path TEXT NOT NULL,
      participant INTEGER NOT NULL,
      kind TEXT NOT NULL,
      PRIMARY KEY (repo, path, participant)
    );
    -- a flag posted, once per writer, path and holder (D8)
    CREATE TABLE IF NOT EXISTS flag_posts (
      repo TEXT NOT NULL,
      path TEXT NOT NULL,
      participant INTEGER NOT NULL,
      holder INTEGER NOT NULL,
      PRIMARY KEY (repo, path, participant, holder)
    );
    -- one row per merge, written by merged, deleted with its run by prune (D25): files and conflicts JSON, conflicts NULL for unknown
    CREATE TABLE IF NOT EXISTS merges (
      participant INTEGER NOT NULL,
      run INTEGER NOT NULL,
      sha TEXT NOT NULL,
      at TEXT NOT NULL,
      files TEXT NOT NULL,
      conflicts TEXT
    );
    CREATE INDEX IF NOT EXISTS merges_run ON merges (run);
    -- one row per merge-lock turn: asked, granted, merged; refused counts the refusals (D25); deleted with its run
    CREATE TABLE IF NOT EXISTS lock_requests (repo TEXT NOT NULL, participant INTEGER NOT NULL, asked_at TEXT NOT NULL,
      granted_at TEXT, merged_at TEXT, refused INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS lock_requests_by_participant ON lock_requests (participant, asked_at);
    -- claims-phase: the kept claims replace the claim log, read by member as it was (board-fixes#D14); an older store's goes
    CREATE INDEX IF NOT EXISTS claims_by_participant ON claims (participant);
    DROP INDEX IF EXISTS claim_log_by_participant;
    DROP TABLE IF EXISTS claim_log;
  `);
  if (sharesAreNew) db.prepare("INSERT OR IGNORE INTO settings (name, value) VALUES (?, ?)").run(SHARES_SINCE, new Date().toISOString());
  const upkeep = (table: string, column: string, ddl: string): void => {
    const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };
  // 1 once the member has called `merged` since it joined: what `end` writes as its doing (D66); on the core's members
  upkeep("participants", "merged", "merged INTEGER NOT NULL DEFAULT 0");
  // the branch a merge lands in, named by merge-lock --onto (D9)
  upkeep("merge_locks", "onto", "onto TEXT");
  // the guides merge-lock listed for the branch, JSON; merged refuses until each is settled
  upkeep("merge_locks", "guides", "guides TEXT");
  // the holder's HEAD reflog length at the grant: merged replays only a rebase past it (D36)
  upkeep("merge_locks", "reflog_mark", "reflog_mark INTEGER");
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
  // claims-phase: a claim's state, its last merge's sha, and whether its path is still in the member's changes
  upkeep("claims", "state", "state TEXT NOT NULL DEFAULT 'active'");
  upkeep("claims", "sha", "sha TEXT");
  upkeep("claims", "in_changes", "in_changes INTEGER NOT NULL DEFAULT 1");
}

/** Deletes a pruned member's code rows, of every table, either side of a share or a notice. */
export function forgetMemberRows(db: DatabaseSync, participant: number): void {
  for (const table of MEMBER_TABLES) db.prepare(`DELETE FROM ${table} WHERE participant = ?`).run(participant);
  db.prepare("DELETE FROM notices WHERE other = ?").run(participant);
  db.prepare("DELETE FROM shares WHERE other = ?").run(participant);
}

/** Deletes a pruned run's merges. */
export function forgetRunRows(db: DatabaseSync, run: number): void {
  db.prepare("DELETE FROM merges WHERE run = ?").run(run);
}
