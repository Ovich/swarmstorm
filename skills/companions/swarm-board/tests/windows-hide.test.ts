// board-split#D39: no test opens a console window. Every child a test starts is given `windowsHide: true` by the
// suite's preload (tests/fixtures/outside-harness.ts), and every test script of package.json loads that preload.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const seen = (): Record<string, unknown>[] => (globalThis as { __childOptionsSeen?: Record<string, unknown>[] }).__childOptionsSeen ?? [];
const last = () => seen().at(-1);

test("the preload is loaded: children started here are counted", () => {
  assert.ok((globalThis as { __childOptionsSeen?: unknown }).__childOptionsSeen, "tests/fixtures/outside-harness.ts not loaded (run through npm test)");
});

test("a child started with no options, with args, or with options of its own is hidden", async () => {
  spawnSync(process.execPath, ["-e", ""]);
  assert.equal(last()?.windowsHide, true, "spawnSync(cmd, args)");
  spawnSync(process.execPath, ["-e", ""], { encoding: "utf8" });
  assert.deepEqual(last(), { windowsHide: true, encoding: "utf8" }, "spawnSync(cmd, args, options)");
  execFileSync(process.execPath, ["-e", ""]);
  assert.equal(last()?.windowsHide, true, "execFileSync");
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  assert.equal(last()?.windowsHide, true, "spawn");
  await new Promise((ok) => child.on("exit", ok));
});

test("a caller's own windowsHide still wins", () => {
  spawnSync(process.execPath, ["-e", ""], { windowsHide: false });
  assert.equal(last()?.windowsHide, false);
});

test("every test script of package.json loads the preload", () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "..", "package.json"), "utf8")) as { scripts: Record<string, string> };
  const testing = Object.entries(pkg.scripts).filter(([, cmd]) => /--test\b/.test(cmd));
  assert.ok(testing.length, "no test script found");
  for (const [name, cmd] of testing) assert.match(cmd, /--import \.\/tests\/fixtures\/outside-harness\.ts/, name);
});
