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
    assert.match(roster.text, /blocked: ask the person/);
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

// F5: thread in a run with no phase gives the run's posts
test("F5: thread in a brainstorm with no phase gives the run's posts", async () => {
  const s = await scene("seat", "idle");
  try {
    s.must("post", "an idea", "--as", s.me);
    const thread = s.call("thread", "--as", s.me);
    assert.match(thread.text, /an idea/);
    assert.doesNotMatch(thread.text, /no post yet in phase -/);
  } finally {
    s.stop();
  }
});

// F7 (D12, rule 10): refusals in plain words, no plan ids, every command runnable as printed
test("F7: a verifier's code verb and seat --state refuse in plain words, commands carrying --as", async () => {
  const s = await scene("verifier", "idle");
  try {
    const claim = s.call("claim", "a.ts", "--as", s.me);
    assert.notEqual(claim.status, 0);
    assert.match(claim.text, /claim: refused: claim is a worker's verb, and a verifier holds no files; your verbs are in --help/);
    assert.doesNotMatch(claim.text, /code pack|\(D\d+\)/);
    const state = s.call("seat", "v1", "--state", "done", "--as", O);
    assert.doesNotMatch(state.text, /\(D\d+\)/);
    assert.match(state.text, /block v1 "<reason>" --as g\/orchestrator/);
    assert.match(state.text, /park v1 --as g\/orchestrator/);
  } finally {
    s.stop();
  }
});

// F8 (S21): the owed phase is said whole at the wake or join; a claim after it asks only for the listener
test("F8: a worker's claim does not repeat the owed phase line", async () => {
  const s = await scene("worker", "owes-first");
  try {
    const claim = s.call("claim", "a.ts", "--as", s.me);
    assert.equal(claim.status, 0, claim.text);
    assert.doesNotMatch(claim.text, /phase build is yours|Do your part now, then:/);
    assert.match(claim.text, /start your listener now, in the background/);
  } finally {
    s.stop();
  }
});
