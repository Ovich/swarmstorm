// The yardstick's fast core (run agent-ergonomics, F3): one scenario per class of miss, played only to its bound,
// asserting it is caught in time. It keeps detection on every `npm test`, the release's included; the full table,
// M1 and the false alerts are `npm run yardstick` (tests/yardstick.harness.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { SCENARIOS, STALL_S, play } from "./fixtures/yardstick.ts";

/** id, the bound in s from T0, the rule (or the event) that must tell it. */
const CORE: [string, number, string][] = [
  // board-split D55: lost LOST_MS after the link and the last sign went
  ["S5a", 61, "lost"],
  // simple-states: no member's tokens moved, told `stopped` once the stall window passed since the last move
  ["S4-owing", STALL_S + 61, "stopped"],
];

/** board-split D49: trouble comes from board facts alone. A turn ended, a background task gone silent or a dev server
 *  left running, owing no open phase, is no board fact: the board tells none of them, never from the transcript. */
const TRANSCRIPT_ONLY = ["S4", "S10", "S12", "A12a"];
for (const id of TRANSCRIPT_ONLY) {
  test(`yardstick core: ${id}, a transcript state owing no phase, draws no stalled (board-split D49)`, async () => {
    const sc = SCENARIOS.find((s) => s.id === id)!;
    const r = await play(sc, sc.stuckAt! + 62);
    assert.deepEqual(r.alerts.filter((a) => a.event === "stalled" || a.rule != null), [], `${id}: ${r.events}`);
  });
}

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

test("yardstick core: S14, a member with no transcript, wakes no one: its blindness is a card note, never an alarm (board-split D55)", async () => {
  const sc = SCENARIOS.find((s) => s.id === "S14")!;
  const r = await play(sc, 40);
  assert.equal(r.wakeAt.find((w) => w.events.some((e) => e === "stalled" || e === "lost")), undefined, r.events);
});
