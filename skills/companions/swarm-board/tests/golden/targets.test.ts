// D3: the lines a finding touches, pinned at their TARGET bytes under plan D2's rules, before the fix. Each is skipped
// until build 2 fixes its finding and enables it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scene, type Answer } from "./golden.ts";

const O = "g/orchestrator";
const WAIT = (as: string) => `node <cli> wait --mentions --as ${as} --timeout 170000`;
const FOREGROUND = "it holds 170 s, as Claude Code detaches a foreground command that runs past 180 s; run it again when it returns empty";
const REARM = (as: string) => `start this listener again, in the background while you work, in the foreground when you are waiting (${FOREGROUND}): ${WAIT(as)}`;
const DELIVERED = "these lines are delivered; the task-end notice is the same event";
const SHOW = process.env.GOLDEN_SHOW === "1";
const skip = !SHOW;

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
      DELIVERED,
    ]);
  } finally {
    s.stop();
  }
});

// G10: a later wake in an unchanged phase repeats nothing of it: the re-arm line, then what woke it
test("G10 target: a wake in an unchanged phase carries no phase line", { skip }, async () => {
  const s = await scene("worker", "owes-again");
  try {
    s.must("post", "@w1 ping", "--as", O);
    expect(s.call("wait", "--mentions", "--as", s.me, "--timeout", "5000"), [
      REARM(s.me),
      `#<seq> ${O}  <ts>`,
      "@w1 ping",
      DELIVERED,
    ]);
  } finally {
    s.stop();
  }
});

// G14: the idle answer says first that the seat stays, so it never reads as the end of the run
test("G14 target: the idle answer says the seat stays before it says end", { skip }, async () => {
  const s = await scene("worker", "idle");
  try {
    s.call("wait", "--mentions", "--as", s.me, "--timeout", "200");
    expect(s.call("wait", "--mentions", "--as", s.me, "--timeout", "200"), [
      `nothing for you now; the run is open and your seat stays in it, the orchestrator may dispatch you to it again: run node <cli> end --as ${s.me} and return`,
    ]);
  } finally {
    s.stop();
  }
});

// G16 (holds when the in-wait column is right; D4 makes the link's report the source): a post while the member's listener runs ends on its seq, no listener line
test("G16 target: a post while the listener runs prints no listener line", { skip }, async () => {
  const s = await scene("worker", "listening");
  try {
    expect(s.call("post", "a note", "--as", s.me), ["#<seq>"]);
  } finally {
    s.stop();
  }
});

// G17: a task posted before its phase opened is named in the phase-open wake, so the worker knows its task is that phase's
test("G17 target: the phase-open wake names the worker's task posted before it", { skip }, async () => {
  const s = await scene("worker", "idle");
  try {
    s.must("post", "@w1 the task", "--as", O);
    s.must("deliver", "--as", s.me);
    s.must("phase", "build", "build the thing", "--as", O);
    expect(s.call("wait", "--mentions", "--as", s.me, "--timeout", "5000"), [
      REARM(s.me),
      `#<seq> ${O} (event)  <ts>`,
      "phase build: build the thing; its tasks posted before it: #<seq> w1",
      // the worker's own task named on its done line: no line added (D2)
      `when your part of build (your task #<seq>) is posted: node <cli> done build --as ${s.me}`,
      DELIVERED,
    ]);
  } finally {
    s.stop();
  }
});

// G32: join with a phase open states the phase once: the owed line alone, no header line besides it
test("G32 target: join in an open phase states it once", { skip }, async () => {
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
test("G33 target: thread states the phase text once", { skip }, async () => {
  const s = await scene("worker", "owes-first");
  try {
    expect(s.call("thread", "--as", s.me), [
      "phase build: build the thing",
      "no post yet in phase build",
      `phase build is yours: Do your part now, then: node <cli> done build --as ${s.me}`,
    ]);
  } finally {
    s.stop();
  }
});
