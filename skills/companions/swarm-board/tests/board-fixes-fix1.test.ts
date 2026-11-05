// board-fixes fix1: V1-1 (--after takes its value, never the body) and V1-3 (done names a task still open).
import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs } from "../src/cli/args.ts";
import { answer } from "../src/cli/answer/index.ts";
import type { Situation } from "../src/cli/answer/situation.ts";

test("V1-1: post --after w2 keeps w2 out of the body", () => {
  const a = parseArgs(["post", "--after", "w2", "@w1 task Z", "--as", "g/orchestrator"]);
  assert.deepEqual(a.positional, ["@w1 task Z"]);
  assert.deepEqual(a.flags("--after"), ["w2"]);
});

test("V1-3: a done that leaves the member's task open names it and how it closes", () => {
  const s: Situation = {
    cli: "swarm", as: "g/w2", run: 1, seat: "w2", ended: false, listenerRunning: true, listens: "background",
    wholeThread: false, closed: false, pause: null, phase: { name: "build", text: "x" }, owed: null, phaseFirst: null,
    owesNothing: false, openTask: 39,
  };
  const a = answer({ verb: "done", phase: "build", line: "done build: 1/2 done" }, s);
  assert.equal(a.next, "your task #39 is still open: finish it and report, then close it with your next done: swarm done build --as g/w2; a later task to you replaces it");
  assert.doesNotMatch(a.lines.join("\n"), /wait for the next phase/);
});
