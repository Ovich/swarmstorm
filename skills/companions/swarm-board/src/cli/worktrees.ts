// The worktrees the board makes for a code run's members (kind profile `worktree`): one per seat under
// `<data home>/worktrees/<run>/<seat>`, never inside the repository, on branch `swarm/<run>-<group>/<seat>` from the run's base.
// Removed once clean and merged, the branch kept; what is not removed is said, with why.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DATA_ROOT } from "../board/home.ts";
import { linkPidFile } from "../link/link.ts";
import { git } from "./git.ts";

export const WORKTREES_ROOT = path.join(DATA_ROOT, "worktrees");

const CASELESS = process.platform === "win32" || process.platform === "darwin";
const fold = (s: string): string => (CASELESS ? path.resolve(s).toLowerCase() : path.resolve(s));
const safe = (s: string): string => s.replace(/[^A-Za-z0-9._-]/g, "_");

// the run id keeps two runs apart: group a-b seat c and group a seat b-c never share a folder or a branch
export const worktreeDir = (run: number, seat: string): string => path.join(WORKTREES_ROOT, String(run), safe(seat));
export const branchFor = (run: number, group: string, seat: string): string => `swarm/${run}-${group}/${seat}`;

/** A worktree the board made: `<data home>/worktrees/<run>/<seat>`. */
export const owned = (wt: string | null): wt is string => !!wt && fold(path.dirname(path.dirname(wt))) === fold(WORKTREES_ROOT);

/** Every worktree folder under the data home's worktrees folder, run by run. */
export const worktreeDirs = (): string[] => {
  const sub = (d: string) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(d, e.name)) : []);
  return sub(WORKTREES_ROOT).flatMap(sub);
};

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
export function ensureWorktree(cwd: string, runId: number, group: string, seat: string, base: string): { path: string; branch: string; reused: boolean } {
  const at = worktreeDir(runId, seat);
  const branch = branchFor(runId, group, seat);
  const top = fs.existsSync(at) ? git(at, "rev-parse", "--show-toplevel") : null;
  if (top && same(top, at)) return { path: at, branch: git(at, "rev-parse", "--abbrev-ref", "HEAD") ?? branch, reused: true };
  if (fs.existsSync(at) && fs.readdirSync(at).length) throw new Error(`${at} exists and is not a worktree: remove it, then join again`);
  // a registration whose folder went is pruned first, or git refuses the path
  run(cwd, "worktree", "prune");
  fs.mkdirSync(path.dirname(at), { recursive: true });
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

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** The command line of a live process; null when it is gone or cannot be read. */
function commandLine(pid: number): string | null {
  const r =
    process.platform === "win32"
      ? spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`], { encoding: "utf8", windowsHide: true })
      : spawnSync("ps", ["-o", "args=", "-p", String(pid)], { encoding: "utf8" });
  return (r.stdout ?? "").trim() || null;
}

/** Stops the members' links before their worktrees go (Windows refuses to remove a folder a live process holds):
 *  only the pid each link wrote under this data home, and only while that process is still a link. */
export function stopLinks(runId: number, members: string[]): void {
  const pids: number[] = [];
  for (const member of members) {
    const file = linkPidFile(DATA_ROOT, runId, member);
    let pid: number;
    try {
      pid = Number(fs.readFileSync(file, "utf8").trim());
    } catch {
      continue;
    }
    if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && alive(pid) && /\slink(\s|$)/.test(commandLine(pid) ?? "")) {
      try {
        process.kill(pid);
        pids.push(pid);
      } catch {}
    }
    try {
      fs.rmSync(file);
    } catch {}
  }
  for (let i = 0; i < 40 && pids.some(alive); i++) spawnSync(process.execPath, ["-e", "setTimeout(()=>{},50)"]);
}

/** Removes `wt` when clean and merged into `into`; otherwise says why it stays. */
export function sweep(wt: string, repo: string, into: string | null): { removed: boolean; why: string | null } {
  const why = leftover(wt, into) ?? removeWorktree(wt, repo);
  return { removed: why === null, why };
}
