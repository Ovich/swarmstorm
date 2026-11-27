// The code pack's own shapes (board-split D18): what its tables, events and verbs carry, kept out of the core's types.
import type { RunId } from "../../contract/board.ts";

/** A worktree a member joined from, with what its cleanup needs: the run's state and base. */
export interface MemberWorktree {
  run: RunId;
  member: string;
  worktree: string;
  repo: string;
  base: string | null;
  open: boolean;
}
