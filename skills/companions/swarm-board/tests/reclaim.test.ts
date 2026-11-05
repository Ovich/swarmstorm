// claims-phase (v1-2): a phase open drops the run's claims; the server tells each of the run's links, which sends its
// worktree's changes again at once, its set unchanged or not, so each member holds its files back within one look.
// Real server, real links, a real repository, under a temporary data home.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeRepo, type Repo } from "./fixtures/worktrees.ts";
import { openRawStore } from "./fixtures/raw-store.ts";
import { CHANGES_EVERY_MS } from "../src/link/link.ts";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "cli", "index.ts");

let repos: Repo[] = [];
let links: ChildProcess[] = [];
afterEach(() => {
  for (const l of links) if (l.exitCode === null) l.kill();
  links = [];
  for (const r of repos) r.cleanup();
  repos = [];
});

/** The paths `seat` of `group` holds as active claims now, read from the store the server writes. */
function activeClaims(r: Repo, group: string, seat: string): string[] {
  const db = openRawStore(r.store);
  try {
    const rows = db
      .prepare("SELECT c.path FROM claims c JOIN participants p ON p.id = c.participant JOIN runs u ON u.id = p.run WHERE u.plan = ? AND p.seat = ? AND c.state = 'active' ORDER BY c.path")
      .all(group, seat) as { path: string }[];
    return rows.map((x) => String(x.path));
  } finally {
    db.close();
  }
}

async function until(what: string, ok: () => boolean, ms: number): Promise<number> {
  const started = Date.now();
  while (!ok()) {
    if (Date.now() - started > ms) assert.fail(`${what}: not within ${ms} ms`);
    await new Promise((res) => setTimeout(res, 50));
  }
  return Date.now() - started;
}

test("v1-2: after a phase opens, both members' links re-send their unchanged sets and their claims come back within one look", async () => {
  const r = makeRepo("swarm-reclaim-");
  repos.push(r);
  const seats = path.join(r.home, "seats.json");
  fs.writeFileSync(seats, JSON.stringify(["w1", "w2"].map((id) => ({ id, blockers: [] }))));
  const run = r.cli(r.repo, "open", "--kind", "task", "--group", "rc", "--title", "T", "--seats", seats, "--onto", "main").split(/\r?\n/)[0].trim();
  const env = { ...process.env, SWARM_ROOT: r.home, SWARMSTORM_HOME: r.home, SWARM_NO_POLLER: "1" };
  for (const [seat, file] of [["w1", "src/a.ts"], ["w2", "src/c.ts"]] as const) {
    r.cli(r.repo, "join", "--run", run, "--seat", seat, "--doing", "x", "--as", `rc/${seat}`);
    const worktree = path.join(r.repo, ".git", "swarm", "worktrees", run, seat);
    fs.appendFileSync(path.join(worktree, file), "// changed\n");
    const link = spawn(process.execPath, [CLI, "link", "--run", run, "--as", `rc/${seat}`], { cwd: r.repo, env, stdio: "ignore" });
    links.push(link);
  }
  await until("w1 claims src/a.ts", () => activeClaims(r, "rc", "w1").join() === "src/a.ts", 15_000);
  await until("w2 claims src/c.ts", () => activeClaims(r, "rc", "w2").join() === "src/c.ts", 15_000);

  r.cli(r.repo, "phase", "build", "go", "--as", "rc/orchestrator");
  // the phase dropped them, and neither worktree's set changed: only the reclaim sends them again
  const took = await until("both claim again", () => activeClaims(r, "rc", "w1").join() === "src/a.ts" && activeClaims(r, "rc", "w2").join() === "src/c.ts", CHANGES_EVERY_MS);
  assert.ok(took <= CHANGES_EVERY_MS, `${took} ms`);
});
