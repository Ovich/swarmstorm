// Board.stats on a plan run (SL2, S2.2, S5.2): the member's timeline, the merge lock's waits and races, the
// shared-files funnel, totals and files across runs, read through Board.stats alone, a fake Date for the spans.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { MemberStats, RunStats } from "../src/board/board.ts";
import { MIN, REPO, at, brainstormRun, clockTo, planRun, recordsBeginAt, scratchBoard, share, type ScratchBoard } from "./fixtures/stats-board.ts";
import { codeVerbs } from "../src/packs/code/calls.ts";

let s: ScratchBoard;
beforeEach(async () => {
  s = await scratchBoard("swarm-stats-plan-");
});
afterEach(() => s.done());

const runOf = (run: number): RunStats => {
  const out = s.board.stats({ repo: REPO, run });
  assert.equal(out.runs.length, 1);
  return out.runs[0];
};
const memberOf = (r: RunStats, name: string): MemberStats => r.members.find((m) => m.member === name)!;
const spans = (m: MemberStats) => m.intervals.map((i) => [i.what, i.from, i.to, i.inferred]);

test("a member's intervals: working, waiting for the lock, merging solid; silent past `silentAfterMs` inferred (board D9, D12, SL2)", () => {
  const { board } = s;
  const { run, m: [a, b] } = planRun(board, "app", ["S1", "S2"]);
  clockTo(1), board.deliver(a);
  clockTo(2), assert.equal(codeVerbs(board).lockMerge(a, "main").granted, true);
  clockTo(3), assert.equal(codeVerbs(board).lockMerge(b, "main").granted, false);
  clockTo(4), board.deliver(b);
  clockTo(5), codeVerbs(board).merged(a, "aaa111", []);
  clockTo(6), assert.equal(codeVerbs(board).lockMerge(b, "main").granted, true);
  clockTo(7), codeVerbs(board).merged(b, "bbb222", []);
  clockTo(8), board.end(b);
  clockTo(20), board.deliver(a);
  clockTo(21), board.end(a);
  clockTo(22);
  const r = runOf(run);
  assert.equal(s.board.stats({ repo: REPO, run }).silentAfterMs, 10 * MIN);
  assert.deepEqual(spans(memberOf(r, a.name)), [
    ["working", at(0), at(2), true],
    ["merging", at(2), at(5), false],
    ["silent", at(5), at(20), true],
    ["working", at(20), at(21), true],
  ]);
  assert.deepEqual(spans(memberOf(r, b.name)), [
    ["working", at(0), at(3), true],
    ["waiting", at(3), at(6), false],
    ["merging", at(6), at(7), false],
    ["working", at(7), at(8), true],
  ]);
});

test("deliveries keep a member from silent: a member that only delivers every five minutes for thirty has no silent span (D37, SL2)", () => {
  const { board } = s;
  const { run, m: [a] } = planRun(board, "app", ["S1"]);
  for (let min = 5; min <= 30; min += 5) clockTo(min), board.deliver(a);
  board.end(a);
  clockTo(40);
  assert.deepEqual(spans(memberOf(runOf(run), a.name)), [["working", at(0), at(30), true]]);
});

test("a refused verb counts no call, and a member whose only calls are refused falls silent (D25, SL2)", () => {
  const { board } = s;
  const { run, m: [a, b] } = planRun(board, "app", ["S1", "S2"]);
  for (const min of [5, 10, 15]) {
    clockTo(min);
    assert.throws(() => board.endorse(a, 99999), /unknown message #99999/);
    board.deliver(b);
  }
  const roster = board.snapshot(REPO).roster;
  assert.equal(roster.find((x) => x.member === a.name)!.calls, 0);
  assert.equal(roster.find((x) => x.member === b.name)!.calls, 3);
  clockTo(16);
  const r = runOf(run);
  assert.deepEqual(spans(memberOf(r, a.name)), [["silent", at(0), at(16), true]]);
  assert.ok(!memberOf(r, b.name).intervals.some((i) => i.what === "silent"));
});

test("lock waits from refused to granted; a race lost is a refused ask still pending while a later asker is granted (US1, D33, SL2)", () => {
  const { board } = s;
  const { run, m: [a, b, c] } = planRun(board, "app", ["S1", "S2", "S3"]);
  clockTo(1), codeVerbs(board).lockMerge(a, "main");
  clockTo(2), assert.equal(codeVerbs(board).lockMerge(b, "main").granted, false);
  clockTo(3), assert.equal(codeVerbs(board).lockMerge(c, "main").granted, false);
  clockTo(4), codeVerbs(board).merged(a, "aaa111", []);
  clockTo(5), assert.equal(codeVerbs(board).lockMerge(c, "main").granted, true);
  clockTo(6), codeVerbs(board).merged(c, "ccc333", []);
  clockTo(7), assert.equal(codeVerbs(board).lockMerge(b, "main").granted, true);
  clockTo(8), codeVerbs(board).merged(b, "bbb222", []);
  const r = runOf(run);
  assert.deepEqual([...r.plan!.lock.waitsMs].sort((x, y) => x - y), [0, 2 * MIN, 5 * MIN]);
  assert.deepEqual(r.plan!.lock.racesLost, [{ member: b.name, lost: 1, waitedMs: 3 * MIN }]);
  assert.equal(r.racesLost, 1);
  const races = memberOf(r, b.name).marks.filter((x) => x.what === "race");
  assert.deepEqual(races.map((x) => [x.at, x.note]), [[at(5), `the merge lock went to ${c.name}, who asked later`]]);
  assert.deepEqual(memberOf(r, c.name).marks.filter((x) => x.what === "race"), []);
});

test("`end` closes a lock turn left without a merge (D37, SL2)", () => {
  const { board } = s;
  const { run, m: [a] } = planRun(board, "app", ["S1"]);
  clockTo(1), codeVerbs(board).lockMerge(a, "main");
  clockTo(3), board.end(a);
  clockTo(5);
  const again = board.join({ run, seat: "S1", doing: "again", files: [] }).member;
  clockTo(7), codeVerbs(board).lockMerge(again, "main");
  clockTo(8), codeVerbs(board).merged(again, "aaa111", []);
  clockTo(9), board.end(again);
  const r = runOf(run);
  assert.deepEqual(
    memberOf(r, a.name).intervals.filter((i) => i.what === "merging").map((i) => [i.from, i.to]),
    [
      [at(1), at(3)],
      [at(7), at(8)],
    ],
  );
  assert.deepEqual(r.plan!.lock.waitsMs, [0, 0]);
});

test("a file held one after the other is not shared; held at the same time it is (D39, S2.2)", () => {
  const { board } = s;
  const { run, m: [a, b] } = planRun(board, "app", ["S1", "S2"]);
  clockTo(1), codeVerbs(board).checkEdit(a, "src/one.ts");
  clockTo(2), codeVerbs(board).release(a, "src/one.ts");
  clockTo(3), assert.equal(codeVerbs(board).checkEdit(b, "src/one.ts").allowed, true);
  clockTo(4), codeVerbs(board).checkEdit(a, "src/two.ts");
  clockTo(5), share(board, b, a, "src/two.ts");
  const shared = runOf(run).plan!.shared;
  assert.equal(shared.files, 1);
  assert.deepEqual(
    shared.perFile.map((f) => [f.path, f.holders]),
    [["src/two.ts", [a.name, b.name]]],
  );
});

test("the funnel is nested: an agreement given on a file whose holders were not all told is not counted under agreed (D38, S2.2)", () => {
  const { board } = s;
  const { run, m: [a, b, c] } = planRun(board, "app", ["S1", "S2", "S3"]);
  // src/x.ts: c holds it first and lets go; a takes it; b and c share it, but a never tells c
  clockTo(1), codeVerbs(board).checkEdit(c, "src/x.ts");
  clockTo(2), codeVerbs(board).release(c, "src/x.ts");
  clockTo(3), codeVerbs(board).checkEdit(a, "src/x.ts");
  clockTo(4), share(board, b, a, "src/x.ts");
  clockTo(5), share(board, c, [a, b], "src/x.ts");
  clockTo(6), board.post(a, `@${b.name} ${b.seat} changes the top of x, ${a.seat} the rest`, { about: "src/x.ts", kind: "agreement" });
  // src/y.ts: told and agreed
  clockTo(7), codeVerbs(board).checkEdit(a, "src/y.ts");
  clockTo(8), share(board, b, a, "src/y.ts");
  clockTo(9), board.post(a, `@${b.name} ${b.seat} changes the top of y, ${a.seat} the rest`, { about: "src/y.ts", kind: "agreement" });
  const shared = runOf(run).plan!.shared;
  assert.deepEqual(
    { files: shared.files, everyHolderTold: shared.everyHolderTold, agreed: shared.agreed, agreedBeforeMerge: shared.agreedBeforeMerge },
    { files: 2, everyHolderTold: 1, agreed: 1, agreedBeforeMerge: 1 },
  );
  const totals = s.board.stats({ repo: REPO }).totals.shared;
  assert.deepEqual([totals.files, totals.everyHolderTold, totals.agreed, totals.agreedBeforeMerge], [2, 1, 1, 1]);
});

test("`totals` carries the scope's counts and a series point per run, a run with `recorded: false` a null point where nothing was kept, an estimated one where it was (D28, D32, D34, D44, SL2, SL9)", async () => {
  const { board } = s;
  const early = planRun(board, "early", ["S1"]);
  clockTo(1);
  await recordsBeginAt(s.file, at(1));
  clockTo(2), board.closeRun(early.run);
  clockTo(10);
  const later = planRun(board, "later", ["S1"]);
  clockTo(11), codeVerbs(board).lockMerge(later.m[0], "main");
  clockTo(12), codeVerbs(board).merged(later.m[0], "aaa111", []);
  clockTo(15), board.closeRun(later.run);
  clockTo(20);
  const debate = brainstormRun(board, "debate", ["skeptic", "a"]);
  clockTo(25), board.closeRun(debate.run);
  const out = board.stats({ repo: REPO, closedOnly: true });
  assert.deepEqual(
    out.runs.map((r) => [r.run, r.recorded]),
    [
      [early.run, false],
      [later.run, true],
      [debate.run, true],
    ],
  );
  assert.equal(out.totals.runs, 3);
  assert.deepEqual(out.totals.byKind, { plan: 2, brainstorm: 1 });
  assert.equal(out.totals.notRecorded, 1);
  // flags are read from the board's messages (D43), slices and shared files from what every run kept (D44)
  const kept = new Set(["flags", "slicesMerged", "sliceTimeP50", "sharedAgreed"]);
  for (const [name, points] of Object.entries(out.totals.series)) {
    assert.equal(points.length, 3, name);
    if (!kept.has(name)) assert.equal(points[0], null, `${name}: the unrecorded run is a gap`);
  }
  // the early run merged nothing: 0, estimated, never a gap
  assert.deepEqual(out.totals.series.slicesMerged.slice(0, 2), [0, 1]);
  assert.deepEqual(out.totals.series.sharedAgreed.slice(0, 2), [0, 0]);
  assert.deepEqual([out.totals.slices.timesEstimatedRuns, out.totals.shared.estimatedRuns], [1, 1]);
  assert.deepEqual(out.totals.series.flags, [0, 0, null]);
});

test("`files[].perRun` lists each run's holders and conflict, oldest first, `declaredInterface` counted from interface claims (D33, D37, SL2)", () => {
  const { board } = s;
  const one = planRun(board, "alpha", ["S1", "S2"]);
  clockTo(1), codeVerbs(board).checkEdit(one.m[0], "src/x.ts", { interface: true });
  clockTo(2), share(board, one.m[1], one.m[0], "src/x.ts");
  clockTo(3), codeVerbs(board).lockMerge(one.m[1], "main");
  clockTo(4), codeVerbs(board).merged(one.m[1], "aaa111", ["src/x.ts"], { files: ["src/x.ts"] });
  clockTo(5), board.closeRun(one.run);
  clockTo(10);
  const two = planRun(board, "beta", ["S1", "S2"]);
  clockTo(11), codeVerbs(board).checkEdit(two.m[0], "src/x.ts");
  clockTo(12), share(board, two.m[1], two.m[0], "src/x.ts");
  clockTo(13), codeVerbs(board).lockMerge(two.m[1], "main");
  clockTo(14), codeVerbs(board).merged(two.m[1], "bbb222", ["src/x.ts"], { files: [] });
  clockTo(15), board.closeRun(two.run);
  const x = board.stats({ repo: REPO }).files.find((f) => f.path === "src/x.ts")!;
  assert.deepEqual(x.runs, [one.run, two.run]);
  assert.deepEqual(x.perRun, [
    { run: one.run, holders: 2, conflict: true },
    { run: two.run, holders: 2, conflict: false },
  ]);
  assert.equal(x.conflicts, 1);
  assert.equal(x.declaredInterface, 1);
});

test("`MemberStats` carries `waitingMs`, `agreementsMade`, `endorsed`, `objections` (D40, S5.2)", () => {
  const { board } = s;
  const plan = planRun(board, "app", ["S1", "S2"]);
  const [a, b] = plan.m;
  clockTo(1), codeVerbs(board).lockMerge(a, "main");
  clockTo(2), codeVerbs(board).lockMerge(b, "main");
  clockTo(5), codeVerbs(board).merged(a, "aaa111", []);
  codeVerbs(board).lockMerge(b, "main");
  clockTo(6), board.post(b, `@${a.name} ${b.seat} takes the config`, { about: "src/config.ts", kind: "agreement" });
  clockTo(7), codeVerbs(board).merged(b, "bbb222", []);
  clockTo(8), board.closeRun(plan.run);
  const debate = brainstormRun(board, "debate", ["skeptic", "a", "b"]);
  const [skeptic, sa, sb] = debate.m;
  clockTo(9);
  const g1 = board.post(sa, "D1: keep the store", { about: "D1", kind: "agreement" });
  clockTo(10), board.endorse(skeptic, g1.seq);
  clockTo(11), board.post(sb, "D2: one table", { about: "D2", kind: "agreement" });
  clockTo(12), board.post(skeptic, "one table cannot hold both", { about: "D2" });
  clockTo(13), board.closeRun(debate.run);
  const figures = (m: MemberStats) => [m.waitingMs, m.agreementsMade, m.endorsed, m.objections];
  const p = runOf(plan.run);
  assert.deepEqual(figures(memberOf(p, a.name)), [0, 0, null, null]);
  assert.deepEqual(figures(memberOf(p, b.name)), [3 * MIN, 1, null, null]);
  const d = runOf(debate.run);
  assert.deepEqual(figures(memberOf(d, skeptic.name)), [0, 0, 1, 1]);
  assert.deepEqual(figures(memberOf(d, sa.name)), [0, 1, 0, 0]);
  assert.deepEqual(figures(memberOf(d, sb.name)), [0, 1, 0, 0]);
});

test("an open run is computed on read and its spans end at now (D22, D32, SL2)", () => {
  const { board } = s;
  const { run, m: [a] } = planRun(board, "app", ["S1"]);
  clockTo(1), board.deliver(a);
  clockTo(5);
  let r = runOf(run);
  assert.deepEqual([r.closedAt, r.lengthMs, memberOf(r, a.name).ended], [null, 5 * MIN, null]);
  assert.equal(memberOf(r, a.name).intervals.at(-1)!.to, at(5));
  clockTo(7);
  r = runOf(run);
  assert.equal(r.lengthMs, 7 * MIN);
  assert.equal(memberOf(r, a.name).intervals.at(-1)!.to, at(7));
});
