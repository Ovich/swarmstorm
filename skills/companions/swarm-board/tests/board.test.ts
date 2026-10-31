import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board, type EditAllowed, type EditHeld, type Participant } from "../src/board/board.ts";
import { claimHeldLine } from "../src/cli/answer/code-rules.ts";
import { codeVerbs, PackVerbRefused } from "../src/packs/code/calls.ts";

const REPO = "/repos/one/.git";
const SLICES = [
  { id: "S1", role: "the board", blockers: [] },
  { id: "S3", role: "the page", blockers: ["S1"] },
  { id: "S5", role: "the skill", blockers: [] },
];

let dir: string;
let board: Board;
const opened: Board[] = [];

const another = async (): Promise<Board> => {
  const b = await openBoard(path.join(dir, "swarm.sqlite"));
  opened.push(b);
  return b;
};

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-board-"));
  board = await another();
});

afterEach(() => {
  for (const b of opened.splice(0)) b.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const twoRunners = () => {
  const run = board.openRun({ repo: REPO, group: "review-tool", title: "Review tool", seats: SLICES });
  const s3 = board.join({ run: run.id, seat: "S3", doing: "page", files: [] }).member;
  const s5 = board.join({ run: run.id, seat: "S5", doing: "skill", files: [] }).member;
  board.deliver(s3); // the join events
  board.deliver(s5);
  return { run, s3, s5, orchestrator: board.participant("review-tool/orchestrator")! };
};

test("opens a run and lists its slices", () => {
  const run = board.openRun({ repo: REPO, group: "review-tool", title: "Review tool", seats: SLICES });
  assert.equal(run.state, "open");
  assert.deepEqual(
    run.seats.map((s) => [s.id, s.state, s.blockers]),
    [
      ["S1", "empty", []],
      ["S3", "empty", ["S1"]],
      ["S5", "empty", []],
    ],
  );
  // board-split D36: a seat's state follows its member, never set
  const s1 = board.join({ run: run.id, seat: "S1", doing: "x", files: [] }).member;
  assert.equal(board.runs()[0].seats[0].state, "working"); // a fresh join counts as moved
  board.end(s1);
  assert.equal(board.runs()[0].seats[0].state, "ended");
});

test("join returns every participant of the repository, both plans", () => {
  const a = board.openRun({ repo: REPO, group: "review-tool", title: "A", seats: SLICES });
  const b = board.openRun({ repo: REPO, group: "swarm", title: "B", seats: SLICES });
  const other = board.openRun({ repo: "/repos/two/.git", group: "elsewhere", title: "C", seats: SLICES });
  board.join({ run: a.id, seat: "S3", doing: "page", files: [{ path: "src/x.ts", interface: true }] });
  board.join({ run: other.id, seat: "S1", doing: "far away", files: [] });
  const { member, roster } = board.join({ run: b.id, seat: "S1", doing: "board", files: [] });
  assert.equal(member.name, "swarm/S1");
  assert.deepEqual(roster.map((r) => r.name).sort(), ["review-tool/S3", "review-tool/orchestrator", "swarm/S1", "swarm/orchestrator"]);
  const s3 = roster.find((r) => r.name === "review-tool/S3")!;
  assert.equal(s3.doing, "page");
  assert.deepEqual(s3.files, [{ path: "src/x.ts", interface: true }]);
});

test("a mention is delivered in full, the rest as one line", () => {
  const { s3, s5 } = twoRunners();
  const named = board.post(s3, "@S5 I take src/a.ts first\nthen the rest");
  const other = board.post(s3, "progress: half way");
  const d = board.deliver(s5);
  assert.deepEqual(d.full.map((m) => m.seq), [named.seq]);
  assert.equal(d.full[0].body, "@S5 I take src/a.ts first\nthen the rest");
  assert.equal(d.lines.length, 1);
  assert.match(d.lines[0], new RegExp(`^#${other.seq} review-tool/S3: progress: half way$`));
});

test("a member never receives its own message", () => {
  const { s3 } = twoRunners();
  board.post(s3, "@S3 note to self");
  const d = board.deliver(s3);
  assert.deepEqual(d, { full: [], lines: [] });
});

test("deliver marks delivered, a second deliver is empty", () => {
  const { s3, s5 } = twoRunners();
  board.post(s3, "one");
  board.post(s3, "@S5 two");
  const first = board.deliver(s5);
  assert.equal(first.full.length + first.lines.length, 2);
  assert.deepEqual(board.deliver(s5), { full: [], lines: [] });
});

test("@swarm reaches its run only, @<plan>/S1 and @<CODE>·S3 cross; @all names nobody (D3)", () => {
  const { s3, s5 } = twoRunners();
  const b = board.openRun({ repo: REPO, group: "swarm", title: "B", seats: SLICES });
  const far = board.join({ run: b.id, seat: "S1", doing: "board", files: [] }).member;
  board.deliver(far);
  board.deliver(s3);
  board.deliver(s5);

  board.post(s3, "@swarm rebase on the target");
  assert.equal(board.deliver(s5).full.length, 1);
  assert.deepEqual(board.deliver(far), { full: [], lines: [] }); // another run's plain talk never reaches it (D2)

  assert.deepEqual(board.post(s3, "@all anyone?").mentions, []);
  assert.equal(board.deliver(s5).full.length, 0);
  assert.deepEqual(board.deliver(far), { full: [], lines: [] });

  board.post(s3, "@swarm/S1 your schema touches mine");
  assert.equal(board.deliver(far).full.length, 1);
  assert.equal(board.deliver(s5).full.length, 0);

  board.post(far, "@RT·S3 agreed, I go second"); // the plan code of review-tool (D30)
  assert.equal(board.deliver(s3).full.length, 1);
});

test("wait resolves within 100 ms of a post for it", async () => {
  const { s3, s5 } = twoRunners();
  // the post through the same board, as the server commits every call in its one process (swarm-relay D14)
  let posted = 0;
  setTimeout(() => {
    posted = Date.now();
    board.post(s3, "@S5 done with src/a.ts");
  }, 300);
  const d = await board.wait(s5, { timeoutMs: 5000 });
  const latency = Date.now() - posted;
  assert.equal(d.full.length, 1);
  assert.ok(latency < 100, `woke after ${latency} ms`);
});

test("wait resolves empty on timeout", async () => {
  const { s5 } = twoRunners();
  const t0 = Date.now();
  const d = await board.wait(s5, { timeoutMs: 150 });
  assert.deepEqual(d, { full: [], lines: [] });
  assert.ok(Date.now() - t0 >= 140);
});

test("a mentions-only wait: a one-line event does not end it, a mention does; the event stays for deliver", async () => {
  const { s3, s5 } = twoRunners();
  const poster = await another();
  const s3There = poster.participant(s3.name)!;
  const waiting = board.wait(s5, { timeoutMs: 5000, mentionsOnly: true });
  let done = false;
  void waiting.then(() => (done = true));
  await new Promise((r) => setTimeout(r, 100));
  poster.setDoing(s3There, "the sidebar"); // an event: one line for S5
  poster.post(s3There, "@S1 not for S5"); // a message for someone else: one line for S5
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(done, false, "a line ended a mentions-only wait");
  poster.post(s3There, "@S5 your turn");
  const d = await waiting;
  assert.deepEqual(
    d.full.map((m) => m.body),
    ["@S5 your turn"],
  );
  assert.deepEqual(d.lines, []);
  // what the wait did not return is still undelivered
  const rest = board.deliver(s5);
  assert.equal(rest.full.length, 0);
  assert.equal(rest.lines.length, 2);
  assert.match(rest.lines.join("\n"), /doing: the sidebar/);
  assert.match(rest.lines.join("\n"), /@S1 not for S5/);
});

test("a mentions-only wait ends on an urgent post that does not mention it", async () => {
  const { s5, orchestrator } = twoRunners();
  const poster = await another();
  setTimeout(() => poster.post(poster.participant(orchestrator.name)!, "stop: main is red", { kind: "urgent" }), 100);
  const d = await board.wait(s5, { timeoutMs: 5000, mentionsOnly: true });
  assert.equal(d.full.length + d.lines.length, 1);
  assert.match([...d.full.map((m) => m.body), ...d.lines].join("\n"), /main is red/);
});

test("without mentionsOnly, a wait still ends on any delivery", async () => {
  const { s3, s5 } = twoRunners();
  const poster = await another();
  setTimeout(() => poster.setDoing(poster.participant(s3.name)!, "the sidebar"), 100);
  const d = await board.wait(s5, { timeoutMs: 5000 });
  assert.equal(d.lines.length, 1);
});

test("a newer wait of a member, from another process, supersedes the older: it returns empty at once; the newer gets the message", async () => {
  const { s3, s5 } = twoRunners();
  const other = await another(); // the foreground wait, in a second process
  const older = board.wait(s5, { timeoutMs: 10_000, mentionsOnly: true });
  let olderAt = 0;
  void older.then(() => (olderAt = Date.now()));
  await new Promise((r) => setTimeout(r, 100));
  const t0 = Date.now();
  const newer = other.wait(other.participant(s5.name)!, { timeoutMs: 10_000, mentionsOnly: true });
  assert.deepEqual(await older, { full: [], lines: [], superseded: true });
  // S31: another process hears the newer wait by the store's watch, at once; a watch event can be missed, and then the
  // re-read every WAIT_POLL_MS (board.ts, 1000 ms) catches it: the promise is "at most one poll late", so the bound is
  // one poll period plus the poll already in flight when the event was missed, never the poll period itself
  const WAIT_POLL_MS = 1000;
  assert.ok(olderAt - t0 < 2 * WAIT_POLL_MS, `superseded after ${olderAt - t0} ms`);
  board.post(s3, "@S5 rebase onto abc");
  const d = await newer;
  assert.equal(d.superseded, undefined);
  assert.deepEqual(d.full.map((m) => m.body), ["@S5 rebase onto abc"]);
  assert.deepEqual(board.deliver(s5), { full: [], lines: [] }, "the message was taken by the newer wait only");
});

test("a superseded wait leaves the newer one's state: listening while a mentions wait is pending, waiting for a plain one", async () => {
  const { s5 } = twoRunners();
  const watcher = await another();
  // board-split D49: the state is read where the wait is held (the server, in production)
  const s5Of = () => watcher.snapshot(REPO).roster.find((r) => r.member === s5.name)!;
  const listener = board.wait(s5, { timeoutMs: 10_000, mentionsOnly: true });
  const foreground = watcher.wait(watcher.participant(s5.name)!, { timeoutMs: 400 });
  assert.equal((await listener).superseded, true);
  assert.deepEqual([s5Of().state, s5Of().listening], ["working", false]);
  await foreground;
  assert.deepEqual([s5Of().state, s5Of().listening], ["working", false]);
  const first = board.wait(s5, { timeoutMs: 10_000, mentionsOnly: true });
  const second = watcher.wait(watcher.participant(s5.name)!, { timeoutMs: 400, mentionsOnly: true });
  assert.equal((await first).superseded, true);
  // D49: a held wait with no link to say it is a background listener reads waiting
  assert.deepEqual([s5Of().state, s5Of().listening], ["working", true]);
  await second;
  assert.equal(s5Of().listening, false);
});

test("end releases a pending wait of that member, empty, at once", async () => {
  const { s5 } = twoRunners();
  const other = await another(); // end from a second connection, as the member's next call would
  const waiting = board.wait(s5, { timeoutMs: 10_000, mentionsOnly: true });
  await new Promise((r) => setTimeout(r, 100));
  const t0 = Date.now();
  other.end(other.participant(s5.name)!);
  const d = await waiting;
  assert.deepEqual(d, { full: [], lines: [] });
  assert.ok(Date.now() - t0 < 1000, `released after ${Date.now() - t0} ms`);
});

test("post by an ended member throws", () => {
  const { s3 } = twoRunners();
  board.end(s3);
  assert.throws(() => board.post(s3, "late"), /review-tool\/S3 has ended/);
});

test("an agreement is a message of kind agreement", () => {
  const { s3, s5 } = twoRunners();
  const m = board.post(s3, "@S5 I own src/a.ts until my merge", { kind: "agreement", about: "src/a.ts" });
  assert.equal(board.read(m.seq).kind, "agreement");
  assert.equal(board.read(m.seq).about, "src/a.ts");
  assert.equal(board.deliver(s5).full[0].kind, "agreement");
});

// ── claims, reconcile, the merge lock (Seat 2) ──────────────────────────────────

const CHECKOUT = path.resolve("/repos/one");
const wt = (name: string): string => path.resolve(`/worktrees/${name}`);

/** S3 holds src/a.ts (declared), S5 holds src/b.ts; each in its own worktree. */
const claimed = () => {
  const run = board.openRun({ repo: REPO, group: "review-tool", title: "Review tool", seats: SLICES });
  const s3 = board.join({ run: run.id, seat: "S3", doing: "the page", files: [{ path: "src/a.ts", interface: false }], place: wt("s3") }).member;
  const s5 = board.join({ run: run.id, seat: "S5", doing: "the skill", files: [{ path: "src/b.ts", interface: false }], place: wt("s5") }).member;
  board.deliver(s3);
  board.deliver(s5);
  return { run, s3, s5 };
};

const FREE = { allowed: true, sharedWith: [], notice: null };
const noticeOf = (v: EditAllowed | EditHeld): string | null => (v.allowed ? v.notice : `refused: ${v.path}`);
// board-split V-13: a held claim's line as the answer module words it for `me`
const heldLine = (me: Participant, v: EditAllowed | EditHeld): string => (v.allowed ? "" : claimHeldLine(me, "swarm", v));

test("the first edit of a held file is held, naming the holder and the post that opens it (D41)", () => {
  const { s3, s5 } = claimed();
  assert.deepEqual(codeVerbs(board).checkEdit(s3, path.join(wt("s3"), "src/a.ts")), FREE);
  const v = codeVerbs(board).checkEdit(s5, path.join(wt("s5"), "src/a.ts"));
  assert.equal(v.allowed, false);
  const refusal = heldLine(s5, v);
  assert.match(refusal, /review-tool\/S3/);
  assert.match(refusal, /the page/);
  // V-13: the post runnable as printed, its mention the caller's own run's
  assert.match(refusal, / swarm post "@S3 <what you change>" --about src\/a\.ts --as review-tool\/S5; /);
  assert.match(refusal, /its holder answers with an agreement on who changes what, and that agreement goes\. Claim again once posted; do not wait for the agreement\.$/);
});

test("a post about the path mentioning the holder opens it; both then hold it", () => {
  const { s3, s5 } = claimed();
  codeVerbs(board).checkEdit(s5, path.join(wt("s5"), "src/a.ts"));
  board.post(s5, "@S3 I add isExpired() at the end", { about: "src/a.ts" });
  assert.deepEqual(codeVerbs(board).checkEdit(s5, path.join(wt("s5"), "src/a.ts")), {
    allowed: true,
    sharedWith: [{ member: "review-tool/S3", doing: "the page" }],
    notice: "src/a.ts is also held by review-tool/S3: the page",
  });
  assert.deepEqual(board.snapshot(REPO).files.find((f) => f.path === "src/a.ts")!.holders, ["review-tool/S3", "review-tool/S5"]);
  // the holder's next edit goes through too, told once of the newcomer
  assert.equal(noticeOf(codeVerbs(board).checkEdit(s3, "src/a.ts")), "src/a.ts is also held by review-tool/S5: the skill");
});

test("a body naming the file opens it as an about does", () => {
  const { s5 } = claimed();
  board.post(s5, "@S3 in a.ts I only append a helper");
  assert.equal(codeVerbs(board).checkEdit(s5, "src/a.ts").allowed, true);
});

test("a post about the path mentioning no holder does not open it", () => {
  const { run, s5 } = claimed();
  board.join({ run: run.id, seat: "S1", doing: "board", files: [], place: wt("s1") });
  board.post(s5, "I add isExpired() at the end", { about: "src/a.ts" });
  board.post(s5, "@S1 I add isExpired() at the end", { about: "src/a.ts" }); // S1 does not hold it
  board.post(s5, "@S3 about something else", { about: "src/b.ts" });
  assert.equal(codeVerbs(board).checkEdit(s5, "src/a.ts").allowed, false);
});

test("a path held by two opens only once every holder is mentioned, in one post or several", () => {
  const { run, s5 } = claimed();
  board.post(s5, "@S3 a helper at the end", { about: "src/a.ts" });
  codeVerbs(board).checkEdit(s5, "src/a.ts");
  const s1 = board.join({ run: run.id, seat: "S1", doing: "board", files: [], place: wt("s1") }).member;
  board.post(s1, "@S3 one line in a.ts", { about: "src/a.ts" });
  const v = codeVerbs(board).checkEdit(s1, "src/a.ts");
  assert.equal(v.allowed, false);
  assert.match(heldLine(s1, v), / swarm post "@S3 @S5 <what you change>"/);
  board.post(s1, "@S5 one line in a.ts", { about: "src/a.ts" });
  assert.equal(codeVerbs(board).checkEdit(s1, "src/a.ts").allowed, true);
});

test("the notice is given once per member and path", () => {
  const { s3, s5 } = claimed();
  board.post(s5, "@S3 a helper at the end", { about: "src/a.ts" });
  assert.deepEqual(
    [1, 2, 3].map(() => noticeOf(codeVerbs(board).checkEdit(s5, "src/a.ts"))),
    ["src/a.ts is also held by review-tool/S3: the page", null, null],
  );
  // another shared path is told of on its own
  board.post(s3, "@S5 one line in b.ts", { about: "src/b.ts" });
  assert.equal(noticeOf(codeVerbs(board).checkEdit(s3, "src/b.ts")), "src/b.ts is also held by review-tool/S5: the skill");
  assert.equal(noticeOf(codeVerbs(board).checkEdit(s3, "src/b.ts")), null);
});

test("release drops one holder of a shared path", () => {
  const { run, s3, s5 } = claimed();
  board.post(s5, "@S3 a helper at the end", { about: "src/a.ts" });
  codeVerbs(board).checkEdit(s5, "src/a.ts");
  codeVerbs(board).release(s3, "src/a.ts");
  assert.deepEqual(board.snapshot(REPO).files.find((f) => f.path === "src/a.ts")!.holders, ["review-tool/S5"]);
  const s1 = board.join({ run: run.id, seat: "S1", doing: "board", files: [], place: wt("s1") }).member;
  const v = codeVerbs(board).checkEdit(s1, "src/a.ts");
  assert.match(heldLine(s1, v), /^src\/a\.ts is also held by review-tool\/S5 \(/);
});

test("a file declared at join while another member holds it shows under both holders (D62)", () => {
  const { run } = claimed();
  board.join({ run: run.id, seat: "S1", doing: "board", files: [{ path: "src/a.ts", interface: true }], place: wt("s1") });
  assert.deepEqual(board.snapshot(REPO).files.find((f) => f.path === "src/a.ts")!.holders, ["review-tool/S3", "review-tool/S1"]);
});

test("merged mentions every other holder of a shared path", () => {
  const { run, s3, s5 } = claimed();
  const s1 = board.join({ run: run.id, seat: "S1", doing: "board", files: [], place: wt("s1") }).member;
  for (const p of [s1, s5]) {
    board.post(p, "@S3 @S1 my part of a.ts", { about: "src/a.ts" });
    assert.equal(codeVerbs(board).checkEdit(p, "src/a.ts").allowed, true);
  }
  for (const p of [s1, s3, s5]) board.deliver(p);
  codeVerbs(board).lockMerge(s3);
  codeVerbs(board).merged(s3, "abc123", ["src/a.ts"]);
  const m = board.deliver(s5).full[0];
  assert.match(m.body, /^merged abc123: rebase your branch onto it./);
  assert.deepEqual([...m.mentions].sort(), ["review-tool/S1", "review-tool/S5"]);
  assert.equal(board.deliver(s1).full[0].seq, m.seq);
});

test("a member is given a funny name at join, unique on the repository; @Name mentions it (D43)", () => {
  const run = board.openRun({ repo: REPO, group: "review-tool", title: "R", seats: SLICES });
  const other = board.openRun({ repo: REPO, group: "swarm", title: "B", seats: [{ id: "S1", blockers: [] }] });
  const many = Array.from({ length: 30 }, (_, i) => { board.addSeat(run.id, { id: `T${i}`, blockers: [] }); return board.join({ run: run.id, seat: `T${i}`, doing: "x", files: [] }).member; });
  const far = board.join({ run: other.id, seat: "S1", doing: "y", files: [] }).member;
  const nicks = [...many, far].map((p) => p.nick);
  assert.ok(nicks.every((n) => /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(n)), nicks.join(", "));
  assert.equal(new Set(nicks).size, nicks.length, "unique among the repository's active members");
  // the orchestrator is given one at open too (D17), unique with the members'
  const orch = board.participant("review-tool/orchestrator")!.nick;
  assert.match(orch, /^[A-Z][a-z]+ [A-Z][a-z]+$/);
  assert.ok(!nicks.includes(orch));
  // kept for the run: a second join of the seat keeps it
  assert.equal(board.join({ run: run.id, seat: "T0", doing: "again", files: [] }).member.nick, many[0].nick);
  assert.equal(board.roster(REPO).find((r) => r.name === far.name)!.nick, far.nick);
  // @SleepyOtter is a mention of that member, across plans
  const m = board.post(many[1], `@${far.nick.replace(" ", "")} your schema`);
  assert.deepEqual(m.mentions, [far.name]);
});

test("holds the first edit across two runs on one repository", () => {
  claimed();
  const other = board.openRun({ repo: REPO, group: "swarm", title: "B", seats: SLICES });
  const s1 = board.join({ run: other.id, seat: "S1", doing: "board", files: [], place: wt("swarm-s1") }).member;
  const v = codeVerbs(board).checkEdit(s1, path.join(wt("swarm-s1"), "src/b.ts"));
  assert.equal(v.allowed, false);
  assert.match(heldLine(s1, v), /held by review-tool\/S5 \(\w+ \w+: the skill\)/);
  // a run on another repository holds nothing here
  const far = board.openRun({ repo: "/repos/two/.git", group: "far", title: "C", seats: SLICES });
  const f1 = board.join({ run: far.id, seat: "S1", doing: "x", files: [], place: wt("far") }).member;
  assert.deepEqual(codeVerbs(board).checkEdit(f1, path.join(wt("far"), "src/b.ts")), FREE);
});

test("widens the claim on a free undeclared path, silently", () => {
  const { s3, s5 } = claimed();
  assert.deepEqual(codeVerbs(board).checkEdit(s3, path.join(wt("s3"), "src/new.ts")), FREE);
  const v = codeVerbs(board).checkEdit(s5, path.join(wt("s5"), "src/new.ts"));
  assert.equal(v.allowed, false);
  assert.match(heldLine(s5, v), /src\/new\.ts is also held by review-tool\/S3/);
});

test("a worktree path and the checkout path are one claim", () => {
  const { s3, s5 } = claimed();
  assert.equal(codeVerbs(board).checkEdit(s5, path.join(CHECKOUT, "src", "a.ts")).allowed, false);
  assert.equal(codeVerbs(board).checkEdit(s5, path.join(wt("s5"), "src", "a.ts")).allowed, false);
  assert.equal(codeVerbs(board).checkEdit(s5, "src/a.ts").allowed, false);
  codeVerbs(board).checkEdit(s3, path.join(CHECKOUT, "src", "c.ts"));
  assert.equal(codeVerbs(board).checkEdit(s5, path.join(wt("s5"), "src", "c.ts")).allowed, false);
  // outside every root of the repository: no claim at all
  assert.deepEqual(codeVerbs(board).checkEdit(s5, path.resolve("/elsewhere/src/a.ts")), FREE);
});

test("end releases the claims", () => {
  const { s3, s5 } = claimed();
  board.end(s3);
  assert.deepEqual(codeVerbs(board).checkEdit(s5, path.join(wt("s5"), "src/a.ts")), FREE);
});

test("claims a free file written outside the claim", () => {
  const { s3, s5 } = claimed();
  assert.deepEqual(codeVerbs(board).reconcileWrites(s5, ["src/free.ts", "src/b.ts"]), []);
  const v = codeVerbs(board).checkEdit(s3, path.join(wt("s3"), "src/free.ts"));
  assert.equal(v.allowed, false);
  assert.match(heldLine(s3, v), /held by review-tool\/S5/);
});

test("flags a held file written outside the claim, mentioning both", () => {
  const { s3, s5 } = claimed();
  const flags = codeVerbs(board).reconcileWrites(s5, ["src/a.ts"]);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].path, "src/a.ts");
  assert.equal(flags[0].holder, "review-tool/S3");
  const m = board.read(flags[0].seq);
  assert.deepEqual([...m.mentions].sort(), ["review-tool/S3", "review-tool/S5"]);
  assert.equal(m.about, "src/a.ts");
  assert.deepEqual(board.deliver(s3).full.map((x) => x.seq), [flags[0].seq]);
  // the holder keeps it
  assert.equal(codeVerbs(board).checkEdit(s5, "src/a.ts").allowed, false);
});

test("grants the lock to one member at a time", () => {
  const { s3, s5 } = claimed();
  assert.deepEqual(codeVerbs(board).lockMerge(s3), { granted: true });
  assert.deepEqual(codeVerbs(board).lockMerge(s5), { granted: false, holder: "review-tool/S3" });
  assert.deepEqual(codeVerbs(board).lockMerge(s3), { granted: true });
  codeVerbs(board).merged(s3, "abc123", ["src/a.ts"]);
  assert.deepEqual(codeVerbs(board).lockMerge(s5), { granted: true });
});

test("a member refused the lock hears its release by merged in a mentions-only wait (D65)", async () => {
  const { s3, s5 } = claimed();
  assert.deepEqual(codeVerbs(board).lockMerge(s3), { granted: true });
  assert.deepEqual(codeVerbs(board).lockMerge(s5), { granted: false, holder: "review-tool/S3" });
  const merger = await another();
  // S3 merged a file S5 neither holds nor declared: only the refusal makes S5 a reader
  setTimeout(() => codeVerbs(merger).merged(merger.participant(s3.name)!, "abc123", ["src/a.ts"]), 100);
  const d = await board.wait(s5, { timeoutMs: 5000, mentionsOnly: true });
  assert.equal(d.full.length, 1);
  assert.match(d.full[0].body, /the merge lock is free: @review-tool\/S5/);
  assert.ok(d.full[0].mentions.includes("review-tool/S5"));
  // the record is cleared: the next merge does not mention S5 again
  assert.deepEqual(codeVerbs(board).lockMerge(s3), { granted: true });
  codeVerbs(board).merged(s3, "def456", ["src/a.ts"]);
  assert.equal(board.deliver(s5).full.length, 0);
});

test("a member refused the lock hears its release by the holder's end (D65)", async () => {
  const { s3, s5 } = claimed();
  assert.deepEqual(codeVerbs(board).lockMerge(s3), { granted: true });
  assert.deepEqual(codeVerbs(board).lockMerge(s5), { granted: false, holder: "review-tool/S3" });
  const ender = await another();
  setTimeout(() => ender.end(ender.participant(s3.name)!), 100);
  const d = await board.wait(s5, { timeoutMs: 5000, mentionsOnly: true });
  assert.equal(d.full.length, 1);
  assert.match(d.full[0].body, /the merge lock is free: @review-tool\/S5/);
  assert.deepEqual(codeVerbs(board).lockMerge(s5), { granted: true });
});

test("a refusal recorded under one holder is not carried to the next (D65)", () => {
  const { run, s3, s5 } = claimed();
  const s1 = board.join({ run: run.id, seat: "S1", doing: "board", files: [], place: wt("s1") }).member;
  board.deliver(s3);
  board.deliver(s5);
  board.deliver(s1);
  codeVerbs(board).lockMerge(s3);
  codeVerbs(board).lockMerge(s5); // refused under S3
  board.end(s3); // tells S5, clears the record
  assert.equal(board.deliver(s5).full.length, 1);
  assert.deepEqual(codeVerbs(board).lockMerge(s1), { granted: true });
  codeVerbs(board).merged(s1, "abc123", ["src/c.ts"]);
  assert.equal(board.deliver(s5).full.length, 0, "S5 was not refused under S1");
});

test("merged releases the lock and mentions holders and declarers", () => {
  const { run, s3, s5 } = claimed();
  // S1 declares src/b.ts, which S5 holds: a declarer, not a holder
  const s1 = board.join({ run: run.id, seat: "S1", doing: "board", files: [{ path: "src/b.ts", interface: false }], place: wt("s1") }).member;
  board.deliver(s3);
  board.deliver(s5);
  board.deliver(s1);
  const merger = board.participant("review-tool/orchestrator")!;
  assert.deepEqual(codeVerbs(board).lockMerge(merger), { granted: true });
  codeVerbs(board).merged(merger, "abc123", ["src/b.ts"]);
  assert.deepEqual(codeVerbs(board).lockMerge(s3), { granted: true }, "the lock was released");

  const forS5 = board.deliver(s5).full;
  const forS1 = board.deliver(s1).full;
  assert.equal(forS5.length, 1);
  assert.equal(forS1.length, 1);
  assert.equal(forS5[0].seq, forS1[0].seq);
  assert.match(forS5[0].body, /^merged abc123: rebase your branch onto it./);
  assert.deepEqual([...forS5[0].mentions].sort(), ["review-tool/S1", "review-tool/S5"]);
  // S3 neither holds nor declared src/b.ts: one line, not in full
  const forS3 = board.deliver(s3);
  assert.equal(forS3.full.length, 0);
  assert.equal(forS3.lines.length, 1);
});

test("an interface file in a merge is announced to @swarm, and reaches the other run's members", () => {
  const run = board.openRun({ repo: REPO, group: "review-tool", title: "A", seats: SLICES });
  const s3 = board.join({ run: run.id, seat: "S3", doing: "api", files: [{ path: "src/api.ts", interface: true }], place: wt("s3") }).member;
  const s5 = board.join({ run: run.id, seat: "S5", doing: "x", files: [], place: wt("s5") }).member;
  const other = board.openRun({ repo: REPO, group: "swarm", title: "B", seats: SLICES });
  const far = board.join({ run: other.id, seat: "S1", doing: "y", files: [], place: wt("far") }).member;
  for (const p of [s3, s5, far]) board.deliver(p);
  codeVerbs(board).lockMerge(s3);
  codeVerbs(board).merged(s3, "def456", [path.join(wt("s3"), "src", "api.ts")]);
  for (const p of [s5, far]) {
    const d = board.deliver(p);
    assert.equal(d.full.length, 1, `${p.name} got the announcement in full`);
    assert.match(d.full[0].body, /@swarm interface changed: src\/api\.ts/);
    assert.match(d.full[0].body, /^merged def456: rebase your branch onto it./);
  }
});

test("a plan merge of an interface file never mentions a brainstorm seat subscribed to nothing, and stays in its run (D70)", async () => {
  const run = board.openRun({ repo: REPO, group: "review-tool", title: "A", seats: SLICES });
  const s3 = board.join({ run: run.id, seat: "S3", doing: "api", files: [{ path: "src/api.ts", interface: true }], place: wt("s3") }).member;
  const debate = board.openRun({ repo: REPO, kind: "brainstorm", group: "topic", title: "T", seats: SLICES });
  const seat = board.join({ run: debate.id, seat: "S1", doing: "arguing", files: [], on: [] }).member;
  board.deliver(seat);
  codeVerbs(board).lockMerge(s3);
  codeVerbs(board).merged(s3, "def456", [path.join(wt("s3"), "src", "api.ts")]);
  const event = board.snapshot(REPO).events.find((e) => /^merged def456: rebase your branch onto it./.test(e.body))!;
  assert.ok(!board.read(event.seq).mentions.includes("topic/*"), "the seat's run is not @all-ed");
  assert.notEqual(event.channel, "main");
  const { wakes } = await import("../src/board/events.ts");
  assert.equal(wakes(board.read(event.seq), seat, []), false);
  assert.equal(board.deliver(seat).full.length, 0);
});

test("identify resolves the live member from its worktree, a subdirectory included (D28)", () => {
  const { s3, s5 } = claimed();
  assert.equal(board.identify({ place: path.join(wt("s3"), "src") })?.name, s3.name);
  assert.equal(board.identify({ place: wt("s5") })?.name, s5.name);
  assert.equal(board.identify({}), null);
  board.end(s5);
  assert.equal(board.identify({ place: wt("s5") }), null);
});

test("unknown run, member and seq are named", () => {
  assert.throws(() => board.join({ run: 42, seat: "S1", doing: "x", files: [] }), /unknown run 42/);
  assert.equal(board.participant("nobody/S9"), null);
  assert.throws(() => board.read(99), /unknown message #99/);
});

// ── the page's view: repos, snapshot, onChange (Seat 3, D39) ─────────────────────

test("a snapshot shows two plans on one repository", () => {
  const { s3 } = claimed();
  const other = board.openRun({ repo: REPO, group: "swarm", title: "B", seats: SLICES });
  const s1 = board.join({ run: other.id, seat: "S1", doing: "board", files: [{ path: "src/api.ts", interface: true }], place: wt("swarm-s1") }).member;
  board.post(s3, "@swarm/S1 one thread", { about: "src/a.ts" });
  codeVerbs(board).lockMerge(s1);

  const snap = board.snapshot(REPO);
  assert.equal(snap.repo, REPO);
  assert.equal(snap.name, "one");
  assert.deepEqual(
    snap.runs.map((r) => [r.plan, r.code, r.title, r.open, r.members, r.done, r.of]),
    [
      ["review-tool", "RT", "Review tool", true, 2, 0, 3],
      ["swarm", "SW", "B", true, 1, 0, 3],
    ],
  );
  assert.deepEqual(Object.keys(snap.queues).sort(), ["review-tool", "swarm"]);
  assert.deepEqual(
    snap.queues["review-tool"].map((q) => [q.seat, q.role, q.state, q.blockers, q.member]),
    [
      ["S1", "the board", "empty", [], null],
      ["S3", "the page", "working", ["S1"], "review-tool/S3"],
      ["S5", "the skill", "working", [], "review-tool/S5"],
    ],
  );
  const by = Object.fromEntries(snap.roster.map((r) => [r.member, r]));
  assert.deepEqual(Object.keys(by).sort(), ["review-tool/S3", "review-tool/S5", "review-tool/orchestrator", "swarm/S1", "swarm/orchestrator"]);
  assert.equal(by["review-tool/orchestrator"].state, "working"); // the orchestrator owes its run
  assert.equal(by["review-tool/S3"].state, "working");
  assert.equal(by["review-tool/S3"].role, "the page");
  assert.equal(by["review-tool/S3"].doing, "the page");
  assert.deepEqual(by["review-tool/S3"].files, [{ path: "src/a.ts", interface: false, shared: false }]);
  // the lock is the code pack's fact, beside the state: its holder reads merging
  assert.deepEqual([by["swarm/S1"].state, by["swarm/S1"].fact], ["working", "merging"]);
  assert.deepEqual(by["swarm/S1"].files, [{ path: "src/api.ts", interface: true, shared: false }]);
  assert.deepEqual(snap.lock && snap.lock.holder, "swarm/S1");
  const last = snap.events.at(-1)!;
  assert.deepEqual([last.kind, last.from, last.body, last.about], ["msg", "review-tool/S3", "@swarm/S1 one thread", "src/a.ts"]);
  assert.ok(snap.events.every((e, i) => i === 0 || e.seq > snap.events[i - 1].seq), "oldest first");
  // another repository is not in it, and an unknown one is named
  assert.throws(() => board.snapshot("/repos/none/.git"), /no project \/repos\/none\/\.git/);
});

test("a member's state: ended, working", async () => {
  const { run, s3, s5 } = claimed();
  const waiting = board.wait(s5, { timeoutMs: 400 });
  // board-split D49: waiting is the held wait, read where it is held
  assert.equal(board.snapshot(REPO).roster.find((r) => r.member === s5.name)!.state, "working");
  await waiting;
  board.end(s5);
  const by = Object.fromEntries(board.snapshot(REPO).roster.map((r) => [r.member, r.state]));
  assert.equal(by[s5.name], "ended");
  assert.equal(by[s3.name], "working");
  assert.equal(board.runs().find((r) => r.id === run.id)!.seats.find((x) => x.id === "S5")!.state, "ended");
});

test("a pending mentions-only wait is listening; working while its open call is another (D49), a plain wait is waiting", async () => {
  const { s5 } = twoRunners();
  const s5Of = () => board.snapshot(REPO).roster.find((r) => r.member === s5.name)!;
  assert.equal(s5Of().listening, false);
  const listening = board.wait(s5, { timeoutMs: 300, mentionsOnly: true });
  const t = Date.now();
  board.recordActivity(s5.run, "S5", { grewAt: t, tokens: 0, context: null, openTool: { name: "Bash", target: "npm test", since: t, boardWait: false }, lastTool: null, finished: false }, new Date(t));
  assert.deepEqual([s5Of().state, s5Of().listening], ["working", true]);
  await listening;
  assert.equal(s5Of().listening, false);
  board.recordActivity(s5.run, "S5", { grewAt: t, tokens: 0, context: null, openTool: { name: "Bash", target: "swarm wait", since: t, boardWait: true }, lastTool: null, finished: false }, new Date(t));
  const waiting = board.wait(s5, { timeoutMs: 300 });
  assert.deepEqual([s5Of().state, s5Of().listening], ["working", false]);
  await waiting;
  assert.equal(s5Of().state, "working");
});

test("a closed run stays in repos() within the retention, however many closed after it (D46)", () => {
  const first = board.openRun({ repo: REPO, group: "old", title: "Old", seats: SLICES });
  board.closeRun(first.id);
  const open = board.openRun({ repo: "/repos/two/.git", group: "live", title: "Live", seats: SLICES });
  let repos = board.repos();
  assert.deepEqual(repos.map((r) => r.repo), ["/repos/two/.git", REPO], "a repository with an open run first");
  assert.deepEqual(repos[1].runs.map((r) => [r.plan, r.open]), [["old", false]]);
  assert.equal(board.snapshot(REPO).roster.find((r) => r.member === "old/orchestrator")!.state, "ended");
  // ten later closed runs no longer push it out; the open one stays first
  for (let i = 0; i < 10; i++) board.closeRun(board.openRun({ repo: "/repos/three/.git", group: `p${i}`, title: "x", seats: SLICES }).id);
  repos = board.repos();
  assert.deepEqual(repos.map((r) => r.repo), ["/repos/two/.git", "/repos/three/.git", REPO]);
  assert.equal(repos[1].runs.length, 10);
  assert.ok(repos[0].runs.some((r) => r.run === open.id));
});

test("each write fires onChange once with its repository", async () => {
  const watcher = await another(); // a second connection: the page server's
  const seen: string[] = [];
  const off = watcher.onChange((repo) => seen.push(repo));
  const settle = async (what: string): Promise<void> => {
    const t0 = Date.now();
    while (!seen.length && Date.now() - t0 < 1500) await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => setTimeout(r, 150)); // a second call would land here
    assert.deepEqual(seen, [REPO], `${what}: ${JSON.stringify(seen)}`);
    seen.length = 0;
  };
  const run = board.openRun({ repo: REPO, group: "review-tool", title: "R", seats: SLICES });
  await settle("open a run");
  const s3 = board.join({ run: run.id, seat: "S3", doing: "page", files: [{ path: "src/a.ts", interface: false }], place: wt("s3") }).member;
  await settle("join");
  board.post(s3, "hello");
  await settle("post");
  codeVerbs(board).checkEdit(s3, "src/new.ts");
  await settle("claim widened");
  codeVerbs(board).release(s3, "src/new.ts");
  await settle("claim released");
  codeVerbs(board).lockMerge(s3);
  await settle("lock taken");
  codeVerbs(board).merged(s3, "abc", ["src/a.ts"]);
  await settle("lock released");
  board.end(s3);
  await settle("end");
  board.closeRun(run.id);
  await settle("close the run");
  off();
});

// plan D55 (4): a fact write moves the version in its own write, so a snapshot reader hears it within one tick
test("a link fact written reaches an onChange reader within one tick, its link up and its link down", async () => {
  const run = board.openRun({ repo: REPO, group: "review-tool", title: "R", seats: SLICES });
  board.join({ run: run.id, seat: "S3", doing: "page", files: [], place: wt("s3") });
  const watcher = await another();
  const seen: string[] = [];
  const off = watcher.onChange((repo) => seen.push(repo));
  const heard = async (what: string): Promise<void> => {
    const t0 = Date.now();
    while (!seen.length && Date.now() - t0 < 1500) await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(seen, [REPO], `${what}: ${JSON.stringify(seen)}`);
    seen.length = 0;
  };
  board.recordLink(run.id, "S3", { connected: true, lostAt: null });
  await heard("link up");
  board.recordLink(run.id, "S3", { connected: false, lostAt: Date.now() });
  await heard("link down");
  off();
});

test("calls counts every board call of a member, one each, a wait's looks none (D66)", async () => {
  const { s3, s5 } = claimed();
  const calls = () => board.snapshot(REPO).roster.find((r) => r.member === s3.name)!.calls;
  const step = (what: string, call: () => unknown): void => {
    const before = calls();
    call();
    assert.equal(calls(), before + 1, what);
  };
  step("claim", () => codeVerbs(board).checkEdit(s3, path.join(wt("s3"), "src/c.ts")));
  step("post", () => board.post(s3, "@S5 a word"));
  step("agree", () => board.post(s3, "S3 changes c.ts", { kind: "agreement", with: ["orchestrator"] }));
  step("doing", () => board.setDoing(s3, "the tests"));
  step("deliver", () => board.deliver(s3));
  const seq = board.post(s5, "@S3 hello").seq;
  step("read", () => board.read(seq, s3));
  step("release", () => codeVerbs(board).release(s3, path.join(wt("s3"), "src/c.ts")));
  step("merge-lock", () => codeVerbs(board).lockMerge(s3));
  step("merged", () => codeVerbs(board).merged(s3, "abc123", []));
  board.deliver(s3); // nothing left for s3: the wait below times out after several looks
  const before = calls();
  await board.wait(s3, { timeoutMs: 1300 }); // more than one look: the poll runs every second
  assert.equal(calls(), before + 1, "wait");
  step("end", () => board.end(s3));
  // a read with no member, and a refused call, count none
  const after = calls();
  board.read(seq);
  assert.throws(() => board.post(s3, "too late"));
  assert.equal(calls(), after);
});

test("an ended member's doing says how it ended, and its end time is kept (D66)", () => {
  const { s3, s5 } = claimed();
  board.setDoing(s3, "writing src/cli.js");
  board.setDoing(s5, "writing src/b.ts");
  assert.deepEqual(codeVerbs(board).lockMerge(s3), { granted: true });
  codeVerbs(board).merged(s3, "abc123", []);
  board.end(s3);
  board.end(s5);
  const by = Object.fromEntries(board.snapshot(REPO).roster.map((r) => [r.member, r]));
  assert.equal(by[s3.name].doing, "merged and ended");
  assert.equal(by[s5.name].doing, "ended");
  for (const r of [by[s3.name], by[s5.name]]) {
    assert.ok(r.ended && Date.parse(r.ended) >= Date.parse(r.joined), `${r.member} ended ${r.ended}`);
  }
});

test("a member joined again starts unmerged and live (D66)", () => {
  const { run, s3 } = claimed();
  codeVerbs(board).lockMerge(s3);
  codeVerbs(board).merged(s3, "abc123", []);
  board.end(s3);
  const again = board.join({ run: run.id, seat: "S3", doing: "a second pass", files: [], place: wt("s3") }).member;
  assert.equal(board.snapshot(REPO).roster.find((r) => r.member === again.name)!.ended, null);
  board.end(again);
  assert.equal(board.snapshot(REPO).roster.find((r) => r.member === again.name)!.doing, "ended");
});

test("a flag appears and clears with its claim", () => {
  const { s3, s5 } = claimed();
  codeVerbs(board).reconcileWrites(s5, ["src/a.ts", "src/free.ts"]);
  assert.deepEqual(board.snapshot(REPO).flags, [
    { path: "src/a.ts", member: "review-tool/S5" },
    { path: "src/free.ts", member: "review-tool/S5" },
  ]);
  codeVerbs(board).release(s3, "src/a.ts"); // the holder's claim goes, and with it the flag
  codeVerbs(board).release(s5, "src/free.ts");
  assert.deepEqual(board.snapshot(REPO).flags, []);
});

test("a run and its slices carry their links, opaque, to the snapshot (D44)", () => {
  board.openRun({
    repo: REPO,
    group: "review-tool",
    title: "R",
    link: "http://localhost:4321/d/12",
    seats: [
      { id: "S1", blockers: [], link: "http://localhost:4321/d/13" },
      { id: "S3", blockers: ["S1"] },
    ],
  });
  const snap = board.snapshot(REPO);
  assert.equal(snap.runs[0].link, "http://localhost:4321/d/12");
  assert.deepEqual(snap.queues["review-tool"].map((q) => [q.seat, q.link]), [["S1", "http://localhost:4321/d/13"], ["S3", null]]);
  assert.equal(board.runs()[0].link, "http://localhost:4321/d/12");
});

test("a store from before shared claims is rebuilt keyed by holder, its claims kept", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const file = path.join(dir, "old.sqlite");
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE claims (repo TEXT NOT NULL, path TEXT NOT NULL, participant INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'inside', PRIMARY KEY (repo, path));
           INSERT INTO claims VALUES ('${REPO}', 'src/a.ts', 2, 'interface');`);
  db.close();
  const old = await openBoard(file);
  opened.push(old);
  const run = old.openRun({ repo: REPO, group: "review-tool", title: "R", seats: SLICES }); // participant 1, the orchestrator
  const s3 = old.join({ run: run.id, seat: "S3", doing: "the page", files: [] }).member; // participant 2
  const s5 = old.join({ run: run.id, seat: "S5", doing: "the skill", files: [] }).member;
  assert.equal(s3.id, 2);
  assert.deepEqual(old.snapshot(REPO).files, [{ path: "src/a.ts", holders: ["review-tool/S3"], interface: true }]);
  old.post(s5, "@S3 one helper", { about: "src/a.ts" });
  assert.equal(codeVerbs(old).checkEdit(s5, "src/a.ts").allowed, true);
  assert.deepEqual(old.snapshot(REPO).files[0].holders, ["review-tool/S3", "review-tool/S5"]);
});

// One conversation (plan D1, D2): every item carries its author's run; another run's member is
// reached only by what is its own.
const twoRuns = () => {
  const { run, s3, s5 } = twoRunners();
  const other = board.openRun({ repo: REPO, group: "swarm", title: "B", seats: SLICES });
  const far = board.join({ run: other.id, seat: "S1", doing: "board", files: [] }).member;
  const near = board.join({ run: other.id, seat: "S3", doing: "page", files: [] }).member;
  for (const p of [s3, s5, far, near]) board.deliver(p);
  return { run, other, s3, s5, far, near };
};

test("the hard rule: run A's plain post reaches run B neither in full nor as a line; a mention, an agreement about a held path, a subscribed any: event and an urgent post do (D2)", () => {
  const { run, s3, s5, far } = twoRuns();
  const m = board.post(s3, "@S5 I take the header");
  assert.equal(m.run, run.id);
  assert.equal(board.deliver(s5).full.length, 1);
  assert.deepEqual(board.deliver(far), { full: [], lines: [] });
  board.post(s3, "nothing for anyone");
  board.setDoing(s3, "the header"); // an event far did not subscribe to
  assert.equal(board.deliver(s5).lines.length, 2);
  assert.deepEqual(board.deliver(far), { full: [], lines: [] });

  const mention = board.post(s3, "@SW·S1 your schema touches mine");
  assert.deepEqual(board.deliver(far).full.map((x) => x.seq), [mention.seq]);

  assert.equal(codeVerbs(board).checkEdit(far, "src/x.ts").allowed, true);
  const agreement = board.post(s3, "S1 first, then S3", { about: "src/x.ts", kind: "agreement", with: ["orchestrator"] });
  assert.deepEqual(board.deliver(far).full.map((x) => x.seq), [agreement.seq]);

  board.subscribe(far, [{ event: "ended", scope: "any" }]);
  board.end(s5);
  const ended = board.deliver(far);
  assert.deepEqual(ended.full, []);
  assert.equal(ended.lines.length, 1);
  assert.match(ended.lines[0], /ended/);

  board.post(s3, "fire", { kind: "urgent" });
  const urgent = board.deliver(far);
  assert.equal(urgent.lines.length, 1);
  assert.match(urgent.lines[0], /fire/);
});

test("a mention across runs keeps its author's run and ends the other member's wait --mentions", async () => {
  const { run, s3, far } = twoRuns();
  const waiting = board.wait(far, { mentionsOnly: true, timeoutMs: 5000 });
  const m = board.post(s3, "@swarm/S1 your schema touches mine");
  assert.equal(m.run, run.id);
  const got = await waiting;
  assert.deepEqual(got.full.map((x) => x.seq), [m.seq]);
});

test("@<CODE> across runs reaches every member of that run, and no one of the sender's (D3)", () => {
  const { s3, s5, far, near } = twoRuns();
  const m = board.post(s3, "@SW the schema moved");
  assert.deepEqual(m.mentions, ["swarm/*"]);
  assert.equal(board.deliver(far).full.length, 1);
  assert.equal(board.deliver(near).full.length, 1);
  assert.deepEqual(board.deliver(s5).full, []); // its own run's talk, a line
});

test("an event keeps its author's run; the snapshot's events carry run, its members lastCall (D13, D21)", () => {
  const { run, s3, s5, far } = twoRuns();
  board.setDoing(s3, "the header");
  const got = board.deliver(s5);
  assert.equal(got.lines.length, 1);
  assert.match(got.lines[0], /doing: the header/);
  assert.deepEqual(board.deliver(far), { full: [], lines: [] });
  const snap = board.snapshot(REPO);
  const doing = snap.events.find((e) => e.body === "doing: the header")!;
  assert.equal(doing.run, run.id);
  assert.ok(snap.events.every((e) => typeof e.run === "number"));
  for (const r of snap.roster) assert.ok(!Number.isNaN(Date.parse(r.lastCall)), r.member);
  assert.deepEqual(snap.runs.map((r) => [r.kind, r.group]), [["plan", "review-tool"], ["plan", "swarm"]]);
});

test("a closed run refuses a post", () => {
  const { run, s3 } = twoRuns();
  board.closeRun(run.id);
  assert.throws(() => board.post(s3, "late"), new RegExp(`run ${run.id} is closed|has ended`));
});

test("endorse backs an agreement: a mention of its author, its about copied", () => {
  const { s3, s5 } = twoRuns();
  const a = board.post(s3, "S3 changes the header, S5 the footer", { about: "src/page.ts", kind: "agreement", with: ["orchestrator"] });
  const e = board.endorse(s5, a.seq);
  assert.equal(e.kind, "endorsement");
  assert.equal(e.body, `endorses #${a.seq}`);
  assert.equal(e.about, "src/page.ts");
  assert.equal(e.endorses, a.seq);
  assert.deepEqual(e.mentions, [s3.name]);
  assert.equal(board.deliver(s3).full.some((x) => x.seq === e.seq), true);
  assert.equal(board.endorse(s5, a.seq).endorses, a.seq); // twice, recorded twice
  const plain = board.post(s3, "just talk");
  assert.throws(() => board.endorse(s5, plain.seq), new RegExp(`#${plain.seq} is not an agreement`));
  assert.throws(() => board.endorse(s3, a.seq), /your own agreement/);
});

test("an agreement about a path held by members of two runs keeps its author's run and reaches the other holder", () => {
  const { run, other, s3, far } = twoRuns();
  assert.equal(codeVerbs(board).checkEdit(far, "src/x.ts").allowed, true);
  board.post(s3, "@swarm/S1 I add a helper to src/x.ts", { about: "src/x.ts" });
  assert.equal(codeVerbs(board).checkEdit(s3, "src/x.ts").allowed, true);
  const a = board.post(far, "S1 first, then S3", { about: "src/x.ts", kind: "agreement", with: ["orchestrator"] });
  assert.equal(a.run, other.id);
  assert.ok(board.deliver(s3).full.some((x) => x.seq === a.seq));
  const e = board.endorse(s3, a.seq);
  assert.equal(e.run, run.id);
  assert.ok(board.deliver(far).full.some((x) => x.seq === e.seq));
});

// A brainstorm run (D3, D21, D22): seats with no worktree and no claims.
test("a brainstorm run refuses files, worktrees and every code verb, writing nothing", () => {
  const run = board.openRun({ repo: REPO, kind: "brainstorm", group: "ideas", title: "Ideas", seats: [{ id: "critic", role: "critic", blockers: [] }] });
  assert.equal(run.kind, "brainstorm");
  const before = JSON.stringify(board.snapshot(REPO));
  assert.throws(() => board.join({ run: run.id, seat: "critic", doing: "x", files: [{ path: "src/a.ts", interface: false }] }), /join: a brainstorm run has no claims/);
  assert.equal(JSON.stringify(board.snapshot(REPO)), before);
  const seat = board.join({ run: run.id, seat: "critic", doing: "reading", files: [], place: dir }).member;
  assert.equal(seat.place, null);
  assert.equal(seat.kind, "brainstorm");
  const unchanged = JSON.stringify(board.snapshot(REPO));
  const verbs: [string, () => unknown][] = [
    ["check-edit", () => codeVerbs(board).checkEdit(seat, "src/a.ts")],
    ["reconcile", () => codeVerbs(board).reconcileWrites(seat, ["src/a.ts"])],
    ["release", () => codeVerbs(board).release(seat, "src/a.ts")],
    ["lock-merge", () => codeVerbs(board).lockMerge(seat)],
    ["merged", () => codeVerbs(board).merged(seat, "abc", ["src/a.ts"])],
  ];
  // a seat with no pack is refused the code verb, the fact the answer module words (D12)
  for (const [verb, call] of verbs) {
    assert.throws(call, (e: unknown) => e instanceof PackVerbRefused && e.fact.refused.reason === "no-pack" && e.fact.refused.verb === verb);
    assert.equal(JSON.stringify(board.snapshot(REPO)), unchanged, verb);
  }
});

test("a store from before channels opens: a row with run null reads as its author's run, its runs as plan, and an open run keeps going (D13)", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const file = path.join(dir, "before-channels.sqlite");
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE runs (id INTEGER PRIMARY KEY, repo TEXT NOT NULL, plan TEXT NOT NULL, title TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'open', opened_at TEXT NOT NULL, closed_at TEXT, link TEXT);
    CREATE TABLE participants (id INTEGER PRIMARY KEY, run INTEGER NOT NULL, seat TEXT NOT NULL, worktree TEXT, doing TEXT NOT NULL DEFAULT '', files TEXT NOT NULL DEFAULT '[]', since_seq INTEGER NOT NULL DEFAULT 0, joined_at TEXT NOT NULL, ended_at TEXT, last_call TEXT, nick TEXT, UNIQUE (run, seat));
    CREATE TABLE messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, repo TEXT NOT NULL, author INTEGER NOT NULL, body TEXT NOT NULL, about TEXT, kind TEXT NOT NULL DEFAULT 'msg', mentions TEXT NOT NULL DEFAULT '[]', at TEXT NOT NULL, by_board INTEGER NOT NULL DEFAULT 0);
    INSERT INTO runs (id, repo, plan, title, opened_at) VALUES (1, '${REPO}', 'old', 'Old', '2026-10-01T00:00:00Z');
    INSERT INTO participants (id, run, seat, joined_at) VALUES (1, 1, 'orchestrator', '2026-10-01T00:00:00Z');
    INSERT INTO participants (id, run, seat, joined_at, nick) VALUES (2, 1, 'S3', '2026-10-01T00:00:00Z', 'Sleepy Otter');
    INSERT INTO participants (id, run, seat, joined_at, nick) VALUES (3, 1, 'S5', '2026-10-01T00:00:00Z', 'Hasty Crane');
    INSERT INTO messages (repo, author, body, mentions, at) VALUES ('${REPO}', 2, '@S5 before', '["old/S5"]', '2026-10-01T00:00:01Z');
  `);
  db.close();
  const old = await openBoard(file);
  opened.push(old);
  opened.push(await openBoard(file)); // the upkeep is idempotent
  assert.equal(old.read(1).run, 1);
  assert.equal(old.runs()[0].kind, "plan");
  const s3 = old.participant("old/S3")!;
  const s5 = old.participant("old/S5")!;
  assert.equal(s3.kind, "plan");
  assert.deepEqual(old.deliver(s5).full.map((m) => m.seq), [1]); // an old message mentioning it
  const m = old.post(s3, "@S5 after");
  assert.equal(m.run, 1);
  assert.deepEqual(old.deliver(s5).full.map((x) => x.seq), [m.seq]);
  assert.equal(codeVerbs(old).checkEdit(s3, "src/a.ts").allowed, true);
  assert.deepEqual(old.snapshot(REPO).files, [{ path: "src/a.ts", holders: ["old/S3"], interface: false }]);
});

// D59: subscriptions and the wake rule; D60: a seat added mid-run
const SEATS = [
  { id: "architect", blockers: [] },
  { id: "skeptic", blockers: [], on: ["agreement"] },
];

test("join: --on over the seat row's on over the kind's defaults, per role", () => {
  const plan = board.openRun({ repo: REPO, group: "review-tool", title: "R", seats: SLICES });
  assert.deepEqual(board.join({ run: plan.id, seat: "S3", doing: "x", files: [] }).member.subscriptions, []);
  assert.deepEqual(board.participant("review-tool/orchestrator")!.subscriptions.map((s) => s.event), ["ended", "stopped", "all-joined", "done", "joined"]);
  const idea = board.openRun({ repo: REPO, kind: "brainstorm", group: "idea", title: "I", seats: SEATS });
  assert.deepEqual(board.participant("idea/orchestrator")!.subscriptions.map((s) => s.event), ["agreement", "endorsement", "ended", "stopped", "all-joined", "done", "joined"]);
  assert.deepEqual(board.join({ run: idea.id, seat: "architect", doing: "x", files: [] }).member.subscriptions, []);
  assert.deepEqual(board.join({ run: idea.id, seat: "skeptic", doing: "x", files: [] }).member.subscriptions, [{ event: "agreement", scope: "run" }]);
  const on = [{ event: "merged" as const, scope: "any" as const }];
  assert.deepEqual(board.join({ run: idea.id, seat: "skeptic", doing: "x", files: [], on }).member.subscriptions, on);
  assert.deepEqual(board.roster(REPO).find((r) => r.seat === "skeptic")!.subscriptions, on);
  assert.deepEqual(board.snapshot(REPO).roster.find((r) => r.seat === "skeptic")!.on, ["any:merged"]);
});

test("a seats row naming an unknown event is refused at open", () => {
  assert.throws(
    () => board.openRun({ repo: REPO, kind: "brainstorm", group: "idea", title: "I", seats: [{ id: "x", blockers: [], on: ["agreed"] }] }),
    /unknown event agreed/,
  );
});

test("subscribe and unsubscribe return the member's set", () => {
  const idea = board.openRun({ repo: REPO, kind: "brainstorm", group: "idea", title: "I", seats: SEATS });
  const a = board.join({ run: idea.id, seat: "architect", doing: "x", files: [] }).member;
  assert.equal(board.subscribe(a, [{ event: "agreement", scope: "run" }, { event: "merged", scope: "any" }]).length, 2);
  assert.equal(board.subscribe(a, [{ event: "agreement", scope: "run" }]).length, 2);
  assert.deepEqual(board.unsubscribe(a, [{ event: "agreement", scope: "run" }]), [{ event: "merged", scope: "any" }]);
});

test("the board's events store their name; an agreement maps by kind, with no name stored", () => {
  const { s3, s5 } = twoRunners();
  const agreement = board.post(s3, "we agree", { kind: "agreement", with: ["orchestrator"] });
  assert.equal(agreement.event, null);
  board.end(s3);
  const names = board.deliver(s5).lines.join("\n");
  assert.match(names, /ended/);
  const events = board.snapshot(REPO).events.map((e) => board.read(e.seq));
  assert.ok(events.some((m) => m.event === "joined" && /^joined/.test(m.body)));
  assert.ok(events.some((m) => m.event === "ended" && /^- S3 .* ended$/.test(m.body)));
});

test("a subscribed seat's wait --mentions ends on another seat's agreement, with no mention", async () => {
  const idea = board.openRun({ repo: REPO, kind: "brainstorm", group: "idea", title: "I", seats: SEATS });
  const architect = board.join({ run: idea.id, seat: "architect", doing: "x", files: [] }).member;
  const skeptic = board.join({ run: idea.id, seat: "skeptic", doing: "x", files: [] }).member;
  const waiting = (await another()).wait(skeptic, { mentionsOnly: true, timeoutMs: 5000 });
  const a = (await another()).post(architect, "D1 holds", { kind: "agreement", about: "D1" });
  const d = await waiting;
  assert.deepEqual(d.full.map((m) => m.seq), [a.seq]);
});

test("an unsubscribed seat's wait --mentions stays waiting on another seat's agreement", async () => {
  const idea = board.openRun({ repo: REPO, kind: "brainstorm", group: "idea", title: "I", seats: SEATS });
  const architect = board.join({ run: idea.id, seat: "architect", doing: "x", files: [] }).member;
  const skeptic = board.join({ run: idea.id, seat: "skeptic", doing: "x", files: [] }).member;
  const idle = (await another()).wait(architect, { mentionsOnly: true, timeoutMs: 1500 });
  (await another()).post(skeptic, "D1 holds", { kind: "agreement", about: "D1" });
  assert.deepEqual(await idle, { full: [], lines: [] });
});

test("an agreement in another run does not wake a run-scoped seat; any:agreement wakes on one; urgent and mentions always", async () => {
  const idea = board.openRun({ repo: REPO, kind: "brainstorm", group: "idea", title: "I", seats: SEATS });
  const skeptic = board.join({ run: idea.id, seat: "skeptic", doing: "x", files: [] }).member;
  const architect = board.join({ run: idea.id, seat: "architect", doing: "x", files: [] }).member;
  const idea2 = board.openRun({ repo: REPO, kind: "brainstorm", group: "idea2", title: "J", seats: SEATS });
  const elsewhere = board.join({ run: idea2.id, seat: "architect", doing: "x", files: [] }).member;
  board.post(elsewhere, "D9 in the other run", { kind: "agreement", about: "D9" });
  assert.deepEqual(await board.wait(skeptic, { mentionsOnly: true, timeoutMs: 1200 }), { full: [], lines: [] });
  board.subscribe(skeptic, [{ event: "agreement", scope: "any" }]);
  const m = board.post(elsewhere, "D10 in the other run", { kind: "agreement", about: "D10" });
  const d = await board.wait(skeptic, { mentionsOnly: true, timeoutMs: 3000 });
  assert.ok(d.full.some((x) => x.seq === m.seq));
  board.unsubscribe(skeptic, [
    { event: "agreement", scope: "run" },
    { event: "agreement", scope: "any" },
  ]);
  const u = board.post(architect, "fire", { kind: "urgent" });
  assert.deepEqual((await board.wait(skeptic, { mentionsOnly: true, timeoutMs: 3000 })).full.map((x) => x.seq), [u.seq]);
  const q = board.post(architect, "@skeptic a question");
  assert.deepEqual((await board.wait(skeptic, { mentionsOnly: true, timeoutMs: 3000 })).full.map((x) => x.seq), [q.seq]);
});

test("addSeat adds after the last, ready; refuses a duplicate, an unknown blocker, a closed run; the snapshot lists it", () => {
  const run = board.openRun({ repo: REPO, group: "review-tool", title: "R", seats: SLICES });
  const s = board.addSeat(run.id, { id: "S7", blockers: ["S1"] });
  assert.deepEqual([s.id, s.state, s.blockers], ["S7", "empty", ["S1"]]);
  assert.deepEqual(board.runs()[0].seats.map((x) => x.id), ["S1", "S3", "S5", "S7"]);
  assert.ok(board.snapshot(REPO).queues["review-tool"].some((q) => q.seat === "S7"));
  assert.ok(board.snapshot(REPO).events.some((e) => /^\+ S7 added$/.test(e.body)));
  assert.equal(board.join({ run: run.id, seat: "S7", doing: "x", files: [] }).member.seat, "S7");
  assert.throws(() => board.addSeat(run.id, { id: "S7", blockers: [] }), /already in run/);
  assert.throws(() => board.addSeat(run.id, { id: "S8", blockers: ["S99"] }), /unknown blocker S99/);
  board.closeRun(run.id);
  assert.throws(() => board.addSeat(run.id, { id: "S9", blockers: [] }), /is closed/);
});
