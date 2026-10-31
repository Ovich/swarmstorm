// The yardstick, full: every scenario of tests/fixtures/yardstick.ts played to its end against the board's own code (a
// simulated clock, synthetic transcripts; no agent, no tokens), the M1-M4 table printed and held, and the simple
// board's acceptance rows. About 2 min of CPU, so not in `npm test`'s glob: `npm run yardstick`. Its fast core
// (detection only) is tests/yardstick.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { locate } from "../src/link/transcripts.ts";
import { toolCall, writeSubagent } from "./fixtures/transcripts.ts";
import { PROJECT, SCENARIOS, SESSION, STALL_S, iso, play, type Row } from "./fixtures/yardstick.ts";

/** The numbers under the simple board (2026-10-31): two notifications, `stopped` (no member's tokens moved for the
 *  run's window, 10 min) and `lost` (a link down while owing). id, wakes, no-action, wakes per member-hour, M2, M2b s,
 *  M3 s, M4, rule (none: the notifications carry no rule). Known on purpose: S1, S9 (one 20-min call writing nothing)
 *  and S6 (an idle swarm) wake as stopped; S11-1a, S11-1b, S11-2, C6 (an owing member re-arming its wait, its tokens
 *  moving) are missed: the wait's own answer tells it its part. */
const EXPECTED: [string, number, number, number, number, number, number | null, number, string | null][] = [
  ["S1", 1, 1, 2.4, 1, 0, null, 0, null],
  ["S2", 0, 0, 0, 0, 0, null, 0, null],
  ["A1b", 1, 0, 1.7, 0, 0, 600, 0, null],
  ["S2b", 0, 0, 0, 0, 0, null, 0, null],
  ["S3a-120", 1, 0, 1.7, 0, 0, 720, 0, null],
  ["S3a-600", 1, 0, 1.7, 0, 0, 1200, 0, null],
  ["S3a-old", 1, 0, 1.7, 0, 0, 1200, 0, null],
  ["E1", 1, 0, 1.7, 0, 0, 600, 0, null],
  ["E1b-install", 0, 0, 0, 0, 0, null, 0, null],
  ["E1b-until", 0, 0, 0, 0, 0, null, 0, null],
  ["S3b", 1, 0, 1.7, 0, 0, 600, 0, null],
  ["S4", 1, 0, 1.7, 0, 0, 600, 0, null],
  ["S4-owing", 1, 0, 1.7, 0, 0, 600, 0, null],
  ["S5a", 2, 0, 3.4, 0, 0, 61, 0, null],
  ["A8", 1, 0, 6, 0, 0, 61, 0, null],
  ["S5b", 1, 0, 1.7, 0, 0, 600, 0, null],
  ["A13", 1, 0, 1.7, 0, 0, 600, 0, null],
  ["S5c", 1, 0, 1.7, 0, 0, 600, 0, null],
  ["S5d", 1, 0, 1.7, 0, 0, 600, 0, null],
  ["S6", 1, 1, 2.7, 1, 0, null, 0, null],
  ["S7", 0, 0, 0, 0, 0, null, 0, null],
  ["S8", 0, 0, 0, 0, 0, null, 0, null],
  ["A4b", 1, 0, 1.7, 0, 0, 600, 0, null],
  ["S9", 1, 1, 2.4, 1, 0, null, 0, null],
  ["S10", 1, 0, 1.7, 0, 0, 507, 0, null],
  ["S11-1a", 0, 0, 0, 0, 0, null, 1, null],
  ["S11-1b", 0, 0, 0, 0, 0, null, 1, null],
  ["S11-guard", 1, 0, 3, 0, 0, 940, 0, null],
  ["C6", 0, 0, 0, 0, 0, null, 1, null],
  ["S11-2", 0, 0, 0, 0, 0, null, 1, null],
  ["S11-3", 0, 0, 0, 0, 0, null, 0, null],
  ["S12", 1, 0, 1.7, 0, 0, 600, 0, null],
  ["A3b", 1, 0, 1.7, 0, 0, 600, 0, null],
  ["S13", 0, 0, 0, 0, 0, null, 0, null],
  ["A7b", 1, 1, 6, 1, 29, null, 0, null],
  ["A12a", 1, 0, 1.7, 0, 0, 600, 0, null],
  ["A12b", 1, 0, 1.7, 0, 0, 600, 0, null],
  ["S14", 1, 0, 1.7, 0, 0, 600, 0, null],
];

let rows: Row[] = [];
const rowOf = (rid: string) => rows.find((r) => r.id === rid)!;

test("the yardstick: M1-M4 per scenario", async () => {
  rows = [];
  for (const sc of SCENARIOS) rows.push(await play(sc));
  const head = "| id | wakes | no-action | wakes/member-h | M2 false alerts | M2b false-state s | M3 detect s | M4 missed | rule | wakes at |";
  const table = [head, "|---|---|---|---|---|---|---|---|---|---|", ...rows.map((r) => `| ${r.id} | ${r.wakes} | ${r.noAction} | ${r.perMemberHour} | ${r.falseAlerts} | ${r.falseStateS} | ${r.detectS ?? "-"} | ${r.missed} | ${r.rule ?? "-"} | ${r.events} |`)].join("\n");
  console.log(table);
  assert.deepEqual(rows.map((r) => [r.id, r.wakes, r.noAction, r.perMemberHour, r.falseAlerts, r.falseStateS, r.detectS, r.missed, r.rule]), EXPECTED);
});

const eventsOf = (rid: string): string[] => rowOf(rid).alerts.map((a) => String(a.event));

test("lost: a link down while owing is told within 66 s, once", () => {
  for (const rid of ["S5a", "A8"]) {
    assert.ok(rowOf(rid).detectS! <= 66, `${rid}: ${rowOf(rid).detectS} s`);
    assert.equal(eventsOf(rid).filter((e) => e === "lost").length, 1, rid);
  }
});
test("stopped: no member's tokens moving is told within the window and a few ticks, as one stopped", () => {
  for (const rid of ["S4", "S4-owing", "S12", "A4b", "A13"]) {
    assert.ok(rowOf(rid).detectS! <= STALL_S + 10, `${rid}: ${rowOf(rid).detectS} s`);
    assert.deepEqual([...new Set(eventsOf(rid))], ["stopped"], rid);
  }
});
test("quiet stays quiet: steady work, growing background tasks, installs, a link blip with the transcript growing", () => {
  for (const rid of ["S2", "S2b", "E1b-install", "E1b-until", "S7", "S8", "S13", "S11-3"]) assert.equal(rowOf(rid).wakes, 0, `${rid}: ${rowOf(rid).events}`);
});
test("A9: a join run through PowerShell with backslash paths is located", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-yardstick-locate-"));
  try {
    const file = writeSubagent(root, PROJECT, SESSION, "ps", [toolCall("PowerShell", { command: String.raw`node C:\Users\me\.claude\plugins\swarm-board\swarm.mjs join --run 85 --seat d1 --doing x` }, "toolu_ps", iso(Date.now(), 0))], {});
    assert.equal(locate({ verb: "join", run: 85, seat: "d1" }, { CLAUDE_CODE_SESSION_ID: SESSION, SWARM_TRANSCRIPTS_ROOT: root }), file);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
