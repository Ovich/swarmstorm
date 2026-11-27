// The code pack's part of the page's snapshot (board-split#D18, D20): the merge lock and its turns, the files held and
// the flags of one repository, read from the pack's own tables. The core snapshot places these fields as they read before
// the split, so the page reads the same.
import type { DatabaseSync } from "node:sqlite";
import type { Declared } from "../../contract/board.ts";
import type { CodeMemberFact, CodeSnapshotFields, SnapshotFile } from "../../contract/code.ts";

type Row = Record<string, unknown>;

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
  const heldBy = db.prepare("SELECT path FROM claims WHERE participant = ? ORDER BY rowid");
  // V-46: who waits on the lock, in the order refused
  const lockWaiters = (db.prepare("SELECT participant FROM lock_waiters WHERE repo = ? ORDER BY rowid").all(repo) as Row[])
    .map((w) => Number(w.participant))
    .filter((id) => isLive(id) && id !== lockHolder)
    .map(nameOf);
  // every live member's claims on the repository, in claim order: the FileMap's rows, and which paths are shared (D40)
  const live = (
    db.prepare("SELECT c.path, c.participant, p.seat, r.plan FROM claims c JOIN participants p ON p.id = c.participant JOIN runs r ON r.id = p.run WHERE c.repo = ? ORDER BY c.rowid").all(repo) as Row[]
  ).filter((c) => isLive(Number(c.participant)));
  const files = new Map<string, SnapshotFile>();
  for (const c of live) {
    const path = String(c.path);
    (files.get(path) ?? files.set(path, { path, holders: [] }).get(path)!).holders.push(`${c.plan}/${c.seat}`);
  }
  // a file a live member declared at join, held by another: it holds it too (D62)
  for (const r of people) {
    if (String(r.seat) === orchestratorSeat || !isLive(Number(r.id))) continue;
    const name = `${r.plan}/${r.seat}`;
    for (const d of JSON.parse(String(r.files)) as Declared[]) {
      const f = files.get(relPath(repo, d.path) ?? d.path);
      if (f && !f.holders.includes(name)) f.holders.push(name);
    }
  }
  const sharedBy = (path: string, id: number): boolean => live.some((c) => String(c.path) === path && Number(c.participant) !== id);

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
    },
    factOf: (id) => (id === lockHolder ? "merging" : null),
    heldFilesOf: (id) => (heldBy.all(id) as Row[]).map((c) => ({ path: String(c.path), shared: sharedBy(String(c.path), id) })),
  };
}

/** The claims a member holds now (F27), repository-relative: the roster's `held`. */
export function heldOf(db: DatabaseSync, id: number): Declared[] {
  return (db.prepare("SELECT path FROM claims WHERE participant = ? ORDER BY rowid").all(id) as Row[]).map((c) => ({ path: String(c.path) }));
}
