// simple-states (spec §7): the paths a member's worktree changed since it left its target, read by its link from
// git and sent as a `changes` frame; the server sets the member's holdings to them. The board runs no git for it.
import { gitAnswer } from "../../git.ts";
import type { DriftedFile } from "./types.ts";

/** The commit `worktree`'s branch left `onto` at; null when git fails, or when HEAD is detached (the worktree
 *  switched to another commit, a base to compare against): no branch to read against. A caller reading both sets
 *  of one look passes it to each, so git reads it once (E3). */
export function branchBase(worktree: string, onto: string): string | null {
  if (gitAnswer(worktree, "symbolic-ref", "-q", "HEAD").status !== 0) return null;
  const base = gitAnswer(worktree, "merge-base", "--end-of-options", "HEAD", onto);
  return base.status === 0 ? base.stdout.trim() : null;
}

/** Every path `worktree` changed against `onto`, repository-relative with forward slashes: what git status shows
 *  (staged, unstaged, untracked, a conflict; a rename's both paths) and what its branch committed since the merge-base
 *  (a rename's both paths); ignored files never. Null when git fails, or when HEAD is detached (the worktree switched
 *  to another commit, a base to compare against): the caller keeps the last set, so the claims stay the member's work. */
export function changedSet(worktree: string, onto: string, base = branchBase(worktree, onto)): string[] | null {
  if (!base) return null;
  const status = gitAnswer(worktree, "--no-optional-locks", "status", "--porcelain=v2", "-z", "--untracked-files=all");
  const diff = gitAnswer(worktree, "diff", "--name-status", "-z", "--find-renames", "--end-of-options", base, "HEAD");
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

/** The paths of `files` that `onto` changed since `worktree`'s branch left it, each with the newest such commit on
 *  `onto`: what the branch lacks until it rebases. A branch rebased onto them, or made after them, has none. Null as
 *  `changedSet` is (git fails, HEAD detached): the caller keeps the last set. The target's log since the base is read
 *  whole and filtered here, so no pathspec list grows with the member's files. */
export function driftedSet(worktree: string, onto: string, files: string[], base = branchBase(worktree, onto)): DriftedFile[] | null {
  if (!base) return null;
  if (!files.length) return [];
  // one record per commit, newest first: "\x01<sha>", then the paths it changed, one per line, unquoted
  const log = gitAnswer(worktree, "-c", "core.quotePath=false", "log", "--format=%x01%H", "--name-only", "--end-of-options", `${base}..${onto}`);
  if (log.status !== 0) return null;
  const newest = new Map<string, string>();
  let sha = "";
  for (const line of log.stdout.split(/\r?\n/)) {
    if (line.startsWith("\x01")) sha = line.slice(1);
    else if (line && !newest.has(line)) newest.set(line, sha);
  }
  return files.filter((path) => newest.has(path)).map((path) => ({ path, sha: newest.get(path)! }));
}
