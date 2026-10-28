// A closed run's summary (D20, D21, D25): stored at close, written by prune before the raw rows go, never pruned; a run
// before the records reads recorded: false; a failing summary never fails close. Read through Board.stats and the CLI.
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Board, RunId } from "../src/board/board.ts";
import { DAY, REPO, at, brainstormRun, clockTo, dropSummary, planRun, recordsBeginAt, scratchBoard, setup, share, type ScratchBoard } from "./fixtures/stats-board.ts";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "cli", "index.ts");

let s: ScratchBoard;
beforeEach(async () => {
  s = await scratchBoard("swarm-stats-records-");
});
afterEach(() => s.done());

/** A plan run with every kind of figure: an interface declared at join, a shared file told and agreed, a lock wait, a
 *  merge with a conflict, a flag, a silent stretch; closed at minute 30. Its posts' seqs, to read them back. */
function fullPlanRun(board: Board, group = "app"): { run: RunId; seqs: number[] } {
  const { run, m: [a, b] } = planRun(board, group, ["S1", "S2"], { S1: [{ path: "src/x.ts", interface: true }] });
  clockTo(1), share(board, b, a, "src/x.ts");
  clockTo(2);
  const agreed = board.post(a, `@${b.name} ${b.seat} changes the top, ${a.seat} the rest`, { about: "src/x.ts", kind: "agreement" });
  clockTo(3), board.checkEdit(a, "src/y.ts");
  clockTo(4), board.reconcileWrites(b, ["src/y.ts"]);
  clockTo(5), board.lockMerge(a, "main");
  clockTo(6), board.lockMerge(b, "main");
  clockTo(8), board.merged(a, "aaa111", ["src/x.ts"], { files: [] });
  board.lockMerge(b, "main");
  clockTo(9), board.merged(b, "bbb222", ["src/x.ts", "src/y.ts"], { files: ["src/x.ts"] });
  clockTo(25), board.deliver(a);
  clockTo(30), board.closeRun(run);
  return { run, seqs: [agreed.seq] };
}

/** A brainstorm run with a settled question, an objection and an open one; closed at minute 50. */
function fullBrainstormRun(board: Board): RunId {
  clockTo(40);
  const { run, m: [skeptic, a] } = brainstormRun(board, "debate", ["skeptic", "a"]);
  clockTo(41), board.post(a, "keep one store, see src/x.ts:3", { about: "D1" });
  clockTo(42);
  const g1 = board.post(a, "keep one store", { about: "D1", kind: "agreement" });
  clockTo(43), board.post(skeptic, "one store will contend", { about: "D1" });
  clockTo(44);
  const g2 = board.post(a, "one store, one writer", { about: "D1", kind: "agreement" });
  clockTo(45), board.endorse(skeptic, g2.seq);
  clockTo(46), board.post(a, "D2 stays open", { about: "D2" });
  void g1;
  clockTo(50), board.closeRun(run);
  return run;
}

test("a closed run's stored summary equals its live computation (D20, D21, D41, SL2, SL3)", async () => {
  const { board } = s;
  const plan = fullPlanRun(board);
  const debate = fullBrainstormRun(board);
  clockTo(60);
  const stored = [board.stats({ repo: REPO, run: plan.run }), board.stats({ repo: REPO, run: debate }), board.stats({ repo: REPO })];
  await dropSummary(s.file, plan.run);
  await dropSummary(s.file, debate);
  clockTo(70);
  const live = [board.stats({ repo: REPO, run: plan.run }), board.stats({ repo: REPO, run: debate }), board.stats({ repo: REPO })];
  assert.deepEqual(live, stored);
});

test("prune past the retention keeps the run's figures, equal before and after, its raw rows gone (D20, SL2)", () => {
  const { board } = s;
  const plan = fullPlanRun(board);
  clockTo(31);
  const before = board.stats({ repo: REPO, run: plan.run });
  mock.timers.setTime(Date.parse(at(30)) + 31 * DAY);
  assert.equal(board.prune().runs, 1);
  // the raw rows are gone: the run's posts no longer read
  assert.throws(() => board.read(plan.seqs[0]), /unknown message/);
  assert.deepEqual(board.stats({ repo: REPO, run: plan.run }).runs, before.runs);
});

test("prune writes a missing summary first: a closed run with none still reads its figures after prune (D21, D41, SL2)", async () => {
  const { board } = s;
  const plan = fullPlanRun(board);
  clockTo(31);
  const before = board.stats({ repo: REPO, run: plan.run });
  await dropSummary(s.file, plan.run);
  mock.timers.setTime(Date.parse(at(30)) + 31 * DAY);
  assert.equal(board.prune().runs, 1);
  assert.throws(() => board.read(plan.seqs[0]), /unknown message/);
  assert.deepEqual(board.stats({ repo: REPO, run: plan.run }).runs, before.runs);
});

test("a run before the records reads `recorded: false`, its lock-wait and conflict figures null, never 0, its slices, shared files and spans estimated, its merges and message figures kept (US1, D21, D34, D39, D41, D44, D45, SL2, SL3, SL9, SL10)", async () => {
  const { board } = s;
  // the records begin a minute after the run opened
  const { run, m: [a, b] } = planRun(board, "app", ["S1", "S2"]);
  clockTo(1);
  await recordsBeginAt(s.file, at(1));
  clockTo(2), share(board, b, a, "src/x.ts");
  clockTo(3), board.post(a, `@${b.name} ${b.seat} changes the top`, { about: "src/x.ts", kind: "agreement" });
  clockTo(4), board.checkEdit(a, "src/y.ts");
  clockTo(5), board.reconcileWrites(b, ["src/y.ts"]);
  clockTo(6), board.lockMerge(a, "main");
  clockTo(7), board.lockMerge(b, "main");
  clockTo(8), board.merged(a, "aaa111", ["src/x.ts"], { files: ["src/x.ts"] });
  board.lockMerge(b, "main");
  clockTo(9), board.merged(b, "bbb222", ["src/x.ts"]);
  clockTo(30), board.closeRun(run);
  const out = board.stats({ repo: REPO, run });
  const r = out.runs[0];
  assert.equal(r.recorded, false);
  // the first merge read from its `merged` event (D45); races not kept
  assert.deepEqual([r.firstMergeAtMs, r.racesLost], [8 * 60_000, null]);
  for (const m of r.members) {
    assert.equal(m.estimated, true, m.member);
    assert.ok(m.intervals.length > 0 && m.intervals.every((i) => i.inferred && (i.what === "working" || i.what === "merging")), m.member);
    assert.equal(m.waitingMs, null, m.member);
  }
  const p = r.plan!;
  // read from the members' rows and the claims, estimated (D44)
  assert.deepEqual([p.slices.merged, p.slices.timesEstimated, p.shared.estimated], [2, true, true]);
  assert.equal(p.slices.timesMs.length, 2);
  assert.deepEqual(p.lock.waitsMs, []);
  assert.deepEqual(p.conflicts, { known: null, inShared: null, unknownMerges: null });
  // the merges known from their events, the step is counted, never null: here no path two members claimed (D45)
  assert.equal(p.shared.agreedBeforeMerge, 0);
  // the message figures are kept
  assert.equal(p.flags, 1);
  const byName = new Map(r.members.map((m) => [m.member, m]));
  assert.deepEqual([byName.get(a.name)!.posts, byName.get(b.name)!.posts], [1, 1]);
  assert.deepEqual([byName.get(a.name)!.agreementsMade, byName.get(b.name)!.flags], [1, 1]);
  const t = out.totals;
  assert.deepEqual([t.notRecorded, t.lockWait.merges, t.lockWait.p50Ms, t.conflicts.known, t.silentMembers], [1, null, null, null, null]);
  assert.deepEqual([t.slices.merged, t.slices.timesEstimatedRuns, t.shared.estimatedRuns], [2, 1, 1]);
  assert.equal(t.flags, 1);
});

test("`close` exits 0 with its usual output when the summary fails, and the run is then computed live (D25, D41, SL2)", async () => {
  // the CLI runs on the real clock: the in-process board does too, the records begun a day back
  mock.timers.reset();
  const { board, file } = s;
  await recordsBeginAt(file, new Date(Date.now() - DAY).toISOString());
  const home = path.dirname(file);
  const close = (run: RunId) =>
    spawnSync(process.execPath, [CLI, "close", "--run", String(run)], { cwd: home, encoding: "utf8", env: { ...process.env, SWARM_ROOT: home, SWARMSTORM_HOME: home, SWARM_NO_POLLER: "1" } });
  const mergedRun = (group: string): RunId => {
    const { run, m: [a] } = planRun(board, group, ["S1"]);
    board.lockMerge(a, "main");
    board.merged(a, "aaa111", ["src/x.ts"], { files: ["src/x.ts"] });
    return run;
  };
  // the usual output, from a run whose summary is written
  const sound = mergedRun("sound");
  const usual = close(sound);
  assert.equal(usual.status, 0, usual.stderr);
  // the summary of this one fails: its merge's conflicts are not JSON
  const broken = mergedRun("broken");
  await setup(file, (db) => void db.prepare("UPDATE merges SET conflicts = '{not json' WHERE run = ?").run(broken));
  const r = close(broken);
  assert.deepEqual([r.status, r.stdout, r.stderr], [0, usual.stdout.replace(`run ${sound}`, `run ${broken}`), usual.stderr]);
  // the row mended in setup, the run reads closed, computed live from its rows
  await setup(file, (db) => void db.prepare(`UPDATE merges SET conflicts = '["src/x.ts"]' WHERE run = ?`).run(broken));
  const read = board.stats({ repo: REPO, run: broken }).runs[0];
  assert.notEqual(read.closedAt, null);
  assert.equal(read.plan!.conflicts.known, 1);
});

test("a file claimed, not declared, as an interface reads interface: true from the stored summary and computed live after close (D37, D42)", async () => {
  const { board } = s;
  const { run, m: [a, b] } = planRun(board, "api", ["S1", "S2"]);
  clockTo(1), board.checkEdit(a, "src/api.ts", { interface: true });
  clockTo(2), share(board, b, a, "src/api.ts");
  clockTo(3), board.checkEdit(b, "src/api.ts");
  clockTo(10), board.closeRun(run);
  const interfaceOf = (): (boolean | null)[] =>
    board.stats({ repo: REPO, run }).runs[0].plan!.shared.perFile.filter((f) => f.path === "src/api.ts").map((f) => f.interface);
  assert.deepEqual(interfaceOf(), [true], "from the stored summary");
  await dropSummary(s.file, run);
  assert.deepEqual(interfaceOf(), [true], "computed live after close");
});

test("a closed run's flags are the board's flag messages, read after release: the `flag` event, a board-written row from before the event name, never a member's post quoting one (D43, S6.2)", async () => {
  const { board } = s;
  /** A plan run where `b` writes a path `a` holds, flagged by the board, and `a` quotes a flag's wording in a post. */
  const flaggedRun = (group: string): { run: RunId; a: string; b: string; flagSeq: number } => {
    const { run, m: [a, b] } = planRun(board, group, ["S1", "S2"]);
    board.checkEdit(a, "src/y.ts");
    const [flag] = board.reconcileWrites(b, ["src/y.ts"]);
    board.post(a, `@${b.name} the page reads 'flag: <member> wrote <path> outside its claim; <holder> holds it'`, { about: "src/view.ts" });
    board.closeRun(run);
    return { run, a: a.name, b: b.name, flagSeq: flag.seq };
  };
  const flagsOf = (run: RunId) => {
    const out = board.stats({ repo: REPO, run });
    const r = out.runs[0];
    return {
      recorded: r.recorded,
      plan: r.plan!.flags,
      members: r.members.filter((m) => m.seat !== "orchestrator").map((m) => [m.member, m.flags, m.marks.filter((x) => x.what === "flag").length]),
      total: out.totals.flags,
      without: out.totals.runsWithoutFlag,
      series: out.totals.series.flags,
    };
  };

  // a recorded run, its summary dropped: computed live once close has released the claims and emptied the flags table
  clockTo(1);
  const live = flaggedRun("live");
  await dropSummary(s.file, live.run);
  assert.deepEqual(flagsOf(live.run), {
    recorded: true,
    plan: 1,
    members: [
      [live.a, 0, 0],
      [live.b, 1, 1],
    ],
    total: 1,
    without: 0,
    series: [1],
  });

  // a run before the records, its flag a plain board-written message, as the board wrote one before the event name
  clockTo(20);
  const old = flaggedRun("old");
  await setup(s.file, (db) => void db.prepare("UPDATE messages SET kind = 'msg', event = NULL, run = NULL WHERE seq = ?").run(old.flagSeq));
  await recordsBeginAt(s.file, at(30));
  await dropSummary(s.file, old.run);
  assert.deepEqual(flagsOf(old.run), {
    recorded: false,
    plan: 1,
    members: [
      [old.a, 0, 0],
      [old.b, 1, 1],
    ],
    total: 1,
    without: 0,
    series: [1],
  });
});

test("a plan run before the records: slices merged from the members' rows, each member's join to its `merged` event, else to its end, estimated; lock and conflicts null (D44, D45, SL9, SL10)", async () => {
  const { board } = s;
  const { run, m: [a, b, c] } = planRun(board, "app", ["S1", "S2", "S3"]);
  clockTo(1), board.lockMerge(a, "main");
  clockTo(2), board.merged(a, "aaa111", []);
  clockTo(5), board.end(a);
  clockTo(6), board.lockMerge(b, "main");
  clockTo(7), board.merged(b, "bbb222", []);
  clockTo(9), board.end(b);
  clockTo(10), board.end(c);
  clockTo(20), board.closeRun(run);
  // the records begin after the run: it reads as an old run
  await recordsBeginAt(s.file, at(21));
  await dropSummary(s.file, run);
  const r = board.stats({ repo: REPO, run }).runs[0];
  const p = r.plan!;
  assert.equal(r.recorded, false);
  assert.deepEqual([p.slices.merged, p.slices.of, p.slices.timesEstimated], [2, 3, true]);
  // the merges at 2 and 7 minutes, read from the board's events; c, never merged, to its end at 10 (D45)
  assert.deepEqual([...p.slices.timesMs].sort((x, y) => x - y), [2 * 60_000, 7 * 60_000, 10 * 60_000]);
  assert.deepEqual(p.lock.waitsMs, []);
  assert.deepEqual(p.conflicts, { known: null, inShared: null, unknownMerges: null });
});

test("before shares-since a path claimed by two members is shared, estimated, its agreement before any merge counted; a path one member claimed is not (D44, D45, SL9, SL10)", async () => {
  const { board } = s;
  const { run, m: [a, b] } = planRun(board, "app", ["S1", "S2"]);
  // held one after the other while both were members: a recorded run would not share it, an old one counts it, their
  // memberships overlapping (D46)
  clockTo(1), board.checkEdit(a, "src/x.ts");
  clockTo(2), board.end(a);
  clockTo(3), board.checkEdit(b, "src/x.ts");
  clockTo(4), board.post(b, `@${a.name} I change one function in src/x.ts`, { about: "src/x.ts" });
  clockTo(5), board.post(b, `@${a.name} ${b.seat} owns the bottom`, { about: "src/x.ts", kind: "agreement" });
  clockTo(6), board.checkEdit(b, "src/y.ts");
  clockTo(10), board.closeRun(run);
  await recordsBeginAt(s.file, at(11));
  await dropSummary(s.file, run);
  const out = board.stats({ repo: REPO, run });
  const shared = out.runs[0].plan!.shared;
  assert.equal(shared.estimated, true);
  assert.deepEqual([shared.files, shared.everyHolderTold, shared.agreed, shared.agreedBeforeMerge], [1, 1, 1, 1]);
  assert.deepEqual(shared.perFile.map((f) => [f.path, f.holders]), [["src/x.ts", [a.name, b.name]]]);
  // the hot files fill from it
  assert.deepEqual(out.files.map((f) => f.path), ["src/x.ts"]);
});

test("a recorded run reads both estimate flags false (D44, SL9)", () => {
  const { board } = s;
  const plan = fullPlanRun(board);
  const out = board.stats({ repo: REPO, run: plan.run });
  const p = out.runs[0].plan!;
  assert.deepEqual([p.slices.timesEstimated, p.shared.estimated], [false, false]);
  assert.ok(out.runs[0].members.every((m) => m.estimated === false));
  assert.deepEqual([out.totals.slices.timesEstimatedRuns, out.totals.shared.estimatedRuns], [0, 0]);
});

test("a stored summary from before `timesEstimated`: its `estimated` read as the times', none read false; the count never estimated (D44, round 2)", async () => {
  const { board } = s;
  const legacy = fullPlanRun(board, "legacy");
  const older = fullPlanRun(board, "older");
  const rewrite = (run: RunId, slices: (x: Record<string, unknown>) => void) =>
    setup(s.file, (db) => {
      const body = JSON.parse(String((db.prepare("SELECT body FROM run_stats WHERE run = ?").get(run) as { body: string }).body));
      slices(body.plan.slices);
      db.prepare("UPDATE run_stats SET body = ? WHERE run = ?").run(JSON.stringify(body), run);
    });
  await rewrite(legacy.run, (x) => {
    delete x.timesEstimated;
    x.estimated = true;
  });
  await rewrite(older.run, (x) => void delete x.timesEstimated);
  const out = board.stats({ repo: REPO });
  const slicesOf = (run: RunId) => out.runs.find((r) => r.run === run)!.plan!.slices;
  assert.equal(slicesOf(legacy.run).timesEstimated, true);
  assert.equal("estimated" in slicesOf(legacy.run), false);
  assert.equal(slicesOf(older.run).timesEstimated, false);
  assert.deepEqual([out.totals.slices.merged, out.totals.slices.timesEstimatedRuns], [4, 1]);
});

test("`totals.brainstorm.notRecorded` counts the brainstorm runs before the records only, never the plan runs (round 2)", async () => {
  const { board } = s;
  const plans = [fullPlanRun(board, "p1"), fullPlanRun(board, "p2")];
  const old = fullBrainstormRun(board);
  await recordsBeginAt(s.file, at(60));
  for (const p of plans) await dropSummary(s.file, p.run);
  await dropSummary(s.file, old);
  clockTo(61);
  const out = board.stats({ repo: REPO });
  assert.deepEqual([out.totals.notRecorded, out.totals.brainstorm.notRecorded], [3, 1]);
  // a scope with no brainstorm run has none to count
  assert.equal(board.stats({ repo: REPO, kinds: ["plan"] }).totals.brainstorm.notRecorded, null);
});
