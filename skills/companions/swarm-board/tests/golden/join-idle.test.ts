// S15 (build 4, D2): a worker's join with nothing owed and no unread mention is idle, so it ends on the foreground wait;
// with a task unread it is working and ends on the background listener line. Target bytes pinned before the fix (D3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { scene } from "./golden.ts";

const O = "g/orchestrator";
const FOREGROUND = "it holds 170 s, as Claude Code detaches a foreground command that runs past 180 s; run it again when it returns empty";

const lastLine = (text: string): string => text.trimEnd().split("\n").at(-1)!;

test("S15 target: an idle worker's join ends on the foreground wait", async () => {
  const s = await scene("worker", "idle");
  try {
    s.must("wait", "--mentions", "--timeout", "200", "--as", s.me);
    const joined = s.call("join", "--run", "1", "--seat", "w1", "--doing", "x", "--as", s.me);
    assert.equal(lastLine(joined.text), `nothing yet; wait, in the foreground (${FOREGROUND}): node <cli> wait --mentions --as ${s.me} --timeout 170000`);
  } finally {
    s.stop();
  }
});

test("S15 target: a worker's join with a task unread ends on the background listener line", async () => {
  const s = await scene("worker", "idle");
  try {
    s.must("post", "@w1 the task", "--as", O);
    const joined = s.call("join", "--run", "1", "--seat", "w1", "--doing", "x", "--as", s.me);
    assert.equal(lastLine(joined.text), `start your listener now, in the background (your harness's background task): node <cli> wait --mentions --as ${s.me}`);
  } finally {
    s.stop();
  }
});
