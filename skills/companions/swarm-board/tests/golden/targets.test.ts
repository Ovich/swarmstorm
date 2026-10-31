// D3: the lines a finding touches, pinned at their TARGET bytes under plan D2's rules, before the fix. Each was skipped
// until build 2 fixes its finding and enables it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scene, type Answer } from "./golden.ts";

const O = "g/orchestrator";
const WAIT = (as: string) => `node <cli> wait --mentions --as ${as} --timeout 170000`;
const FOREGROUND = "it holds 170 s, as Claude Code detaches a foreground command that runs past 180 s; run it again when it returns empty";
const REARM = (as: string) => `start this listener again, in the background while you work, in the foreground when you are waiting (${FOREGROUND}): ${WAIT(as)}`;
const SHOW = process.env.GOLDEN_SHOW === "1";

const expect = (answer: Answer, target: string[]): void => {
  if (SHOW) console.log(`----\n${answer.text}----`);
  assert.equal(answer.text, target.map((l) => `${l}\n`).join(""));
};

// G7 (already holds today, after run 1's wait fix; enabled with the others in build 2): a phase-open wake shows the phase once (its own event) and one done line, never a second owed line
test("G7 target: the phase-open wake of a worker names the phase and its done once", async () => {
  const s = await scene("worker", "idle");
  try {
    s.must("phase", "build", "build the thing", "--as", O);
    expect(s.call("wait", "--mentions", "--as", s.me, "--timeout", "5000"), [
      REARM(s.me),
      `#<seq> ${O} (event)  <ts>`,
      "phase build: build the thing",
      `when your part of build is posted: node <cli> done build --as ${s.me}`,
    ]);
  } finally {
    s.stop();
  }
});

// G10: a later wake in an unchanged phase repeats nothing of it: the re-arm line, then what woke it
test("G10 target: a wake in an unchanged phase carries no phase line", async () => {
  const s = await scene("worker", "owes-again");
  try {
    s.must("post", "@w1 ping", "--as", O);
    expect(s.call("wait", "--mentions", "--as", s.me, "--timeout", "5000"), [
      REARM(s.me),
      `#<seq> ${O}  <ts>`,
      "@w1 ping",
    ]);
  } finally {
    s.stop();
  }
});

// G14, S26 (board-split D30), simple-states: an idle member owing nothing ends its turn, never with end; the orchestrator resumes it
test("G14, S26 target: the idle answer of a member owing nothing says end the turn, never end", async () => {
  const s = await scene("worker", "idle");
  try {
    s.call("wait", "--mentions", "--as", s.me, "--timeout", "200");
    expect(s.call("wait", "--mentions", "--as", s.me, "--timeout", "200"), [
      "you owe nothing now: end your turn with your report, without end; the orchestrator resumes you by message with the next task",
    ]);
  } finally {
    s.stop();
  }
});

// G16 (holds when the in-wait column is right; D4 makes the link's report the source): a post while the member's listener runs ends on its seq, no listener line
test("G16 target: a post while the listener runs prints no listener line", async () => {
  const s = await scene("worker", "listening");
  try {
    expect(s.call("post", "a note", "--as", s.me), ["#<seq>"]);
  } finally {
    s.stop();
  }
});

// G32: join with a phase open states the phase once: the owed line alone, no header line besides it
test("G32 target: join in an open phase states it once", async () => {
  const s = await scene("worker", "owes-first");
  try {
    const joined = s.call("join", "--run", "1", "--seat", "w1", "--doing", "x", "--as", s.me);
    if (SHOW) console.log(joined.text);
    assert.doesNotMatch(joined.text, /^phase build: build the thing$/m);
    assert.equal(joined.text.match(/build the thing/g)?.length, 1);
    assert.equal(joined.text.match(/ done build /g)?.length, 1);
  } finally {
    s.stop();
  }
});

// G33: thread's result first (the phase header and its posts), then the owed step brief, not the phase text again
test("G33 target: thread states the phase text once", async () => {
  const s = await scene("worker", "owes-first");
  try {
    expect(s.call("thread", "--as", s.me), [
      "phase build: build the thing",
      "no post yet in phase build",
      `you owe phase build: do your part, then mark it done: node <cli> done build --as ${s.me}`,
    ]);
  } finally {
    s.stop();
  }
});

// G38: a listener never returns empty: a live member's empty wait prints its re-arm, an ended member's says it ended
test("G38: an empty wait --mentions prints the re-arm line; an ended member's, why it stopped", async () => {
  const s = await scene("worker", "owes-again");
  try {
    const empty = s.call("wait", "--mentions", "--as", s.me, "--timeout", "200");
    assert.equal(empty.text, `nothing yet; wait, in the foreground (${FOREGROUND}): ${WAIT(s.me)}\n`);
    s.must("end", "--seat", s.me.split("/")[1], "--as", "g/orchestrator");
    assert.match(s.call("wait", "--mentions", "--as", s.me, "--timeout", "200").text, /^you have ended in run \d+: this listener stops; nothing to re-arm; return your summary now\n$/);
  } finally {
    s.stop();
  }
});

// S1: a task posted to a seat before it (re-)joins is shown at its join, whole, the result before the next step;
// marked delivered there, so neither a second join nor a later wait brings it again (D2, D8)
test("S1 target: join shows the unread task posted before it", async () => {
  const s = await scene("worker", "idle");
  try {
    s.must("post", "@w1 the task: build the thing", "--as", O);
    const wt = "<home>/repo/.git/swarm/worktrees/1/w1";
    expect(s.call("join", "--run", "1", "--seat", "w1", "--doing", "x", "--as", s.me), [
      "you are g/w1, <nick:w1>: @w1 or @<Nick:w1> mentions you",
      "orchestrator <nick:orchestrator>: working",
      "w1 <nick:w1>: working",
      `${O}  run 1  working  <n> unread  doing: -  on: ended, stopped, all-joined, done (carried), joined (carried)`,
      // S20: the roster is read after the join delivered the task: nothing unread on its own row
      "<nick:w1> · g/w1  run 1  working  doing: x",
      // the result: the task, whole, as a wait would deliver it
      `#<seq> ${O}  <ts>`,
      "@w1 the task: build the thing",
      `your worktree: ${wt} (branch swarm/1-g/w1 from main; made at your first claim or merge-lock). Work there by absolute paths and git -C ${wt}, never cd into it; pass --as g/w1 on every call`,
      "posts are markdown, rendered on the board: steps as a list, options as a table, a task or a report in short headed parts, a flow or a structure as a mermaid block; more than one line goes through post --file <path>",
      "start your link now, in the background (your harness's background task): node <cli> link --run 1 --as g/w1",
      "start your listener now, in the background (your harness's background task): node <cli> wait --mentions --as g/w1",
    ]);
    const again = s.call("join", "--run", "1", "--seat", "w1", "--doing", "x", "--as", s.me);
    assert.doesNotMatch(again.text, /the task: build the thing/);
    assert.doesNotMatch(s.call("wait", "--mentions", "--as", s.me, "--timeout", "300").text, /the task: build the thing/);
  } finally {
    s.stop();
  }
});

// S5: agree's parties line names every party, its author included, in one stable order (by name); every --with counts
test("S5 target: agree names every party, the author included, each --with counted", async () => {
  const s = await scene("worker", "idle");
  try {
    s.must("seat", "add", "w2", "--run", "1", "--as", O);
    s.must("join", "--run", "1", "--seat", "w2", "--doing", "x", "--as", "g/w2");
    const agreed = s.call("agree", "I change a.ts first", "--with", "w2", "--with", "orchestrator", "--as", s.me);
    expect(agreed, [
      "#<seq>",
      "parties: g/orchestrator, g/w1 (you), g/w2; woken when its file merges",
      `start your listener now, in the background (your harness's background task): node <cli> wait --mentions --as ${s.me}`,
    ]);
  } finally {
    s.stop();
  }
});
