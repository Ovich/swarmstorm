// The paths a verb reads and prints: forward slashes in every answer, the tool's own folder, the repository a
// folder is in, what a worktree's branch changed, and the files written in the data home for a printed command.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { projectFolderName } from "../board/board.ts";
import { DATA_ROOT } from "../host/home.ts";
import { git, gitAnswer } from "../host/git.ts";
import { relativeIn, repoOf as placeRepoOf } from "../host/place.ts";
import { hiddenSpawnSync } from "../host/proc.ts";
import { projectNamer } from "./aiview-board.ts";
import type { WriteOrchestratorSeats } from "./answer/index.ts";
import { fail } from "./fail.ts";

/** A path as every answer prints it: forward slashes, which git, both shells and Node on Windows take, and in which
 *  PowerShell shows no doubled backslash. */
export const fwd = (p: string): string => p.split("\\").join("/");

/** The nearest folder at or above `from` holding swarm.mjs; `from` itself when none does. */
const swarmBoardFolderAbove = (from: string): string => {
  for (let dir = from; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "swarm.mjs"))) return dir;
    if (path.dirname(dir) === dir) return from;
  }
};

/** The tool's folder (swarm.mjs's), the aiview skill beside it, whatever the entry: swarm.mjs, dist-cli/cli.mjs or src/cli/index.ts. */
export const toolRoot = (): string => process.env.SWARM_ROOT ?? swarmBoardFolderAbove(path.dirname(path.resolve(process.argv[1])));

/** board-split D47 (V-18): a project's one name in a line: its aiview slug, else its folder; never its git dir. */
export const projectNameOf = (): ((repo: string) => string) => projectNamer({ toolRoot: toolRoot(), cwd: process.cwd(), fallback: projectFolderName });

/** The repository (D29): its common git dir, so every worktree of one repository is one (Place, D5). */
export function repoOf(dir: string): string {
  return placeRepoOf(dir) ?? fail(`not in a git repository: ${dir}`);
}

/** Repository-relative to `root` (the member's worktree), forward slashes: what the board stores and every answer names. */
export const repoRelative = (root: string | null, abs: string): string => relativeIn(root, abs);

/** Paths `git status` shows changed in a worktree, as it gives them; a rename gives both (D31). */
function changedIn(worktree: string): string[] {
  // G20: a worktree named at join and never made holds nothing
  if (!fs.existsSync(worktree)) return [];
  const r = hiddenSpawnSync("git", ["--no-optional-locks", "status", "--porcelain", "-z", "--untracked-files=all"], { cwd: worktree, encoding: "utf8" });
  if (r.status !== 0) return fail(`git status failed in ${worktree}: ${r.stderr.trim()}`);
  const parts = r.stdout.split("\0");
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    out.push(e.slice(3));
    if (/[RC]/.test(e.slice(0, 2)) && parts[i + 1]) out.push(parts[++i]); // -z: "R  new\0old\0"
  }
  return out;
}

/** Paths the worktree's branch changed since it left `onto`, committed or not; a rename gives both (D59). */
export function branchChangedIn(worktree: string, onto: string): string[] {
  const base = git(worktree, "merge-base", "--end-of-options", onto, "HEAD") ?? fail(`no merge base between ${onto} and HEAD in ${worktree}: is --onto the branch you merge into?`);
  // --no-renames: a rename is its deletion and its addition, both paths
  const r = hiddenSpawnSync("git", ["diff", "--name-only", "-z", "--no-renames", "--end-of-options", `${base}..HEAD`], { cwd: worktree, encoding: "utf8" });
  if (r.status !== 0) return fail(`git diff failed in ${worktree}: ${r.stderr.trim()}`);
  const committed = r.stdout.split("\0").filter(Boolean);
  return [...new Set([...committed, ...changedIn(worktree)])];
}

/** Paths the commit `sha` changed against its first parent; none when git does not know it here (D59: a rename gives both). */
export function commitChanged(worktree: string | null, sha: string): string[] {
  if (!worktree) return [];
  const r = gitAnswer(worktree, "diff", "--name-only", "-z", "--no-renames", "--end-of-options", `${sha}^1`, sha);
  return r.status === 0 ? r.stdout.split("\0").filter(Boolean) : [];
}

/** The orchestrators board's seats file, written in the data home per project, so the printed
 *  `open … --seats <path>` runs as printed (AGENTS rule 10). */
export const writeOrchestratorSeats: WriteOrchestratorSeats = (repo, seats) => {
  // one file per project: its checkout's folder name, then a short hash of its git dir
  const project = path.basename(path.dirname(repo)).replace(/[^\w.-]/g, "_");
  const file = path.join(DATA_ROOT, "orchestrators", `${project}-${createHash("sha1").update(repo).digest("hex").slice(0, 8)}.seats.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(seats, null, 2)}\n`);
  // forward slashes: the path is one shell word on every platform, printed unquoted
  return file.split(path.sep).join("/");
};
