// P2 composition (plan D3-D6, D17, D18): the join answer carries who is in the run; changes are lines on the thread.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board } from "../src/board/board.ts";

const REPO = "/repos/one/.git";
let dir: string;
let board: Board;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-comp-"));
  board = await openBoard(path.join(dir, "swarm.sqlite"));
});
afterEach(() => {
  board.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const open = (seats: { id: string; role?: string; area?: string }[]) =>
  board.openRun({ repo: REPO, kind: "task", group: "g", title: "G", seats: seats.map((s) => ({ ...s, blockers: [] })) });
const join = (run: number, seat: string) => board.join({ run, seat, doing: "x", files: [] });

test("D3: join returns every declared seat, joined or not, with role and area", () => {
  const run = open([{ id: "w1", role: "worker", area: "the app" }, { id: "v1", role: "verifier" }]);
  const j = join(run.id, "w1");
  assert.deepEqual(j.composition.entries.map((e) => [e.seat, e.state, e.role, e.area]), [
    ["orchestrator", "working", undefined, undefined],
    ["w1", "working", "worker", "the app"],
    ["v1", "empty", "verifier", undefined],
  ]);
  assert.equal(j.composition.showRole, true);
  assert.equal(j.composition.lines.length, 3);
  assert.match(j.composition.lines[1], /^w1 [A-Z][a-z]+ [A-Z][a-z]+ worker \(the app\): working$/);
  assert.equal(j.composition.lines[2], "v1 verifier: empty");
  const v1 = join(run.id, "v1");
  assert.deepEqual(board.composition(run.id), v1.composition);
});

test("D6: role is left out when every seat shares one (or none)", () => {
  const run = open([{ id: "w1", role: "worker" }, { id: "w2", role: "worker" }]);
  const c = join(run.id, "w1").composition;
  assert.equal(c.showRole, false);
  assert.ok(c.lines.every((l) => !/worker/.test(l)));
});

test("D4: a late join, an added seat, an end, a back are lines on the run's thread that never end a wait", async () => {
  const run = open([{ id: "w1" }, { id: "w2" }]);
  const w1 = join(run.id, "w1").member;
  const orch = board.participant("g/orchestrator")!;
  board.deliverMentions(w1);
  board.deliverMentions(orch);
  const waiting = board.wait(w1, { mentionsOnly: true, timeoutMs: 500 });
  join(run.id, "w2");
  board.addSeat(run.id, { id: "w3", role: "worker", area: "docs", blockers: [] });
  assert.deepEqual(await waiting, { full: [] });
  const w2 = board.participant("g/w2")!;
  board.end(w2);
  join(run.id, "w2");
  // they are on the run's thread, and a mention's wake brings only the mention
  board.post(orch, "@w1 go");
  const got = await board.wait(w1, { mentionsOnly: true, timeoutMs: 2000 });
  assert.deepEqual(got.full.map((m) => m.body), ["@w1 go"]);
  const joined = board.snapshot(REPO).events.map((e) => e.body).join("\n");
  assert.match(joined, /\+ w2 [A-Z]/);
  assert.match(joined, /\+ w3 .*\(docs\) added/);
  assert.match(joined, /- w2 [A-Z][a-z]+ [A-Z][a-z]+ ended/);
  assert.match(joined, /\+ w2 [A-Z][a-z]+ [A-Z][a-z]+ back/);
});

test("D5: all-joined reaches the orchestrator once every declared seat has a member, and only then", async () => {
  const run = open([{ id: "w1" }, { id: "w2" }]);
  const orch = board.participant("g/orchestrator")!;
  board.deliverMentions(orch);
  const waiting = board.wait(orch, { mentionsOnly: true, timeoutMs: 600 });
  join(run.id, "w1");
  assert.deepEqual((await waiting).full.filter((m) => m.event === "all-joined"), []);
  const next = board.wait(orch, { mentionsOnly: true, timeoutMs: 3000 });
  join(run.id, "w2");
  const got = await next;
  assert.deepEqual(got.full.map((m) => m.event), ["all-joined"]);
  // a rejoin does not tell again
  join(run.id, "w2");
  assert.equal(board.deliverMentions(orch).full.filter((m) => m.event === "all-joined").length, 0);
});

test("D17: join of a seat the run does not declare refuses and points to seat add", () => {
  const run = open([{ id: "w1" }]);
  assert.throws(() => join(run.id, "w9"), /seat w9 is not declared in run \d+: declare it first with `seat add w9`/);
  board.addSeat(run.id, { id: "w9", blockers: [] });
  assert.equal(join(run.id, "w9").member.seat, "w9");
});

test("D18: a run opened with no seats is valid and grows seat by seat; all-joined needs a seat", async () => {
  const run = open([]);
  assert.deepEqual(board.composition(run.id).entries.map((e) => e.seat), ["orchestrator"]);
  board.addSeat(run.id, { id: "w1", blockers: [] });
  const orch = board.participant("g/orchestrator")!;
  board.deliverMentions(orch);
  const waiting = board.wait(orch, { mentionsOnly: true, timeoutMs: 3000 });
  join(run.id, "w1");
  assert.deepEqual((await waiting).full.map((m) => m.event), ["all-joined"]);
});
