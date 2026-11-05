// board-fixes#D2, D6: the foreground wait's bound and the first close's answer, pure over the situation.
import assert from "node:assert/strict";
import test from "node:test";
import { closeStep, foregroundBound } from "../src/cli/answer/rules.ts";
import type { Situation } from "../src/cli/answer/situation.ts";
import { FOREGROUND_WAIT_MS } from "../src/board/events.ts";

const worker: Situation = {
  cli: "swarm", as: "g/w1", run: 1, seat: "w1", ended: false, listenerRunning: false, listens: "background",
  wholeThread: false, closed: false, pause: null, phase: null, owed: null, phaseFirst: null, owesNothing: true,
};

test("D2: 150 s; a seat in the foreground and a member owing nothing are bounded; a working worker and the orchestrator are not", () => {
  assert.equal(FOREGROUND_WAIT_MS, 150_000);
  assert.equal(foregroundBound(worker), true);
  assert.equal(foregroundBound({ ...worker, owesNothing: false }), false);
  assert.equal(foregroundBound({ ...worker, owesNothing: false, listens: "foreground", seat: "skeptic" }), true);
  assert.equal(foregroundBound({ ...worker, seat: "orchestrator", listens: "orchestrator" }), false);
});

test("D6: the first close names who owes, else the closing steps ending on the confirm", () => {
  assert.match(closeStep(["g/w1", "g/w2"], 4, "swarm close --run 4 --confirm --as g/orchestrator", true), /owing work: g\/w1, g\/w2\. Post no new task/);
  const steps = closeStep([], 4, "swarm close --run 4 --confirm --as g/orchestrator", true);
  assert.match(steps, /\| task \| seat \| state \| merge sha \|/);
  assert.match(closeStep([], 4, "c", false), /\| task \| seat \| state \| result \|/);
  assert.ok(steps.endsWith("swarm close --run 4 --confirm --as g/orchestrator"));
});
