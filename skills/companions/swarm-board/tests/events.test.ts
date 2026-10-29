// The board's core events (D59): names, which message is which event, the wake rule.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Message, Participant } from "../src/board/board.ts";
import { EVENTS, eventOf, formatSubscriptions, parseSubscriptions, wakes } from "../src/board/events.ts";
import { eventStep } from "../src/cli/answer/rules.ts";
const stepOf = (e: import("../src/board/events.ts").EventName) => (m: Parameters<typeof eventStep>[0], me: Parameters<typeof eventStep>[1], cli: string) => eventStep(m, me, cli, e);

const me: Participant = {
  id: 1, run: 7, repo: "/r/.git", kind: "brainstorm", plan: "idea", seat: "skeptic", name: "idea/skeptic", nick: "Zesty Moose",
  ended: false, place: null, listening: true, subscriptions: [], pack: null, verify: false, kindPack: null,
};
const msg = (over: Partial<Message> = {}): Message => ({
  seq: 5, repo: "/r/.git", from: "idea/architect", body: "x", about: null, kind: "msg", mentions: [], at: "", run: 7,
  endorses: null, event: null, ...over,
});

test("parseSubscriptions reads scopes and refuses an unknown name, listing the known ones", () => {
  assert.deepEqual(parseSubscriptions("agreement,any:merged"), [
    { event: "agreement", scope: "run" },
    { event: "merged", scope: "any" },
  ]);
  assert.deepEqual(parseSubscriptions("main:merged"), [{ event: "merged", scope: "any" }]); // the old spelling reads as any:
  assert.deepEqual(parseSubscriptions(["agreement", "agreement"]), [{ event: "agreement", scope: "run" }]);
  assert.throws(() => parseSubscriptions("agreed"), /unknown event agreed: the events are agreement, endorsement, joined, ended, stale, quiet, back, opened, closed, urgent, phase, pause, resume, park, unpark, done, all-done, idle, stalled, recovered, unlocked, breach, gone, liveness, composition, all-joined, merged, flag$/);
  assert.equal(formatSubscriptions(parseSubscriptions("agreement,any:merged")), "agreement, any:merged");
});

test("eventOf: the stored name, else derived from kind; an old row and a plain post have none", () => {
  assert.equal(eventOf(msg({ kind: "event", event: "merged" })), "merged");
  assert.equal(eventOf(msg({ kind: "agreement" })), "agreement");
  assert.equal(eventOf(msg({ kind: "endorsement" })), "endorsement");
  assert.equal(eventOf(msg({ kind: "urgent" })), "urgent");
  assert.equal(eventOf(msg({ kind: "event" })), null); // an old event row
  assert.equal(eventOf(msg()), null);
});

test("wakes: a mention, urgent, a subscribed event in its scope; not another run, not unsubscribed", () => {
  const run = parseSubscriptions("agreement");
  assert.ok(wakes(msg({ mentions: ["idea/skeptic"] }), me, []));
  assert.ok(wakes(msg({ mentions: ["idea/*"] }), me, []));
  assert.ok(wakes(msg({ kind: "urgent" }), me, []));
  assert.ok(EVENTS.urgent.always);
  assert.ok(wakes(msg({ kind: "agreement" }), me, run));
  assert.ok(!wakes(msg({ kind: "agreement" }), me, []));
  assert.ok(!wakes(msg({ kind: "agreement", run: 8 }), me, run));
  assert.ok(wakes(msg({ kind: "agreement", run: 8 }), me, parseSubscriptions("any:agreement")));
  assert.ok(!wakes(msg({ mentions: ["other/*"], run: 8 }), me, [])); // another run's @swarm
  assert.ok(!wakes(msg({ kind: "agreement", from: "idea/skeptic" }), me, run)); // one's own
});

test("the agreement row gives a seat its back-it line, and nothing to a plan member", () => {
  const a = msg({ kind: "agreement" });
  assert.equal(stepOf("agreement")(a, me, "node swarm.mjs"), "back it: node swarm.mjs endorse 5 --as idea/skeptic");
  assert.equal(stepOf("agreement")(a, { ...me, kind: "plan" }, "node swarm.mjs"), null);
  // G34: never to the orchestrator, though its run's members are seats
  assert.equal(stepOf("agreement")(a, { ...me, seat: "orchestrator", name: "idea/orchestrator" }, "node swarm.mjs"), null);
});
