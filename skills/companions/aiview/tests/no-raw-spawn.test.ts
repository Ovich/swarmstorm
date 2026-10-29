// board-split#D39: every child process src/ starts goes through src/proc.ts, which hides its window; no other file
// imports node:child_process, save a line that says why under an `AGENTS EXCEPTION`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname, "..", "src");

test("no file under src/ but proc.ts imports node:child_process", () => {
  const files = fs.readdirSync(SRC, { recursive: true, encoding: "utf8" }).filter((f) => /\.(ts|tsx)$/.test(f) && f !== "proc.ts");
  const raw = files.flatMap((f) =>
    fs
      .readFileSync(path.join(SRC, f), "utf8")
      .split("\n")
      .filter((line) => /["'](node:)?child_process["']/.test(line) && !line.includes("AGENTS EXCEPTION"))
      .map((line) => `${f}: ${line.trim()}`),
  );
  assert.deepEqual(raw, []);
});
