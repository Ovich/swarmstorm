// The code pack's published shapes (codebase-rework#D4): its events, which the core's event table reads beside its own
// (board-split D18), and what its events, verbs and snapshot carry to the board, the wire and the CLI, which never
// import src/packs/ (D9). A leaf: it imports nothing at runtime, so the core reaches it without a cycle.
import type { EventDef } from "./events.ts";

export const CODE_EVENTS = {
  merged: { name: "merged", lands: true },
  // a write outside the writer's claim on a path another holds (D10); mentions: the holder, then the writer
  // posted in the writer's name, it reaches the writer too (v1-7)
  flag: { name: "flag", toAuthor: true },
} as const satisfies Record<string, EventDef<string>>;

/** board-split V-22: the merge lock's name in an `unlocked` event, when the board frees it from a lost holder. */
export const MERGE_LOCK = "merge-lock";

export type CodeEventName = keyof typeof CODE_EVENTS;

/** What the code pack says of a member beside its core state (board-split D36, D18): `merging` while it holds the
 *  repository's merge lock. */
export type CodeMemberFact = "merging";

/** A file written outside its writer's claim while another member holds it. */
export type Flag = { path: string; holder: string; seq: number };

/** What a merged event told, as data (D11): `rebase` holds or declared a changed file, `tell` is whom to tell of a resolved conflict,
 *  of a conflicted path only once the conflicts are known (D5). */
/** `free` (V-49): the members refused the merge lock, told it is free by this merge, as its body says. */
/** `files`: the paths the merge changed, as its body's `files:` line says; absent from an event of an older store. */
export type MergedMeta = { rebase: string[]; tell: string[]; free?: string[]; files?: string[] };
/** An overlap's two members: `holder` held the path, `writer`'s change came second. The event mentions the writer
 *  alone, who settles it; the holder hears through the agreement. */
type FlagMeta = { holder: string; writer: string };

/** The data the code pack's events carry on a message, for the core's `MessageMeta`. */
export type PackMessageMeta = MergedMeta | FlagMeta;

/** `grantedAt` ISO; `onto` null for a lock taken without a branch; `reflogMark` the holder's HEAD reflog
 *  length at the grant, null when none was given (D36); `files` the paths its branch changed, null when its CLI
 *  read none from git (no worktree). */
export type HeldMergeLock = { grantedAt: string; onto: string | null; reflogMark: number | null; files: string[] | null };

export type LockTurn = { member: string; askedAt: string; grantedAt: string | null; mergedAt: string | null; refused: number };
/** A file a live member's worktree changes now: who holds it, in claim order (D40); two holders or more make it shared.
 *  The FileMap's rows. */
export type SnapshotFile = { path: string; holders: string[] };
/** The code fields of `BoardSnapshot`, as the page reads them. */
export type CodeSnapshotFields = {
  /** V-46: `waiters`, the live members refused it and waiting for it, in the order they asked */
  lock: { holder: string; since: string; waiters: string[] } | null;
  /** The repository's merge-lock turns, newest first (at most 50): asked, granted, merged, refusals counted. */
  lockHistory: LockTurn[];
  files: SnapshotFile[];
};
