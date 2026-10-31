// Test support for the merge cases: one real repository with two worktrees (a, b), the
// swarm CLI spawned on a temporary data home, and the git steps a merge goes through (a commit, a
// rebase onto main whose conflicts are resolved by writing the file). Never the person's store.
import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stopServerOf } from "./server.ts";
import { openRawStore } from "./raw-store.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, "..", "..", "src", "cli", "index.ts");
/** The `--require` preload answering `git version` as 2.30 (plan D41). */
export const OLD_GIT = path.join(HERE, "old-git.cjs");

/** Lines enough that an edit at the top and one at the bottom merge cleanly. */
export const LINES = ["export const one = 1;", "export const two = 2;", "export const three = 3;", "export const four = 4;", "export const five = 5;"];
const body = (lines: string[]): string => lines.map((l) => `${l}\n`).join("");

export type Repo = {
  home: string;
  repo: string;
  wtA: string;
  wtB: string;
  /** The CLI's answer, spawned in `cwd`; `oldGit`: with the old-git preload. */
  swarm: (cwd: string, argv: string[], opts?: { oldGit?: boolean }) => SpawnSyncReturns<string>;
  /** The CLI's stdout, its exit checked 0. */
  cli: (cwd: string, ...argv: string[]) => string;
  git: (cwd: string, ...argv: string[]) => string;
  /** Writes `file` in `cwd` and commits everything there; in `repo`, detached, the commit moves main. */
  commitFile: (cwd: string, file: string, lines: string[], msg?: string) => void;
  /** Rebases `cwd`'s branch onto main; a conflicted file is resolved to `resolved`'s lines, then the rebase goes on. */
  rebaseOntoMain: (cwd: string, resolved?: Record<string, string[]>) => { conflicted: string[] };
  /** The store the spawned CLI writes. */
  store: string;
  cleanup: () => void;
};

export function makeRepo(prefix = "swarm-merge-"): Repo {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const repo = path.join(home, "repo");
  const wtA = path.join(home, "wt-a");
  const wtB = path.join(home, "wt-b");
  // no stall poller: it would outlive the test (D27)
  const env = (): NodeJS.ProcessEnv => ({ ...process.env, SWARM_ROOT: home, SWARMSTORM_HOME: home, GIT_EDITOR: "true", SWARM_NO_POLLER: "1" });
  const git = (cwd: string, ...argv: string[]): string => {
    const r = spawnSync("git", argv, { cwd, encoding: "utf8", env: env() });
    assert.equal(r.status, 0, `git ${argv.join(" ")}: ${r.stderr}`);
    return r.stdout;
  };
  const swarm = (cwd: string, argv: string[], opts: { oldGit?: boolean } = {}) => {
    // `merged` names a commit already on main, as the worker's push makes it: the fixture lands it first
    const sha = argv[0] === "merged" ? argv.find((a) => /^[0-9a-f]{40}$/.test(a)) : undefined;
    if (sha && spawnSync("git", ["merge-base", "--is-ancestor", sha, "main"], { cwd: repo }).status !== 0) {
      git(repo, "merge", "-q", "--no-edit", sha);
      git(repo, "update-ref", "refs/heads/main", "HEAD");
    }
    return spawnSync(process.execPath, [...(opts.oldGit ? ["--require", OLD_GIT] : []), CLI, ...argv], { cwd, encoding: "utf8", env: env() });
  };
  const cli = (cwd: string, ...argv: string[]): string => {
    const r = swarm(cwd, argv);
    assert.equal(r.status, 0, `${argv.join(" ")}: ${r.stderr}`);
    return r.stdout;
  };
  const commitFile = (cwd: string, file: string, lines: string[], msg = file): void => {
    fs.writeFileSync(path.join(cwd, file), body(lines));
    git(cwd, "add", "-A");
    git(cwd, "commit", "-q", "-m", msg);
    // the repository's own folder is detached: its commit moves main
    if (cwd === repo) git(cwd, "update-ref", "refs/heads/main", "HEAD");
  };
  const rebaseOntoMain = (cwd: string, resolved: Record<string, string[]> = {}): { conflicted: string[] } => {
    const first = spawnSync("git", ["rebase", "main"], { cwd, encoding: "utf8", env: env() });
    if (first.status === 0) return { conflicted: [] };
    const conflicted = git(cwd, "diff", "--name-only", "--diff-filter=U").split(/\r?\n/).filter(Boolean);
    assert.ok(conflicted.length, `rebase failed without a conflict: ${first.stderr}`);
    for (const f of conflicted) {
      assert.ok(resolved[f], `no resolution given for ${f}`);
      fs.writeFileSync(path.join(cwd, f), body(resolved[f]));
    }
    git(cwd, "add", "-A");
    git(cwd, "rebase", "--continue");
    return { conflicted };
  };

  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  for (const f of ["a.ts", "old.ts", "c.ts"]) fs.writeFileSync(path.join(repo, "src", f), body(LINES));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "t");
  git(repo, "config", "user.email", "t@t");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "root");
  git(repo, "worktree", "add", "-q", "-b", "a", wtA);
  git(repo, "worktree", "add", "-q", "-b", "b", wtB);
  // main checked out nowhere, as a run's target must be: merge-lock refuses a target checked out in a worktree
  git(repo, "checkout", "-q", "--detach");

  const cleanup = (): void => {
    stopServerOf(home);
    for (let i = 0; ; i++) {
      try {
        fs.rmSync(home, { recursive: true, force: true });
        return;
      } catch {
        if (i >= 5) return console.warn(`cleanup: temp dir left behind: ${home}`);
        spawnSync(process.execPath, ["-e", "setTimeout(()=>{},200)"]);
      }
    }
  };
  return { home, repo, wtA, wtB, swarm, cli, git, commitFile, rebaseOntoMain, store: path.join(home, "swarm.sqlite"), cleanup };
}

const SLICES = JSON.stringify([
  { id: "S3", blockers: [] },
  { id: "S5", blockers: [] },
]);

/** A plan run `review-tool` with S3 joined in worktree a holding src/a.ts and S5 in worktree b; its id. */
export function openTwoRunners(r: Repo, plan = "review-tool", title = "T"): number {
  const slices = path.join(r.home, `slices-${plan}.json`);
  fs.writeFileSync(slices, SLICES);
  const id = Number(r.cli(r.repo, "open", "--plan", plan, "--title", title, "--seats", slices).split("\n")[0].trim());
  r.cli(r.wtA, "join", "--run", String(id), "--seat", "S3", "--doing", "the page", "--files", "src/a.ts:inside");
  r.cli(r.wtB, "join", "--run", String(id), "--seat", "S5", "--doing", "the skill");
  r.cli(r.wtA, "wait", "--mentions", "--timeout", "200");
  r.cli(r.wtB, "wait", "--mentions", "--timeout", "200");
  // spec §7: S3 holds src/a.ts as its link would set it from its worktree's changes; written after S3's link spoke,
  // so its first (empty) set does not undo it
  holdAs(r.store, plan, "S3", "src/a.ts");
  return id;
}

/** `seat` of `plan` holds `rel`, as a changes frame from its link would make it (a scene with no edit of its own). */
function holdAs(store: string, plan: string, seat: string, rel: string): void {
  const db = openRawStore(store);
  try {
    const p = db.prepare("SELECT p.id, r.repo FROM participants p JOIN runs r ON r.id = p.run WHERE r.plan = ? AND p.seat = ? AND p.ended_at IS NULL").get(plan, seat) as { id: number; repo: string };
    db.prepare("INSERT OR IGNORE INTO claims (repo, path, participant, kind, since_seq) VALUES (?, ?, ?, 'inside', 0)").run(p.repo, rel, p.id);
    db.prepare("INSERT OR IGNORE INTO claim_log (repo, path, participant, kind) VALUES (?, ?, ?, 'inside')").run(p.repo, rel, p.id);
  } finally {
    db.close();
  }
}

/** The tell lines `merged` prints, one per holder of a conflicted file (D5, D63). */
export const tellLines = (stdout: string): string[] => stdout.split(/\r?\n/).filter((l) => l.startsWith("if you resolved a conflict in "));
