// The phase verb: the orchestrator opens a phase, the current one ending with it, a `phase` event that wakes its own run;
// the done verb: a member finished the current phase.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board } from "../src/board/board.ts";
import { EVENTS } from "../src/board/events.ts";
import { eventStep } from "../src/cli/answer/rules.ts";
const stepOf = (e: import("../src/board/events.ts").EventName) => (m: Parameters<typeof eventStep>[0], me: Parameters<typeof eventStep>[1], cli: string) => eventStep(m, me, cli, e);

const REPO = "/repos/one/.git";
const SEATS = [
  { id: "architect", blockers: [] },
  { id: "skeptic", blockers: [] },
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-phase-"));
  board = await another();
});

afterEach(() => {
  for (const b of opened.splice(0)) b.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const twoRuns = () => {
  const idea = board.openRun({ repo: REPO, kind: "brainstorm", group: "idea", title: "I", seats: SEATS });
  const other = board.openRun({ repo: REPO, kind: "brainstorm", group: "other", title: "O", seats: SEATS });
  const orchestrator = board.participant("idea/orchestrator")!;
  const skeptic = board.join({ run: idea.id, seat: "skeptic", doing: "x", files: [] }).member;
  const elsewhere = board.join({ run: other.id, seat: "skeptic", doing: "x", files: [] }).member;
  board.deliver(skeptic);
  board.deliver(elsewhere);
  return { idea, other, orchestrator, skeptic, elsewhere };
};

test("the orchestrator's phase is a phase event, its name in the meta, mentioning its run alone", () => {
  const { idea, orchestrator } = twoRuns();
  const m = board.phase(orchestrator, "diverge", "every idea, no judgment");
  assert.equal(m.kind, "event");
  assert.equal(m.event, "phase");
  assert.equal(m.body, "phase diverge: every idea, no judgment");
  assert.deepEqual(m.meta, { phase: "diverge" });
  assert.deepEqual(m.mentions, ["idea/*"]);
  assert.equal(m.run, idea.id);
  assert.ok(!EVENTS.phase.always);
  const shown = board.snapshot(REPO).events.find((e) => e.seq === m.seq)!;
  assert.deepEqual([shown.event, shown.meta], ["phase", { phase: "diverge" }]);
});

test("a phase wakes a seat's wait --mentions in its run, and not a member of another run", async () => {
  const { orchestrator, skeptic, elsewhere } = twoRuns();
  const waiting = (await another()).wait(skeptic, { mentionsOnly: true, timeoutMs: 5000 });
  const idle = (await another()).wait(elsewhere, { mentionsOnly: true, timeoutMs: 1500 });
  const m = (await another()).phase(orchestrator, "diverge", "every idea");
  assert.deepEqual((await waiting).full.map((x) => x.seq), [m.seq]);
  assert.deepEqual(await idle, { full: [], lines: [] });
});

test("a seat's phase is refused; so is a phase on a closed run, and a phase with no text", () => {
  const { idea, orchestrator, skeptic } = twoRuns();
  assert.throws(() => board.phase(skeptic, "diverge", "x"), /only the orchestrator opens a phase/);
  assert.throws(() => board.phase(orchestrator, "diverge", "  "), /what does it ask/);
  assert.throws(() => board.phase(orchestrator, "two words", "x"), /one word/);
  board.closeRun(idea.id);
  assert.throws(() => board.phase(board.participant("idea/orchestrator")!, "again", "x"), /ended|closed/);
});

test("a woken seat is told to run done; the orchestrator gets no line; end is a phase name like any", () => {
  const { orchestrator, skeptic } = twoRuns();
  const m = board.phase(orchestrator, "diverge", "every idea");
  assert.equal(stepOf("phase")(m, skeptic, "node swarm.mjs"), "when your part of diverge is posted: node swarm.mjs done diverge --as idea/skeptic");
  assert.equal(stepOf("phase")(m, orchestrator, "node swarm.mjs"), null);
  const end = board.phase(orchestrator, "end", "closing");
  assert.equal(stepOf("phase")(end, skeptic, "node swarm.mjs"), "when your part of end is posted: node swarm.mjs done end --as idea/skeptic");
});

test("done is stored once per run, member and phase; the last member's done posts one all-done to the orchestrator; a phase opened again clears its marks", () => {
  const { idea, orchestrator, skeptic } = twoRuns();
  const architect = board.join({ run: idea.id, seat: "architect", doing: "x", files: [] }).member;
  board.deliver(orchestrator);
  assert.throws(() => board.done(skeptic, "diverge"), /no phase is open/);
  board.phase(orchestrator, "diverge", "every idea");
  assert.throws(() => board.done(orchestrator, "diverge"), /orchestrator opens phases/);
  assert.throws(() => board.done(skeptic, "converge"), /the current phase is diverge/);
  const first = board.done(skeptic, "diverge");
  assert.deepEqual([first.progress, first.all, first.already], [{ phase: "diverge", done: 1, of: 2, gone: [], idleEnded: [], parked: [] }, false, false]);
  assert.deepEqual(first.message!.mentions, ["idea/orchestrator"]);
  assert.equal(first.message!.event, "done");
  assert.deepEqual(board.done(skeptic, "diverge").already, true);
  assert.deepEqual(board.phaseProgress(idea.id), { phase: "diverge", done: 1, of: 2, gone: [], idleEnded: [], parked: [] });
  const last = board.done(architect, "diverge");
  assert.equal(last.all, true);
  // idea 2: the first done (the straggler case) and all-done in full; the last plain done carried, as a line
  const delivery = board.deliver(orchestrator);
  const told = delivery.full;
  assert.deepEqual(told.map((m) => m.event), ["done", "all-done"]);
  assert.ok(delivery.lines.some((l) => /done diverge \(2\/2\)/.test(l)), delivery.lines.join("\n"));
  assert.match(told[1].body, /^all done diverge: every member is done \(2\/2\)/);
  assert.match(stepOf("all-done")(told[1], orchestrator, "swarm")!, /^open the next phase: swarm phase <name> "<text>" --as idea\/orchestrator/);
  assert.equal(stepOf("all-done")(told[1], skeptic, "swarm"), null);
  assert.deepEqual(board.snapshot(REPO).runs.find((r) => r.run === idea.id)!.progress, { phase: "diverge", done: 2, of: 2, gone: [], idleEnded: [], parked: [] });
  board.phase(orchestrator, "converge", "pick");
  board.phase(orchestrator, "diverge", "again");
  assert.deepEqual(board.phaseProgress(idea.id), { phase: "diverge", done: 0, of: 2, gone: [], idleEnded: [], parked: [] });
});

test("a phase event is not a post in the stats", () => {
  const { idea, orchestrator, skeptic } = twoRuns();
  board.post(skeptic, "an idea");
  const before = board.stats({ repo: REPO, run: idea.id }).runs[0];
  board.phase(orchestrator, "diverge", "every idea");
  const after = board.stats({ repo: REPO, run: idea.id }).runs[0];
  assert.deepEqual(after.members.map((x) => x.posts), before.members.map((x) => x.posts));
});

test("the run keeps its current phase, plan runs too: runs(), currentPhase and the snapshot's summary", () => {
  const plan = board.openRun({ repo: REPO, group: "review-tool", title: "R", seats: [{ id: "S1", blockers: [] }] });
  const orchestrator = board.participant("review-tool/orchestrator")!;
  assert.equal(board.currentPhase(plan.id), null);
  assert.equal(board.snapshot(REPO).runs.find((r) => r.run === plan.id)!.phase, null);
  const member = board.join({ run: plan.id, seat: "S1", doing: "x", files: [] }).member;
  board.deliver(member);
  board.phase(orchestrator, "build", "the first wave");
  assert.deepEqual(board.currentPhase(plan.id), { name: "build", text: "the first wave" });
  assert.deepEqual(board.runs().find((r) => r.id === plan.id)!.phase, { name: "build", text: "the first wave" });
  assert.deepEqual(board.snapshot(REPO).runs.find((r) => r.run === plan.id)!.phase, { name: "build", text: "the first wave" });
  assert.equal(board.deliver(member).full.at(-1)!.event, "phase"); // it mentions every member of the run
  board.phase(orchestrator, "end", "merged and verified");
  assert.deepEqual(board.currentPhase(plan.id), { name: "end", text: "merged and verified" });
});

