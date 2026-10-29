// The code pack's part of the page's snapshot (board-split#D18, D20): the merge lock and its turns, the files held and
// the flags of one repository, read from the pack's own tables. The core snapshot places these fields as they read before
// the split, so the page reads the same.
import type { DatabaseSync } from "node:sqlite";
import type { Declared } from "../../board/board.ts";
import type { CodeMemberFact } from "./types.ts";

type Row = Record<string, unknown>;

export type LockTurn = { member: string; askedAt: string; grantedAt: string | null; mergedAt: string | null; refused: number };
/** A held file and every member holding it, in claim order (D40): the FileMap's rows. */
export type SnapshotFile = { path: string; holders: string[]; interface: boolean };
/** The code fields of `BoardSnapshot`, as the page reads them. */
export type CodeSnapshotFields = {
  lock: { holder: string; since: string } | null;
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
  const heldBy = db.prepare("SELECT path, kind FROM claims WHERE participant = ? ORDER BY rowid");
  // every live claim on the repository, in claim order: the FileMap's rows, and which paths are shared (D40)
  const live = (
    db.prepare("SELECT c.path, c.kind, c.participant, p.seat, r.plan FROM claims c JOIN participants p ON p.id = c.participant JOIN runs r ON r.id = p.run WHERE c.repo = ? ORDER BY c.rowid").all(repo) as Row[]
  ).filter((c) => isLive(Number(c.participant)));
  const files = new Map<string, SnapshotFile>();
  for (const c of live) {
    const f = files.get(String(c.path)) ?? { path: String(c.path), holders: [], interface: false };
    f.holders.push(`${c.plan}/${c.seat}`);
    f.interface ||= c.kind === "interface";
    files.set(f.path, f);
  }
  // a file a live member declared at join but could not claim, held by another: it holds it too (D62);
  // one it claimed and released since does not come back
  const everClaimed = db.prepare("SELECT 1 FROM claim_log WHERE repo = ? AND path = ? AND participant = ?");
  for (const r of people) {
    if (String(r.seat) === orchestratorSeat || !isLive(Number(r.id))) continue;
    const name = `${r.plan}/${r.seat}`;
    for (const d of JSON.parse(String(r.files)) as Declared[]) {
      const f = files.get(relPath(repo, d.path) ?? d.path);
      if (f && !f.holders.includes(name) && !everClaimed.get(repo, f.path, Number(r.id))) f.holders.push(name);
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
      lock: lockHolder !== null ? { holder: nameOf(lockHolder), since: String(lockRow!.at) } : null,
      files: [...files.values()],
      flags,
    },
    factOf: (id) => (id === lockHolder ? "merging" : null),
    heldFilesOf: (id) => (heldBy.all(id) as Row[]).map((c) => ({ path: String(c.path), interface: c.kind === "interface", shared: sharedBy(String(c.path), id) })),
  };
}

/** The claims a member holds now (F27), repository-relative: the roster's `held`. */
export function heldOf(db: DatabaseSync, id: number): Declared[] {
  return (db.prepare("SELECT path, kind FROM claims WHERE participant = ? ORDER BY rowid").all(id) as Row[]).map((c) => ({ path: String(c.path), interface: c.kind === "interface" }));
}
