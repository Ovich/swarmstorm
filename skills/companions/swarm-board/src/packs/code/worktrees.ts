// The worktrees the board makes for a code run's members (kind profile `worktree`): one per seat under
// `<repo's git common dir>/swarm/worktrees/<run>/<seat>`, beside the repository's own git data, never in its tree, on branch `swarm/<run>-<group>/<seat>` from the run's base.
// Removed once clean and merged, the branch kept; what is not removed is said, with why.
// One entry (board-split#D13, widened by #D37): `worktrees(repo)` and the sweeps; paths, branch names, git hidden.
import { hiddenSpawnSync } from "../../proc.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DATA_ROOT } from "../../board/home.ts";
import { baseRef, git } from "../../git.ts";
import { stopLinks } from "../../link/link.ts";
import { worktreeOf } from "../../place/place.ts";

/** The one folder the board makes worktrees in, and the only one it ever removes from: `<repo>/swarm/worktrees`, `repo` the git common dir. */
const worktreesRoot = (repo: string): string => path.join(repo, "swarm", "worktrees");

const CASELESS = process.platform === "win32" || process.platform === "darwin";
const fold = (s: string): string => (CASELESS ? path.resolve(s).toLowerCase() : path.resolve(s));
const safe = (s: string): string => s.replace(/[^A-Za-z0-9._-]/g, "_");

// the run id keeps two runs apart: group a-b seat c and group a seat b-c never share a folder or a branch
const worktreeDir = (repo: string, run: number, seat: string): string => path.join(worktreesRoot(repo), String(run), safe(seat));
const branchFor = (run: number, group: string, seat: string): string => `swarm/${run}-${group}/${seat}`;

/** A worktree the board made for `repo`: `<repo>/swarm/worktrees/<run>/<seat>`. */
const owned = (wt: string | null, repo: string): wt is string => !!wt && fold(path.dirname(path.dirname(wt))) === fold(worktreesRoot(repo));

/** Every worktree folder under each repository's worktrees folder, run by run. */
const worktreeDirs = (repos: Iterable<string>): string[] => {
  const sub = (d: string) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(d, e.name)) : []);
  return [...new Set(repos)].flatMap((repo) => sub(worktreesRoot(repo)).flatMap(sub));
};

const same = (a: string, b: string): boolean => fold(a) === fold(b);

/** git with its error text: what a refusal quotes. */
function run(cwd: string, ...argv: string[]): { ok: boolean; out: string; err: string } {
  const r = hiddenSpawnSync("git", argv, { cwd, encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() || (r.error?.message ?? "") };
}

/** True when `cwd` is a worktree git added (not the repository's own checkout). */
function inLinkedWorktree(cwd: string): boolean {
  const dir = git(cwd, "rev-parse", "--absolute-git-dir");
  const common = git(cwd, "rev-parse", "--git-common-dir");
  return !!dir && !!common && !same(dir, path.resolve(cwd, common));
}

const branchExists = (cwd: string, branch: string): boolean => git(cwd, "rev-parse", "--verify", "-q", `refs/heads/${branch}`) !== null;
const isAncestor = (cwd: string, ref: string, of: string): boolean => run(cwd, "merge-base", "--is-ancestor", ref, of).ok;

/** The seat's worktree, made from `base` or reused when it is there; `cwd` is any checkout of the repository. */
function ensureWorktree(cwd: string, repo: string, runId: number, group: string, seat: string, base: string): { path: string; branch: string; reused: boolean } {
  const at = worktreeDir(repo, runId, seat);
  const branch = branchFor(runId, group, seat);
  const top = fs.existsSync(at) ? git(at, "rev-parse", "--show-toplevel") : null;
  if (top && same(top, at)) return { path: at, branch: git(at, "rev-parse", "--abbrev-ref", "HEAD") ?? branch, reused: true };
  if (fs.existsSync(at) && fs.readdirSync(at).length) throw new Error(`${at} exists and is not a worktree: remove it, then join again`);
  // a registration whose folder went is pruned first, or git refuses the path
  run(cwd, "worktree", "prune");
  fs.mkdirSync(path.dirname(at), { recursive: true });
  // a branch left by an earlier worktree of the seat: reset to the base when merged, kept as it is when not
  const from = baseRef(cwd, base);
  const argv = !branchExists(cwd, branch) ? ["-b", branch, at, from] : isAncestor(cwd, branch, from) ? ["-B", branch, at, from] : [at, branch];
  const r = run(cwd, "worktree", "add", "-q", ...argv);
  if (!r.ok) throw new Error(`git worktree add ${argv.join(" ")} failed: ${r.err}`);
  return { path: at, branch, reused: false };
}

/** Why the worktree cannot go yet: uncommitted changes, or commits not in `into`; null when it can (or is gone). */
function leftover(wt: string, into: string | null): string | null {
  if (!fs.existsSync(wt)) return null;
  const status = run(wt, "status", "--porcelain", "--untracked-files=all");
  if (!status.ok) return `git status failed: ${status.err}`;
  const changed = status.out.split(/\r?\n/).filter(Boolean).length;
  if (changed) return `${changed} uncommitted change${changed === 1 ? "" : "s"}`;
  if (!into) return "no base branch recorded for its run";
  if (!isAncestor(wt, "HEAD", baseRef(wt, into))) return `branch ${git(wt, "rev-parse", "--abbrev-ref", "HEAD") ?? "HEAD"} has commits not merged into ${into}`;
  return null;
}

/** `git worktree remove`, then prune; run from the repository's git dir, never from inside the worktree. Null on success, else why. */
function removeWorktree(wt: string, repo: string): string | null {
  if (!fs.existsSync(wt)) {
    run(os.tmpdir(), `--git-dir=${repo}`, "worktree", "prune");
    return null;
  }
  const r = run(os.tmpdir(), `--git-dir=${repo}`, "worktree", "remove", wt);
  run(os.tmpdir(), `--git-dir=${repo}`, "worktree", "prune");
  return r.ok ? null : r.err || "git worktree remove failed";
}

/** Removes `wt` when clean and merged into `into`; otherwise says why it stays. */
function sweep(wt: string, repo: string, into: string | null): { removed: boolean; why: string | null } {
  const why = leftover(wt, into) ?? removeWorktree(wt, repo);
  return { removed: why === null, why };
}

/** Where the board made worktrees before D6: under the data home. */
const LEGACY_ROOT = path.join(DATA_ROOT, "worktrees");
const LEGACY_SWEPT = path.join(LEGACY_ROOT, ".swept");

/** D6: the legacy data-home root, swept once as a migration, never by prune: each clean worktree in it is removed
 *  (its branch kept, so no commit is lost), one with uncommitted changes is kept and named. The root goes when empty;
 *  else a marker keeps the sweep from running again. Returns one line per kept worktree; [] when nothing was there. */
function sweepLegacyRoot(): string[] {
  if (!fs.existsSync(LEGACY_ROOT) || fs.existsSync(LEGACY_SWEPT)) return [];
  const kept: string[] = [];
  const sub = (d: string) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(d, e.name)) : []);
  for (const wt of sub(LEGACY_ROOT).flatMap(sub)) {
    const common = git(wt, "rev-parse", "--git-common-dir");
    if (!common) {
      // not a worktree any more: an empty folder goes, anything else stays
      if (!fs.readdirSync(wt).length) fs.rmdirSync(wt);
      else kept.push(`${wt}: not a git worktree, left as it is`);
      continue;
    }
    const status = run(wt, "status", "--porcelain", "--untracked-files=all");
    if (!status.ok || status.out) {
      kept.push(`${wt}: uncommitted changes, kept`);
      continue;
    }
    const why = removeWorktree(wt, path.resolve(wt, common));
    if (why) kept.push(`${wt}: ${why}`);
  }
  for (const runDir of sub(LEGACY_ROOT)) if (!fs.readdirSync(runDir).length) fs.rmdirSync(runDir);
  if (!fs.readdirSync(LEGACY_ROOT).length) fs.rmdirSync(LEGACY_ROOT);
  else fs.writeFileSync(LEGACY_SWEPT, `${new Date().toISOString()}\n`);
  return kept;
}

/** A seat's worktree as its callers hold it: the run, the member whose link holds it open, its folder. */
export type SeatRef = { run: number; member: string; worktree: string };
/** A worktree folder's owner as the board recorded it. */
export type WorktreeRecord = { run: number; open: boolean; repo: string; base: string | null };

/** The board's worktrees of one repository, `repo` its git common dir. */
export function worktrees(repo: string) {
  return {
    /** Where the seat's worktree is, without making it (G20); null when `cwd` is a worktree the board did not make. */
    place(run: number, group: string, seat: string, cwd: string): { path: string; branch: string; reused: boolean } | null {
      if (inLinkedWorktree(cwd) && !owned(worktreeOf(cwd), repo)) return null;
      const at = worktreeDir(repo, run, seat);
      return { path: at, branch: branchFor(run, group, seat), reused: fs.existsSync(at) };
    },
    /** The seat's worktree, made from `base` or reused when it is there; git runs from the repository's git dir. */
    forSeat(run: number, group: string, seat: string, base: string): { path: string; branch: string; reused: boolean } {
      return ensureWorktree(repo, repo, run, group, seat, base);
    },
    /** True when `wt` is a worktree the board made for this repository. */
    owns(wt: string | null): wt is string {
      return owned(wt, repo);
    },
    /** Why the seat's worktree cannot go yet (uncommitted changes, commits not in `into`); null when it can. */
    unmerged(wt: string, into: string | null): string | null {
      return leftover(wt, into);
    },
    /** Stops the seat's link (Windows refuses to remove a folder a live process is in), then removes the worktree once
     *  clean and merged into `into`; otherwise says why it stays. */
    release(seat: SeatRef, into: string | null): { removed: boolean; why: string | null } {
      stopLinks(seat.run, [seat.member]);
      return sweep(seat.worktree, repo, into);
    },
  };
}

/** `worktree prune`: every worktree folder of each repository, judged by the board's record of it (null: no member of
 *  any run joined from it); removed once its run is closed and it is clean and merged, else kept with why. */
export function sweepAll(repos: Iterable<string>, recordOf: (dir: string) => WorktreeRecord | null): { worktree: string; removed: boolean; why: string | null }[] {
  return worktreeDirs(repos).map((dir) => {
    const w = recordOf(dir);
    if (!w) return { worktree: dir, removed: false, why: "no member of any run joined from it" };
    if (w.open) return { worktree: dir, removed: false, why: `run ${w.run} is open` };
    return { worktree: dir, ...sweep(dir, w.repo, w.base) };
  });
}

/** D6: the worktrees an older board made under the data home, swept once; one line per kept worktree. */
export const sweepLegacy = (): string[] => sweepLegacyRoot();
