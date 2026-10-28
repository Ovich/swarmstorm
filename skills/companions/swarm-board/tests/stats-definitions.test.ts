// The figures' definitions an audit of a real store set right (D46, SL11): a shared file estimated from overlapping
// memberships, its `told`, an agreement before the tell, exchanges before the outcome, objections at the post's time,
// every seat's endorsements, a repeated flag counted once. Read through Board.stats alone.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { MemberStats, RunStats } from "../src/board/board.ts";
import { REPO, brainstormRun, clockTo, dropSummary, planRun, recordsBeginAt, scratchBoard, setup, share, type ScratchBoard } from "./fixtures/stats-board.ts";

let s: ScratchBoard;
beforeEach(async () => {
  s = await scratchBoard("swarm-stats-definitions-");
});
afterEach(() => s.done());

const runOf = (run: number): RunStats => s.board.stats({ repo: REPO, run }).runs[0];
const memberOf = (r: RunStats, name: string): MemberStats => r.members.find((m) => m.member === name)!;

test("before shares-since, two members claiming a path one after the other are not shared; members at once, they are (D44, D46 point 1, SL11)", async () => {
  const { board } = s;
  const run = board.openRun({ repo: REPO, group: "app", title: "app", seats: ["S1", "S2", "S3"].map((id) => ({ id, title: id, blockers: [] })) }).id;
  const join = (seat: string) => board.join({ run, seat, doing: seat, files: [] }).member;
  const a = join("S1");
  clockTo(1), board.checkEdit(a, "dist/out.js");
  clockTo(2), board.checkEdit(a, "src/x.ts");
  clockTo(3), board.end(a);
  // b joins after a ended: its claim of dist/out.js follows a's, never beside it
  clockTo(4);
  const b = join("S2");
  clockTo(5), board.checkEdit(b, "dist/out.js");
  // c joins while b is still a member: src/y.ts, claimed by both, is shared
  const c = join("S3");
  clockTo(6), board.checkEdit(b, "src/y.ts");
  clockTo(7), board.end(b);
  clockTo(8), board.checkEdit(c, "src/y.ts");
  clockTo(10), board.closeRun(run);
  await recordsBeginAt(s.file, s.board.stats({ repo: REPO, run }).runs[0].closedAt!);
  await dropSummary(s.file, run);
  const shared = runOf(run).plan!.shared;
  assert.equal(shared.estimated, true);
  assert.deepEqual(
    shared.perFile.map((f) => [f.path, f.holders]),
    [["src/y.ts", [b.name, c.name]]],
  );
});

test("an untold file with an agreement reads `told: false` and is not counted agreed; a told one reads `told: true` (D38, D46 point 2, SL11)", () => {
  const { board } = s;
  const { run, m: [a, b, c] } = planRun(board, "app", ["S1", "S2", "S3"]);
  // src/x.ts: c holds it and lets go, a takes it, b and c share it, but a never tells c; then a agrees with b
  clockTo(1), board.checkEdit(c, "src/x.ts");
  clockTo(2), board.release(c, "src/x.ts");
  clockTo(3), board.checkEdit(a, "src/x.ts");
  clockTo(3), share(board, b, a, "src/x.ts");
  clockTo(3), share(board, c, [a, b], "src/x.ts");
  clockTo(3), board.post(a, `@${b.name} ${b.seat} owns the top of x`, { about: "src/x.ts", kind: "agreement" });
  // src/y.ts: told and agreed
  clockTo(4), board.checkEdit(a, "src/y.ts");
  clockTo(5), share(board, b, a, "src/y.ts");
  clockTo(6), board.post(a, `@${b.name} ${b.seat} owns the top of y`, { about: "src/y.ts", kind: "agreement" });
  const shared = runOf(run).plan!.shared;
  assert.deepEqual(
    shared.perFile.map((f) => [f.path, f.told, f.agreement !== null]),
    [
      ["src/x.ts", false, true],
      ["src/y.ts", true, true],
    ],
  );
  assert.deepEqual([shared.files, shared.everyHolderTold, shared.agreed], [2, 1, 1]);
});

test("an agreement posted before the tell reads a negative `agreedAfterMs`, never 0 (D46 point 3, SL11)", () => {
  const { board } = s;
  const { run, m: [a, b] } = planRun(board, "app", ["S1", "S2"]);
  clockTo(1), board.checkEdit(a, "src/x.ts");
  clockTo(2), board.checkEdit(b, "src/x.ts");
  clockTo(3), board.post(a, `@${b.name} ${b.seat} owns the top`, { about: "src/x.ts", kind: "agreement" });
  clockTo(5), board.post(b, `@${a.name} I change one function in src/x.ts`, { about: "src/x.ts" });
  const [file] = runOf(run).plan!.shared.perFile;
  assert.equal(file.agreedAfterMs, -2 * 60_000);
});

test("an objection: the skeptic's post while the latest agreement is not yet endorsed by it, even when endorsed later; none after its endorsement (D23, D46 point 5, SL11)", () => {
  const { board } = s;
  const { run, m: [skeptic, a] } = brainstormRun(board, "debate", ["skeptic", "a"]);
  // D1: agreed, the skeptic objects, then endorses it: the post before the endorsement is an objection
  clockTo(1);
  const g1 = board.post(a, "keep one store", { about: "D1", kind: "agreement" });
  clockTo(2);
  const objection = board.post(skeptic, "one store cannot hold both", { about: "D1" });
  clockTo(3), board.endorse(skeptic, g1.seq);
  // D2: agreed and endorsed, then the skeptic speaks on it: no objection
  clockTo(4);
  const g2 = board.post(a, "one table", { about: "D2", kind: "agreement" });
  clockTo(5), board.endorse(skeptic, g2.seq);
  clockTo(6), board.post(skeptic, "one table holds, see #12", { about: "D2" });
  const r = runOf(run);
  assert.deepEqual(
    memberOf(r, skeptic.name).marks.filter((x) => x.what === "objected").map((x) => x.seq),
    [objection.seq],
  );
  assert.equal(memberOf(r, skeptic.name).objections, 1);
});

test("`MemberStats.endorsed` counts every seat's endorsements; the run's `endorsed` stays the skeptic's (D30, D40, D46 point 6, SL11)", () => {
  const { board } = s;
  const { run, m: [skeptic, a, b] } = brainstormRun(board, "debate", ["skeptic", "a", "b"]);
  clockTo(1);
  const g1 = board.post(a, "keep one store", { about: "D1", kind: "agreement" });
  const g2 = board.post(b, "one table", { about: "D2", kind: "agreement" });
  const g3 = board.post(a, "one writer", { about: "D3", kind: "agreement" });
  clockTo(2), board.endorse(b, g1.seq);
  board.endorse(a, g2.seq);
  board.endorse(b, g3.seq);
  clockTo(3), board.endorse(skeptic, g1.seq);
  const r = runOf(run);
  assert.deepEqual(
    [skeptic, a, b].map((p) => memberOf(r, p.name).endorsed),
    [1, 1, 2],
  );
  assert.equal(r.brainstorm!.endorsed, 1);
});

test("a flag repeated for the same writer, path and holder counts once; another holder's counts apart (D43, D46 point 7, SL11)", async () => {
  const { board } = s;
  const { run, m: [a, b, c] } = planRun(board, "app", ["S1", "S2", "S3"]);
  clockTo(1), board.checkEdit(a, "src/y.ts");
  clockTo(2);
  const [flag] = board.reconcileWrites(b, ["src/y.ts"]);
  // the board posted the same flag again, as a store from before kept it
  await setup(s.file, (db) => {
    const columns = (db.prepare("SELECT name FROM pragma_table_info('messages') WHERE name <> 'seq'").all() as { name: string }[]).map((c) => c.name).join(", ");
    db.prepare(`INSERT INTO messages (${columns}) SELECT ${columns} FROM messages WHERE seq = ?`).run(flag.seq);
  });
  // c holds src/z.ts and b writes it: another flag
  clockTo(3), board.checkEdit(c, "src/z.ts");
  clockTo(4), board.reconcileWrites(b, ["src/z.ts"]);
  const r = runOf(run);
  assert.equal(r.plan!.flags, 2);
  assert.deepEqual([memberOf(r, b.name).flags, memberOf(r, b.name).marks.filter((x) => x.what === "flag").length], [2, 2]);
});
