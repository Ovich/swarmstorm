// D3 for P3 (board-rework#D3): the code verbs' answers pinned through one real code run, two workers and the
// orchestrator on a git repository, `--onto main`: what the code pack will own once it moves, pinned before it moves.
// S25 flipped in P3 (T8: an agreement wakes its own parties only, tests/s25-agreement-wake.test.ts); S28 flipped in T7 (merged releases the merged files' claims, tests/golden/claim-flow.test.ts). The D19 target (stats' per-kind figures read
// through the pack) changes no line here: only where the figures come from.
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
const GROUP = "g";
const ORCHESTRATOR = `${GROUP}/orchestrator`;
const W1 = `${GROUP}/w1`;
const W2 = `${GROUP}/w2`;
const W3 = `${GROUP}/w3`;

/** A commit's sha, full or short, moves with every run's timestamps. */
const withoutShas = (text: string): string => text.replace(/\b[0-9a-f]{7,40}\b/g, "<sha>");

test("golden code flow: two workers, one run onto main", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-golden-code-"));
  const repo = path.join(home, "repo");
  fs.mkdirSync(repo, { recursive: true });
  const env = { ...process.env, SWARM_ROOT: home, SWARMSTORM_HOME: home, SWARM_NO_POLLER: "1", SWARM_NO_TRANSCRIPT_MS: String(60 * 60 * 1000), GIT_EDITOR: "true" };
  const git = (cwd: string, ...argv: string[]) => {
    const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...argv], { cwd, encoding: "utf8", env });
    assert.equal(r.status, 0, `git ${argv.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  git(repo, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(repo, "a.ts"), "export const a = 1;\n");
  fs.writeFileSync(path.join(repo, "b.ts"), "export const b = 1;\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "root");
  // a branch checked out nowhere, so a worker's push lands on it
  git(repo, "checkout", "-q", "--detach");
  const nicks = new Map<string, string>();
  const raw = (argv: string[]) => spawnSync(process.execPath, [CLI, ...argv], { cwd: repo, encoding: "utf8", env });
  const call = (...argv: string[]): Answer => {
    const r = raw(argv);
    return { status: r.status, text: withoutShas(normalise(r.stdout + (r.stderr ? `--- stderr\n${r.stderr}` : ""), home, nicks)) };
  };
  const must = (...argv: string[]) => {
    const r = raw(argv);
    assert.equal(r.status, 0, `${argv.join(" ")}: ${r.stderr}${r.stdout}`);
    return r.stdout;
  };
  const learnNicks = () => {
    for (const r of (JSON.parse(must("roster", "--json")) as { roster: { nick: string; seat: string }[] }).roster) if (r.nick) nicks.set(r.nick, r.seat);
  };
  try {
    const seats = path.join(home, "seats.json");
    fs.writeFileSync(seats, JSON.stringify([{ id: "w1", blockers: [] }, { id: "w2", blockers: [] }, { id: "w3", blockers: [] }]));
    const runId = must("open", "--kind", "plan", "--group", GROUP, "--title", "T", "--seats", seats, "--onto", "main").split("\n")[0].trim();
    const joinW1 = raw(["join", "--run", runId, "--seat", "w1", "--doing", "x", "--files", "a.ts:interface,c.ts:inside", "--as", W1]);
    assert.equal(joinW1.status, 0, joinW1.stderr);
    must("join", "--run", runId, "--seat", "w2", "--doing", "x", "--as", W2);
    learnNicks();
    pin("code.join.files", { status: joinW1.status, text: withoutShas(normalise(joinW1.stdout, home, nicks)) });

    // the two settle a.ts between them (spec §7: their links would post the overlap; no link runs here)
    pin("code.agree", call("agree", "w1 changes a.ts first, w2 after", "--with", "w2", "--about", "a.ts", "--as", W1));

    const worktreeOf = (member: string): string => {
      const listed = git(repo, "worktree", "list", "--porcelain");
      const seat = member.split("/")[1];
      const line = listed.split("\n").find((l) => l.startsWith("worktree ") && l.replace(/\\/g, "/").endsWith(`/${seat}`));
      assert.ok(line, `${member}: no worktree in\n${listed}`);
      return line.slice("worktree ".length);
    };
    const wt1 = worktreeOf(W1);
    const wt2 = worktreeOf(W2);

    // the merge lock: free, then held (the wait line), then a real merge and its event
    pin("code.merge-lock.free", call("merge-lock", "--onto", "main", "--as", W1));
    pin("code.merge-lock.held", call("merge-lock", "--onto", "main", "--as", W2));
    fs.writeFileSync(path.join(wt1, "a.ts"), "export const a = 2;\n");
    git(wt1, "commit", "-q", "-am", "w1 a");
    git(wt1, "push", "-q", ".", "HEAD:main");
    const sha1 = git(wt1, "rev-parse", "HEAD");
    pin("code.merged", call("merged", sha1, "--files", "a.ts", "--report", "-", "--as", W1));
    // the merged event, as the orchestrator is given it; its wake lines name the file's holders and the agreement's own parties (S25)
    pin("code.merged.orchestrator", call("wait", "--mentions", "--timeout", "200", "--as", ORCHESTRATOR));

    // end: w1 merged and clean, its merged a.ts no longer held (S28, T7);
    // w2 with a commit not merged (the refusal)
    // end refuses while a mention is unread: each worker reads its own first
    must("wait", "--mentions", "--timeout", "200", "--as", W1);
    // D30, D38: a worker's own end is refused while the run is open; the orchestrator ends the seat
    pin("code.end.own-refused", call("end", "--as", W1));
    pin("code.end.claims-held", call("end", "--seat", "w1", "--as", ORCHESTRATOR));
    git(wt2, "rebase", "-q", "main");
    fs.writeFileSync(path.join(wt2, "b.ts"), "export const b = 2;\n");
    git(wt2, "commit", "-q", "-am", "w2 b");
    must("wait", "--mentions", "--timeout", "200", "--as", W2);
    pin("code.end.unmerged", call("end", "--seat", "w2", "--as", ORCHESTRATOR));
    must("merge-lock", "--onto", "main", "--as", W2);
    git(wt2, "push", "-q", ".", "HEAD:main");
    must("merged", git(wt2, "rev-parse", "HEAD"), "--files", "b.ts", "--report", "w2 changed b.ts", "--as", W2);
    // the report rides on the merge, the orchestrator's one wake
    pin("code.merged.report", call("wait", "--mentions", "--timeout", "200", "--as", ORCHESTRATOR));
    must("wait", "--mentions", "--timeout", "200", "--as", W2);
    pin("code.end.clean", call("end", "--seat", "w2", "--as", ORCHESTRATOR));

    // w3 leaves a commit not merged: close keeps its worktree and says why
    must("join", "--run", runId, "--seat", "w3", "--doing", "x", "--as", W3);
    learnNicks();
    const wt3 = worktreeOf(W3);
    fs.writeFileSync(path.join(wt3, "c.ts"), "export const c = 1;\n");
    git(wt3, "add", "c.ts");
    git(wt3, "commit", "-q", "-m", "w3 c");

    pin("code.close", call("close", "--run", runId, "--as", ORCHESTRATOR));
  } finally {
    stopServerOf(home);
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
