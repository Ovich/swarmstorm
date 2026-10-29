// S25 (board-split T8): a merged event tells "you agreed on a file it changed" to the agreement's parties only. A seat's
// name outlives its run: an agreement made in an earlier run under the same name is that member's, not the new one's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stopServerOf } from "./fixtures/server.ts";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "cli", "index.ts");

test("S25: an agreement of an earlier run's member of the same name wakes no one at a merge", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-s25-"));
  const repo = path.join(home, "repo");
  fs.mkdirSync(repo);
  const env = { ...process.env, SWARM_ROOT: home, SWARMSTORM_HOME: home, SWARM_NO_POLLER: "1" };
  const git = (cwd: string, ...argv: string[]) => {
    const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...argv], { cwd, encoding: "utf8", env, windowsHide: true });
    assert.equal(r.status, 0, `git ${argv.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const must = (...argv: string[]) => {
    const r = spawnSync(process.execPath, [CLI, ...argv], { cwd: repo, encoding: "utf8", env, windowsHide: true });
    assert.equal(r.status, 0, `${argv.join(" ")}: ${r.stderr}${r.stdout}`);
    return r.stdout;
  };
  try {
    git(repo, "init", "-q", "-b", "main");
    fs.writeFileSync(path.join(repo, "a.ts"), "export const a = 1;\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "root");
    git(repo, "checkout", "-q", "--detach");
    const seats = path.join(home, "seats.json");
    fs.writeFileSync(seats, JSON.stringify([{ id: "w1", blockers: [] }, { id: "w3", blockers: [] }]));
    // run A: w1 and w3 agree on a.ts, then the run closes
    const runA = must("open", "--kind", "task", "--group", "g", "--title", "A", "--seats", seats, "--onto", "main").split("\n")[0].trim();
    must("join", "--run", runA, "--seat", "w1", "--doing", "x", "--as", "g/w1");
    must("join", "--run", runA, "--seat", "w3", "--doing", "x", "--as", "g/w3");
    must("agree", "w1 changes a.ts", "--about", "a.ts", "--with", "w3", "--as", "g/w1");
    must("deliver", "--as", "g/w1");
    must("deliver", "--as", "g/w3");
    must("end", "--as", "g/w1");
    must("end", "--as", "g/w3");
    must("close", "--run", runA, "--as", "g/orchestrator");
    // run B, same group: w3 is a new member of the same name; w1 merges a.ts
    const runB = must("open", "--kind", "task", "--group", "g", "--title", "B", "--seats", seats, "--onto", "main").split("\n")[0].trim();
    must("join", "--run", runB, "--seat", "w1", "--doing", "x", "--as", "g/w1");
    must("join", "--run", runB, "--seat", "w3", "--doing", "x", "--as", "g/w3");
    must("claim", "a.ts", "--as", "g/w1");
    must("merge-lock", "--onto", "main", "--as", "g/w1");
    const listed = git(repo, "worktree", "list", "--porcelain");
    const wt = listed.split("\n").find((l) => l.startsWith("worktree ") && l.replace(/\\/g, "/").endsWith(`/${runB}/w1`))!.slice("worktree ".length);
    fs.writeFileSync(path.join(wt, "a.ts"), "export const a = 2;\n");
    git(wt, "commit", "-q", "-am", "a");
    git(wt, "push", "-q", ".", "HEAD:main");
    must("merged", git(wt, "rev-parse", "HEAD"), "--files", "a.ts", "--report", "-", "--as", "g/w1");
    const heard = must("deliver", "--as", "g/w3");
    assert.match(heard, /merged \S+ into main/);
    assert.doesNotMatch(heard, /you agreed on a file it changed/);
  } finally {
    stopServerOf(home);
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
