// reflect-phase: a phase's kind is the word its name opens with; the phase verb's answer asks "closer or circling?"
// at every 3rd pass of one kind since the last reflect.
import { test } from "node:test";
import assert from "node:assert/strict";
import { circlingLine, phaseKind } from "../src/cli/answer/rules.ts";

test("phaseKind: the opening word, any word; none without a leading letter", () => {
  assert.deepEqual(["verify-38", "verify1", "Build-desk", "simplify", "t3-k7", "3rd"].map(phaseKind), ["verify", "verify", "build", "simplify", "t", null]);
});

test("circlingLine: every 3rd pass of a kind, titles shifting; a reflect resets the count and is never reminded", () => {
  const loop = ["build-1", "verify-1", "build-desk", "verify2"];
  assert.equal(circlingLine(loop.slice(0, 2), "build-2"), null);
  assert.match(circlingLine(loop, "verify-final")!, /verify pass 3.*reflect/);
  assert.equal(circlingLine([...loop, "verify-3", "build-x"], "verify-4"), null, "4th: quiet");
  assert.match(circlingLine(["round 1", "round 2"], "round 3")!, /round pass 3/, "any kind of swarm");
  assert.equal(circlingLine(["verify-1", "verify-2", "reflect"], "verify-3"), null, "counted since the last reflect");
  assert.equal(circlingLine(["reflect", "reflect-arch"], "reflect-2"), null);
});
