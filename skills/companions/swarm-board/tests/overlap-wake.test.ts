// An overlap the board posts in a member's own name, for that member, reaches it through `wait --mentions`, with the agree
// step; the holder is not woken. The claims are driven on the store as the member's link drives them; each member reads
// through the CLI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openBoard, type Board, type Participant } from "../src/board/board.ts";
import { makeRepo, openTwoRunners, type Repo } from "./fixtures/worktrees.ts";
import { stopServerOf } from "./fixtures/server.ts";
import { codeVerbs } from "../src/packs/code/calls.ts";

const PLAN = "review-tool";

/** The two runners of `openTwoRunners`, S3 (worktree a, holding src/a.ts) and S5 (worktree b), driven on the board
 *  itself with the server stopped, as their links' frames and merges would; then each reads through `wait --mentions`. */
async function onTheBoard(r: Repo, drive: (board: Board, s3: Participant, s5: Participant, code: ReturnType<typeof codeVerbs<Board>>) => void): Promise<void> {
  stopServerOf(r.home);
  const board = await openBoard(r.store);
  try {
    drive(board, board.participant(`${PLAN}/S3`)!, board.participant(`${PLAN}/S5`)!, codeVerbs(board));
  } finally {
    board.close();
  }
}
const waitIn = (r: Repo, cwd: string): string => r.cli(cwd, "wait", "--mentions", "--timeout", "2000");

test("the overlap flag wakes its writer, with the agree step, and not the holder", async () => {
  const r = makeRepo("swarm-claims-wake-");
  try {
    openTwoRunners(r, PLAN);
    // S3 holds src/a.ts; S5's worktree changes it too: the flag is posted in S5's name
    await onTheBoard(r, (_board, _s3, s5, code) => code.changes(s5, ["src/a.ts"]));
    const writer = waitIn(r, r.wtB);
    assert.match(writer, /overlap: .* changes src\/a\.ts/);
    assert.match(writer, /settle it: .*agree/);
    assert.doesNotMatch(waitIn(r, r.wtA), /overlap:/, "the holder is not woken: the agreement tells it");
  } finally {
    r.cleanup();
  }
});
