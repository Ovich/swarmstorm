// The board's upkeep without a server (companions-merge D16): prune then flagStale, at most every
// five minutes, from any verb and from a pending wait; the last upkeep's time kept in the store.
import { test, beforeEach, afterEach } from "node:test";
import { stopServerOf } from "./fixtures/server.ts";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { openRawStore } from "./fixtures/raw-store.ts";
import { openBoard, UPKEEP_EVERY_MS } from "../src/board/board.ts";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "cli", "index.ts");
const REPO = "/repos/one/.git";
const SEATS = [{ id: "S1", blockers: [] }];
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

let dir: string;
let file: string;
let repo: string;

// SWARM_ROOT and SWARMSTORM_HOME both in the temp dir: nothing reaches the real data home
const env = () => ({ ...process.env, SWARM_ROOT: dir, SWARMSTORM_HOME: dir, SWARM_NO_POLLER: "1" });
const cli = (...argv: string[]) => spawnSync(process.execPath, [CLI, ...argv], { cwd: repo, encoding: "utf8", env: env() });
const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-upkeep-"));
  file = path.join(dir, "swarm.sqlite");
  repo = path.join(dir, "repo");
  fs.mkdirSync(repo);
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: repo }).status, 0);
});

afterEach(() => {
  stopServerOf(dir);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

/** The store opened raw: what the interface cannot do, dating rows in the past. */
const withRaw = <T>(fn: (raw: DatabaseSync) => T): T => {
  const raw = openRawStore(file);
  try {
    return fn(raw);
  } finally {
    raw.close();
  }
};
const lastUpkeepAgo = (ms: number): void => void
  withRaw((raw) => raw.prepare("UPDATE settings SET value = ? WHERE name = 'last-upkeep'").run(ago(ms)));
const silentFor = (run: number, ms: number): void => void
  withRaw((raw) => raw.prepare("UPDATE participants SET last_call = ?, joined_at = ? WHERE run = ?").run(ago(ms), ago(ms), run));
const events = async (event: string) => {
  const board = await openBoard(file);
  try {
    // every run here is of the one test repository, as the CLI names it
    return board.snapshot(board.runs()[0].repo).events.filter((e) => e.event === event);
  } finally {
    board.close();
  }
};
const openRunCli = (group: string): number => {
  const seats = path.join(dir, `${group}.seats.json`);
  fs.writeFileSync(seats, JSON.stringify([{ id: "S3", blockers: [] }]));
  const r = cli("open", "--plan", group, "--title", group, "--seats", seats);
  assert.equal(r.status, 0, r.stderr);
  return Number(r.stdout.split("\n")[0].trim());
};

test("upkeepIfDue runs when none ran", async () => {
  const board = await openBoard(file);
  try {
    const run = board.openRun({ repo: REPO, group: "old", title: "old", seats: SEATS });
    board.closeRun(run.id);
    withRaw((raw) => raw.prepare("UPDATE runs SET closed_at = ? WHERE id = ?").run(ago(40 * DAY), run.id));
    assert.equal(board.upkeepIfDue(), true);
    // prune ran: the run past the retention is stamped pruned
    assert.ok(withRaw((raw) => raw.prepare("SELECT pruned_at FROM runs WHERE id = ?").get(run.id) as { pruned_at: string | null }).pruned_at);
    // the time is the store's, for every process
    assert.ok(withRaw((raw) => raw.prepare("SELECT value FROM settings WHERE name = 'last-upkeep'").get()));
  } finally {
    board.close();
  }
});

test("upkeepIfDue skips within five minutes", async () => {
  const board = await openBoard(file);
  try {
    const t0 = new Date();
    assert.equal(board.upkeepIfDue(t0), true);
    assert.equal(board.upkeepIfDue(new Date(t0.getTime() + 4 * MINUTE)), false);
    // another process sees the same time
    const other = await openBoard(file);
    try {
      assert.equal(other.upkeepIfDue(new Date(t0.getTime() + UPKEEP_EVERY_MS - 1)), false);
    } finally {
      other.close();
    }
  } finally {
    board.close();
  }
});

test("upkeepIfDue runs again after five minutes", async () => {
  const board = await openBoard(file);
  try {
    const run = board.openRun({ repo: REPO, group: "hush", title: "hush", seats: SEATS });
    const t0 = new Date();
    assert.equal(board.upkeepIfDue(t0), true);
    assert.equal(board.upkeepIfDue(new Date(t0.getTime() + 11 * MINUTE)), true);
    assert.equal(board.upkeepIfDue(new Date(t0.getTime() + 12 * MINUTE)), false);
    void run;
  } finally {
    board.close();
  }
});

/** The events of `event` once the board server's upkeep, looked at every second, has had its turn (swarm-relay D13). */
const eventsAfterUpkeep = async (event: string) => {
  let found = await events(event);
  for (let i = 0; i < 40 && !found.length; i++) {
    await new Promise((r) => setTimeout(r, 150));
    found = await events(event);
  }
  return found;
};

test("an upkeep failure does not stop the verb", async () => {
  openRunCli("broken");
  // an unreadable retention: prune throws
  withRaw((raw) => raw.prepare("INSERT INTO settings (name, value) VALUES ('retention-days', 'bogus') ON CONFLICT (name) DO UPDATE SET value = excluded.value").run());
  lastUpkeepAgo(6 * MINUTE);
  const r = cli("status");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /broken/);
  // the server's failed upkeep, a tick later, stops neither it nor the next verb
  await new Promise((res) => setTimeout(res, 1500));
  const again = cli("status");
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /broken/);
});
