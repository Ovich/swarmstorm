// D7: membership is one write. A join or re-join posts one event (G5), a re-join starts its liveness afresh (G18),
// all-joined is told only before the first phase (G13). G36: a seat's worktree is made on its own branch, never the base.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board, type Presence } from "../src/board/board.ts";
import { worktrees } from "../src/packs/code/worktrees.ts";
import type { MemberActivity } from "../src/wire.ts";

const REPO = "/repos/one/.git";
let dir: string;
let board: Board;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-membership-"));
  board = await openBoard(path.join(dir, "swarm.sqlite"));
});
afterEach(() => {
  board.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const act = (o: Partial<MemberActivity> = {}): MemberActivity => ({ grewAt: null, tokens: 0, context: null, openTool: null, lastTool: null, finished: false, ...o });
const events = (name: string) => board.snapshot(REPO).events.filter((e) => e.event === name);
const twoSeats = () => board.openRun({ repo: REPO, kind: "brainstorm", group: "idea", title: "I", seats: [{ id: "a", blockers: [] }, { id: "b", blockers: [] }] });

test("G18: a seat whose agent finished, told gone, re-joins: not gone, no link-lost line, one joined event and no recovered", () => {
  const run = twoSeats();
  const a = board.join({ run: run.id, seat: "a", doing: "x", files: [] }).member;
  board.join({ run: run.id, seat: "b", doing: "x", files: [] });
  const t = Date.now() + 60_000;
  const lost: Presence = () => ({ connected: false, lostAt: t - 120_000 });
  board.recordActivity(run.id, "a", act({ grewAt: t, finished: true }), new Date(t));
  board.livenessTick(run.id, new Date(t), lost);
  assert.equal(events("lost").length, 2, "both told lost");
  board.end(a);
  const joinedBefore = events("joined").length;
  board.join({ run: run.id, seat: "a", doing: "again", files: [] });
  // the server starts the re-joined seat's presence afresh (server.ts freshPresence): no link yet, never lost
  const fresh: Presence = (m) => (m === "a" ? { connected: false, lostAt: null } : { connected: false, lostAt: t - 120_000 });
  board.livenessTick(run.id, new Date(t + 1000), fresh);
  const st = board.memberStates(run.id, new Date(t + 1000)).find((s) => s.member === "a")!;
  assert.notEqual(st.badge?.name, "lost");
  assert.equal(events("joined").length, joinedBefore + 1, "one joined event per re-join");
  assert.equal(events("recovered").length, 0, "no recovered beside the joined event");
  assert.ok(!board.snapshot(REPO).events.some((e) => /idea\/a: link lost/.test(e.body)));
});

test("G13: the last seat joining after the first phase opened tells no all-joined; before it, once", () => {
  const late = twoSeats();
  board.join({ run: late.id, seat: "a", doing: "x", files: [] });
  board.phase(board.participant("idea/orchestrator")!, "verify", "check");
  board.join({ run: late.id, seat: "b", doing: "x", files: [] });
  assert.equal(events("all-joined").length, 0);
  const early = board.openRun({ repo: REPO, kind: "brainstorm", group: "other", title: "O", seats: [{ id: "a", blockers: [] }] });
  board.join({ run: early.id, seat: "a", doing: "x", files: [] });
  assert.equal(events("all-joined").length, 1);
});

test("G36: a base that exists only on origin: the seat's worktree is on its own branch, and no local base branch is made", () => {
  const git = (cwd: string, ...argv: string[]) => {
    const r = spawnSync("git", argv, { cwd, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  const origin = path.join(dir, "origin");
  fs.mkdirSync(origin);
  git(origin, "init", "-q", "-b", "main");
  git(origin, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "root");
  git(origin, "branch", "feat");
  const clone = path.join(dir, "clone");
  git(dir, "clone", "-q", origin, clone);
  const common = path.resolve(clone, git(clone, "rev-parse", "--git-common-dir"));
  const made = worktrees(common).forSeat(1, "g", "w1", "feat");
  assert.equal(git(made.path, "branch", "--show-current"), "swarm/1-g/w1");
  assert.equal(git(clone, "branch", "--list", "feat"), "", "the base stays origin's");
});
