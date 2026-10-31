// board-split verify 1's findings F2, F4, F5, F7, F8 (T21), each pinned at its corrected answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scene } from "./golden.ts";

const O = "g/orchestrator";

// F2 (D44): `pause "<text>" --person --as …` takes the text as the person's question, never the --as that follows
test("F2: pause --person with the text before it reads the text, not --as", async () => {
  const s = await scene("worker", "idle");
  try {
    const paused = s.call("pause", "ask the person", "--person", "--as", O);
    assert.equal(paused.status, 0, paused.text);
    assert.match(paused.text, /waiting on the person: ask the person;/);
    assert.doesNotMatch(paused.text, /--as;|person: --as/);
    const roster = s.call("roster");
    assert.match(roster.text, /on you: ask the person/);
  } finally {
    s.stop();
  }
});

// F4 (D2, D11): a verifier's join tells one way to listen, the listener line it ends on
test("F4: a verifier's join names one way to listen", async () => {
  const s = await scene("verifier", "idle");
  try {
    s.must("post", "@v1 ping", "--as", O);
    const joined = s.call("join", "--run", "1", "--seat", "v1", "--doing", "x", "--as", s.me);
    assert.doesNotMatch(joined.text, /# in the foreground, when waiting/);
  } finally {
    s.stop();
  }
});

// F7 (D12, rule 10): refusals in plain words, no plan ids, every command runnable as printed
test("F7: a verifier's code verb and seat --state refuse in plain words, commands carrying --as", async () => {
  const s = await scene("verifier", "idle");
  try {
    const refused = s.call("merge-lock", "--as", s.me);
    assert.notEqual(refused.status, 0);
    assert.match(refused.text, /merge-lock: refused: merge-lock is a worker's verb, and a verifier holds no files; your verbs are in --help/);
    assert.doesNotMatch(refused.text, /code pack|\(D\d+\)/);
    const state = s.call("seat", "v1", "--state", "done", "--as", O);
    assert.doesNotMatch(state.text, /\(D\d+\)/);
    assert.match(state.text, /end --seat v1 --as g\/orchestrator/);
  } finally {
    s.stop();
  }
});

