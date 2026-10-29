// The code pack's own shapes (board-split D18): what its tables, events and verbs carry, kept out of the core's types.
import type { RunId } from "../../board/board.ts";

/** A file written outside its writer's claim while another member holds it. */
export type Flag = { path: string; holder: string; seq: number };

/** What a merged event told, as data (D11): `rebase` holds or declared a changed file, `tell` is whom to tell of a resolved conflict,
 *  of a conflicted path only once the conflicts are known (D5). */
export type MergedMeta = { rebase: string[]; tell: string[] };

/** A worktree a member joined from, with what its cleanup needs: the run's state and base. */
export interface MemberWorktree {
  run: RunId;
  member: string;
  worktree: string;
  repo: string;
  base: string | null;
  open: boolean;
}
