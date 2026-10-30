// The project's board is aiview's /board page (aiview board-page migration): `swarm open` adds
// the run's repository to the project's board through `aiview board --repo`, and prints the
// page's link. aiview is called as a command, never imported (swarm plan D16, D17).
import { hiddenSpawnSync } from "../proc.ts";
import fs from "node:fs";
import path from "node:path";

/** aiview's launcher: SWARM_AIVIEW, else `aiview.mjs` in the aiview skill beside this one. */
export function aiviewLauncher(toolRoot: string): string | null {
  const file = process.env.SWARM_AIVIEW ?? path.join(toolRoot, "..", "aiview", "aiview.mjs");
  return fs.existsSync(file) ? file : null;
}

type AiviewResult = { ok: true; out: unknown } | { ok: false; error: string };

const callAiview = (launcher: string, cwd: string, argv: string[]): AiviewResult => {
  const r = hiddenSpawnSync(process.execPath, [launcher, ...argv, "--json"], { cwd, encoding: "utf8" });
  if (r.status !== 0) return { ok: false, error: `aiview ${argv[0]} failed: ${(r.stderr || r.stdout).trim()}` };
  try {
    return { ok: true, out: JSON.parse(r.stdout.trim().split("\n").pop() ?? "") };
  } catch {
    return { ok: false, error: `aiview ${argv[0]}: unreadable output ${r.stdout.trim()}` };
  }
};

export type BoardPage =
  | { registered: true; url: string; repos: string[] }
  | { registered: false; reason: string }; // "aiview not found", an aiview error

/** Where the run's board will show: aiview's project claiming `cwd`. Asked before the run opens,
 *  so a run is never opened onto a board nobody can see. */
export type BoardHome =
  | { found: true; launcher: string; project: string }
  | { found: false; reason: string; launcher: string | null }; // launcher set, reason "no aiview project …": aiview is there, the project is not

export function boardHome(input: { toolRoot: string; cwd: string }): BoardHome {
  const launcher = aiviewLauncher(input.toolRoot);
  if (!launcher) return { found: false, reason: "aiview not found", launcher: null };
  const status = callAiview(launcher, input.cwd, ["status"]);
  if (!status.ok) return { found: false, reason: status.error, launcher: null };
  const project = (status.out as { cwdProject?: string | null }).cwdProject;
  if (!project) return { found: false, reason: `no aiview project for ${input.cwd}`, launcher };
  return { found: true, launcher, project };
}

/** Adds `repo` to the board of `home`'s project (never the active one), and returns the board
 *  page's link. Idempotent: a repository already on the board is not added twice. */
export function registerBoard(input: { home: BoardHome; cwd: string; repo: string }): BoardPage {
  const { home } = input;
  if (!home.found) return { registered: false, reason: home.reason };
  const board = callAiview(home.launcher, input.cwd, ["board", "--repo", input.repo, "--project", home.project]);
  if (!board.ok) return { registered: false, reason: board.error };
  const out = board.out as { url: string; repos: string[] };
  return { registered: true, url: out.url, repos: out.repos };
}

/** The paths aiview's project `name` covers, its slug matched as aiview matches it (case aside on Windows); null:
 *  aiview knows no such project, or is not there (board-split D47, verify 3 F15). */
export function projectPaths(input: { toolRoot: string; cwd: string; name: string }): string[] | null {
  const launcher = aiviewLauncher(input.toolRoot);
  if (!launcher) return null;
  const listed = callAiview(launcher, input.cwd, ["project"]);
  if (!listed.ok || !Array.isArray(listed.out)) return null;
  const projects = listed.out as { slug: string; paths: string[] }[];
  const same = (slug: string) => (process.platform === "win32" ? slug.toLowerCase() === input.name.toLowerCase() : slug === input.name);
  return projects.find((p) => same(p.slug))?.paths ?? null;
}

/** board-split D47 (V-18): the one name of a project, as the board's hash and aiview's page carry it: the slug of the
 *  aiview project whose paths cover the repository's checkout, else `fallback` (its folder name). One `aiview project`
 *  call for every repository asked. */
export function projectNamer(input: { toolRoot: string; cwd: string; fallback: (repo: string) => string }): (repo: string) => string {
  const launcher = aiviewLauncher(input.toolRoot);
  const listed = launcher ? callAiview(launcher, input.cwd, ["project"]) : null;
  const projects = listed?.ok && Array.isArray(listed.out) ? (listed.out as { slug: string; paths: string[] }[]) : [];
  const norm = (p: string): string => {
    const forward = path.resolve(p).split("\\").join("/").replace(/\/+$/, "");
    return process.platform === "win32" ? forward.toLowerCase() : forward;
  };
  const covers = (root: string, checkout: string): boolean => checkout === root || checkout.startsWith(`${root}/`);
  return (repo) => {
    const checkout = norm(path.basename(repo).toLowerCase() === ".git" ? path.dirname(repo) : repo);
    return projects.find((p) => p.paths.some((root) => covers(norm(root), checkout)))?.slug ?? input.fallback(repo);
  };
}
