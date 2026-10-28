// A run before the records read from the board's events (D45): its members' `merged` events give its merges, their
// times exact, so its first merge, seat times and agreements before the merge fill, and each member's spans are
// estimated from its join, its merges and its end. Lock waits, races and conflicts stay null. Read through Board.stats.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Board, RunId } from "../src/board/board.ts";
import { MIN, REPO, at, clockTo, dropSummary, planRun, recordsBeginAt, scratchBoard, setup, share, type ScratchBoard } from "./fixtures/stats-board.ts";

let s: ScratchBoard;
beforeEach(async () => {
  s = await scratchBoard("swarm-stats-events-");
});
afterEach(() => s.done());

/** A plan run of three: a merges src/x.ts at minute 5 after its agreement at 3; b merges src/z.ts at 9 before c's
 *  agreement at 10; c never merges and ends at 12. Closed at 20, the records begun at 21. */
async function oldRun(board: Board): Promise<{ run: RunId; names: string[] }> {
  const { run, m: [a, b, c] } = planRun(board, "app", ["S1", "S2", "S3"]);
  clockTo(1), board.checkEdit(a, "src/x.ts");
  clockTo(2), share(board, b, a, "src/x.ts");
  clockTo(3), board.post(a, `@${b.name} ${a.seat} changes the top`, { about: "src/x.ts", kind: "agreement" });
  clockTo(4), board.lockMerge(a, "main");
  clockTo(5), board.merged(a, "aaa111", ["src/x.ts"]);
  clockTo(6), board.end(a);
  clockTo(7), board.checkEdit(b, "src/z.ts");
  clockTo(8), share(board, c, b, "src/z.ts");
  clockTo(9), board.lockMerge(b, "main"), board.merged(b, "bbb222", ["src/z.ts"]);
  clockTo(10), board.post(c, `@${b.name} ${c.seat} keeps the rest`, { about: "src/z.ts", kind: "agreement" });
  clockTo(11), board.end(b);
  clockTo(12), board.end(c);
  clockTo(20), board.closeRun(run);
  await recordsBeginAt(s.file, at(21));
  await dropSummary(s.file, run);
  return { run, names: [a.name, b.name, c.name] };
}

/** The figures D45 reads from the events, the same whether the `merged` rows carry the event's name or only its body. */
function assertReadFromEvents(board: Board, run: RunId, [a, b, c]: string[]): void {
  const r = board.stats({ repo: REPO, run }).runs[0];
  assert.equal(r.recorded, false);
  assert.equal(r.firstMergeAtMs, 5 * MIN);
  const spans = new Map(r.members.map((m) => [m.member, m.intervals.map((i) => [i.what, (Date.parse(i.from) - Date.parse(at(0))) / MIN, (Date.parse(i.to) - Date.parse(at(0))) / MIN, i.inferred])]));
  // working from the join to the first merge, a merge mark at it; c, never merged, working to its end
  assert.deepEqual(spans.get(a), [["working", 0, 5, true], ["merging", 5, 5, true]]);
  assert.deepEqual(spans.get(b), [["working", 0, 9, true], ["merging", 9, 9, true]]);
  assert.deepEqual(spans.get(c), [["working", 0, 12, true]]);
  assert.ok(r.members.every((m) => m.estimated && m.waitingMs === null));
  const p = r.plan!;
  assert.deepEqual([...p.slices.timesMs].sort((x, y) => x - y), [5 * MIN, 9 * MIN, 12 * MIN]);
  assert.equal(p.slices.timesEstimated, true);
  // x.ts agreed at 3, before its merge at 5; z.ts agreed at 10, after its merge at 9
  assert.deepEqual([p.shared.files, p.shared.agreed, p.shared.agreedBeforeMerge, p.shared.estimated], [2, 2, 1, true]);
  // what the events do not carry stays null (D34)
  assert.equal(r.racesLost, null);
  assert.deepEqual(p.lock.waitsMs, []);
  assert.deepEqual(p.conflicts, { known: null, inShared: null, unknownMerges: null });
  assert.ok(p.shared.perFile.every((f) => f.conflict === null));
}

test("a run before the records reads its merges, first merge, seat times, agreements before the merge and estimated spans from its `merged` events (D45, SL10)", async () => {
  const { run, names } = await oldRun(s.board);
  assertReadFromEvents(s.board, run, names);
});

test("a `merged` row from before the event column is read by its body, its files from its `files:` line (D43, D45, SL10)", async () => {
  const { run, names } = await oldRun(s.board);
  await setup(s.file, (db) => void db.prepare("UPDATE messages SET event = NULL WHERE event = 'merged'").run());
  assertReadFromEvents(s.board, run, names);
});

test("a `merged` event without a files line counts as a merge of each path its author held (D45, SL10)", async () => {
  const { run } = await oldRun(s.board);
  // the files lines gone: a's merge at 5 is the first merge of x.ts, b's at 9 of z.ts, as before
  await setup(s.file, (db) => void db.prepare("UPDATE messages SET body = substr(body, 1, instr(body, char(10)) - 1) WHERE event = 'merged' AND instr(body, char(10)) > 0").run());
  const p = s.board.stats({ repo: REPO, run }).runs[0].plan!;
  assert.deepEqual([p.shared.agreed, p.shared.agreedBeforeMerge], [2, 1]);
});
