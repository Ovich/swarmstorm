// claims-phase build 2 (v1's verify 1): a notice the board posts in a member's own name for that member reaches it
// through `wait --mentions` (the drift notice, v1-1; the overlap flag to its writer, v1-7); a member the merge's event
// already mentioned gets no drift notice for it (v1-6); a merged claim the link never reported, edited later, is active
// again (v1-4); a claim active again keeps its merge's sha, so the list still shows the merge and drift still finds it
// (v1-5). The claims are driven on the store as the member's link drives them; each member reads through the CLI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openBoard, type Board, type Participant } from "../src/board/board.ts";
import { makeRepo, openTwoRunners, type Repo } from "./fixtures/worktrees.ts";
import { stopServerOf } from "./fixtures/server.ts";
import { codeVerbs } from "../src/packs/code/calls.ts";

const SHA = "0c85ce0aa1b2c3d4e5f60718293a4b5c6d7e8f90";
const OTHER = "9f1a2d77b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6";
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

test("v1-1, v1-6: a drift notice wakes its member through wait, with the rebase step; none to a member the merge mentioned", async () => {
  const r = makeRepo("swarm-claims-wake-");
  try {
    openTwoRunners(r, PLAN);
    await onTheBoard(r, (_board, s3, s5, code) => {
      code.changes(s3, ["src/a.ts", "src/c.ts"]);
      code.changes(s5, ["src/a.ts"]);
      // S3 merges a.ts, which S5 holds: that merge mentions S5; then c.ts, which S5 does not hold yet: that one does not
      code.merged(s3, OTHER, ["src/a.ts"]);
      code.merged(s3, SHA, ["src/c.ts"]);
      code.changes(s5, ["src/a.ts", "src/c.ts"], [{ path: "src/a.ts", sha: OTHER }, { path: "src/c.ts", sha: SHA }]);
    });
    const heard = waitIn(r, r.wtB);
    assert.match(heard, /merged 9f1a2d77/, "the a.ts merge mentions S5");
    // the drift notice for c.ts reaches S5, posted in its own name; a.ts's is skipped: the merge already told it
    assert.match(heard, /src\/c\.ts was merged by review-tool\/S3 \(0c85ce0\) and is not in your branch: rebase now/);
    assert.match(heard, new RegExp(`commit what you have, then: git rebase ${SHA}`));
    assert.doesNotMatch(heard, /src\/a\.ts was merged by/, "v1-6: no drift notice for the file the merge told it of");
  } finally {
    r.cleanup();
  }
});

test("v1-7: the overlap flag wakes its writer too, with the agree step", async () => {
  const r = makeRepo("swarm-claims-wake-");
  try {
    openTwoRunners(r, PLAN);
    // S3 holds src/a.ts; S5's worktree changes it too: the flag is posted in S5's name
    await onTheBoard(r, (_board, _s3, s5, code) => code.changes(s5, ["src/a.ts"]));
    const writer = waitIn(r, r.wtB);
    assert.match(writer, /overlap: .* changes src\/a\.ts/);
    assert.match(writer, /settle it: .*agree/);
    assert.match(waitIn(r, r.wtA), /overlap: .* changes src\/a\.ts/, "and the holder, as before");
  } finally {
    r.cleanup();
  }
});

test("v1-4, v1-5: a merged file never reported, edited again, is active; active again it keeps its sha, and drift finds it", async () => {
  const r = makeRepo("swarm-claims-wake-");
  try {
    openTwoRunners(r, PLAN);
    let files: unknown;
    await onTheBoard(r, (board, s3, s5, code) => {
      // S3's link never reported src/old.ts before the merge (v1-4): its next edit makes the claim active again
      code.merged(s3, SHA, ["src/old.ts"]);
      code.changes(s3, ["src/a.ts", "src/old.ts"]);
      // S5 changes it too, its branch lacking S3's merge: the overlap (S3 active) and the drift (S3's merge kept, v1-5)
      code.changes(s5, ["src/old.ts"], [{ path: "src/old.ts", sha: SHA }]);
      files = board.snapshot(board.repos()[0].repo).files.find((f) => f.path === "src/old.ts");
    });
    assert.deepEqual(files, { path: "src/old.ts", holders: [`${PLAN}/S3`, `${PLAN}/S5`], past: [{ member: `${PLAN}/S3`, state: "merged", sha: SHA }] });
    const s5 = waitIn(r, r.wtB);
    assert.match(s5, /overlap: .* changes src\/old\.ts/, "v1-4: S3 is an active holder again");
    assert.match(s5, /src\/old\.ts was merged by review-tool\/S3 \(0c85ce0\) and is not in your branch: rebase now/, "v1-5: drift finds the kept merge");
  } finally {
    r.cleanup();
  }
});
