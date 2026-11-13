// A claim is a path its member's worktree changes now, as its link last read it: made when the path enters the changes,
// gone when it leaves them, at its merge and at the member's end; a phase changes nothing. An overlap is posted once per
// pair and path. Who merged a file is read from the merged events, never from a claim kept past its work.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openBoard, type Board } from "../src/board/board.ts";
import { codeVerbs } from "../src/packs/code/calls.ts";
import { migrateCodeTables } from "../src/packs/code/schema.ts";

const REPO = "/repos/claims/.git";
const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const sha = (c: string): string => c.repeat(40);
let dir: string;
let board: Board;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-claims-"));
  board = await openBoard(path.join(dir, "swarm.sqlite"));
});
afterEach(() => {
  board.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const seated = () => {
  const run = board.openRun({ repo: REPO, kind: "task", group: "g", title: "T", seats: ["w1", "w2", "w3"].map((id) => ({ id, blockers: [] })) });
  const [w1, w2, w3] = ["w1", "w2", "w3"].map((seat) => board.join({ run: run.id, seat, doing: "x", files: [] }).member);
  return { run, w1, w2, w3, orchestrator: board.participant("g/orchestrator")!, code: codeVerbs(board) };
};
const fileOf = (rel: string) => board.snapshot(REPO).files.find((f) => f.path === rel);
const overlaps = () => board.snapshot(REPO).events.filter((e) => e.event === "flag");
const lastMerged = () => board.snapshot(REPO).events.filter((e) => e.event === "merged").at(-1)!;

test("a claim is what the worktree changes now: released when the path leaves the changes, at its merge, at the end; a phase changes nothing", () => {
  const { w1, w2, orchestrator, code } = seated();
  code.changes(w1, ["src/a.ts", "src/b.ts", "src/c.ts"]);
  code.changes(w1, ["src/a.ts", "src/c.ts"]);
  assert.deepEqual(board.heldBy(w1).sort(), ["src/a.ts", "src/c.ts"], "reverted: released");
  assert.equal(fileOf("src/b.ts"), undefined);
  board.phase(orchestrator, "verify", "walk it");
  assert.deepEqual(board.heldBy(w1).sort(), ["src/a.ts", "src/c.ts"], "a phase opening drops no claim");
  code.merged(w1, SHA, ["src/a.ts"]);
  assert.deepEqual(board.heldBy(w1), ["src/c.ts"], "merged: released, the rest stays");
  assert.equal(fileOf("src/a.ts"), undefined, "the page lists who changes a file now");
  code.changes(w2, ["src/d.ts"]);
  board.end(w2);
  assert.equal(fileOf("src/d.ts"), undefined, "ended: released");
  assert.deepEqual(board.heldBy(w2), []);
});

test("an overlap is posted once per pair and path, a path that left the changes and came back included; one who merged the path is no holder", () => {
  const { w1, w2, code } = seated();
  code.changes(w1, ["src/a.ts"]);
  code.changes(w2, ["src/a.ts"]);
  assert.equal(overlaps().length, 1);
  assert.deepEqual(fileOf("src/a.ts")?.holders, ["g/w1", "g/w2"]);
  // a stash, a revert: the path leaves w2's changes and comes back
  code.changes(w2, []);
  assert.deepEqual(fileOf("src/a.ts")?.holders, ["g/w1"]);
  code.changes(w2, ["src/a.ts"]);
  assert.equal(overlaps().length, 1, "not posted again");
  // w1 merges it: w2, who changes it, is told; then w1 holds it no more, and a third change of it overlaps w2 alone
  code.merged(w1, SHA, ["src/a.ts"]);
  assert.deepEqual(lastMerged().mentions ?? [], ["g/w2"]);
  assert.deepEqual(fileOf("src/a.ts")?.holders, ["g/w2"]);
  code.merged(w2, sha("b"), ["src/a.ts"]);
  assert.deepEqual(lastMerged().mentions ?? [], [], "w1 no longer changes it: not told");
  code.changes(w1, ["src/b.ts"]);
  code.changes(w2, ["src/b.ts"]);
  assert.equal(overlaps().length, 2, "another path, another overlap");
});

test("a merged event carries its files; a resolved conflict is told to who merged the file since the merger's branch last met the target, and to who changes it now", () => {
  const { w1, w2, w3, code } = seated();
  code.changes(w2, ["src/a.ts"]);
  assert.deepEqual(code.merged(w2, sha("b"), ["src/a.ts", "src/b.ts"]), []);
  assert.deepEqual((lastMerged().meta as { files?: string[] }).files, ["src/a.ts", "src/b.ts"]);
  // w1 delivers after it and resolved a conflict in a.ts: w2 merged it since w1 joined; w3 changes it now
  code.changes(w3, ["src/a.ts"]);
  code.changes(w1, ["src/a.ts", "src/c.ts"]);
  const told = code.merged(w1, SHA, ["src/a.ts", "src/c.ts"], { files: ["src/a.ts"] });
  assert.deepEqual(told.map((t) => [t.path, t.member]).sort(), [["src/a.ts", "g/w2"], ["src/a.ts", "g/w3"]]);
  assert.deepEqual((lastMerged().meta as { tell: string[] }).tell.sort(), ["g/w2", "g/w3"]);
  // w1 delivers again: w2's merge is in its branch since its last delivery, so only w3, who still changes the file
  code.changes(w1, ["src/a.ts"]);
  assert.deepEqual(code.merged(w1, sha("c"), ["src/a.ts"], { files: ["src/a.ts"] }).map((t) => t.member), ["g/w3"]);
  // conflicts unknown: every merged path is taken for one; w2 last met the target at its own merge, w1 merged a.ts since
  code.changes(w2, ["src/a.ts"]);
  assert.deepEqual(code.merged(w2, sha("d"), ["src/a.ts"]).map((t) => t.member).sort(), ["g/w1", "g/w3"]);
});

test("an older store opens: its claim log and drift notices go, and the claims kept past their work with the columns that marked them", () => {
  const db = new DatabaseSync(path.join(dir, "old.sqlite"));
  db.exec(`CREATE TABLE settings (name TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE participants (id INTEGER PRIMARY KEY, files TEXT);
    CREATE TABLE claims (repo TEXT NOT NULL, path TEXT NOT NULL, participant INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'inside', since_seq INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'active', sha TEXT, in_changes INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (repo, path, participant));
    CREATE TABLE claim_log (repo TEXT NOT NULL, path TEXT NOT NULL, participant INTEGER NOT NULL, PRIMARY KEY (repo, path, participant));
    CREATE INDEX claim_log_by_participant ON claim_log (participant);
    CREATE TABLE drift_notices (repo TEXT NOT NULL, path TEXT NOT NULL, participant INTEGER NOT NULL, PRIMARY KEY (repo, path, participant));
    INSERT INTO claims (repo, path, participant, state, sha, in_changes) VALUES
      ('r', 'now.ts', 1, 'active', NULL, 1), ('r', 'merged.ts', 1, 'merged', 'abc', 0), ('r', 'reverted.ts', 1, 'active', NULL, 0), ('r', 'again.ts', 1, 'active', 'abc', 1);`);
  migrateCodeTables(db);
  migrateCodeTables(db); // a second open finds nothing to do
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name IN ('claim_log', 'drift_notices')").get(), undefined);
  assert.deepEqual((db.prepare("SELECT path FROM claims ORDER BY path").all() as { path: string }[]).map((r) => r.path), ["again.ts", "now.ts"]);
  assert.deepEqual((db.prepare("PRAGMA table_info(claims)").all() as { name: string }[]).map((c) => c.name), ["repo", "path", "participant", "kind", "since_seq"]);
  db.close();
});
