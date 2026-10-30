// board-split D62: owing.ts, the one count of who owes a phase (break-flow T54, V-11, U-F40).
import { test } from "node:test";
import assert from "node:assert/strict";
import { owesPhase, phaseCount, progressText, type PhaseMember, type PhaseScope } from "../src/board/owing.ts";

const member = (seat: string, o: Partial<PhaseMember> = {}): PhaseMember => ({ member: `g/${seat}`, seat, done: false, ended: false, idleEnded: false, parked: false, lost: false, ...o });
const open: PhaseScope = { open: true, forSeats: null };

test("a parked member is out of the count, done or not (V-11)", () => {
  const p = phaseCount("build", [member("w1", { done: true }), member("w2", { done: true, parked: true }), member("w3", { parked: true })], open);
  assert.deepEqual([p.done, p.of], [1, 1]);
  assert.equal(owesPhase(member("w3", { parked: true }), open), false);
});

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
