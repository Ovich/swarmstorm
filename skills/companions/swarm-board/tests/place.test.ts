// D5 Place (repoOf, resolveIn, commonGitDir), G42 (a directory claim covers the files under it), V8 (a base only on
// origin), D6 (the legacy data-home root swept once).
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBoard, type Board } from "../src/board/board.ts";
import { commonGitDir, relativeIn, repoOf, resolveIn } from "../src/place/place.ts";
import { worktrees } from "../src/packs/code/worktrees.ts";
import { stopServerOf } from "./fixtures/server.ts";
import { codeVerbs } from "../src/packs/code/calls.ts";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "cli", "index.ts");
let dir: string;
beforeEach(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "swarm-place-")));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

const git = (cwd: string, ...argv: string[]): string => {
  const r = spawnSync("git", argv, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
const repoWithWorktree = () => {
  const main = path.join(dir, "main");
  fs.mkdirSync(path.join(main, "src"), { recursive: true });
  git(main, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(main, "src", "a.ts"), "x\n");
  git(main, "add", ".");
  git(main, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "root");
  const wt = path.join(dir, "wt");
  git(main, "worktree", "add", "-q", "-b", "w", wt);
  return { main, wt };
};

test("D5: a worktree and its main checkout are one repository, by repoOf and by commonGitDir alike", () => {
  const { main, wt } = repoWithWorktree();
  assert.equal(repoOf(wt), repoOf(main));
  assert.equal(path.resolve(commonGitDir(path.join(wt, ".git"))).toLowerCase(), path.resolve(repoOf(main)!).toLowerCase());
  assert.equal(repoOf(dir), null, "outside a repository");
});

test("D5, G19: resolveIn reads a member's path in its worktree first when the shell is elsewhere; missing names both, --new takes it", () => {
  const { main, wt } = repoWithWorktree();
  assert.equal(resolveIn(wt, "src/a.ts", { cwd: main }).abs, path.join(wt, "src", "a.ts"));
  const gone = resolveIn(wt, "src/none.ts", { cwd: wt });
  assert.equal(gone.missing.length, 1);
  assert.deepEqual(resolveIn(wt, "src/none.ts", { cwd: wt, create: true }).missing, []);
  assert.equal(relativeIn(wt, path.join(wt, "src", "a.ts")), "src/a.ts");
});

test("G42 (spec §7): a member holding a file under a directory: another's sibling sharing the prefix is not an overlap", async () => {
  const board: Board = await openBoard(path.join(dir, "swarm.sqlite"));
  try {
    const run = board.openRun({ repo: "/r/.git", kind: "task", group: "g", title: "T", seats: [{ id: "a", blockers: [] }, { id: "b", blockers: [] }] });
    const a = board.join({ run: run.id, seat: "a", doing: "x", files: [] }).member;
    const b = board.join({ run: run.id, seat: "b", doing: "x", files: [] }).member;
    codeVerbs(board).changes(a, ["src/dir/f.ts"]);
    assert.equal(codeVerbs(board).changes(b, ["src/dir/f.ts"]).length, 1, "the same file: an overlap");
    assert.equal(codeVerbs(board).changes(b, ["src/dirt.ts"]).length, 0, "a sibling sharing the prefix is no overlap");
  } finally {
    board.close();
  }
});

test("V8: a worktree branched from a base only on origin is clean and merged against that base", () => {
  const origin = path.join(dir, "origin");
  fs.mkdirSync(origin);
  git(origin, "init", "-q", "-b", "main");
  git(origin, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "root");
  git(origin, "branch", "feat");
  const clone = path.join(dir, "clone");
  git(dir, "clone", "-q", origin, clone);
  const wt = path.join(dir, "seat");
  git(clone, "worktree", "add", "-q", "-b", "seat", wt, "refs/remotes/origin/feat");
  assert.equal(worktrees(path.resolve(clone, ".git")).unmerged(wt, "feat"), null);
});

test("D6: the legacy data-home worktrees are swept once: a clean one removed, a dirty one kept and named, then never again", () => {
  const { main } = repoWithWorktree();
  const home = path.join(dir, "home");
  const legacy = path.join(home, "worktrees", "1");
  fs.mkdirSync(legacy, { recursive: true });
  git(main, "worktree", "add", "-q", "-b", "clean", path.join(legacy, "clean"));
  git(main, "worktree", "add", "-q", "-b", "dirty", path.join(legacy, "dirty"));
  fs.writeFileSync(path.join(legacy, "dirty", "new.txt"), "x");
  const env = { ...process.env, SWARMSTORM_HOME: home, SWARM_ROOT: home, SWARM_NO_POLLER: "1" };
  const first = spawnSync(process.execPath, [CLI, "status"], { cwd: main, encoding: "utf8", env });
  assert.match(first.stderr, /legacy worktree .*dirty: uncommitted changes, kept/);
  assert.ok(!fs.existsSync(path.join(legacy, "clean")));
  assert.ok(fs.existsSync(path.join(legacy, "dirty")));
  const again = spawnSync(process.execPath, [CLI, "status"], { cwd: main, encoding: "utf8", env });
  assert.doesNotMatch(again.stderr, /legacy worktree/);
  assert.ok(git(main, "branch", "--list", "clean"), "the branch is kept");
  stopServerOf(home);
});
