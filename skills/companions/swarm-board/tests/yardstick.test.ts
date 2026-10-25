// The yardstick's fast core (run agent-ergonomics, F3): one scenario per class of miss, played only to its bound,
// asserting it is caught in time. It keeps detection on every `npm test`, the release's included; the full table,
// M1 and the false alerts are `npm run yardstick` (tests/yardstick.harness.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { SCENARIOS, play } from "./fixtures/yardstick.ts";

/** id, the bound in s from T0, the rule (or the event) that must tell it. */
const CORE: [string, number, string][] = [
  ["S4", 61, "ended"],
  ["S5a", 31, "gone"],
  ["S10", 61, "background"],
  ["S11-1a", 61, "owing"],
  ["S12", 61, "ended"],
  ["A12a", 61, "ended"],
];

for (const [id, bound, told] of CORE) {
  test(`yardstick core: ${id} is told within ${bound} s, ${told}`, async () => {
    const sc = SCENARIOS.find((s) => s.id === id)!;
    const r = await play(sc, sc.stuckAt! + bound + 1);
    assert.equal(r.missed, 0, `${id} caught (${r.events})`);
    assert.ok(r.detectS! <= bound, `${id}: ${r.detectS} s <= ${bound} s`);
    const first = r.alerts.find((a) => a.s - sc.stuckAt! === r.detectS)!;
    assert.equal(first.rule ?? first.event, told);
  });
}

test("yardstick core: S14, a member with no transcript, is named to the orchestrator within 31 s (its blindness, never silent)", async () => {
  const sc = SCENARIOS.find((s) => s.id === "S14")!;
  const r = await play(sc, 40);
  const named = r.wakeAt.find((w) => w.events.includes("liveness"));
  assert.ok(named && named.s <= 35, `liveness at ${named?.s} s (${r.events})`);
});
