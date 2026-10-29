// board-split T12 (D18, D20): a store from before the split opens and reads the same. A member's worktree column is the
// core's neutral `place` now, renamed in place; the code tables are created and kept up by the code pack, an old claims
// table keyed by path alone rebuilt as before (D40).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openBoard } from "../src/board/board.ts";

const REPO = "/repos/one/.git";
const WORKTREE = path.resolve("/repos/one/.git/swarm/worktrees/1/S1");

test("a store from before T12: the member's worktree reads as its place, its old claim as held, the snapshot as before", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-board-"));
  const file = path.join(dir, "old.sqlite");
  const old = new DatabaseSync(file);
  old.exec(`
    CREATE TABLE runs (id INTEGER PRIMARY KEY, repo TEXT NOT NULL, plan TEXT NOT NULL, title TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'open', opened_at TEXT NOT NULL, closed_at TEXT);
    CREATE TABLE seats (run INTEGER NOT NULL, id TEXT NOT NULL, blockers TEXT NOT NULL DEFAULT '[]', state TEXT NOT NULL DEFAULT 'ready', ord INTEGER NOT NULL, PRIMARY KEY (run, id));
    CREATE TABLE participants (id INTEGER PRIMARY KEY, run INTEGER NOT NULL, seat TEXT NOT NULL, worktree TEXT, doing TEXT NOT NULL DEFAULT '', files TEXT NOT NULL DEFAULT '[]', since_seq INTEGER NOT NULL DEFAULT 0, joined_at TEXT NOT NULL, ended_at TEXT, last_call TEXT, UNIQUE (run, seat));
    CREATE TABLE claims (repo TEXT NOT NULL, path TEXT NOT NULL PRIMARY KEY, participant INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'inside');
    INSERT INTO runs (id, repo, plan, title, opened_at) VALUES (1, '${REPO}', 'old-plan', 'Old', '2026-01-01T00:00:00.000Z');
    INSERT INTO seats (run, id, blockers, ord) VALUES (1, 'S1', '[]', 0);
    INSERT INTO participants (run, seat, joined_at) VALUES (1, 'orchestrator', '2026-01-01T00:00:00.000Z');
    INSERT INTO participants (run, seat, worktree, joined_at) VALUES (1, 'S1', '${WORKTREE.replace(/'/g, "''")}', '2026-01-01T00:00:00.000Z');
    INSERT INTO claims (repo, path, participant, kind) VALUES ('${REPO}', 'src/api.ts', 2, 'interface');
  `);
  old.close();

  const b = await openBoard(file);
  const s1 = b.participant("old-plan/S1")!;
  assert.equal(s1.place, WORKTREE);
  assert.equal(b.identify({ place: path.join(WORKTREE, "src") })?.name, "old-plan/S1");
  const entry = b.roster(REPO).find((r) => r.name === "old-plan/S1")!;
  assert.equal(entry.worktree, WORKTREE);
  assert.deepEqual(entry.held, [{ path: "src/api.ts", interface: true }]);
  const snap = b.snapshot(REPO);
  assert.deepEqual(snap.files, [{ path: "src/api.ts", holders: ["old-plan/S1"], interface: true }]);
  assert.deepEqual([snap.lock, snap.lockHistory, snap.flags], [null, [], []]);
  assert.deepEqual(snap.roster.find((m) => m.member === "old-plan/S1")?.files, [{ path: "src/api.ts", interface: true, shared: false }]);

  // the column was renamed, never copied: the store holds one place column and no worktree column
  const raw = new DatabaseSync(file, { readOnly: true });
  const cols = (raw.prepare("PRAGMA table_info(participants)").all() as { name: string }[]).map((c) => c.name);
  raw.close();
  assert.ok(cols.includes("place") && !cols.includes("worktree"), cols.join(","));
});
