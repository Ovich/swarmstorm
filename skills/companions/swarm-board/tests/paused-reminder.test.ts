// A paused run is never forgotten: the orchestrator reads it first at every verb's answer until the resume.
import { test } from "node:test";
import assert from "node:assert/strict";
import { answer } from "../src/cli/answer/index.ts";
import type { Situation } from "../src/cli/answer/situation.ts";

const base: Situation = {
  cli: "swarm", as: "idea/orchestrator", run: 88, seat: "orchestrator", ended: false, listenerRunning: true,
  listens: "orchestrator", wholeThread: false, closed: false, parked: false, pause: null, phase: null, owed: null, phaseFirst: null,
};

test("an orchestrator posting in its paused run reads the pause first, with the resume command", () => {
  const a = answer({ verb: "heard", lines: ["#12"] }, { ...base, pause: { text: "T50 verdict", person: true } });
  assert.match(a.lines[0], /^run 88 is PAUSED: waiting on the person: T50 verdict: no member acts on this until you resume \(swarm resume "<message>" --as idea\/orchestrator\)$/);
  assert.equal(a.paused, a.lines[0]);
  assert.equal(a.lines[1], "#12");
});

test("no reminder when the run is not paused, nor for a member", () => {
  assert.equal(answer({ verb: "heard", lines: ["#12"] }, base).paused, undefined);
  const member = { ...base, seat: "w5", as: "idea/w5", listens: "background" as const, pause: { text: "", person: false } };
  assert.ok(!answer({ verb: "heard", lines: ["#12"] }, member).lines.some((l) => l.includes("PAUSED:") || l.includes("until you resume")));
});
