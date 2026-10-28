import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openBoard } from "../src/board/board.ts";

const REPO = "/repos/one/.git";

test("a store from before the seat vocabulary opens: slices become seats, participants.slice becomes seat, titles are dropped (D16)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-board-"));
  const file = path.join(dir, "old.sqlite");
  const old = new DatabaseSync(file);
  old.exec(`
    CREATE TABLE runs (id INTEGER PRIMARY KEY, repo TEXT NOT NULL, plan TEXT NOT NULL, title TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'open', opened_at TEXT NOT NULL, closed_at TEXT);
    CREATE TABLE slices (run INTEGER NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL, blockers TEXT NOT NULL DEFAULT '[]', state TEXT NOT NULL DEFAULT 'ready', ord INTEGER NOT NULL, PRIMARY KEY (run, id));
    CREATE TABLE participants (id INTEGER PRIMARY KEY, run INTEGER NOT NULL, slice TEXT NOT NULL, worktree TEXT, doing TEXT NOT NULL DEFAULT '', files TEXT NOT NULL DEFAULT '[]', since_seq INTEGER NOT NULL DEFAULT 0, joined_at TEXT NOT NULL, ended_at TEXT, last_call TEXT, UNIQUE (run, slice));
    INSERT INTO runs (id, repo, plan, title, opened_at) VALUES (1, '${REPO}', 'old-plan', 'Old', '2026-01-01T00:00:00.000Z');
    INSERT INTO slices (run, id, title, blockers, ord) VALUES (1, 'S1', 'the board', '[]', 0);
    INSERT INTO participants (run, slice, joined_at) VALUES (1, 'orchestrator', '2026-01-01T00:00:00.000Z');
    INSERT INTO participants (run, slice, joined_at) VALUES (1, 'S1', '2026-01-01T00:00:00.000Z');
  `);
  old.close();
  const b = await openBoard(file);
  const run = b.runs()[0];
  assert.deepEqual(run.seats.map((s) => [s.id, s.state]), [["S1", "ready"]]);
  assert.equal(b.participant("old-plan/S1")?.seat, "S1");
  const added = b.addSeat(run.id, { id: "S2", role: "worker", area: "the app", blockers: [] });
  assert.deepEqual([added.id, added.role, added.area], ["S2", "worker", "the app"]);
});
