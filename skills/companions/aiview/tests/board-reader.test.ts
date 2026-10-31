// The seam from aiview's side (D3, swarm-relay D23): aiview reads the swarm board through swarm's
// BoardReader, a client of the board server, imported by relative path, so aiview's typecheck and
// test member prove the cross-folder import. The board is seeded through a test server.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoardReader } from "../../swarm-board/src/client/reader.ts";
import { SWARM_CLI, startTestBoard } from "./fixtures/board-server.ts";

test("aiview reads a run through the reader", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiview-board-reader-"));
  const board = await startTestBoard(dir);
  const reader = await openBoardReader({ dataRoot: dir, swarmEntry: SWARM_CLI });
  try {
    const { writer } = board;
    const repo = "/repos/one/.git";
    const run = await writer.openRun({ repo, group: "review-tool", title: "Review tool", seats: [{ id: "S1", blockers: [] }] });
    const s1 = (await writer.join({ run: run.id, seat: "S1", doing: "the schema", files: [] })).member;
    await writer.post(s1, "@orchestrator the schema is in");

    const [summary] = await reader.repos();
    assert.equal(summary.repo, repo);
    assert.deepEqual(summary.runs.map((r) => [r.run, r.title]), [[run.id, "Review tool"]]);
    assert.deepEqual(await reader.snapshot(repo), await writer.snapshot(repo));
  } finally {
    reader.close();
    await board.close();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
