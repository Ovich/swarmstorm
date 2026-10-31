// F25: an agreement's parties are its mentions, then --with, else the other holders of its file; none is flagged.
// F28: a background listener's answer is delivered, so a following deliver does not repeat it.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board } from "../src/board/board.ts";
import { codeVerbs } from "../src/packs/code/calls.ts";

const REPO = "/repos/one/.git";
let dir: string;
let board: Board;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-agree-"));
  board = await openBoard(path.join(dir, "swarm.sqlite"));
});
afterEach(() => {
  board.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const setup = (files: Record<string, string[]>) => {
  const ids = Object.keys(files);
  const run = board.openRun({ repo: REPO, kind: "task", group: "g", title: "G", seats: ids.map((id) => ({ id, blockers: [] })) });
  const members = ids.map((id) => board.join({ run: run.id, seat: id, doing: "x", files: files[id].map((p) => ({ path: p, interface: false })) }).member);
  for (const m of members) board.deliverMentions(m);
  return members;
};

test("F25: --with names the agreement's party, and the merge of its file wakes it", async () => {
  const [w1, w2] = setup({ w1: [], w2: [] });
  const m = board.post(w2, "you merge first", { kind: "agreement", about: "docs/notes.md", with: ["w1"] });
  assert.deepEqual(m.mentions, ["g/w1"]);
  board.deliverMentions(w1);
  board.deliverMentions(w2);
  const waiting = board.wait(w2, { mentionsOnly: true, timeoutMs: 3000 });
  codeVerbs(board).merged(w1, "abc123", ["docs/notes.md"]);
  const got = await waiting;
  assert.match(got.full[0].body, /@g\/w2: you agreed on a file it changed/);
});

test("F25: with no mention and no --with, the other holders of the --about file are the parties", () => {
  const [, w2] = setup({ w1: ["src/a.ts"], w2: ["src/a.ts"], w3: [] });
  const m = board.post(w2, "I take the top half", { kind: "agreement", about: "src/a.ts" });
  assert.deepEqual(m.mentions, ["g/w1"]);
});

test("the agree line a holder is given names the asker by --with, so the agreement's party is who asked", () => {
  const [, w2, w3] = setup({ w1: [], w2: [], w3: ["src/a.ts"] });
  codeVerbs(board).checkEdit(w2, "src/a.ts");
  board.post(w2, "@w3 I resolved src/a.ts: both cases removed", { about: "src/a.ts" });
  const all = board.deliverMentions(w3).full;
  const heard = all.find((m) => m.about === "src/a.ts") as { answer?: string } | undefined;
  assert.match(heard?.answer ?? "", /--about src\/a\.ts --with g\/w2$/);
  const m = board.post(w3, "agreed: your resolution stands", { kind: "agreement", about: "src/a.ts", with: ["g/w2"] });
  assert.deepEqual(m.mentions, ["g/w2"]);
});

test("F25: an agreement with no other party is refused, nothing recorded", () => {
  const [w1] = setup({ w1: [], w2: [] });
  assert.throws(() => board.post(w1, "agreed", { kind: "agreement", about: "docs/x.md" }), /agree needs another party: @<seat> or --with <seat>; to inform, use post/);
  assert.ok(board.post(w1, "plain").seq > 0);
});

test("F28: what a wait --mentions answered is delivered; a later look does not repeat it", async () => {
  const [w1, w2] = setup({ w1: [], w2: [] });
  const waiting = board.wait(w2, { mentionsOnly: true, timeoutMs: 3000 });
  board.post(w1, "@g/w2 look");
  const got = await waiting;
  assert.equal(got.full.length, 1);
  const again = board.deliverMentions(w2);
  assert.equal(again.full.some((m) => m.body.includes("look")), false);
});
