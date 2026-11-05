// simple-states: a member owing nothing ends its turn; a post to a member whose link is down says how it is reached.
import assert from "node:assert/strict";
import test from "node:test";
import { answer } from "../src/cli/answer/index.ts";
import { mentionReaches, unreachedMentionLines } from "../src/cli/answer/rules.ts";
import type { Situation } from "../src/cli/answer/situation.ts";

const worker: Situation = {
  cli: "swarm", as: "g/w1", run: 1, seat: "w1", ended: false, listenerRunning: true, listens: "background",
  wholeThread: false, closed: false, pause: null, phase: null, owed: null, phaseFirst: null, owesNothing: true,
};
const END_TURN = "you owe nothing now: end your turn with your report, without end; the orchestrator resumes you by message with the next task";

test("board-fixes#D3: owing nothing, a post gives no step (never the listener line); done ends the turn", () => {
  assert.deepEqual(answer({ verb: "heard", lines: ["#5"] }, worker).lines, ["#5"]);
  assert.deepEqual(answer({ verb: "heard", lines: ["#5"] }, { ...worker, listenerRunning: false }).lines, ["#5"], "no listener line");
  assert.match(answer({ verb: "heard", lines: ["#5"] }, { ...worker, listenerRunning: false, owesNothing: false }).next ?? "", /^start your listener now/, "owing: its listener");
  assert.equal(answer({ verb: "done", phase: "build", line: "done build: 1/1 done" }, worker).next, END_TURN);
});

test("an idle wait ends the turn of a member owing nothing; one owing waits again", () => {
  const empty = { verb: "wait", outcome: "empty", idle: true, again: "swarm wait --mentions --as g/w1", foregroundAgain: "swarm wait --mentions --as g/w1 --timeout 150000" } as const;
  assert.equal(answer(empty, worker).next, END_TURN);
  assert.match(answer(empty, { ...worker, owesNothing: false }).next ?? "", /^nothing for you now; .*wait again/);
});

test("a post names how an away or a lost member is reached, nothing for one whose link is up", () => {
  assert.deepEqual(unreachedMentionLines([{ name: "g/w1", state: "away" }, { name: "g/w2", state: "lost" }, { name: "g/w3", state: "idle" }]), [
    "g/w1 is away: resume it by message so it reads this post",
    "g/w2 is lost: dispatch a fresh agent into its seat",
  ]);
});

test("a group mention (@swarm, stored as <group>/*) reaches every member of the group, so each away one is named", () => {
  assert.equal(mentionReaches(["g/*"], "g/w1"), true);
  assert.equal(mentionReaches(["g/w2"], "g/w1"), false);
  assert.equal(mentionReaches(["h/*"], "g/w1"), false, "another group's mention does not reach it");
});
