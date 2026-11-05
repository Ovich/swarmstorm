// The board under load (board-fixes#D14): realistic exchanges over the wire on a store seeded with a long history,
// the members stepped 5 → 10 → 20 → 50. At 20 members a call's p95 stays under 500 ms and no call is dropped; the
// step where p95 passes 1 s is printed. Its own script (`npm run test:load`), never beside the suite: it measures
// time, and a suite running in parallel on the same machine is what it would measure.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard } from "../src/board/board.ts";
import { connectMember, serveBoard, type CallOutcome, type ServedBoard } from "./fixtures/wire-client.ts";

const REPO = "/repos/load/.git";
const HISTORY_RUNS = 40;
const HISTORY_POSTS_PER_RUN = 500;
const STEPS = [5, 10, 20, 50];
/** Each member's exchanges in a step: post, wait look, roster, doing, and every few rounds a merge-lock cycle. */
const ROUNDS = 6;
const GIVE_UP_MS = 30_000;

/** 20k messages over many runs, a tenth of them mentioning a member, as a project's store after weeks of work. Each run's
 *  first posts go through the board; the rest are copies of them in SQL, the board's posting too slow to seed with. */
async function seedHistory(dataRoot: string): Promise<void> {
  const storePath = path.join(dataRoot, "swarm.sqlite");
  const board = await openBoard(storePath);
  try {
    for (let r = 0; r < HISTORY_RUNS; r++) {
      const run = board.openRun({ repo: REPO, group: `past${r}`, title: `past run ${r}`, seats: [{ id: "w1", blockers: [] }, { id: "w2", blockers: [] }] });
      const w1 = board.join({ run: run.id, seat: "w1", doing: "x", files: [] }).member;
      board.join({ run: run.id, seat: "w2", doing: "x", files: [] });
      board.post(w1, "history");
      board.post(w1, "@w2 history");
      // a few runs stay open, their members never reading: the unread a lost member carries
      if (r % 8 !== 0) board.closeRun(run.id);
    }
  } finally {
    board.close();
  }
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(storePath);
  try {
    const columns = (db.prepare("PRAGMA table_info(messages)").all() as { name: string }[]).map((c) => c.name).filter((c) => c !== "seq");
    const copied = columns.join(", ");
    const originals = db.prepare("SELECT seq FROM messages WHERE body LIKE '%history'").all() as { seq: number }[];
    const copies = Math.ceil(HISTORY_RUNS * HISTORY_POSTS_PER_RUN / originals.length);
    db.exec("BEGIN");
    const copy = db.prepare(`INSERT INTO messages (${copied}) SELECT ${copied} FROM messages WHERE seq = ?`);
    for (let n = 0; n < copies; n++) for (const { seq } of originals) copy.run(seq);
    db.exec("COMMIT");
  } finally {
    db.close();
  }
}

const connect = (served: ServedBoard, member?: { name: string; run: number }) => connectMember(served, member ?? null, GIVE_UP_MS);

/** One step: `count` members join a fresh run and work through ROUNDS rounds at once; every call's time kept. */
async function step(served: ServedBoard, count: number, stepNo: number): Promise<CallOutcome[]> {
  const opener = await connect(served);
  const seats = Array.from({ length: count }, (_, i) => ({ id: `m${i + 1}`, blockers: [] }));
  const run = (await opener.call("openRun", { repo: REPO, group: `step${stepNo}`, title: `${count} members`, seats })).value;
  const members = await Promise.all(
    seats.map(async (s) => {
      const joiner = await connect(served);
      const joined = await joiner.call("join", { run: run.id, seat: s.id, doing: "load", files: [] });
      joiner.close();
      const member = joined.value.member;
      return { member, link: await connect(served, { name: member.name, run: run.id }) };
    }),
  );
  const outcomes: CallOutcome[] = [];
  const kept = async (p: Promise<CallOutcome>): Promise<CallOutcome> => {
    const o = await p;
    outcomes.push(o);
    return o;
  };
  await Promise.all(
    members.map(async ({ member, link }, i) => {
      for (let round = 0; round < ROUNDS; round++) {
        await kept(link.call("post", member, `@${seats[(i + 1) % count].id} round ${round}`));
        await kept(link.call("wait", member, { timeoutMs: 20, mentionsOnly: true }));
        await kept(link.call("roster", REPO));
        await kept(link.call("setDoing", member, `round ${round}`));
        if (round % 3 === 2) {
          const lock = await kept(link.call("packCall", member, "lock-merge", { onto: "main" }));
          if (lock.value?.granted) await kept(link.call("packCall", member, "merged", { sha: `s${stepNo}${i}${round}`, files: [] }));
        }
      }
    }),
  );
  for (const { link } of members) link.close();
  opener.close();
  return outcomes;
}

const p95 = (o: CallOutcome[]): number => {
  const sorted = o.map((x) => x.ms).sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))] ?? 0;
};

test("board-fixes#D14: on a store of 20k messages, 20 members' calls answer with p95 under 500 ms and none dropped", { timeout: 120_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-load-"));
  await seedHistory(dir);
  const served = await serveBoard(dir);
  const child = served.child;
  const stopServer = () => new Promise<void>((resolve) => (child.exitCode !== null ? resolve() : (child.once("exit", () => resolve()), child.kill())));
  try {
    const byStep = new Map<number, CallOutcome[]>();
    for (const [n, count] of STEPS.entries()) byStep.set(count, await step(served, count, n));
    for (const [count, o] of byStep) console.log(`load: ${count} members, ${o.length} calls, p95 ${p95(o)} ms, ${o.filter((x) => !x.ok).length} dropped`);
    const overASecond = STEPS.find((count) => p95(byStep.get(count)!) > 1000);
    console.log(`load: p95 passes 1 s at ${overASecond === undefined ? "no step" : `${overASecond} members`}`);
    const at20 = byStep.get(20)!;
    assert.equal(at20.filter((x) => !x.ok).length, 0);
    assert.ok(p95(at20) < 500, `p95 at 20 members: ${p95(at20)} ms`);
  } finally {
    await stopServer();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
