// The code pack's part of the page's snapshot (board-split#D18, D20): the merge lock and its turns, the files held and
// the flags of one repository, read from the pack's own tables. The core snapshot places these fields as they read before
// the split, so the page reads the same.
import type { DatabaseSync } from "node:sqlite";
import type { Declared } from "../../board/board.ts";
import type { CodeMemberFact } from "./types.ts";

type Row = Record<string, unknown>;

export type LockTurn = { member: string; askedAt: string; grantedAt: string | null; mergedAt: string | null; refused: number };
/** A file claimed this phase (claims-phase): who holds it, active, in claim order (D40), and who held it and merged it
 *  (`sha` the merge's) or ended; `holders` alone count for shared. The FileMap's rows. */
export type SnapshotFile = { path: string; holders: string[]; past: PastHolder[] };
/** A claim of the phase merged, with its merge's sha (its holder may be active on it again, v1-5: then it is in
 *  `holders` too), or no longer active because its member ended (sha null). */
export type PastHolder = { member: string; state: "merged" | "ended"; sha: string | null };
/** The code fields of `BoardSnapshot`, as the page reads them. */
export type CodeSnapshotFields = {
  /** V-46: `waiters`, the live members refused it and waiting for it, in the order they asked */
  lock: { holder: string; since: string; waiters: string[] } | null;
  /** The repository's merge-lock turns, newest first (at most 50): asked, granted, merged, refusals counted. */
  lockHistory: LockTurn[];
  files: SnapshotFile[];
  flags: { path: string; member: string }[];
};
/** What the core needs from the store to read one repository's code fields. */
export interface CodeSnapshotDeps {
  db: DatabaseSync;
  isLive(id: number): boolean;
  nameOf(id: number): string;
  relPath(repo: string, file: string): string | null;
}
/** One repository's code part of the snapshot: its fields, what the pack says of each member (D36: merging, the merge
 *  lock's holder), and each member's held files. `people` are the snapshot's participant rows (id, seat, plan, files). */
export interface CodeSnapshot {
  fields: CodeSnapshotFields;
  factOf(id: number): CodeMemberFact | null;
  heldFilesOf(id: number): (Declared & { shared: boolean })[];
}

export function codeSnapshotOf(deps: CodeSnapshotDeps, repo: string, people: Row[], orchestratorSeat: string): CodeSnapshot {
  const { db, isLive, nameOf, relPath } = deps;
  const lockRow = db.prepare("SELECT participant, at FROM merge_locks WHERE repo = ?").get(repo) as Row | undefined;
  const lockHolder = lockRow && isLive(Number(lockRow.participant)) ? Number(lockRow.participant) : null;
  const heldBy = db.prepare("SELECT path FROM claims WHERE participant = ? AND state = 'active' ORDER BY rowid");
  // V-46: who waits on the lock, in the order refused
  const lockWaiters = (db.prepare("SELECT participant FROM lock_waiters WHERE repo = ? ORDER BY rowid").all(repo) as Row[])
    .map((w) => Number(w.participant))
    .filter((id) => isLive(id) && id !== lockHolder)
    .map(nameOf);
  // every claim of the phase on the repository, in claim order: the FileMap's rows; the active ones say which paths
  // are shared (D40)
  const claimed = db
    .prepare("SELECT c.path, c.participant, c.state, c.sha, p.seat, r.plan FROM claims c JOIN participants p ON p.id = c.participant JOIN runs r ON r.id = p.run WHERE c.repo = ? ORDER BY c.rowid")
    .all(repo) as Row[];
  const live = claimed.filter((c) => c.state === "active" && isLive(Number(c.participant)));
  const files = new Map<string, SnapshotFile>();
  const fileOf = (p: string): SnapshotFile => files.get(p) ?? files.set(p, { path: p, holders: [], past: [] }).get(p)!;
  for (const c of claimed) {
    const f = fileOf(String(c.path));
    const member = `${c.plan}/${c.seat}`;
    if (c.sha != null) f.past.push({ member, state: "merged", sha: String(c.sha) });
    if (live.includes(c)) f.holders.push(member);
    else if (c.state === "active" && c.sha == null) f.past.push({ member, state: "ended", sha: null });
  }
  // a file a live member declared at join but could not claim, held by another: it holds it too (D62);
  // one it claimed this phase, merged or not, does not come back
  const everClaimed = db.prepare("SELECT 1 FROM claims WHERE repo = ? AND path = ? AND participant = ?");
  for (const r of people) {
    if (String(r.seat) === orchestratorSeat || !isLive(Number(r.id))) continue;
    const name = `${r.plan}/${r.seat}`;
    for (const d of JSON.parse(String(r.files)) as Declared[]) {
      const f = files.get(relPath(repo, d.path) ?? d.path);
      if (f && f.holders.length && !f.holders.includes(name) && !everClaimed.get(repo, f.path, Number(r.id))) f.holders.push(name);
    }
  }
  const sharedBy = (path: string, id: number): boolean => live.some((c) => String(c.path) === path && Number(c.participant) !== id);

  const flags = (
    db.prepare("SELECT f.path, p.seat, r.plan FROM flags f JOIN participants p ON p.id = f.participant JOIN runs r ON r.id = p.run WHERE f.repo = ? ORDER BY f.rowid").all(repo) as Row[]
  ).map((f) => ({ path: String(f.path), member: `${f.plan}/${f.seat}` }));

  const lockHistory = (
    db.prepare("SELECT t.asked_at, t.granted_at, t.merged_at, t.refused, p.seat, r.plan FROM lock_requests t JOIN participants p ON p.id = t.participant JOIN runs r ON r.id = p.run WHERE t.repo = ? ORDER BY t.asked_at DESC, t.rowid DESC LIMIT 50").all(repo) as Row[]
  ).map((t) => ({
    member: `${t.plan}/${t.seat}`,
    askedAt: String(t.asked_at),
    grantedAt: t.granted_at == null ? null : String(t.granted_at),
    mergedAt: t.merged_at == null ? null : String(t.merged_at),
    refused: Number(t.refused),
  }));

  return {
    fields: {
      lockHistory,
      lock: lockHolder !== null ? { holder: nameOf(lockHolder), since: String(lockRow!.at), waiters: lockWaiters } : null,
      files: [...files.values()],
      flags,
    },
    factOf: (id) => (id === lockHolder ? "merging" : null),
    heldFilesOf: (id) => (heldBy.all(id) as Row[]).map((c) => ({ path: String(c.path), shared: sharedBy(String(c.path), id) })),
  };
}

/** The active claims a member holds now (F27), repository-relative: the roster's `held`. */
export function heldOf(db: DatabaseSync, id: number): Declared[] {
  return (db.prepare("SELECT path FROM claims WHERE participant = ? AND state = 'active' ORDER BY rowid").all(id) as Row[]).map((c) => ({ path: String(c.path) }));
}

/** Every path the member claimed this phase, merged ones included (S28, claims-phase): the roster's declared files no
 *  longer waited on. */
export function everClaimedOf(db: DatabaseSync, id: number): string[] {
  return (db.prepare("SELECT DISTINCT path FROM claims WHERE participant = ?").all(id) as Row[]).map((c) => String(c.path));
}
