// What a member's rebase met (D3, board D8): the files git could not combine by itself when the
// branch was rebased after the merge lock was granted. Read-only, in the member's worktree: the
// reflog gives the head before the rebase and the commit it started onto, and one
// `merge-tree --write-tree` replays them. Never throws; what git cannot answer is an unknown.
import type { Conflicts } from "../board/board.ts";
import { git, gitAnswer } from "../git.ts";

export type { Conflicts } from "../board/board.ts";

/** `merge-tree --write-tree` came with git 2.38. */
const MERGE_TREE_SINCE: [number, number] = [2, 38];

/** A reflog entry that starts a rebase: `rebase (start)`, `rebase -i (start)`, `pull --rebase (start)`. */
const REBASE_START = /^(?:pull --)?rebase(?: -[a-z]+)? \(start\):/;

function gitHasMergeTree(worktree: string): boolean {
  const m = (git(worktree, "version") ?? "").match(/(\d+)\.(\d+)/);
  if (!m) return false;
  const [major, minor] = [Number(m[1]), Number(m[2])];
  return major > MERGE_TREE_SINCE[0] || (major === MERGE_TREE_SINCE[0] && minor >= MERGE_TREE_SINCE[1]);
}

type ReflogEntry = { commit: string; subject: string };

/** HEAD's reflog in the worktree, newest first; null when it cannot be read. */
function headReflog(worktree: string): ReflogEntry[] | null {
  const r = gitAnswer(worktree, "reflog", "show", "--format=%H%x09%gs", "HEAD");
  if (r.status !== 0) return null;
  return r.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [commit, ...subject] = line.split("\t");
      return { commit, subject: subject.join("\t") };
    });
}

/** How many entries HEAD's reflog holds in the worktree: the mark `merge-lock` keeps with a grant (D36); null when unreadable. */
export function headReflogLength(worktree: string): number | null {
  try {
    return headReflog(worktree)?.length ?? null;
  } catch {
    return null;
  }
}

/** The conflicts of the last rebase in `worktree` past `reflogMark` (the reflog's length at the lock's grant, D36),
 *  replayed against the commit that rebase started onto (D33); `onto`, the lock's branch, stands in only when
 *  that entry names no commit. No rebase past the mark: no conflict (D3). */
export function conflictsOf(worktree: string, onto: string, reflogMark: number): Conflicts {
  try {
    if (!gitHasMergeTree(worktree)) return { unknown: "old-git" };
    const reflog = headReflog(worktree);
    if (!reflog || reflog.length < reflogMark) return { unknown: "no-reflog" };
    // newest first: the entries past the mark lead the list, and the first start among them is the last rebase
    const start = reflog.slice(0, reflog.length - reflogMark).findIndex((e) => REBASE_START.test(e.subject));
    if (start < 0) return { files: [] };
    // the entry before the start (older, next in the list) is where HEAD stood: the branch before the rebase
    const before = reflog[start + 1];
    const target = reflog[start].commit || onto;
    if (!before || !target) return { unknown: "no-reflog" };
    const r = gitAnswer(worktree, "merge-tree", "--write-tree", "--name-only", "--no-messages", "-z", before.commit, target);
    if (r.status === 0) return { files: [] };
    if (r.status !== 1) return { unknown: "no-reflog" };
    // -z: the tree's oid, then each conflicted path, NUL-separated
    const [, ...paths] = r.stdout.split("\0").filter(Boolean);
    return { files: [...new Set(paths)] };
  } catch {
    return { unknown: "no-reflog" };
  }
}
