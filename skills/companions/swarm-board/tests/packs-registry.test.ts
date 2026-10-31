// The pack registry (board-split#D11, D22): one table from (kind, role) to the member's pack and verify setting,
// chosen once at join and stored on the member, so it survives a server restart.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard } from "../src/board/board.ts";
import { registry } from "../src/packs/registry.ts";

const rowOf = (kind: string, role: string | null) => {
  const row = registry.forMember(kind, role);
  return { pack: row.pack?.name ?? null, verify: row.verify };
};

test("registry: each (kind, role) row", () => {
  assert.deepEqual(rowOf("plan", null), { pack: "code", verify: false }, "plan worker");
  assert.deepEqual(rowOf("plan", "builder"), { pack: "code", verify: false }, "plan worker with a role of no row");
  assert.deepEqual(rowOf("task", null), { pack: "code", verify: false }, "task worker");
  assert.deepEqual(rowOf("task", "verifier"), { pack: null, verify: true }, "verifier on a task run");
  assert.deepEqual(rowOf("plan", "verifier"), { pack: null, verify: true }, "verifier on a plan run");
  assert.deepEqual(rowOf("brainstorm", null), { pack: null, verify: false }, "brainstorm seat without role");
  assert.deepEqual(rowOf("brainstorm", "skeptic"), { pack: null, verify: false }, "brainstorm seat with a role");
  assert.throws(() => registry.forMember("retro", null), /unknown kind retro: the kinds are plan, brainstorm, task/);
});

test("registry: the code pack lists its verbs and carries its pack methods (D15, D19, D38)", () => {
  const code = registry.forMember("task", null).pack!;
  assert.deepEqual(code.verbs.map((v) => v.name), ["claim", "release", "merge-lock", "merged", "flag", "conflicts", "unclaimed", "guides"]);
  assert.equal(typeof code.stats?.ofRun, "function");
  for (const method of ["alsoFor", "defaultParties", "busy", "openTables", "run", "beforeEnd", "afterEnd"] as const) assert.equal(typeof code[method], "function", method);
});

test("a member's pack is chosen at join, stored, and survives a server restart", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-packs-"));
  const file = path.join(dir, "swarm.sqlite");
  try {
    let board = await openBoard(file);
    const task = board.openRun({ repo: "/repos/one/.git", kind: "task", group: "t", title: "T", seats: [{ id: "w1", blockers: [] }, { id: "v1", role: "verifier", blockers: [] }] });
    const talk = board.openRun({ repo: "/repos/one/.git", kind: "brainstorm", group: "b", title: "B", seats: [{ id: "s1", blockers: [] }, { id: "sk", role: "skeptic", blockers: [] }] });
    for (const seat of ["w1", "v1"]) board.join({ run: task.id, seat, doing: "x", files: [] });
    for (const seat of ["s1", "sk"]) board.join({ run: talk.id, seat, doing: "x", files: [] });
    board.close();
    board = await openBoard(file);
    const stored = (name: string) => {
      const p = board.participant(name)!;
      return { pack: p.pack, verify: p.verify };
    };
    assert.deepEqual(stored("t/w1"), { pack: "code", verify: false });
    assert.deepEqual(stored("t/v1"), { pack: null, verify: true });
    assert.deepEqual(stored("b/s1"), { pack: null, verify: false });
    assert.deepEqual(stored("b/sk"), { pack: null, verify: false });
    // the run's kind still names its default pack: what a close and an orchestrator read (D22)
    assert.equal(board.participant("t/v1")!.kindPack, "code");
    board.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test("a member row from before the registry reads as its kind's default", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-packs-old-"));
  const file = path.join(dir, "swarm.sqlite");
  try {
    let board = await openBoard(file);
    const task = board.openRun({ repo: "/repos/one/.git", kind: "task", group: "t", title: "T", seats: [{ id: "w1", blockers: [] }] });
    board.join({ run: task.id, seat: "w1", doing: "x", files: [] });
    board.close();
    const { DatabaseSync } = await import("node:sqlite");
    const raw = new DatabaseSync(file);
    raw.exec("UPDATE participants SET pack = NULL, verify = 0, pack_chosen = 0");
    raw.close();
    board = await openBoard(file);
    assert.deepEqual({ pack: board.participant("t/w1")!.pack, verify: board.participant("t/w1")!.verify }, { pack: "code", verify: false });
    board.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test("no file under src/cli/ imports src/packs/ (D9)", () => {
  const cli = path.resolve(import.meta.dirname, "..", "src", "cli");
  const files = fs.readdirSync(cli, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts"));
  for (const f of files) {
    const imported = [...fs.readFileSync(path.join(cli, f), "utf8").matchAll(/from\s+["']([^"']*\/packs\/[^"']*)["']/g)].map((m) => m[1]);
    assert.deepEqual(imported, [], f);
  }
});
