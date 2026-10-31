// simple-states (spec §7): the paths a member's worktree changed since it left its target, read by its link from
// git and sent as a `changes` frame; the server sets the member's holdings to them. The board runs no git for it.
import { gitAnswer } from "../../git.ts";

/** Every path `worktree` changed against `onto`, repository-relative with forward slashes: what git status shows
 *  (staged, unstaged, untracked, a conflict; a rename's both paths) and what its branch committed since the merge-base
 *  (a rename's both paths); ignored files never. Null when git fails: the caller keeps the last set. */
export function changedSet(worktree: string, onto: string): string[] | null {
  const base = gitAnswer(worktree, "merge-base", "HEAD", onto);
  if (base.status !== 0) return null;
  const status = gitAnswer(worktree, "status", "--porcelain=v2", "-z", "--untracked-files=all");
  const diff = gitAnswer(worktree, "diff", "--name-status", "-z", "--find-renames", base.stdout.trim(), "HEAD");
  if (status.status !== 0 || diff.status !== 0) return null;
  const set = new Set<string>();
  // porcelain v2 -z: one record per NUL; a rename record ("2 …") carries its original path as the next record
  const records = status.stdout.split("\0");
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.startsWith("1 ")) set.add(r.split(" ").slice(8).join(" "));
    else if (r.startsWith("2 ")) {
      set.add(r.split(" ").slice(9).join(" "));
      set.add(records[++i]);
    } else if (r.startsWith("u ")) set.add(r.split(" ").slice(10).join(" "));
    else if (r.startsWith("? ")) set.add(r.slice(2));
  }
  // name-status -z: a status, then its path (a rename or copy: two paths)
  const fields = diff.stdout.split("\0").filter(Boolean);
  for (let i = 0; i < fields.length; i++) {
    const two = fields[i].startsWith("R") || fields[i].startsWith("C");
    set.add(fields[i + 1]);
    if (two) set.add(fields[i + 2]);
    i += two ? 2 : 1;
  }
  return [...set].filter(Boolean).map((p) => p.split("\\").join("/")).sort();
}
