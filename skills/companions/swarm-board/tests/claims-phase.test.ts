// claims-phase: a claim lasts its run's phase. Made at the member's first change of a path, it survives a merge (marked
// merged, with the sha), the member's end (read as ended) and the path leaving the worktree's changes; the next phase
// drops every claim of the run. Overlaps and merge mentions are between active holders; a member whose branch lacks a
// merge of a path it changes is told once per path and phase to rebase.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openBoard, type Board } from "../src/board/board.ts";
import { codeVerbs } from "../src/packs/code/calls.ts";
import { migrateCodeTables } from "../src/packs/code/schema.ts";

const REPO = "/repos/claims-phase/.git";
const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
let dir: string;
let board: Board;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-claims-phase-"));
  board = await openBoard(path.join(dir, "swarm.sqlite"));
});
afterEach(() => {
  board.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const seated = () => {
  const run = board.openRun({ repo: REPO, kind: "task", group: "g", title: "T", seats: ["w1", "w2"].map((id) => ({ id, blockers: [] })) });
  const [w1, w2] = ["w1", "w2"].map((seat) => board.join({ run: run.id, seat, doing: "x", files: [] }).member);
  return { run, w1, w2, orchestrator: board.participant("g/orchestrator")!, code: codeVerbs(board) };
};
const fileOf = (rel: string) => board.snapshot(REPO).files.find((f) => f.path === rel);
const drifts = () => board.snapshot(REPO).events.filter((e) => e.event === "drift");

test("a claim survives the path leaving the changes, a merge and an end; the next phase drops every claim of the run", () => {
  const { w1, w2, orchestrator, code } = seated();
  code.changes(w1, ["src/a.ts", "src/b.ts"]);
  code.changes(w1, ["src/a.ts"]);
  assert.deepEqual(board.heldBy(w1).sort(), ["src/a.ts", "src/b.ts"], "reverted: still held");
  code.merged(w1, SHA, ["src/a.ts"]);
  assert.deepEqual(fileOf("src/a.ts"), { path: "src/a.ts", holders: [], past: [{ member: "g/w1", state: "merged", sha: SHA }] }, "merged, with its sha");
  assert.deepEqual(board.heldBy(w1), ["src/b.ts"], "the roster holds the active claim only");
  code.changes(w2, ["src/c.ts"]);
  board.end(w2);
  assert.deepEqual(fileOf("src/c.ts"), { path: "src/c.ts", holders: [], past: [{ member: "g/w2", state: "ended", sha: null }] }, "ended, kept");
  board.phase(orchestrator, "verify", "walk it");
  assert.deepEqual(board.snapshot(REPO).files, [], "the phase drops them all");
  code.changes(w1, ["src/a.ts"]);
  assert.deepEqual(fileOf("src/a.ts")?.holders, ["g/w1"], "the link claims again from the worktree's changes");
});

test("a merged path changed again after it left the changes is active again, keeping its merge (v1-5); a frame read before the merge never reopens it", () => {
  const { w1, code } = seated();
  code.changes(w1, ["src/a.ts"]);
  code.merged(w1, SHA, ["src/a.ts"]);
  code.changes(w1, ["src/a.ts"]); // read before the merge, sent after
  assert.equal(fileOf("src/a.ts")?.past[0]?.state, "merged");
  code.changes(w1, []);
  code.changes(w1, ["src/a.ts"]);
  assert.deepEqual(fileOf("src/a.ts"), { path: "src/a.ts", holders: ["g/w1"], past: [{ member: "g/w1", state: "merged", sha: SHA }] });
});

test("overlap and merge mentions only between active holders; shared counts active holders", () => {
  const { w1, w2, code } = seated();
  const overlaps = () => board.snapshot(REPO).events.filter((e) => e.event === "flag");
  code.changes(w1, ["src/a.ts"]);
  code.merged(w1, SHA, ["src/a.ts"]);
  code.changes(w2, ["src/a.ts"]);
  assert.equal(overlaps().length, 0, "a merged holder is no overlap");
  assert.deepEqual(board.snapshot(REPO).roster.find((m) => m.member === "g/w2")?.files, [{ path: "src/a.ts", shared: false }]);
  code.changes(w1, ["src/b.ts"]);
  code.changes(w2, ["src/a.ts", "src/b.ts"]);
  assert.equal(overlaps().length, 1, "two active holders overlap");
  const merge = code.merged(w2, "b".repeat(40), ["src/a.ts"]);
  void merge;
  const event = board.snapshot(REPO).events.filter((e) => e.event === "merged").at(-1)!;
  assert.ok(!event.mentions?.includes("g/w1"), "w1's claim on a.ts is merged: not told");
});

test("the drift notice: once per member and path per phase, only for a path merged this phase, none when the branch has it", () => {
  const { w1, w2, orchestrator, code } = seated();
  code.changes(w1, ["src/a.ts"]);
  code.changes(w2, ["src/x.ts"]);
  code.changes(w2, ["src/x.ts"], [{ path: "src/x.ts", sha: "c".repeat(40) }]);
  assert.equal(drifts().length, 0, "x.ts was merged by no one this phase");
  // w2 holds no a.ts yet: the merge does not mention it (a member it mentions is told already, v1-6)
  code.merged(w1, SHA, ["src/a.ts"]);
  code.changes(w2, ["src/a.ts", "src/x.ts"]);
  assert.equal(drifts().length, 0, "the branch has the merge: no drift listed, no notice");
  code.changes(w2, ["src/a.ts", "src/x.ts"], [{ path: "src/a.ts", sha: SHA }]);
  code.changes(w2, ["src/a.ts", "src/x.ts"], [{ path: "src/a.ts", sha: SHA }]);
  assert.equal(drifts().length, 1, "once");
  const notice = drifts()[0];
  assert.deepEqual(notice.mentions, ["g/w2"], "the merger is not told");
  assert.equal(notice.about, "src/a.ts");
  assert.match(notice.body, /src\/a\.ts was merged by g\/w1 \(a1b2c3d\) and is not in your branch: rebase now/);
  board.phase(orchestrator, "fix", "the findings");
  code.changes(w1, ["src/a.ts"]);
  code.merged(w1, SHA, ["src/a.ts"]);
  code.changes(w2, ["src/a.ts"], [{ path: "src/a.ts", sha: SHA }]);
  assert.equal(drifts().length, 2, "a new phase tells again");
});

test("v1-6: a member the merge's event mentioned gets no drift notice for its files", () => {
  const { w1, w2, code } = seated();
  code.changes(w1, ["src/a.ts"]);
  code.changes(w2, ["src/a.ts"]);
  code.merged(w1, SHA, ["src/a.ts"]);
  assert.ok(board.snapshot(REPO).events.filter((e) => e.event === "merged").at(-1)!.mentions?.includes("g/w2"));
  code.changes(w2, ["src/a.ts"], [{ path: "src/a.ts", sha: SHA }]);
  assert.equal(drifts().length, 0);
});

test("an older store with a claim log opens: the log goes, the claims gain their state", () => {
  const db = new DatabaseSync(path.join(dir, "old.sqlite"));
  db.exec(`CREATE TABLE settings (name TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE participants (id INTEGER PRIMARY KEY, files TEXT);
    CREATE TABLE claims (repo TEXT NOT NULL, path TEXT NOT NULL, participant INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'inside', since_seq INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (repo, path, participant));
    CREATE TABLE claim_log (repo TEXT NOT NULL, path TEXT NOT NULL, participant INTEGER NOT NULL, PRIMARY KEY (repo, path, participant));
    CREATE INDEX claim_log_by_participant ON claim_log (participant);
    INSERT INTO claims (repo, path, participant) VALUES ('r', 'a.ts', 1);`);
  migrateCodeTables(db);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'claim_log'").get(), undefined);
  assert.deepEqual({ ...(db.prepare("SELECT state, sha, in_changes FROM claims").get() as object) }, { state: "active", sha: null, in_changes: 1 });
  db.close();
});
