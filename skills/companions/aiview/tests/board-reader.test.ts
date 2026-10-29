// The seam from aiview's side (D3, swarm-relay D23): aiview reads the swarm board through swarm's
// BoardReader, a client of the board server, imported by relative path, so aiview's typecheck and
// test member prove the cross-folder import. The board is seeded through a test server.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoardReader } from "../../swarm-board/src/client/reader.ts";
import { SWARM_CLI, startTestBoard } from "./fixtures/board-server.ts";
import { codeVerbs } from "../../swarm-board/src/packs/code/calls.ts";

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

test("`BoardReader.stats` deep-equals `Board.stats` for a run, the across scopes and both kinds (D2, SL2)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiview-board-reader-stats-"));
  // a still clock, so an open run is computed to the same now by both
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-01T09:00:00.000Z") });
  const board = await startTestBoard(dir);
  const reader = await openBoardReader({ dataRoot: dir, swarmEntry: SWARM_CLI });
  try {
    const { writer } = board;
    const repo = "/repos/one/.git";
    const seats = [
      { id: "S1", blockers: [] },
      { id: "S2", blockers: [] },
    ];
    const plan = await writer.openRun({ repo, group: "review-tool", title: "Review tool", seats });
    const s1 = (await writer.join({ run: plan.id, seat: "S1", doing: "the schema", files: [{ path: "src/a.ts", interface: true }] })).member;
    const s2 = (await writer.join({ run: plan.id, seat: "S2", doing: "the page", files: [] })).member;
    await codeVerbs(writer).checkEdit(s2, "src/a.ts");
    await writer.post(s2, `@${s1.name} I add a helper to src/a.ts`, { about: "src/a.ts" });
    mock.timers.tick(60_000);
    assert.equal((await codeVerbs(writer).lockMerge(s1, "main")).granted, true);
    await codeVerbs(writer).merged(s1, "abc123", ["src/a.ts"], { files: ["src/a.ts"] });
    await writer.end(s1);
    await writer.end(s2);
    mock.timers.tick(60_000);
    await writer.closeRun(plan.id);

    const idea = await writer.openRun({
      repo,
      kind: "brainstorm",
      group: "idea",
      title: "An idea",
      seats: [
        { id: "skeptic", role: "skeptic", blockers: [] },
        { id: "builder", role: "builder", blockers: [] },
      ],
    });
    const skeptic = (await writer.join({ run: idea.id, seat: "skeptic", doing: "doubting", files: [] })).member;
    const builder = (await writer.join({ run: idea.id, seat: "builder", doing: "building", files: [] })).member;
    await writer.post(builder, "a cache in front, see src/a.ts:12", { about: "D1" });
    const agreed = await writer.post(builder, "a cache with a one-minute TTL", { about: "D1", kind: "agreement" });
    await writer.endorse(skeptic, agreed.seq);
    mock.timers.tick(60_000); // the brainstorm run stays open

    const scopes = [
      { repo, run: plan.id },
      { repo, run: idea.id },
      { repo },
      { repo, since: "30d" },
      { repo, closedOnly: true },
      { repo, kinds: ["plan" as const] },
      { repo, kinds: ["brainstorm" as const] },
    ];
    for (const scope of scopes) assert.deepEqual(await reader.stats(scope), await writer.stats(scope), JSON.stringify(scope));
    assert.equal((await reader.stats({ repo })).runs.length, 2, "both kinds are in the across scope");
  } finally {
    mock.timers.reset();
    reader.close();
    await board.close();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
