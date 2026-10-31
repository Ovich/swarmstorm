// simple-states: a member owing nothing ends its turn; post --task to a member whose link is down says how it is reached.
import assert from "node:assert/strict";
import test from "node:test";
import { answer } from "../src/cli/answer/index.ts";
import { taskTargetLines } from "../src/cli/answer/rules.ts";
import type { Situation } from "../src/cli/answer/situation.ts";

const worker: Situation = {
  cli: "swarm", as: "g/w1", run: 1, seat: "w1", ended: false, parked: false, listenerRunning: true, listens: "background",
  wholeThread: false, closed: false, pause: null, phase: null, owed: null, phaseFirst: null, owesNothing: true,
};
const END_TURN = "you owe nothing now: end your turn with your report, without end; the orchestrator resumes you by message with the next task";

test("a post to the orchestrator that leaves the member owing nothing ends its turn; one still owing keeps its line", () => {
  assert.equal(answer({ verb: "heard", lines: ["#5"], toOrchestrator: true }, worker).next, END_TURN);
  assert.equal(answer({ verb: "heard", lines: ["#5"], toOrchestrator: true }, { ...worker, owesNothing: false }).next, null);
  assert.equal(answer({ verb: "heard", lines: ["#5"] }, worker).next, null, "a post to no orchestrator says nothing new");
});

test("post --task names how an away or a lost member is reached, nothing for one whose link is up", () => {
  assert.deepEqual(taskTargetLines([{ name: "g/w1", state: "away" }, { name: "g/w2", state: "lost" }, { name: "g/w3", state: "idle" }]), [
    "g/w1 is away: resume it by message so it reads this task",
    "g/w2 is lost: dispatch a fresh agent into its seat",
  ]);
});
