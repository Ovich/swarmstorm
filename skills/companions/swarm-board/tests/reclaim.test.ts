// claims-phase (v1-2): a phase open drops the run's claims; the server tells each of the run's links, which sends its
// worktree's changes again at once, its set unchanged or not, so each member holds its files back. A link's periodic
// look never re-sends an unchanged set, so only the reclaim can bring the claims back: the test waits on them, its
// ceiling a hang guard (v1-8), never a clock the reclaim must beat.
// Real server, real links, a real repository, under a temporary data home.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeRepo, type Repo } from "./fixtures/worktrees.ts";
import { endProcess } from "./fixtures/server.ts";
import { openRawStore } from "./fixtures/raw-store.ts";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "cli", "index.ts");

let repos: Repo[] = [];
let links: ChildProcess[] = [];
afterEach(() => {
  for (const l of links) if (l.exitCode === null) endProcess(l.pid);
  links = [];
  for (const r of repos) r.cleanup();
  repos = [];
});

/** The paths `seat` of `group` holds as active claims now, made at or after seq `since`, read from the store the server writes. */
function activeClaims(r: Repo, group: string, seat: string, since = 0): string[] {
  const db = openRawStore(r.store);
  try {
    const rows = db
      .prepare("SELECT c.path FROM claims c JOIN participants p ON p.id = c.participant JOIN runs u ON u.id = p.run WHERE u.plan = ? AND p.seat = ? AND c.state = 'active' AND c.since_seq >= ? ORDER BY c.path")
      .all(group, seat, since) as { path: string }[];
    return rows.map((x) => String(x.path));
  } finally {
    db.close();
  }
}

/** Waits for `ok`; `hangGuardMs` only ends a test that would otherwise hang. */
async function until(what: string, ok: () => boolean, hangGuardMs: number): Promise<void> {
  const started = Date.now();
  while (!ok()) {
    if (Date.now() - started > hangGuardMs) assert.fail(`${what}: not within ${hangGuardMs} ms`);
    await new Promise((res) => setTimeout(res, 50));
  }
}

const HANG_GUARD_MS = 60_000;

/** The seq of the phase event `group`'s run posted last. */
function phaseOpenedAt(r: Repo, group: string): number {
  const db = openRawStore(r.store);
  try {
    const row = db.prepare("SELECT MAX(m.seq) AS seq FROM messages m JOIN runs u ON u.id = m.run WHERE u.plan = ? AND m.event = 'phase'").get(group) as { seq: number | null };
    assert.ok(row.seq, "the phase event is posted");
    return Number(row.seq);
  } finally {
    db.close();
  }
}

test("v1-2: after a phase opens, both members' links re-send their unchanged sets and their claims come back", async () => {
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
  await until("w1 claims src/a.ts", () => activeClaims(r, "rc", "w1").join() === "src/a.ts", HANG_GUARD_MS);
  await until("w2 claims src/c.ts", () => activeClaims(r, "rc", "w2").join() === "src/c.ts", HANG_GUARD_MS);

  r.cli(r.repo, "phase", "--confirm", "build", "go", "--as", "rc/orchestrator");
  const phaseSeq = phaseOpenedAt(r, "rc");
  // the phase dropped them, and neither worktree's set changed: only the reclaim sends them again; a claim made at or
  // after the phase event is a new one, never the old one left standing
  await until("both claim again", () => activeClaims(r, "rc", "w1", phaseSeq).join() === "src/a.ts" && activeClaims(r, "rc", "w2", phaseSeq).join() === "src/c.ts", HANG_GUARD_MS);
});
