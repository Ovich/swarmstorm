// The repository as git sees it, at the working tree or at any commit: its root, its source files and
// their text, its packages, its history. Nothing here names a project: every answer comes from git
// and from the package.json files the repository holds.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";

const SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
// dist-cli/ and the like: a committed bundle is built, never written, so it is no part of the code; .claude/ holds the tools, this one included
const SKIPPED = /(^|\/)(\.claude|node_modules|dist(-[\w-]+)?|build|out|coverage|\.next|\.angular|vendor)\//;
const BIG = 64 * 1024 * 1024;

const git = (root, args, input) => execFileSync("git", args, { windowsHide: true, cwd: root, encoding: "utf8", maxBuffer: BIG, input, stdio: ["pipe", "pipe", "ignore"] });

/** The repository holding `dir`, or a clear failure when `dir` is in none. */
export function repoRoot(dir) {
  const run = spawnSync("git", ["rev-parse", "--show-toplevel"], { windowsHide: true, cwd: dir, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`${dir} is not inside a git repository: the codebase bench reads what git tracks`);
  return run.stdout.trim();
}

/** The tool's own cache folder for this repository (derived data only, safe to delete). */
const cacheDirOf = (root) => {
  const common = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { windowsHide: true, cwd: root, encoding: "utf8" }).stdout.trim().toLowerCase() || root;
  return join(tmpdir(), "codebase-bench", "cache", createHash("sha256").update(common).digest("hex").slice(0, 10));
};

/** The commit a name points at, short; `null` for the working tree. */
export const commitOf = (root, ref) => git(root, ["rev-parse", "--short", ref ?? "HEAD"]).trim();

/**
 * A ref to compare from, as seen from HEAD: the ref itself when HEAD contains it, else the commit both
 * share (the merge-base), so what the ref has and HEAD has not yet is never counted as HEAD's regression.
 */
export function sinceOf(root, ref) {
  const sha = commitOf(root, ref);
  const behind = spawnSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], { windowsHide: true, cwd: root }).status === 0;
  if (behind) return { base: sha, note: null };
  const shared = git(root, ["merge-base", sha, "HEAD"]).trim().slice(0, 9);
  return { base: shared, note: `${ref} is not in HEAD's history: compared from the commit both share, ${shared}` };
}

/** The base a comparison starts from: the ref given, else the merge-base with the main branch, else the first commit. */
export function baseOf(root, ref) {
  if (ref) return commitOf(root, ref);
  for (const main of ["origin/main", "main", "origin/master", "master"]) {
    const run = spawnSync("git", ["merge-base", "HEAD", main], { windowsHide: true, cwd: root, encoding: "utf8" });
    if (run.status === 0 && run.stdout.trim()) return run.stdout.trim().slice(0, 9);
  }
  return git(root, ["rev-list", "--max-parents=0", "HEAD"]).trim().split("\n")[0].slice(0, 9);
}

const isManifest = (path) => /(^|\/)(package|tsconfig[^/]*)\.json$/.test(path);
const isSource = (path) => SOURCE.test(path) && !/\.d\.[cm]?ts$/.test(path) && !SKIPPED.test(path);
/** Tests and tool configuration: read (they count as users of what they import) but kept out of the structure's measures. */
export const isTest = (path) => /(^|\/)(tests?|__tests__|e2e)\//.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) || /(^|\/)[^/]*\.config\.[cm]?[jt]s$/.test(path);

/**
 * The tree to read: `{ files: Map<path, text>, manifests: Map<dir, package.json>, configs: Map<path, tsconfig text> }`, every tracked
 * source (and, for the working tree, every untracked one not ignored). `ref` null reads the working tree.
 */
export function treeOf(root, ref) {
  const ids = new Map();
  const listed = ref
    ? git(root, ["ls-tree", "-r", ref])
        .split("\n")
        .map((line) => {
          const [meta, path] = line.split("\t");
          if (path) ids.set(path, meta.split(" ")[2]);
          return path;
        })
    : git(root, ["ls-files", "-co", "--exclude-standard"]).split("\n");
  const wanted = listed.filter((path) => path && (isSource(path) || isManifest(path)) && !SKIPPED.test(path));
  const texts = ref ? catFiles(root, ref, wanted) : new Map(wanted.flatMap((path) => { try { return [[path, readFileSync(join(root, path), "utf8")]]; } catch { return []; } }));
  const files = new Map(), manifests = new Map(), configs = new Map();
  for (const [path, text] of texts) {
    if (/(^|\/)tsconfig[^/]*\.json$/.test(path)) configs.set(path, text);
    else if (posix.basename(path) === "package.json") {
      try { manifests.set(posix.dirname(path), JSON.parse(text)); } catch { /* a broken manifest is not a package */ }
    } else files.set(path, text);
  }
  return { files, manifests, configs, ids, cacheDir: cacheDirOf(root) };
}

/** Many blobs at one commit in one git call. */
function catFiles(root, ref, paths) {
  const out = execFileSync("git", ["cat-file", "--batch"], { windowsHide: true, cwd: root, input: `${paths.map((path) => `${ref}:${path}`).join("\n")}\n`, maxBuffer: BIG * 4 });
  const texts = new Map();
  let at = 0;
  for (const path of paths) {
    const end = out.indexOf(10, at);
    const header = out.toString("utf8", at, end);
    at = end + 1;
    if (header.endsWith("missing")) continue;
    const size = Number(header.split(" ")[2]);
    texts.set(path, out.toString("utf8", at, at + size));
    at += size + 1;
  }
  return texts;
}

/** How many commits touched each file in the last `days` days: `Map<path, count>`. */
export function churnOf(root, days) {
  const head = git(root, ["rev-parse", "HEAD"]).trim();
  const dir = cacheDirOf(root);
  const file = join(dir, `churn-${days}-${head.slice(0, 12)}-${new Date().toISOString().slice(0, 10)}.json`);
  if (existsSync(file)) return new Map(JSON.parse(readFileSync(file, "utf8")));
  const counts = new Map();
  for (const line of git(root, ["log", `--since=${days}.days`, "--name-only", "--format="]).split("\n")) if (line) counts.set(line, (counts.get(line) ?? 0) + 1);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify([...counts]));
  return counts;
}

/** How many commits of `base..head` touched each file (head = HEAD when absent): `Map<path, count>`. */
export function rangeChurnOf(root, base, head) {
  const counts = new Map();
  for (const line of git(root, ["log", `${base}..${head ?? "HEAD"}`, "--name-only", "--format="]).split("\n")) if (line) counts.set(line, (counts.get(line) ?? 0) + 1);
  return counts;
}

/** Lines added and removed per file between two commits (the working tree when `head` is null). */
export function netOf(root, base, head) {
  const rows = new Map();
  for (const line of git(root, ["diff", "--numstat", "-M", base, ...(head ? [head] : [])]).split("\n")) {
    const [added, removed, path] = line.split("\t");
    if (!path || added === "-") continue;
    const to = path.includes(" => ") ? path.replace(/\{([^}]*) => ([^}]*)\}/, "$2").replace(/^.* => /, "").replace(/\/\//g, "/") : path;
    rows.set(to, { added: Number(added), removed: Number(removed) });
  }
  return rows;
}

/** The files git sees as moved between a commit and the working tree: `Map<new path, old path>`, and the folders they moved with. */
export function renamesOf(root, base, head) {
  const files = new Map(), dirs = new Map();
  for (const line of git(root, ["diff", "-M", "--name-status", "--diff-filter=R", base, ...(head ? [head] : [])]).split("\n")) {
    const [, from, to] = line.split("\t");
    if (!to) continue;
    files.set(to, from);
    const a = posix.dirname(from), b = posix.dirname(to);
    if (a !== b && !dirs.has(b)) dirs.set(b, a);
  }
  return { files, dirs };
}

/** Local branches not merged into HEAD that moved in the last `days` days, each with the files it changes and the files HEAD changed since they parted. */
export function branchesOf(root, days) {
  const since = Date.now() / 1000 - days * 86400;
  const rows = git(root, ["for-each-ref", "--no-merged", "HEAD", "--format=%(refname:short)\t%(committerdate:unix)", "refs/heads"]).split("\n").filter(Boolean);
  return rows
    .map((row) => row.split("\t"))
    .filter(([, at]) => Number(at) >= since)
    .map(([name, at]) => {
      const fork = git(root, ["merge-base", "HEAD", name]).trim();
      const names = (range) => git(root, ["diff", "--name-only", range]).split("\n").filter(Boolean);
      const ahead = Number(git(root, ["rev-list", "--count", `HEAD..${name}`]).trim());
      return { name, at: Number(at), ahead, files: names(`${fork}..${name}`), headFiles: new Set(names(`${fork}..HEAD`)) };
    });
}
