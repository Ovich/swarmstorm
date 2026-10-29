// The kinds of run (D25, D40): each a profile, plan by default.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard } from "../src/board/board.ts";
import { profileOf } from "../src/board/kinds.ts";

test("profileOf gives the plan and brainstorm profiles", () => {
  assert.deepEqual(profileOf("plan"), { kind: "plan", member: "worker", wholeThread: false, defaults: { member: [], orchestrator: [{ event: "ended", scope: "run" }, { event: "stalled", scope: "run" }, { event: "all-joined", scope: "run" }, ...["done", "joined", "idle"].map((event) => ({ event, scope: "run", carry: true }))] } });
  assert.deepEqual(profileOf("brainstorm"), { kind: "brainstorm", member: "seat", wholeThread: true, defaults: { member: [], orchestrator: [{ event: "agreement", scope: "run" }, { event: "endorsement", scope: "run" }, { event: "ended", scope: "run" }, { event: "stalled", scope: "run" }, { event: "all-joined", scope: "run" }, ...["done", "joined", "idle"].map((event) => ({ event, scope: "run", carry: true }))] } });
});

test("an unknown kind names the known ones", () => {
  assert.throws(() => profileOf("retro"), /unknown kind retro: the kinds are plan, brainstorm, task/);
  assert.throws(() => profileOf("toString"), /unknown kind toString/);
});

test("a run opened without a kind is a plan run; an unknown kind is refused", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-kinds-"));
  const board = await openBoard(path.join(dir, "swarm.sqlite"));
  try {
    const run = board.openRun({ repo: "/repos/one/.git", group: "g", title: "T", seats: [] });
    assert.equal(run.kind, "plan");
    assert.equal(run.group, "g");
    assert.throws(
      () => board.openRun({ repo: "/repos/one/.git", kind: "retro" as never, group: "h", title: "T", seats: [] }),
      /the kinds are plan, brainstorm, task/,
    );
    assert.equal(board.runs().length, 1);
  } finally {
    board.close();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
