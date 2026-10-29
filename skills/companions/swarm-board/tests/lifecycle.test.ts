// The board's lifecycle (D19, D20, D32, D45, D46; plan D13, D15, D23): a closed run is read-only,
// pruned past the retention, with the old rows stored before runs (run null), agreements kept; a
// run whose members went silent is flagged once; a silent orchestrator is quiet once, then back.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board } from "../src/board/board.ts";

const REPO = "/repos/one/.git";
const SEATS = [
  { id: "S1", title: "one", blockers: [] },
  { id: "S2", title: "two", blockers: [] },
];
const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;

let dir: string;
let file: string;
let board: Board;
// the same store, opened raw: what the interface cannot do, dating rows in the past
let raw: import("node:sqlite").DatabaseSync;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-lifecycle-"));
  file = path.join(dir, "swarm.sqlite");
  board = await openBoard(file);
  const { DatabaseSync } = await import("node:sqlite");
  raw = new DatabaseSync(file);
});

afterEach(() => {
  raw.close();
  board.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const ago = (ms: number, from = Date.now()): string => new Date(from - ms).toISOString();
const count = (sql: string, ...params: (string | number)[]): number => Number((raw.prepare(sql).get(...params) as { n: number }).n);

const runWithMembers = (group: string) => {
  const run = board.openRun({ repo: REPO, group, title: group, seats: SEATS });
  const s1 = board.join({ run: run.id, seat: "S1", doing: "one", files: [] }).member;
  const s2 = board.join({ run: run.id, seat: "S2", doing: "two", files: [] }).member;
  return { run, s1, s2 };
};

/** Closes the run and dates its close, and every message stored with it, `ms` ago. */
const closedAgo = (run: number, ms: number): void => {
  board.closeRun(run);
  raw.prepare("UPDATE runs SET closed_at = ? WHERE id = ?").run(ago(ms), run);
  raw.prepare("UPDATE messages SET at = ? WHERE run = ?").run(ago(ms + DAY), run);
};

/** Makes rows read as a store from before runs labelled every item: run null, dated `ms` ago (D13). */
const storedBeforeRuns = (seqs: number[], ms: number): void => {
  for (const seq of seqs) raw.prepare("UPDATE messages SET run = NULL, at = ? WHERE seq = ?").run(ago(ms), seq);
};

test("a closed run refuses a post; its messages stay readable", () => {
  const { run, s1, s2 } = runWithMembers("alpha");
  const m = board.post(s1, "before the close");
  board.closeRun(run.id);
  // the members are ended first: that refusal comes before the archive's
  assert.throws(() => board.post(s1, "late"), /has ended/);
  // a member woken behind the board's back still finds the run archived
  raw.prepare("UPDATE participants SET ended_at = NULL WHERE id IN (?, ?)").run(s1.id, s2.id);
  assert.throws(() => board.post(s1, "late"), new RegExp(`run ${run.id} is closed`));
  assert.throws(() => board.post(s1, "late", { kind: "agreement", with: ["orchestrator"] }), new RegExp(`run ${run.id} is closed`));
  assert.equal(board.read(m.seq).body, "before the close");
  assert.ok(board.snapshot(REPO).events.some((e) => e.seq === m.seq));
});

test("prune removes a run closed past the retention with its seats, messages and deliveries; keeps a recent one and an open one", () => {
  const old = runWithMembers("old");
  const said = board.post(old.s1, "@S2 in the old run");
  board.deliver(old.s2);
  closedAgo(old.run.id, 31 * DAY);
  const recent = runWithMembers("recent");
  closedAgo(recent.run.id, 29 * DAY);
  const open = runWithMembers("open");
  raw.prepare("UPDATE runs SET opened_at = ? WHERE id = ?").run(ago(90 * DAY), open.run.id);
  raw.prepare("UPDATE messages SET at = ? WHERE run = ?").run(ago(90 * DAY), open.run.id);

  const removed = board.prune();
  assert.equal(removed.runs, 1);
  // the row stays, stamped, so its id is never handed out again (D61)
  assert.equal(count("SELECT COUNT(*) AS n FROM runs WHERE id = ? AND pruned_at IS NOT NULL", old.run.id), 1);
  assert.equal(count("SELECT COUNT(*) AS n FROM seats WHERE run = ?", old.run.id), 0);
  assert.equal(count("SELECT COUNT(*) AS n FROM participants WHERE run = ?", old.run.id), 0);
  assert.equal(count("SELECT COUNT(*) AS n FROM messages WHERE run = ?", old.run.id), 0);
  assert.equal(count("SELECT COUNT(*) AS n FROM deliveries WHERE seq = ?", said.seq), 0);
  assert.equal(count("SELECT COUNT(*) AS n FROM runs WHERE id = ?", recent.run.id), 1);
  assert.ok(count("SELECT COUNT(*) AS n FROM messages WHERE run = ?", recent.run.id) > 0);
  assert.deepEqual(board.runs().map((r) => r.id), [open.run.id]);
  assert.ok(count("SELECT COUNT(*) AS n FROM messages WHERE run = ?", open.run.id) > 0);
});

test("a pruned run's id is never given to a new run, and the page lists it nowhere (D61)", () => {
  const a = runWithMembers("a");
  closedAgo(a.run.id, 31 * DAY);
  assert.equal(board.prune().runs, 1);
  const b = runWithMembers("b");
  assert.ok(b.run.id > a.run.id, `${b.run.id} > ${a.run.id}`);
  assert.deepEqual(board.snapshot(REPO).runs.map((r) => r.run), [b.run.id]);
  assert.ok(!board.repos().some((r) => r.runs.some((x) => x.run === a.run.id)));
  assert.ok(!board.runs().some((r) => r.id === a.run.id));
});

test("open posts the opened event with the run, naming kind, group and title: a member of another run subscribed to any:opened wakes (D69)", async () => {
  const { run: first } = runWithMembers("alpha");
  const watcher = board.join({ run: first.id, seat: "S1", doing: "watching", files: [], on: [{ event: "opened", scope: "any" }] }).member;
  board.deliver(watcher);
  const run = board.openRun({ repo: REPO, kind: "brainstorm", group: "beta", title: "Beta topic", seats: SEATS });
  const opened = board.snapshot(REPO).events.filter((e) => e.kind === "event" && e.body.startsWith(`run ${run.id} opened`));
  assert.equal(opened.length, 1);
  assert.equal(opened[0].run, run.id);
  assert.equal(opened[0].body, `run ${run.id} opened: brainstorm beta, Beta topic`);
  const { wakes } = await import("../src/board/events.ts");
  assert.ok(wakes(board.read(opened[0].seq), watcher, [{ event: "opened", scope: "any" }]));
  assert.ok(!wakes(board.read(opened[0].seq), watcher, [{ event: "opened", scope: "run" }]));
});

test("close posts the closed event with the run it closes: a member of another run subscribed to any:closed wakes (D67)", async () => {
  const { run } = runWithMembers("alpha");
  const other = board.openRun({ repo: REPO, group: "beta", title: "beta", seats: SEATS });
  const watcher = board.join({ run: other.id, seat: "S1", doing: "watching", files: [], on: [{ event: "closed", scope: "any" }] }).member;
  board.deliver(watcher);
  board.closeRun(run.id);
  const closed = board.snapshot(REPO).events.filter((e) => e.kind === "event" && e.body === `run ${run.id} closed`);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].run, run.id);
  const { wakes } = await import("../src/board/events.ts");
  const m = board.read(closed[0].seq);
  assert.ok(wakes(m, watcher, [{ event: "closed", scope: "any" }]));
  assert.ok(board.deliver(watcher).lines.some((l) => l.includes(`run ${run.id} closed`)));
});

test("prune reaches only old rows stored before runs (run null): plain talk goes, agreements and their endorsements stay with their pruned author; an open run's old talk stays (D23)", () => {
  const alpha = runWithMembers("alpha");
  const beta = runWithMembers("beta");
  const plain = board.post(alpha.s1, "old news");
  const agreement = board.post(alpha.s1, "alpha owns the header", { kind: "agreement", with: ["orchestrator"] });
  const endorsement = board.endorse(beta.s1, agreement.seq);
  const recentOld = board.post(alpha.s2, "old row, recent");
  storedBeforeRuns([plain.seq, agreement.seq, endorsement.seq], 40 * DAY);
  storedBeforeRuns([recentOld.seq], 5 * DAY);
  const openTalk = board.post(beta.s2, "an open run's talk, long ago");
  raw.prepare("UPDATE messages SET at = ? WHERE seq = ?").run(ago(40 * DAY), openTalk.seq);
  closedAgo(alpha.run.id, 31 * DAY);

  const removed = board.prune();
  assert.equal(removed.runs, 1);
  assert.throws(() => board.read(plain.seq), /unknown message/);
  assert.equal(board.read(agreement.seq).from, "alpha/S1");
  assert.equal(board.read(agreement.seq).run, alpha.run.id); // still labelled with its author's run
  assert.equal(board.read(endorsement.seq).endorses, agreement.seq);
  assert.equal(board.read(recentOld.seq).body, "old row, recent");
  assert.equal(board.read(openTalk.seq).body, "an open run's talk, long ago");
  // kept only as the agreement's author: never listed
  assert.deepEqual(board.repos().flatMap((r) => r.runs.map((x) => x.run)), [beta.run.id]);
});

test("a second prune removes nothing", () => {
  const old = runWithMembers("old");
  board.post(old.s1, "an agreement of the run", { kind: "agreement", with: ["orchestrator"] });
  closedAgo(old.run.id, 31 * DAY);
  const first = board.prune();
  assert.ok(first.runs === 1 && first.messages > 0);
  assert.deepEqual(board.prune(), { messages: 0, runs: 0 });
});

test("prune uses the retention setting, and a run within it stays", () => {
  const { run } = runWithMembers("short");
  closedAgo(run.id, 8 * DAY);
  assert.equal(board.prune().runs, 0);
  board.setting("retention-days", 7);
  assert.equal(board.prune().runs, 1);
  // and `now` moves it: a run closed today, pruned 31 days from now
  const later = runWithMembers("later");
  board.closeRun(later.run.id);
  assert.equal(board.prune(new Date(Date.now() + 6 * DAY)).runs, 0);
  assert.equal(board.prune(new Date(Date.now() + 8 * DAY)).runs, 1);
});

test("the retention setting: 30 by default, set to 7, refuses what is not a positive whole number", () => {
  assert.equal(board.setting("retention-days"), 30);
  assert.equal(board.setting("retention-days", 7), 7);
  assert.equal(board.setting("retention-days"), 7);
  assert.throws(() => board.setting("retention-days", 0), /positive whole number/);
  assert.throws(() => board.setting("retention-days", 1.5), /positive whole number/);
  assert.equal(board.setting("retention-days"), 7);
});

test("a run whose every member is silent is flagged once with the run, by its orchestrator, never delivered to it; a call clears the mark (D23)", () => {
  const { run, s1 } = runWithMembers("quiet");
  const later = (minutes: number): Date => new Date(Date.now() + minutes * MINUTE);
  assert.deepEqual(board.flagStale(later(5)), []);
  assert.deepEqual(board.flagStale(later(11)), [run.id]);
  const events = board.snapshot(REPO).events.filter((e) => e.body.includes("is stale"));
  assert.equal(events.length, 1);
  assert.equal(events[0].run, run.id);
  assert.equal(events[0].body, `run ${run.id} (quiet) is stale: every member silent; close it or dispatch again`);
  assert.equal(events[0].from, "quiet/orchestrator");
  assert.deepEqual(board.read(events[0].seq).mentions, ["quiet/orchestrator"]);
  assert.deepEqual(board.flagStale(later(12)), []);
  board.setDoing(s1, "back");
  assert.deepEqual(board.flagStale(later(25)), [run.id]);
  // the orchestrator authors it, so its own delivery never carries it
  const toOrchestrator = board.deliver(board.participant("quiet/orchestrator")!);
  assert.ok(!toOrchestrator.full.some((m) => m.body.includes("is stale")));
  assert.ok(!toOrchestrator.lines.some((l) => l.includes("is stale")));
  // a member of the run hears it, as a line
  assert.ok(board.deliver(s1).lines.some((l) => l.includes("is stale")));
});

test("the board's own stale flag is no activity of the run: a run idle two days stays forgotten after it (S31)", () => {
  const { run } = runWithMembers("idle2d");
  const old = ago(2 * DAY);
  raw.prepare("UPDATE runs SET opened_at = ? WHERE id = ?").run(old, run.id);
  raw.prepare("UPDATE participants SET joined_at = ?, last_call = NULL WHERE run = ?").run(old, run.id);
  raw.prepare("UPDATE messages SET at = ? WHERE run = ?").run(old, run.id);
  assert.equal(board.lastActivity(run.id), old);
  assert.deepEqual(board.flagStale(), [run.id]);
  assert.equal(board.lastActivity(run.id), old);
});

test("a silent orchestrator is posted quiet once, with its run; its next call posts back; a silent member gets none (D15)", () => {
  const { run } = runWithMembers("hush");
  const orchestrator = board.participant("hush/orchestrator")!;
  const later = (minutes: number): Date => new Date(Date.now() + minutes * MINUTE);
  const quietEvents = () => board.snapshot(REPO).events.filter((e) => e.event === "quiet");
  const backEvents = () => board.snapshot(REPO).events.filter((e) => e.event === "back");
  board.flagStale(later(5));
  assert.equal(quietEvents().length, 0);
  board.flagStale(later(11));
  board.flagStale(later(15));
  const quiet = quietEvents();
  assert.equal(quiet.length, 1, "once per silence");
  assert.equal(quiet[0].from, orchestrator.name);
  assert.equal(quiet[0].run, run.id);
  assert.match(quiet[0].body, /^quiet 11 min$/);
  assert.equal(backEvents().length, 0);
  board.deliver(orchestrator);
  const back = backEvents();
  assert.equal(back.length, 1);
  assert.equal(back[0].from, orchestrator.name);
  board.deliver(orchestrator);
  assert.equal(backEvents().length, 1, "back once");
  // no member is ever posted quiet, silent as they were
  assert.ok(board.snapshot(REPO).events.filter((e) => e.event === "quiet" || e.event === "back").every((e) => e.from === orchestrator.name));
});

test("one live member keeps the run unflagged", () => {
  const { run, s1 } = runWithMembers("busy");
  raw.prepare("UPDATE participants SET last_call = ?, joined_at = ? WHERE run = ? AND id != ?").run(ago(20 * MINUTE), ago(20 * MINUTE), run.id, s1.id);
  board.setDoing(s1, "still here");
  assert.deepEqual(board.flagStale(), []);
});

test("repos() lists every closed run within the retention, beyond ten, and none pruned", () => {
  const gone = runWithMembers("gone");
  closedAgo(gone.run.id, 40 * DAY);
  const kept: number[] = [];
  for (let i = 0; i < 12; i++) {
    const { run } = runWithMembers(`closed-${i}`);
    closedAgo(run.id, 20 * DAY);
    kept.push(run.id);
  }
  board.prune();
  const listed = board.repos().flatMap((r) => r.runs.map((x) => x.run));
  assert.deepEqual(listed, kept);
});

test("S24: a seat joined again reads fresh in the roster, never stale from its last member's calls", () => {
  const { run, s1 } = runWithMembers("rejoin");
  board.end(s1);
  raw.prepare("UPDATE participants SET joined_at = ?, last_call = ? WHERE id = ?").run(ago(DAY), ago(DAY), s1.id);
  board.join({ run: run.id, seat: "S1", doing: "back", files: [] });
  const row = board.roster(REPO).find((r) => r.name === "rejoin/S1")!;
  assert.equal(row.stale, false);
});
