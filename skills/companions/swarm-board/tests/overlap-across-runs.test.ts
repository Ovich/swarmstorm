// Two runs on one project, one file changed in both: the overlap reaches the second member with its agree line, the
// agreement run as printed reaches the other run's member, and that member's merge of the file wakes the first. The
// claims and the merge are driven on the store as the links and merge-lock drive them; each member reads through the CLI.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { openBoard, type Board } from "../src/board/board.ts";
import { makeRepo, type Repo } from "./fixtures/worktrees.ts";
import { stopServerOf } from "./fixtures/server.ts";
import { codeVerbs } from "../src/packs/code/calls.ts";

async function onTheBoard(r: Repo, drive: (board: Board, code: ReturnType<typeof codeVerbs<Board>>) => void): Promise<void> {
  stopServerOf(r.home);
  const board = await openBoard(r.store);
  try {
    drive(board, codeVerbs(board));
  } finally {
    board.close();
  }
}
const waitIn = (r: Repo, cwd: string, as: string): string => r.cli(cwd, "wait", "--mentions", "--timeout", "2000", "--as", as);

test("an overlap across two runs is settled across them: flagged, agreed, and the merge told to the other run", async () => {
  const r = makeRepo("swarm-overlap-runs-");
  try {
    const open = (group: string, seat: string, cwd: string): string => {
      const seats = path.join(r.home, `seats-${group}.json`);
      fs.writeFileSync(seats, JSON.stringify([{ id: seat, blockers: [] }]));
      const run = r.cli(r.repo, "open", "--plan", group, "--title", group, "--seats", seats).split("\n")[0].trim();
      r.cli(cwd, "join", "--run", run, "--seat", seat, "--doing", "x", "--as", `${group}/${seat}`);
      waitIn(r, cwd, `${group}/${seat}`);
      return `${group}/${seat}`;
    };
    const a = open("alpha", "S3", r.wtA);
    const b = open("beta", "S5", r.wtB);
    // alpha/S3 changes src/a.ts first, beta/S5 second: the flag is beta/S5's
    await onTheBoard(r, (board, code) => {
      code.changes(board.participant(a)!, ["src/a.ts"]);
      code.changes(board.participant(b)!, ["src/a.ts"]);
    });
    const flagged = waitIn(r, r.wtB, b);
    assert.match(flagged, /overlap: .*src\/a\.ts/);
    const agree = flagged.split("\n").map((l) => l.match(/(agree .*--about src\/a\.ts.*)$/)?.[1]).find(Boolean);
    assert.ok(agree, flagged);
    assert.match(agree!, /--with alpha\/S3/, "the other run's holder, named across runs");
    assert.doesNotMatch(waitIn(r, r.wtA, a), /overlap:/, "the holder hears the agreement, not the flag");

    // beta/S5 runs the agreement, its party alpha/S3
    r.cli(r.wtB, "agree", "S3 merges src/a.ts first, then S5 rebases", "--about", "src/a.ts", "--with", "alpha/S3", "--as", b);
    const told = waitIn(r, r.wtA, a);
    assert.match(told, /S3 merges src\/a\.ts first, then S5 rebases/);

    // alpha/S3's merge of the file wakes beta/S5, the agreement's other party
    await onTheBoard(r, (board, code) => {
      code.merged(board.participant(a)!, "abc1234", ["src/a.ts"]);
    });
    assert.match(waitIn(r, r.wtB, b), /merged abc1234/);
  } finally {
    r.cleanup();
  }
});
