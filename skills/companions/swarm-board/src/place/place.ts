// Place (board-rework D5): where a repository and a path are, the one answer both CLIs use. A repository is its
// common git dir, so every worktree of it is one; a member's path is its worktree's first. aiview imports this module
// as it imports the board reader, bundled.
import { hiddenSpawnSync } from "../proc.ts";
import fs from "node:fs";
import path from "node:path";

const gitOut = (cwd: string, ...argv: string[]): string | null => {
  const r = hiddenSpawnSync("git", argv, { cwd, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
};

const real = (p: string): string => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return p;
  }
};

/** The repository `dir` is in: its common git dir, real path; null outside a repository. */
export function repoOf(dir: string): string | null {
  const common = gitOut(dir, "rev-parse", "--git-common-dir");
  return common ? real(path.resolve(dir, common)) : null;
}

/** The top of the worktree `dir` is in; null outside a repository. */
export function worktreeOf(dir: string): string | null {
  const top = gitOut(dir, "rev-parse", "--show-toplevel");
  return top ? path.resolve(top) : null;
}

/** The common git dir a `.git` entry stands for, read from disk without git (G6): a folder is itself; a worktree's
 *  `.git` file points at its own git dir, whose `commondir` names the shared one. */
export function commonGitDir(dotGit: string): string {
  if (!fs.statSync(dotGit).isFile()) return dotGit;
  const own = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, "utf8"))?.[1]?.trim();
  if (!own) return dotGit;
  const dir = path.resolve(path.dirname(dotGit), own);
  const common = path.join(dir, "commondir");
  return fs.existsSync(common) ? path.resolve(dir, fs.readFileSync(common, "utf8").trim()) : dir;
}

const inside = (root: string, dir: string): boolean => {
  const rel = path.relative(path.resolve(root), path.resolve(dir));
  return !rel.startsWith("..") && !path.isAbsolute(rel);
};

/** The file a member's relative path means (D6, G19): `root` is the member's worktree, else the shell's checkout.
 *  From the shell's folder when the shell is inside `root` and the file is there, else from `root`; a file on neither
 *  is `missing` unless `create`, then it is the first of them. */
export function resolveIn(root: string | null, spec: string, opts: { create?: boolean; cwd?: string } = {}): { abs: string; missing: string[] } {
  if (path.isAbsolute(spec)) return { abs: spec, missing: [] };
  const cwd = opts.cwd ?? process.cwd();
  const here = root && !inside(root, cwd) ? path.resolve(root, spec) : path.resolve(cwd, spec);
  if (fs.existsSync(here)) return { abs: here, missing: [] };
  const fromRoot = root ? path.resolve(root, spec) : null;
  if (fromRoot && fs.existsSync(fromRoot)) return { abs: fromRoot, missing: [] };
  return { abs: here, missing: opts.create ? [] : [here, ...(fromRoot && fromRoot !== here ? [fromRoot] : [])] };
}

/** `abs` relative to `root`, forward slashes: what the board stores and every answer names. */
export function relativeIn(root: string | null, abs: string): string {
  return (root ? path.relative(root, abs) : abs).split(path.sep).join("/");
}
