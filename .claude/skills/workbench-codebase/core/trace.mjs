// The only data the bench keeps: one append-only file per run, `traces/<run>.jsonl`, each line a call
// the CLI served (what was asked and the answer as returned). A run is found without the caller's
// help: the harness's session id when the environment has one, else the last run of this repository
// if its last call is less than IDLE_MS old, else a new one.
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const IDLE_MS = 30 * 60 * 1000;
const SESSION_VARS = ["CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID", "CODEX_SESSION_ID", "CURSOR_SESSION_ID", "AGENT_SESSION_ID"];

/** One repository however it is checked out: its worktrees share the git folder, so they share the traces. */
const repoIdOf = (root) => {
  try {
    return execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { windowsHide: true, cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().toLowerCase();
  } catch {
    return root;
  }
};
// biome-ignore lint/style/noProcessEnv: where the traces live is read from the caller's environment by design
const tracesDir = (root) => join(process.env.CODEBASE_BENCH_HOME ?? join(homedir(), ".codebase-bench"), createHash("sha256").update(repoIdOf(root)).digest("hex").slice(0, 10), "traces");

/** One run per agent and per checkout: the harness's session id and the checkout's path together, so a worker in its own worktree is its own run. */
function runOf(dir, root) {
  const where = createHash("sha256").update(root.toLowerCase()).digest("hex").slice(0, 6);
  // biome-ignore lint/style/noProcessEnv: the harness's session id names the run
  const session = SESSION_VARS.map((name) => process.env[name]).find(Boolean);
  if (session) return { id: `s-${session.slice(0, 12)}-${where}`, session };
  const recent = existsSync(dir) ? readdirSync(dir).map((f) => ({ f, at: statSync(join(dir, f)).mtimeMs })).filter((r) => r.f.startsWith("p-") && r.f.includes(`-${where}-`) && Date.now() - r.at < IDLE_MS).sort((a, b) => b.at - a.at)[0] : null;
  return { id: recent ? recent.f.replace(/\.jsonl$/, "") : `p-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}-${where}-${randomUUID().slice(0, 4)}`, session: null };
}

/** Appends one call to the current run; the first call of a run writes its head line. */
export function record(root, step) {
  const dir = tracesDir(root);
  mkdirSync(dir, { recursive: true });
  const run = runOf(dir, root);
  const file = join(dir, `${run.id}.jsonl`);
  if (!existsSync(file)) appendFileSync(file, `${JSON.stringify({ run: run.id, session: run.session, pid: process.ppid, repo: root, startedAt: new Date().toISOString() })}\n`);
  appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...step })}\n`);
}

/** The runs, newest first: `{ id, startedAt, lastAt, steps, session }`. */
export function runsOf(root) {
  const dir = tracesDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => {
    const lines = readFileSync(join(dir, f), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const head = lines[0];
    return { id: head.run, session: head.session, repo: head.repo, startedAt: head.startedAt, lastAt: lines.at(-1).at ?? head.startedAt, steps: lines.length - 1 };
  }).sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
}

/** One run's steps. */
export const stepsOf = (root, id) => {
  const file = join(tracesDir(root), `${id.replace(/[^\w-]/g, "")}.jsonl`);
  return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").slice(1).map((l) => JSON.parse(l)) : [];
};
