// A worker whose listener lapsed hears of its undelivered messages at the next verb it calls while it works.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scene } from "./golden.ts";

const O = "g/orchestrator";
const lastLine = (text: string): string => text.trimEnd().split("\n").at(-1)!;

test("a worker's doing, with mentions undelivered, ends on reading them", async () => {
  const s = await scene("worker", "idle");
  try {
    s.call("join", "--run", "1", "--seat", "w1", "--doing", "x", "--as", s.me);
    s.must("post", "@w1 one", "--as", O);
    s.must("post", "@w1 two", "--as", O);
    const r = s.call("doing", "building", "--as", s.me);
    assert.equal(lastLine(r.text), `you have 2 unread messages for you: read them now, then start your listener again, in the background: node <cli> wait --mentions --as ${s.me}`);
    s.call("wait", "--mentions", "--timeout", "1000", "--as", s.me);
    assert.doesNotMatch(s.call("doing", "still", "--as", s.me).text, /unread/);
  } finally {
    s.stop();
  }
});
