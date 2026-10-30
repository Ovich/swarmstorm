// break-flow T67 (V-43): a parked member with work not merged runs done: told it is not counted, never told to
// merge-lock (refused while parked).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalise, pin } from "./golden.ts";
import { stopServerOf } from "../fixtures/server.ts";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "cli", "index.ts");

test("golden V-43: a parked member's done with work not merged names no merge step", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-golden-parked-"));
  const repo = path.join(home, "repo");
  fs.mkdirSync(repo, { recursive: true });
  const env = { ...process.env, SWARM_ROOT: home, SWARMSTORM_HOME: home, SWARM_NO_POLLER: "1", SWARM_NO_TRANSCRIPT_MS: String(60 * 60 * 1000), GIT_EDITOR: "true" };
  const git = (cwd: string, ...argv: string[]) => {
    const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...argv], { cwd, encoding: "utf8", env });
    assert.equal(r.status, 0, `git ${argv.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const raw = (argv: string[]) => spawnSync(process.execPath, [CLI, ...argv], { cwd: repo, encoding: "utf8", env });
  const must = (...argv: string[]) => {
    const r = raw(argv);
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
    fs.writeFileSync(seats, JSON.stringify([{ id: "w1", blockers: [] }]));
    const runId = must("open", "--kind", "task", "--group", "g", "--title", "T", "--seats", seats, "--onto", "main").split("\n")[0].trim();
    must("join", "--run", runId, "--seat", "w1", "--doing", "x", "--as", "g/w1");
    must("claim", "a.ts", "--as", "g/w1");
    const line = git(repo, "worktree", "list", "--porcelain").split("\n").find((l) => l.startsWith("worktree ") && l.replace(/\\/g, "/").endsWith("/w1"))!;
    const wt = line.slice("worktree ".length);
    fs.writeFileSync(path.join(wt, "a.ts"), "export const a = 2;\n");
    git(wt, "commit", "-q", "-am", "w1 a");
    must("phase", "build", "build it", "--as", "g/orchestrator");
    must("park", "w1", "--as", "g/orchestrator");
    const r = raw(["done", "build", "--as", "g/w1"]);
    const text = normalise(r.stdout + (r.stderr ? `--- stderr\n${r.stderr}` : ""), home, new Map()).replace(/\b[0-9a-f]{7,40}\b/g, "<sha>");
    pin("done.parked-unmerged", { status: r.status, text });
    assert.match(text, /you are parked: not counted until unparked/);
    assert.doesNotMatch(text, /merge-lock/);
  } finally {
    await stopServerOf(home);
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test("V-44: phase --for with no seat is refused", async () => {
  const { scene } = await import("./golden.ts");
  const s = await scene("orchestrator", "idle");
  try {
    const r = s.call("phase", "x", "do it", "--for", "", "--as", s.me);
    pin("phase.for-empty", r);
    assert.notEqual(r.status, 0);
    assert.match(r.text, /--for names no seat/);
  } finally {
    s.stop();
  }
});

test("V-43: a member's done never says every member is done while a lost member owes", async () => {
  const { WORDING } = await import("../../src/cli/answer/wording.ts");
  assert.doesNotMatch(WORDING.doneCounted("build", "1/1 done, 1 lost: w2", true, true), /every member is done/);
  assert.match(WORDING.doneCounted("build", "2/2 done", true, false), /every member is done/);
});
