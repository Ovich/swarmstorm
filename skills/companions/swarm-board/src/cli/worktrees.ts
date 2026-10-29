// The worktrees the board makes for a code run's members (kind profile `worktree`): one per seat under
// `<data home>/worktrees`, never inside the repository, on branch `swarm/<group>/<seat>` from the run's base.
// Removed once clean and merged, the branch kept; what is not removed is said, with why.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DATA_ROOT } from "../board/home.ts";
import { git } from "./git.ts";

export const WORKTREES_ROOT = path.join(DATA_ROOT, "worktrees");

const CASELESS = process.platform === "win32" || process.platform === "darwin";
const fold = (s: string): string => (CASELESS ? path.resolve(s).toLowerCase() : path.resolve(s));
const safe = (s: string): string => s.replace(/[^A-Za-z0-9._-]/g, "_");

export const worktreeDir = (group: string, seat: string): string => path.join(WORKTREES_ROOT, `${safe(group)}-${safe(seat)}`);
export const branchFor = (group: string, seat: string): string => `swarm/${group}/${seat}`;

/** A worktree the board made: it lives under the data home's worktrees folder. */
export const owned = (wt: string | null): wt is string => !!wt && fold(path.dirname(wt)) === fold(WORKTREES_ROOT);

const same = (a: string, b: string): boolean => fold(a) === fold(b);

/** git with its error text: what a refusal quotes. */
function run(cwd: string, ...argv: string[]): { ok: boolean; out: string; err: string } {
  const r = spawnSync("git", argv, { cwd, encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() || (r.error?.message ?? "") };
}

/** What the run's worktrees branch from: the checkout's branch, else its commit; null outside a repository or before its first commit. */
export const baseAt = (cwd: string): string | null => {
  const head = git(cwd, "rev-parse", "--verify", "-q", "HEAD");
  return head && (git(cwd, "symbolic-ref", "--short", "-q", "HEAD") ?? head);
};

/** True when `cwd` is a worktree git added (not the repository's own checkout). */
export function inLinkedWorktree(cwd: string): boolean {
  const dir = git(cwd, "rev-parse", "--absolute-git-dir");
  const common = git(cwd, "rev-parse", "--git-common-dir");
  return !!dir && !!common && !same(dir, path.resolve(cwd, common));
}

const branchExists = (cwd: string, branch: string): boolean => git(cwd, "rev-parse", "--verify", "-q", `refs/heads/${branch}`) !== null;
const isAncestor = (cwd: string, ref: string, of: string): boolean => run(cwd, "merge-base", "--is-ancestor", ref, of).ok;

/** The seat's worktree, made from `base` or reused when it is there; `cwd` is any checkout of the repository. */
export function ensureWorktree(cwd: string, group: string, seat: string, base: string): { path: string; branch: string; reused: boolean } {
  const at = worktreeDir(group, seat);
  const branch = branchFor(group, seat);
  const top = fs.existsSync(at) ? git(at, "rev-parse", "--show-toplevel") : null;
  if (top && same(top, at)) return { path: at, branch: git(at, "rev-parse", "--abbrev-ref", "HEAD") ?? branch, reused: true };
  if (fs.existsSync(at) && fs.readdirSync(at).length) throw new Error(`${at} exists and is not a worktree: remove it, then join again`);
  // a registration whose folder went is pruned first, or git refuses the path
  run(cwd, "worktree", "prune");
  fs.mkdirSync(WORKTREES_ROOT, { recursive: true });
  // a branch left by an earlier worktree of the seat: reset to the base when merged, kept as it is when not
  const argv = !branchExists(cwd, branch) ? ["-b", branch, at, base] : isAncestor(cwd, branch, base) ? ["-B", branch, at, base] : [at, branch];
  const r = run(cwd, "worktree", "add", "-q", ...argv);
  if (!r.ok) throw new Error(`git worktree add ${argv.join(" ")} failed: ${r.err}`);
  return { path: at, branch, reused: false };
}

/** Why the worktree cannot go yet: uncommitted changes, or commits not in `into`; null when it can (or is gone). */
export function leftover(wt: string, into: string | null): string | null {
  if (!fs.existsSync(wt)) return null;
  const status = run(wt, "status", "--porcelain", "--untracked-files=all");
  if (!status.ok) return `git status failed: ${status.err}`;
  const changed = status.out.split(/\r?\n/).filter(Boolean).length;
  if (changed) return `${changed} uncommitted change${changed === 1 ? "" : "s"}`;
  if (!into) return "no base branch recorded for its run";
  if (!isAncestor(wt, "HEAD", into)) return `branch ${git(wt, "rev-parse", "--abbrev-ref", "HEAD") ?? "HEAD"} has commits not merged into ${into}`;
  return null;
}

/** `git worktree remove`, then prune; run from the repository's git dir, never from inside the worktree. Null on success, else why. */
export function removeWorktree(wt: string, repo: string): string | null {
  if (!fs.existsSync(wt)) {
    run(os.tmpdir(), `--git-dir=${repo}`, "worktree", "prune");
    return null;
  }
  const r = run(os.tmpdir(), `--git-dir=${repo}`, "worktree", "remove", wt);
  run(os.tmpdir(), `--git-dir=${repo}`, "worktree", "prune");
  return r.ok ? null : r.err || "git worktree remove failed";
}

/** The link processes of a run (of `members` only, when given), from the OS: a link's command line is `… link --run <id> --as <member>`. */
function linkPids(runId: number, members?: string[]): number[] {
  const lines =
    process.platform === "win32"
      ? (spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }`], { encoding: "utf8", windowsHide: true }).stdout ?? "")
      : (spawnSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" }).stdout ?? "");
  const found: number[] = [];
  for (const line of lines.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s.*\slink\s+--run\s+(\d+)\s+--as\s+"?([^\s"]+)"?/.exec(line);
    if (!m || Number(m[2]) !== runId || Number(m[1]) === process.pid) continue;
    if (members && !members.includes(m[3])) continue;
    found.push(Number(m[1]));
  }
  return found;
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Stops the members' links before their worktrees go: Windows refuses to remove a folder a live process holds. */
export function stopLinks(runId: number, members?: string[]): void {
  const pids = linkPids(runId, members);
  for (const pid of pids) {
    try {
      process.kill(pid);
    } catch {}
  }
  for (let i = 0; i < 40 && pids.some(alive); i++) spawnSync(process.execPath, ["-e", "setTimeout(()=>{},50)"]);
}

/** Removes `wt` when clean and merged into `into`; otherwise says why it stays. */
export function sweep(wt: string, repo: string, into: string | null): { removed: boolean; why: string | null } {
  const why = leftover(wt, into) ?? removeWorktree(wt, repo);
  return { removed: why === null, why };
}
