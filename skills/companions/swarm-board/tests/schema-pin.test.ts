// codebase-rework#D23: the store's schema pinned before the board splits and its DDL moves to a migration file (D10).
// A fresh store, opened by the source `openBoard` and by the built bundle's server, holds exactly the golden's schema:
// every `sqlite_master` statement, comments dropped and whitespace collapsed, and `PRAGMA user_version`.
// `GOLDEN_UPDATE=1 npm test` writes the golden from today's store instead of comparing.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { openBoard } from "../src/board/board.ts";
import { ensureServer } from "../src/client/remote.ts";
import { stopBoardServer } from "../src/server/server.ts";

const TOOL = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const GOLDEN = path.join(TOOL, "tests", "golden", "pinned", "schema.sql");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-schema-"));
after(() => fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

/** The schema of the store at `file`, one normalised statement per line, sorted, then its user_version. */
function schemaOf(file: string): string {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL").all() as { type: string; name: string; sql: string }[];
    const statements = rows
      .map((r) => `${r.type} ${r.name}: ${r.sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").replace(/\s*([(),])\s*/g, "$1").trim()}`)
      .sort();
    const { user_version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
    return [...statements, `user_version ${user_version}`, ""].join("\n");
  } finally {
    db.close();
  }
}

function matchesGolden(schema: string): void {
  if (process.env.GOLDEN_UPDATE === "1") fs.writeFileSync(GOLDEN, schema);
  assert.equal(schema, fs.readFileSync(GOLDEN, "utf8"));
}

test("D23: a fresh store opened by the source openBoard holds the pinned schema", async () => {
  const file = path.join(scratch, "source", "swarm.sqlite");
  (await openBoard(file)).close();
  matchesGolden(schemaOf(file));
});

test("D23: a fresh store opened by the built bundle's server holds the pinned schema", { timeout: 60_000 }, async () => {
  const home = path.join(scratch, "built");
  try {
    await ensureServer(home, path.join(TOOL, "swarm.mjs"));
  } finally {
    await stopBoardServer(home);
  }
  matchesGolden(schemaOf(path.join(home, "swarm.sqlite")));
});
