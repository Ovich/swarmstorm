// The one way to ask git: a command in a folder, its answer. Shared by the CLI's verbs, conflicts.ts and the
// code pack's worktrees, and a link's changed set; the board never runs git.
import { hiddenSpawnSync } from "./proc.ts";

/** git's exit and output; `status` null when git could not be run at all. */
type GitAnswer = { status: number | null; stdout: string };

export const gitAnswer = (cwd: string, ...argv: string[]): GitAnswer => {
  // a worktree's whole reflog is read (D36): room past the 1 MB default
  const r = hiddenSpawnSync("git", argv, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { status: r.error ? null : r.status, stdout: r.stdout ?? "" };
};

/** A ref, sha or base taken from input, refused when git could read it as an option (trust-adaptations#D7); the
 *  git calls taking revisions also put `--end-of-options` before them. */
export function refArg(value: string, what: string): string {
  if (value.startsWith("-")) throw new Error(`${what} cannot start with "-": ${value}`);
  return value;
}

/** The trimmed output of a git command that exits 0; null otherwise. */
export const git = (cwd: string, ...argv: string[]): string | null => {
  const r = gitAnswer(cwd, ...argv);
  return r.status === 0 ? r.stdout.trim() : null;
};

/** The worktree of the repository that has `branch` checked out, from `git worktree list --porcelain`;
 *  null when none. git refuses a push to a branch checked out elsewhere, so merge-lock says so first. */
export const worktreeHolding = (cwd: string, branch: string): string | null => {
  const list = git(cwd, "worktree", "list", "--porcelain");
  if (!list) return null;
  const ref = branch.startsWith("refs/") ? branch : `refs/heads/${branch}`;
  let at: string | null = null;
  for (const line of list.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) at = line.slice("worktree ".length);
    else if (line === `branch ${ref}`) return at;
  }
  return null;
};

/** What the run's worktrees branch from: the checkout's branch, else its commit; null outside a repository or before its first commit. */
export const baseAt = (cwd: string): string | null => {
  const head = git(cwd, "rev-parse", "--verify", "-q", "HEAD");
  return head && (git(cwd, "symbolic-ref", "--short", "-q", "HEAD") ?? head);
};

/** The base as a full ref git cannot guess from (G36): the local branch, else `origin/<base>`, else the base as given
 *  (a commit). A bare branch name that exists only on origin makes `git worktree add -b <seat> <dir> <base>` create and
 *  check out the base itself instead of the seat branch. */
export const baseRef = (cwd: string, base: string): string => {
  for (const ref of [`refs/heads/${base}`, `refs/remotes/origin/${base}`]) if (git(cwd, "rev-parse", "--verify", "-q", "--end-of-options", ref) !== null) return ref;
  return base;
};

// simple-states (spec §7): the paths a member's worktree changed since it left its target, read by its link from
// git and sent as a `changes` frame; the server sets the member's holdings to them. The board runs no git for it.

/** The commit `worktree`'s branch left `onto` at; null when git fails, or when HEAD is detached (the worktree
 *  switched to another commit, a base to compare against): no branch to read against. */
function branchBase(worktree: string, onto: string): string | null {
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
