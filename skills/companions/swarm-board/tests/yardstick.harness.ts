// The yardstick, full (run agent-ergonomics): every scenario of tests/fixtures/yardstick.ts played to its end, the
// M1-M4 table printed and held, and idea 1's acceptance rows. About 2 min of CPU, so not in `npm test`'s glob:
// `npm run yardstick`, in every test phase. Its fast core (detection only) is tests/yardstick.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BUSY_MAX_MS } from "../src/board/liveness.ts";
// board-split D55 deleted these rules from the board; this measurement harness keeps the bounds it recorded under them
const IN_TURN_MS = 120 * 1000;
const OWE_WAIT_MS = 10 * 60 * 1000;
import { locate } from "../src/link/transcripts.ts";
import { toolCall, writeSubagent } from "./fixtures/transcripts.ts";
import { PROJECT, SCENARIOS, SESSION, STALL_S, iso, play, type Row } from "./fixtures/yardstick.ts";

/** The numbers after idea 1 (note #11926 + #11931): id, wakes, no-action, wakes per member-hour, M2, M2b s, M3 s, M4, first alert's rule.
 *  Moved on purpose from the baseline (f5f40b0): S2 and S8 lose their false alert, S13 its false `gone`, S11-1 is caught,
 *  S10/S12 keep about 60 s with the turn ended, S3a's old form reads 720 s (Risks); build 1.2 (F2): an owing stalled is told again only after 15 min. */
const EXPECTED: [string, number, number, number, number, number, number | null, number, string | null][] =[
  ["S1", 1, 1, 2.4, 1, 0, null, 0, "call"],
  ["S2", 0, 0, 0, 0, 0, null, 0, null],
  ["A1b", 3, 0, 5.1, 0, 0, 60, 0, "ended"],
  ["S2b", 1, 1, 6, 1, 233, null, 0, "background"],
  ["S3a-120", 3, 0, 5.1, 0, 0, 240, 0, "background"],
  ["S3a-600", 2, 0, 3.4, 0, 0, 720, 0, "background"],
  ["S3a-old", 2, 0, 3.4, 0, 0, 720, 0, "in-turn"],
  ["E1", 2, 0, 3.4, 0, 0, 300, 0, "call"],
  ["E1b-install", 0, 0, 0, 0, 0, null, 0, null],
  ["E1b-until", 0, 0, 0, 0, 0, null, 0, null],
  ["S3b", 2, 0, 3.4, 0, 0, 900, 0, "call"],
  ["S4", 3, 0, 5.1, 0, 0, 60, 0, "ended"],
  ["S5a", 1, 0, 1.7, 0, 0, 30, 0, null],
  ["A8", 2, 1, 12, 0, 0, 30, 0, null],
  ["S5b", 3, 0, 5.1, 0, 0, 60, 0, "ended"],
  ["A13", 3, 0, 5.1, 0, 0, 120, 0, "in-turn"],
  ["S5c", 2, 0, 3.4, 0, 0, 900, 0, "call"],
  ["S5d", 1, 0, 1.7, 0, 0, 1, 0, null],
  ["S6", 2, 2, 5.5, 0, 0, null, 0, null],
  ["S7", 0, 0, 0, 0, 0, null, 0, null],
  ["S8", 0, 0, 0, 0, 0, null, 0, null],
  ["A4b", 3, 0, 5.1, 0, 0, 120, 0, "in-turn"],
  ["S9", 1, 1, 2.4, 1, 0, null, 0, "call"],
  ["S10", 3, 0, 5.1, 0, 0, 60, 0, "background"],
  ["S11-1a", 4, 1, 6.9, 0, 0, 61, 0, "owing"],
  ["S11-1b", 2, 0, 3.4, 0, 0, 601, 0, "owing"],
  ["S11-guard", 3, 1, 9, 0, 0, 61, 0, "owing"],
  // C6's 7 s: x's re-armed waits all start on the wall clock within the first seconds, so its owing span reads 10 min
  // old when the phase opens; on a real clock the span is the current wait's age, at most one re-arm (111 s) more
  ["C6", 2, 0, 4, 0, 0, 601, 0, "owing"],
  ["S11-2", 0, 0, 0, 0, 0, null, 1, null],
  ["S11-3", 0, 0, 0, 0, 0, null, 0, null],
  ["S12", 3, 0, 5.1, 0, 0, 60, 0, "ended"],
  ["A3b", 3, 0, 5.1, 0, 0, 60, 0, "ended"],
  ["S13", 1, 1, 6, 0, 0, null, 0, null],
  ["A7b", 2, 2, 12, 1, 60, null, 0, null],
  ["A12a", 3, 0, 5.1, 0, 0, 60, 0, "ended"],
  ["A12b", 2, 0, 3.4, 0, 0, 898, 0, "background"],
  ["S14", 1, 1, 1.7, 0, 5, null, 1, null],
];

let rows: Row[] = [];
const rowOf = (rid: string) => rows.find((r) => r.id === rid)!;

test("the yardstick: M1-M4 per scenario", async () => {
  rows = [];
  for (const sc of SCENARIOS) rows.push(await play(sc));
  const head = "| id | wakes | no-action | wakes/member-h | M2 false alerts | M2b false-state s | M3 detect s | M4 missed | rule | wakes at |";
  const table = [head, "|---|---|---|---|---|---|---|---|---|---|", ...rows.map((r) => `| ${r.id} | ${r.wakes} | ${r.noAction} | ${r.perMemberHour} | ${r.falseAlerts} | ${r.falseStateS} | ${r.detectS ?? "-"} | ${r.missed} | ${r.rule ?? "-"} | ${r.events} |`)].join("\n");
  console.log(table);
  // C6's detection rides on the wall clock (its comment in EXPECTED): held as its bound, 601 s, not as a second
  const detectOf = (r: Row) => (r.id === "C6" && r.detectS !== null && r.detectS <= 601 ? 601 : r.detectS);
  assert.deepEqual(rows.map((r) => [r.id, r.wakes, r.noAction, r.perMemberHour, r.falseAlerts, r.falseStateS, detectOf(r), r.missed, r.rule]), EXPECTED);
});

const bound = (rid: string, maxS: number, rule: string) => {
  const r = rowOf(rid);
  assert.equal(r.missed, 0, `${rid} caught`);
  assert.ok(r.detectS! <= maxS, `${rid}: ${r.detectS} s <= ${maxS} s`);
  assert.equal(r.rule, rule, `${rid} rule`);
};
const clean = (rid: string) => {
  const r = rowOf(rid);
  assert.equal(r.falseAlerts, 0, `${rid}: no false alert (${r.events})`);
  assert.equal(r.falseStateS, 0, `${rid}: no false quiet/gone`);
};
const stall = STALL_S + 1;
const inTurn = IN_TURN_MS / 1000 + 1;

test("A1: a background test with growing output, turn ended, draws no stalled and reads busy · background", () => clean("S2"));
test("A1b: a task notified mid-turn by attachment is closed: the turn's end is told as `ended`, never `background`", () => bound("A1b", stall, "ended"));
test("S2b (measured): a silent background task draws `stalled` at about 61 s, rule background", () => {
  const r = rowOf("S2b");
  assert.equal(r.falseAlerts, 1);
  assert.equal(r.alerts[0].rule, "background");
  assert.match(r.alerts[0].body, /background npm run build silent 60 s/);
});
test("A2: an awaited task whose output stops is stalled within 61 s of its last growth, rule background", () => {
  bound("S10", stall, "background");
  assert.match(rowOf("S10").alerts[0].body, /: background npm test silent 60 s/);
});
test("A3, A3b: only the board's own listener and link pending, through Bash or PowerShell: stalled within 61 s, rule ended", () => {
  bound("S12", stall, "ended");
  bound("A3b", stall, "ended");
});
test("A4: in turn 90 s without a line is working; in turn and silent is stalled within 121 s, rule in-turn", () => {
  clean("S8");
  bound("A4b", inTurn, "in-turn");
  assert.match(rowOf("A4b").alerts[0].body, /in turn, no line for 2 min \(its model may be hung\); last: "Bash ls"/);
});
test("A5: a turn ended is stalled within 61 s; the reason says `turn ended` and the last text; next is the ended move", () => {
  bound("S4", stall, "ended");
  const a = rowOf("S4").alerts[0];
  assert.match(a.body, /^stalled yard\/x: turn ended; last: "I will report once the build is green"/);
  assert.match(a.next!, /a post does not wake it: SendMessage it, or dispatch it again/);
});
// A6 restated (F1, test 1.1): the moved result keeps the agent in its turn, so the in-turn 120 s comes first
test("A6: a foreground Bash moved to the background, then silent: stalled within its timeout + 121 s, rule background", () => {
  bound("S3a-120", 120 + inTurn, "background");
  bound("S3a-600", 600 + inTurn, "background");
});
test("A7: a link lost while the transcript grows is not gone: one liveness, working; S5a gone within loss + 31 s; A7b: no stat, gone as today", () => {
  clean("S13");
  assert.equal(rowOf("S13").wakeAt.flatMap((w) => w.events).filter((e) => e === "liveness").length, 1);
  bound("S5a", 31, rowOf("S5a").rule!);
  assert.equal(rowOf("S5a").alerts[0].event, "lost");
  assert.deepEqual(rowOf("A7b").alerts.map((a) => [a.event, a.s]), [["lost", 90]]);
});
test("A8: a member told gone that comes back: one recovered at the next tick", () => {
  const r = rowOf("A8");
  const recovered = r.wakeAt.filter((w) => w.events.includes("recovered"));
  assert.equal(recovered.length, 1);
  assert.ok(recovered[0].s <= 121, `recovered at ${recovered[0].s} s, the link back at 120 s`);
});
test("A10: a re-armed wait owing the phase: stalled within 61 s with every other member waiting, at 10 min with others working, never owing nothing", () => {
  bound("S11-1a", stall, "owing");
  const b = rowOf("S11-1b");
  assert.equal(b.rule, "owing");
  assert.ok(Math.abs(b.detectS! - OWE_WAIT_MS / 1000) <= 1, `S11-1b at ${b.detectS} s`);
  assert.match(b.alerts[0].next!, /your part of p1/);
  clean("S11-3");
});
test("A11: unchanged: S3b, S5a, S5c, S5d, S6, S7 (the long-call rows keep 15 min)", () => {
  bound("S3b", BUSY_MAX_MS / 1000 + 1, "call");
  bound("S5c", BUSY_MAX_MS / 1000 + 1, "call");
  assert.equal(rowOf("S5d").detectS, 1);
  clean("S6");
  clean("S7");
});
test("A12: a dev server from an earlier turn is a service: stalled within 61 s; one started in the last turn holds busy up to 15 min, rule background", () => {
  bound("A12a", stall, "ended");
  const b = rowOf("A12b");
  assert.equal(b.rule, "background");
  assert.ok(b.detectS! + 7 - 5 <= BUSY_MAX_MS / 1000 + 1, `A12b at ${b.detectS} s from the turn's end`);
});
test("A13: a crash mid-turn, last line a tool result, link alive: stalled within 121 s, rule in-turn", () => bound("A13", inTurn, "in-turn"));

test("A9: a join run through PowerShell with \\ paths is located", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-yardstick-locate-"));
  try {
    const file = writeSubagent(root, PROJECT, SESSION, "ps", [toolCall("PowerShell", { command: "node C:\\Users\\me\\.claude\\plugins\\swarm-board\\swarm.mjs join --run 85 --slice d1 --doing x" }, "toolu_ps", iso(Date.now(), 0))], {});
    assert.equal(locate({ verb: "join", run: 85, seat: "d1" }, { CLAUDE_CODE_SESSION_ID: SESSION, SWARM_TRANSCRIPTS_ROOT: root }), file);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// F2 (test 1.1, fixed in build 1.2): the working blink between two waits of one owing span keeps stalled_at
test("A10: an owing member's stalled is told again only after 15 min, its re-arms between", () => {
  for (const rid of ["S11-1a", "S11-1b"]) {
    const alerts = rowOf(rid).alerts.map((a) => a.s);
    for (let i = 1; i < alerts.length; i++) assert.ok(alerts[i] - alerts[i - 1] >= 900, `${rid}: stalled at ${alerts.join(", ")}`);
  }
});

test("d3's guard on F2: a span ended by a real call, then the turn ended, is told `ended` within 61 s of its last line", () => {
  const r = rowOf("S11-guard");
  const ended = r.alerts.find((a) => a.rule === "ended");
  assert.ok(ended, `an ended stalled (${r.events})`);
  assert.ok(ended.s - 345 <= stall, `ended at ${ended.s} s, last line at 345 s`);
});

test("v1-a (build 1.3): a silent background reason ends on the member's last line", () => {
  assert.match(rowOf("S10").alerts[0].body, /^stalled yard\/x: background npm test silent 60 s; last: "working"/);
  assert.match(rowOf("S2b").alerts[0].body, /^stalled yard\/x: background npm run build silent 60 s; last: "working"/);
});

test("v1-b (build 1.3): a link-down liveness tells the orchestrator to SendMessage the member its link command", () => {
  const live = rowOf("S13").told.filter((t) => t.event === "liveness");
  assert.equal(live.length, 1);
  assert.match(live[0].body, /^liveness yard\/x: link lost, transcript still growing: restart its link$/);
  assert.match(live[0].next!, /^SendMessage yard\/x to restart its link, in the background: swarm link --run \d+ --as yard\/x$/);
});

test("idea 3, C6: a phase opened late raises no alert on the member at work; the waiting one is told owing within the rule's bound from the phase", () => {
  const r = rowOf("C6");
  assert.deepEqual(r.companionAlerts, [], "w works: never stalled or owing");
  assert.ok(r.alerts.every((a) => a.s >= 600), `nothing before the phase (${r.events})`);
  assert.equal(r.rule, "owing");
  assert.ok(r.detectS! <= OWE_WAIT_MS / 1000 + 1, `owing ${r.detectS} s after the phase opened`);
});

test("idea 5, E1/E1b: a seat's busyMax bounds its non-shell call (stalled · call at 300 s); its shell calls keep 15 min; a seat without it keeps 15 min", () => {
  const e1 = rowOf("E1");
  assert.equal(e1.rule, "call");
  assert.ok(Math.abs(e1.detectS! - 300) <= 1, `E1 at ${e1.detectS} s`);
  for (const id of ["E1b-install", "E1b-until"]) assert.equal(rowOf(id).alerts.length, 0, `${id}: ${rowOf(id).events}`);
  assert.equal(rowOf("S3b").detectS, 900);
});
