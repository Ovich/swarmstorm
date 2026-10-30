// board-split D62 goldens (break-flow T54): one done count across done, roster and status (V-11); a late or repeated
// done says what the member owes now (V-5); a phase opened over members still owing the last names them (V-6).
import { test } from "node:test";
import assert from "node:assert/strict";
import { pin, scene } from "./golden.ts";

/** The `n/m done[, k lost: …]` count a line carries. */
const countIn = (text: string): string | null => /(\d+\/\d+ done(?:, \d+ lost: [\w, -]+)?)/.exec(text)?.[1] ?? null;

test("golden V-11: done, roster and status print one count; a parked member's done leaves it", async () => {
  const s = await scene("orchestrator", "owes-first");
  try {
    const orch = s.me;
    const worker = s.other;
    const done = s.call("done", "build", "--as", worker);
    pin("done-count.worker.done", done);
    const roster = s.call("roster", "--as", orch);
    const status = s.call("status");
    assert.equal(countIn(done.text), "1/1 done");
    assert.equal(countIn(roster.text), countIn(done.text));
    assert.equal(countIn(status.text), countIn(done.text));
    // parked, its done is out of the count until unparked: every line says so alike
    s.must("park", worker.split("/")[1], "--as", orch);
    const parkedRoster = s.call("roster", "--as", orch);
    pin("done-count.orchestrator.roster-parked", parkedRoster);
    assert.equal(countIn(parkedRoster.text), "0/0 done");
    assert.equal(countIn(s.call("status").text), "0/0 done");
  } finally {
    s.stop();
  }
});

test("golden V-5: a done for a phase no longer open names what the member owes now; a repeat is already done", async () => {
  const s = await scene("orchestrator", "owes-first");
  try {
    const orch = s.me;
    const worker = s.other;
    s.must("phase", "verify", "check it", "--as", orch);
    const late = s.call("done", "build", "--as", worker);
    pin("done-count.worker.done-late", late);
    assert.match(late.text, /done build recorded late \(the open phase is verify; the orchestrator is told\)\nyou owe phase verify: /);
    const again = s.call("done", "build", "--as", worker);
    pin("done-count.worker.done-late-again", again);
    assert.match(again.text, /already done build; nothing new recorded\nyou owe phase verify: /);
    s.must("done", "verify", "--as", worker);
    const repeat = s.call("done", "verify", "--as", worker);
    pin("done-count.worker.done-repeat", repeat);
    assert.match(repeat.text, /^already done verify: 1\/1 done; nothing new recorded/m);
  } finally {
    s.stop();
  }
});

test("golden V-6: a phase opened while a member owes the last one names it", async () => {
  const s = await scene("orchestrator", "owes-first");
  try {
    const orch = s.me;
    const worker = s.other;
    const opened = s.call("phase", "verify", "check it", "--as", orch);
    pin("done-count.orchestrator.phase-still-owed", opened);
    assert.match(opened.text, new RegExp(`${worker} had not run done for build`));
    // nobody owing: no such line
    s.must("done", "verify", "--as", worker);
    assert.doesNotMatch(s.call("phase", "fix", "fix it", "--as", orch).text, /had not run done/);
  } finally {
    s.stop();
  }
});

test("golden V-21: a done with no phase named shows the open phase in its example", async () => {
  const s = await scene("orchestrator", "owes-first");
  try {
    const usage = s.call("done", "--as", s.other);
    pin("done-count.worker.done-usage", usage);
    assert.match(usage.text, /done build --as/);
  } finally {
    s.stop();
  }
});

test("golden V-18: status names the run's project, never its git dir", async () => {
  const s = await scene("orchestrator", "owes-first");
  try {
    const runLine = s.call("status").text.split("\n").find((l) => l.startsWith("run "))!;
    pin("done-count.status.run-line", { status: 0, text: runLine });
    assert.doesNotMatch(runLine, /\.git\b/);
  } finally {
    s.stop();
  }
});

test("golden V-28: a done from a parked seat says it is not counted, never a count", async () => {
  const s = await scene("orchestrator", "owes-first");
  try {
    const orch = s.me;
    const worker = s.other;
    const seat = worker.split("/")[1];
    s.must("park", seat, "--as", orch);
    const parked = s.call("done", "build", "--as", worker);
    pin("done-count.worker.done-parked", parked);
    assert.match(parked.text, /^done build recorded; you are parked: not counted until unparked$/m);
  } finally {
    s.stop();
  }
});

test("golden V-27: the phase text and the done event say the --for set and the count once", async () => {
  const s = await scene("orchestrator", "owes-first");
  try {
    const orch = s.me;
    const worker = s.other;
    const seat = worker.split("/")[1];
    s.must("phase", "fix", `${seat} only`, "--for", seat, "--as", orch);
    const runLine = s.call("status").text.split("\n").find((l) => l.startsWith("run "))!;
    pin("done-count.status.phase-for", { status: 0, text: runLine });
    assert.doesNotMatch(runLine, new RegExp(`${seat} only ${seat}`));
  } finally {
    s.stop();
  }
});
