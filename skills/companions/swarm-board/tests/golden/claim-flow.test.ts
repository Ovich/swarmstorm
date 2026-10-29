// board-split T7 (D11, D19, S28): the claim flow as the code pack runs it. A worker's join names its worktree and
// makes none; its first claim makes it; `merged` leaves no claim on the merged files; a git failure making the
// worktree refuses the claim and writes nothing; a verifier seat gets no worktree and is refused a claim.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalise, pin, type Answer } from "./golden.ts";
import { stopServerOf } from "../fixtures/server.ts";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "cli", "index.ts");
const W1 = "g/w1";
const W2 = "g/w2";
const V1 = "g/v1";

test("golden claim flow: worktree at first claim, merged releases, git failure writes nothing, verifier refused", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-golden-claim-"));
  const repo = path.join(home, "repo");
  fs.mkdirSync(repo, { recursive: true });
  const env = { ...process.env, SWARM_ROOT: home, SWARMSTORM_HOME: home, SWARM_NO_POLLER: "1" };
  const git = (cwd: string, ...argv: string[]) => {
    const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...argv], { cwd, encoding: "utf8", env });
    assert.equal(r.status, 0, `git ${argv.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  git(repo, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(repo, "a.ts"), "export const a = 1;\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "root");
  git(repo, "checkout", "-q", "--detach");
  const nicks = new Map<string, string>();
  const raw = (argv: string[]) => spawnSync(process.execPath, [CLI, ...argv], { cwd: repo, encoding: "utf8", env });
  const call = (...argv: string[]): Answer => {
    const r = raw(argv);
    return { status: r.status, text: normalise(r.stdout + (r.stderr ? `--- stderr\n${r.stderr}` : ""), home, nicks) };
  };
  const must = (...argv: string[]) => {
    const r = raw(argv);
    assert.equal(r.status, 0, `${argv.join(" ")}: ${r.stderr}${r.stdout}`);
    return r.stdout;
  };
  const held = (member: string): string[] =>
    (JSON.parse(must("roster", "--json")) as { roster: { name: string; held: { path: string }[] }[] }).roster.find((r) => r.name === member)?.held.map((h) => h.path) ?? [];
  try {
    const seats = path.join(home, "seats.json");
    fs.writeFileSync(seats, JSON.stringify([{ id: "w1", blockers: [] }, { id: "w2", blockers: [] }, { id: "v1", role: "verifier", blockers: [], busyMax: 300000 }]));
    const runId = must("open", "--kind", "task", "--group", "g", "--title", "T", "--seats", seats, "--onto", "main").split("\n")[0].trim();
    const wtOf = (seat: string) => path.join(repo, ".git", "swarm", "worktrees", runId, seat);

    // the worker's join names its worktree and makes none
    const joined = raw(["join", "--run", runId, "--seat", "w1", "--doing", "x", "--as", W1]);
    assert.equal(joined.status, 0, joined.stderr);
    for (const r of (JSON.parse(must("roster", "--json")) as { roster: { nick: string; seat: string }[] }).roster) if (r.nick) nicks.set(r.nick, r.seat);
    assert.match(joined.stdout, /your worktree: .*made at your first claim or merge-lock/);
    assert.equal(fs.existsSync(wtOf("w1")), false, "join made the worktree");
    // its first claim makes it
    pin("claim-flow.claim.first", call("claim", "a.ts", "--as", W1));
    assert.equal(fs.existsSync(path.join(wtOf("w1"), "a.ts")), true, "the first claim made no worktree");

    // merged leaves no claim on the merged files (S28)
    must("merge-lock", "--onto", "main", "--as", W1);
    fs.writeFileSync(path.join(wtOf("w1"), "a.ts"), "export const a = 2;\n");
    git(wtOf("w1"), "commit", "-q", "-am", "w1 a");
    git(wtOf("w1"), "push", "-q", ".", "HEAD:main");
    must("merged", git(wtOf("w1"), "rev-parse", "HEAD"), "--files", "a.ts", "--report", "-", "--as", W1);
    assert.deepEqual(held(W1), [], "merged left a claim on a.ts");

    // a git failure making the worktree refuses the claim and writes nothing (D19)
    must("join", "--run", runId, "--seat", "w2", "--doing", "x", "--as", W2);
    // a branch under the seat's branch name: git cannot create the seat's branch beside it
    git(repo, "branch", `swarm/${runId}-g/w2/in-the-way`);
    const refused = raw(["claim", "a.ts", "--as", W2]);
    assert.notEqual(refused.status, 0, "a claim whose worktree git could not make went on");
    assert.match(refused.stderr, /worktree: git worktree add .* failed/);
    assert.equal(fs.existsSync(path.join(wtOf("w2"), "a.ts")), false);
    assert.deepEqual(held(W2), [], "the refused claim wrote a claim");

    // a verifier joins with no worktree and is refused a claim
    const verifier = raw(["join", "--run", runId, "--seat", "v1", "--doing", "x", "--as", V1]);
    assert.equal(verifier.status, 0, verifier.stderr);
    assert.doesNotMatch(verifier.stdout, /your worktree/);
    for (const r of (JSON.parse(must("roster", "--json")) as { roster: { nick: string; seat: string }[] }).roster) if (r.nick) nicks.set(r.nick, r.seat);
    pin("claim-flow.verifier.claim", call("claim", "a.ts", "--as", V1));
    assert.equal(fs.existsSync(wtOf("v1")), false, "the verifier got a worktree");
    assert.deepEqual(held(V1), []);
  } finally {
    stopServerOf(home);
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
