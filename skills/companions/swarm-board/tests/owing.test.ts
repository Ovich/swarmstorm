// board-split D62: owing.ts, the one count of who owes a phase (break-flow T54, V-11, U-F40).
import { test } from "node:test";
import assert from "node:assert/strict";
import { owesPhase, phaseCount, progressText, type PhaseMember, type PhaseScope } from "../src/board/owing.ts";

const member = (seat: string, o: Partial<PhaseMember> = {}): PhaseMember => ({ member: `g/${seat}`, seat, done: false, ended: false, idleEnded: false, lost: false, ...o });
const open: PhaseScope = { open: true, forSeats: null };

test("a lost member owing the phase is out of the count and named in every count line (D41, D62)", () => {
  const p = phaseCount("build", [member("w1", { done: true }), member("w2", { lost: true })], open);
  assert.deepEqual([p.done, p.of, p.gone], [1, 1, ["g/w2"]]);
  assert.equal(progressText(p), "1/1 done, 1 lost: w2");
});

test("--for: only its seats owe the open phase; an ended seat it names still owes", () => {
  const scope: PhaseScope = { open: true, forSeats: ["w1", "w2"] };
  const p = phaseCount("fix", [member("w1"), member("w2", { ended: true }), member("w3")], scope);
  assert.deepEqual([p.done, p.of, p.idleEnded], [0, 2, ["g/w2"]]);
  assert.equal(owesPhase(member("w3"), scope), false);
});

test("an ended member that never ran done owes nothing; an idle-ended one still owes", () => {
  const p = phaseCount("build", [member("w1", { ended: true }), member("w2", { ended: true, idleEnded: true })], open);
  assert.deepEqual([p.of, p.idleEnded], [1, ["g/w2"]]);
});

test("V-28: done from a seat outside --for is recorded and says the phase is for other seats", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { openBoard } = await import("../src/board/board.ts");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-owing-"));
  const board = await openBoard(path.join(dir, "swarm.sqlite"));
  try {
    const run = board.openRun({ repo: "/repos/one/.git", kind: "brainstorm", group: "g", title: "T", seats: ["w1", "w2"].map((id) => ({ id, title: id, blockers: [] })) });
    const w = Object.fromEntries(["w1", "w2"].map((id) => [id, board.join({ run: run.id, seat: id, doing: "x", files: [] }).member]));
    board.phase(board.participant("g/orchestrator")!, "build", "w1 only", { for: ["w1"] });
    const outside = board.done(w.w2, "build");
    assert.deepEqual(outside.notOwed, { forSeats: ["w1"] });
    assert.deepEqual([outside.progress.done, outside.progress.of], [0, 1]);
    assert.equal(board.done(w.w1, "build").notOwed, null);
  } finally {
    board.close();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test("V-27: the done event says the count and who still owes it together, the unmerged branch last", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { openBoard } = await import("../src/board/board.ts");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-owing-"));
  const board = await openBoard(path.join(dir, "swarm.sqlite"));
  try {
    const run = board.openRun({ repo: "/repos/one/.git", kind: "brainstorm", group: "g", title: "T", seats: ["w1", "w2", "v1"].map((id) => ({ id, title: id, blockers: [] })) });
    const w = Object.fromEntries(["w1", "w2", "v1"].map((id) => [id, board.join({ run: run.id, seat: id, doing: "x", files: [] }).member]));
    board.phase(board.participant("g/orchestrator")!, "build", "build it");
    board.done(w.w2, "build");
    const r = board.done(w.w1, "build", { unmerged: "swarm/1-g/w1" });
    assert.equal(r.message?.body, "done build (2/3): all but v1; unmerged swarm/1-g/w1");
  } finally {
    board.close();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
