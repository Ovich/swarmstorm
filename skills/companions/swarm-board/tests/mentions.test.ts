// Mentions at their interface (plan D3): @swarm is the sender's run, @<CODE> a whole run,
// @<CODE>·<id> one member, @all names nobody.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMentions, planCode, unmatchedMentions } from "../src/board/mentions.ts";

const PLANS = ["2026-10-15-swarm-one-conversation", "review-tool"]; // codes SO and RT
const NAMES = new Map([["sleepyotter", "review-tool/S3"]]);

test("@swarm names every member of the sender's run, and only it", () => {
  assert.equal(planCode(PLANS[0]), "SO");
  assert.deepEqual(parseMentions("@swarm rebase", "review-tool", PLANS), ["review-tool/*"]);
});

test("@<CODE> names every member of that run; @<CODE>·<id> one member", () => {
  assert.deepEqual(parseMentions("@SO the schema moved", "review-tool", PLANS), [`${PLANS[0]}/*`]);
  assert.deepEqual(parseMentions("@so lower case", "review-tool", PLANS), [`${PLANS[0]}/*`]);
  assert.deepEqual(parseMentions("@SO·SL3 yours", "review-tool", PLANS), [`${PLANS[0]}/SL3`]);
});

test("@all names nobody", () => {
  assert.deepEqual(parseMentions("@all anyone?", "review-tool", PLANS), []);
});

test("a two-letter seat id loses to a run code; a two-letter token naming no run is a member of the sender's run", () => {
  assert.deepEqual(parseMentions("@RT you", "review-tool", PLANS), ["review-tool/*"]);
  assert.deepEqual(parseMentions("@SO you", "review-tool", PLANS), [`${PLANS[0]}/*`]);
  assert.deepEqual(parseMentions("@QA you", "review-tool", PLANS), ["review-tool/QA"]);
});

test("a funny name names its member, whatever its run", () => {
  assert.deepEqual(parseMentions("@SleepyOtter hi", PLANS[0], PLANS, NAMES), ["review-tool/S3"]);
});

test("unmatchedMentions: @all offers @swarm; an unknown code offers the open codes; members and @swarm match", () => {
  const unmatched = unmatchedMentions("@all @ZZ @swarm @SO @RT·S3 @orchestrator @SleepyOtter", "review-tool", PLANS, NAMES);
  assert.deepEqual(unmatched, [
    { name: "all", closest: ["swarm"] },
    { name: "ZZ", closest: ["SO", "RT"] },
  ]);
});

test("S33: a mention quoted as code, inline or fenced, names nobody and is never unmatched", () => {
  assert.deepEqual(parseMentions("the `@w1` line, then @w2", "review-tool", PLANS), ["review-tool/w2"]);
  assert.deepEqual(parseMentions("```\nswarm post \"@w1 hi\"\n```\n@w3 see above", "review-tool", PLANS), ["review-tool/w3"]);
  assert.deepEqual(unmatchedMentions("run `@nobody …` as printed", "review-tool", PLANS, NAMES), []);
});
