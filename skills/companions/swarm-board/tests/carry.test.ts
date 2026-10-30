// Idea 2, quiet listening (run agent-ergonomics, note #12196 + the orchestrator's judgment, record §2): what wakes the
// orchestrator, what is carried to its next wake, the 5 min deadline driven through the tick's clock (#12220), the
// person's done cases, and a paused run kept silent. One case per acceptance row, B1-B12; B7 and B15 are in cli.test.ts.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board, type Delivery, type Participant, type Presence } from "../src/board/board.ts";
import { CARRY_MAX_MS } from "../src/board/liveness.ts";
import type { MemberActivity } from "../src/wire.ts";
import { codeVerbs } from "../src/packs/code/calls.ts";
import { tick2 } from "./fixtures/tick2.ts";

const REPO = "/repos/carry/.git";
let dir: string;
let board: Board;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-carry-"));
  board = await openBoard(path.join(dir, "swarm.sqlite"));
});

afterEach(() => {
  board.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

let links: Map<string, { connected: boolean; lostAt: number | null }>;
const presence: Presence = (m) => links.get(m) ?? { connected: true, lostAt: null };
const act = (o: Partial<MemberActivity> = {}): MemberActivity => ({ grewAt: null, tokens: 0, context: null, openTool: null, lastTool: null, finished: false, ...o });

/** A task run of `ids`, all joined, what was for them already had. */
const setup = (ids = ["w1", "w2", "w3"], kind: "task" | "brainstorm" = "task") => {
  links = new Map();
  const run = board.openRun({ repo: REPO, kind, group: "g", title: "G", seats: ids.map((id) => ({ id, title: id, blockers: [] })) });
  const m = Object.fromEntries(ids.map((id) => [id, board.join({ run: run.id, seat: id, doing: "x", files: [] }).member])) as Record<string, Participant>;
  const orch = board.participant("g/orchestrator")!;
  for (const p of [...Object.values(m), orch]) board.deliver(p);
  return { run, m, orch };
};
/** The orchestrator's `wait --mentions` held `ms`: what it returned; empty when nothing woke it. */
const waitOf = (p: Participant, ms = 250): Promise<Delivery> => board.wait(p, { mentionsOnly: true, timeoutMs: ms });
const woke = (d: Delivery) => d.full.length > 0 || d.lines.length > 0;
/** Woken by something other than the liveness of members this test gives no transcript (a 5 min tick names them). */
const wokeBesidesLiveness = (d: Delivery) => [...d.full.map((x) => x.body), ...d.lines].some((l) => !/no transcript found|^stalled /.test(l));
const all = (d: Delivery) => [...d.full.map((x) => x.body), ...d.lines].join("\n");
const merge = (p: Participant, sha: string) => {
  codeVerbs(board).lockMerge(p);
  codeVerbs(board).merged(p, sha, []);
};
/** A member joins a seat added mid-run, its doing `tag`: a carried joined event. A second seat stays unjoined, so no all-joined wakes. */
const arrive = (run: number, tag: string) => {
  board.addSeat(run, { id: tag, blockers: [] });
  board.addSeat(run, { id: `${tag}-spare`, blockers: [] });
  return board.join({ run, seat: tag, doing: tag, files: [] }).member;
};
/** A tick past the carry deadline, on the tick's own clock. */
const pastDeadline = (run: number, from = Date.now()) => tick2(board, run, new Date(from + CARRY_MAX_MS + 1000), presence);

test("B1: three merges, each with its report (merged --report): 3 wakes, each the report alone; the merged event never reaches the orchestrator", async () => {
  const { run, m, orch } = setup();
  let wakes = 0;
  for (const [i, id] of ["w1", "w2", "w3"].entries()) {
    merge(m[id], `sha${i}`);
    assert.equal(woke(await waitOf(orch)), false, `${id}'s merged alone wakes nothing`);
    board.post(m[id], `@orchestrator merged sha${i}: T${i} done`);
    const d = await waitOf(orch);
    assert.ok(woke(d));
    wakes++;
    assert.equal(all(d).match(new RegExp(`sha${i}`, "g"))!.length, 1, all(d));
  }
  assert.equal(wakes, 3);
  // no carry deadline brings the merged events (the report was the wake); a silent merge (--report -) wakes nothing either
  merge(m.w1, "silent0");
  pastDeadline(run.id);
  assert.equal(/sha\d|silent0/.test(all(await waitOf(orch, 150))), false);
});

test("B2 (restated, #12261): the first three dones are carried; the straggler's done wakes carrying the earlier ones; all-done wakes", async () => {
  const ids = ["w1", "w2", "w3", "w4", "w5"];
  const { m, orch } = setup(ids);
  board.phase(orch, "p", "your part");
  board.deliver(orch);
  for (const id of ["w1", "w2", "w3"]) {
    board.done(m[id], "p");
    assert.equal(woke(await waitOf(orch, 150)), false, `${id}'s done wakes nothing`);
  }
  board.done(m.w4, "p");
  const straggler = await waitOf(orch, 150);
  assert.match(straggler.full.map((x) => x.body).join("\n"), /done p \(4\/5\): all but w5/);
  assert.equal(straggler.lines.filter((l) => /done p/.test(l)).length, 3, straggler.lines.join("\n"));
  board.done(m.w5, "p");
  const end = await waitOf(orch, 150);
  assert.match(all(end), /all done p/);
});

test("B3: a watched member's done, a done without its deliverable, the straggler and a late done each wake once, the case named", async () => {
  const { m, orch } = setup(["w1", "w2", "w3", "w4"]);
  board.phase(orch, "p", "your part", { watch: ["w1"] });
  board.deliver(orch);
  board.done(m.w1, "p");
  const watched = await waitOf(orch, 150);
  assert.equal(watched.full.length, 1, all(watched));
  assert.match(watched.full[0].body, /^done p \(1\/4\).*watched/);
  // w2 was asked in this phase and posts nothing before its done; w3 was asked and answered: carried
  board.post(orch, "@w2 send the report");
  board.post(orch, "@w3 send the report");
  board.post(m.w3, "@orchestrator the report");
  board.deliver(orch);
  board.done(m.w2, "p");
  const bare = await waitOf(orch, 150);
  assert.equal(bare.full.length, 1, all(bare));
  assert.match(bare.full[0].body, /^done p \(2\/4\): no post since the orchestrator's #\d+$/);
  board.done(m.w3, "p");
  const straggler = await waitOf(orch, 150);
  assert.match(straggler.full.map((x) => x.body).join("\n"), /all but w4/);
  assert.ok(!straggler.full.some((x) => /no post since/.test(x.body)), "w3 answered: not without its deliverable");
  // a late done: accepted and told
  board.phase(orch, "q", "next");
  board.deliver(orch);
  const late = board.done(m.w4, "p");
  assert.deepEqual([late.late, late.already], [true, false]);
  const told = await waitOf(orch, 150);
  assert.match(all(told), /^late done p; the current phase is q/m);
});

test("B4, B10: a lone carried joined wakes the waiting orchestrator by the tick past CARRY_MAX_MS, exactly once", async () => {
  const { run, m, orch } = setup();
  arrive(run.id, "abc123");
  const held = waitOf(orch, 3000);
  tick2(board, run.id, new Date(Date.now() + CARRY_MAX_MS - 5000), presence);
  pastDeadline(run.id);
  const d = await held;
  assert.equal(d.lines.filter((l) => /joined.*abc123/.test(l)).length + d.full.filter((x) => /joined.*abc123/.test(x.body)).length, 1, all(d));
  assert.equal(/abc123/.test(all(board.deliver(orch))), false, "never twice");
});

test("B4: a carried line and a wake together come once; the deadline does not bring it again", async () => {
  const { run, m, orch } = setup();
  arrive(run.id, "def456");
  board.post(m.w1, "@orchestrator report");
  const d = await waitOf(orch);
  assert.equal(all(d).match(/joined[^\n]*def456/g)?.length, 1, all(d));
  pastDeadline(run.id);
  const again = await waitOf(orch, 150);
  assert.equal(wokeBesidesLiveness(again), false, all(again));
});

test("B6: a mention, an urgent post, ended, and an explicit subscribe merged wake at once", async () => {
  const { m, orch } = setup();
  for (const make of [() => board.post(m.w1, "@orchestrator a question"), () => board.post(m.w2, "stop", { kind: "urgent" }), () => board.end(m.w3)]) {
    const held = waitOf(orch, 2000);
    const t0 = Date.now();
    make();
    assert.ok(woke(await held));
    assert.ok(Date.now() - t0 < 1500, "at once");
  }
  board.subscribe(orch, [{ event: "merged", scope: "run" }]);
  assert.ok(!board.participant("g/orchestrator")!.subscriptions.some((s) => s.event === "merged" && s.carry), "the explicit one replaces the carry");
  const held = waitOf(orch, 2000);
  merge(m.w1, "fff000");
  assert.ok(woke(await held));
});

/** Every member in a board wait, as its link reads it: the idle rule's condition. */
const allWaiting = (run: number, ids: string[], m: Record<string, Participant>, t: Date) => {
  for (const id of ids) board.deliver(m[id]);
  const waits = ids.map((id) => board.wait(m[id], { mentionsOnly: true, timeoutMs: 600 }));
  for (const id of ids) board.recordActivity(run, id, act({ grewAt: t.getTime(), openTool: { name: "Bash", target: `node swarm.mjs wait --mentions --as g/${id}`, since: Date.now() - 1000, boardWait: true } }), t);
  return Promise.all(waits);
};

test("B5: with no phase open, the first idle wakes", async () => {
  const { run, m, orch } = setup(["w1", "w2"]);
  const t = new Date();
  const waits = allWaiting(run.id, ["w1", "w2"], m, t);
  tick2(board, run.id, t, presence);
  assert.match(all(await waitOf(orch, 150)), /^idle/m);
  await waits;
});

test("B5, B9: the first idle after all-done was told is carried, and wakes by the deadline", async () => {
  const { run, m, orch } = setup(["w1", "w2"]);
  board.phase(orch, "p", "go");
  board.done(m.w1, "p");
  board.done(m.w2, "p");
  assert.match(all(await waitOf(orch, 150)), /all done p/);
  const t = new Date();
  const waits = allWaiting(run.id, ["w1", "w2"], m, t);
  tick2(board, run.id, t, presence);
  assert.equal(woke(await waitOf(orch, 150)), false, "the idle after all-done is carried");
  const idles = board.snapshot(REPO).events.filter((e) => e.event === "idle");
  assert.equal(idles.length, 1, "the carried idle is posted");
  assert.deepEqual(idles[0].mentions, []);
  const held = waitOf(orch, 2000);
  pastDeadline(run.id, t.getTime());
  assert.match(all(await held), /idle/);
  await waits;
});

test("B11 and d3's guards: a paused run is silent but urgent; resume gives every held line once; a gone member stays gone; a carried deadline counts from the resume", async () => {
  const { run, m, orch } = setup(["w1", "w2"]);
  board.phase(orch, "p", "go");
  board.deliver(orch);
  board.pause(orch, "the person decides");
  board.deliver(orch);
  const base = Date.now();
  // during the pause: a joiner, both dones (all-done), a member gone
  board.done(arrive(run.id, "aaa111"), "p");
  board.done(m.w1, "p");
  board.done(m.w2, "p");
  board.recordActivity(run.id, "w2", act({ grewAt: base }), new Date(base));
  links.set("w2", { connected: false, lostAt: base });
  for (const s of [31, 600, 1800]) tick2(board, run.id, new Date(base + s * 1000), presence);
  assert.equal(woke(await waitOf(orch, 200)), false, "0 wakes while paused");
  const urgent = waitOf(orch, 2000);
  board.post(m.w1, "the build is on fire", { kind: "urgent" });
  assert.ok(woke(await urgent), "urgent still wakes");
  const resumed = board.resume(orch, "go on");
  const held = resumed.held.join("\n");
  for (const said of [/joined: aaa111/, /all done p/, /lost g\/w2/]) assert.match(held, said);
  for (const said of ["joined: aaa111", "all done p", "lost g/w2"]) assert.equal(held.split(said).length - 1, 1, `${said} once: ${held}`);
  // g1: still lost after the resume, told once
  assert.equal(board.memberStates(run.id, new Date(base + 1801_000)).find((s) => s.member === "w2")!.badge?.name, "lost");
  tick2(board, run.id, new Date(base + 1802_000), presence);
  assert.equal(/lost g\/w2/.test(all(board.deliver(orch))), false, "the held gone is not told again");
});

test("d3's guard g3: a carried message held through a pause wakes within the resume + CARRY_MAX_MS, never at once", async () => {
  const { run, m, orch } = setup(["w1", "w2"]);
  board.pause(orch, "hold");
  board.deliver(orch);
  arrive(run.id, "bbb222");
  pastDeadline(run.id);
  board.resume(orch, "go");
  board.deliver(orch);
  arrive(run.id, "ccc333");
  const resumedAt = Date.now();
  tick2(board, run.id, new Date(resumedAt + 1000), presence);
  assert.equal(woke(await waitOf(orch, 150)), false, "not at once after the resume");
  const held = waitOf(orch, 2000);
  pastDeadline(run.id, resumedAt);
  assert.match(all(await held), /ccc333/);
});

test("B12: pause --person names the person in the pause; a plain pause reads as before", () => {
  const { orch } = setup(["w1"]);
  const person = board.pause(orch, "approve idea 1", { person: true });
  assert.match(person.body, /^pause: stop where you are and wait for the resume: waiting on the person: approve idea 1$/);
  board.resume(orch, "ok");
  assert.equal(board.pause(orch, "hold on").body, "pause: stop where you are and wait for the resume: hold on");
});

test("U-F23: a subscription starts from now: an event already on the board is never replayed by the first wait; a later one wakes", async () => {
  const { m } = setup();
  board.end(m.w3);
  board.subscribe(m.w1, [{ event: "ended", scope: "run" }]);
  assert.ok(!all(await waitOf(m.w1)).includes("w3"), "the ended before the subscription is not replayed");
  board.end(m.w2);
  assert.match(all(await waitOf(m.w1, 1000)), /w2/, "the ended after it wakes");
});
