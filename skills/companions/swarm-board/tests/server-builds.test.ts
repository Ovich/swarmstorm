// U-F14 (board-split T36): two clients of different builds on one data home. The second replaces the first's server
// (D28); the server log is appended, never truncated, so who started which build, and what it found, stays readable.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureServer } from "../src/client/remote.ts";
import { stopBoardServer } from "../src/server/server.ts";
import { bundleVersion, serverLogFile } from "../src/wire.ts";

const tool = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-builds-"));
after(() => fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

/** A copy of this tool's launcher and bundle, its bundle marked so its version differs from every other copy's. */
const buildCopy = (name: string): string => {
  const root = path.join(scratch, name);
  fs.mkdirSync(path.join(root, "dist-cli"), { recursive: true });
  fs.copyFileSync(path.join(tool, "swarm.mjs"), path.join(root, "swarm.mjs"));
  fs.writeFileSync(path.join(root, "dist-cli", "cli.mjs"), `${fs.readFileSync(path.join(tool, "dist-cli", "cli.mjs"), "utf8")}\n// build ${name}\n`);
  return path.join(root, "swarm.mjs");
};

test("U-F14: a client of another build replaces the server; the log keeps both starts and what each found", { timeout: 60_000 }, async () => {
  const home = path.join(scratch, "home");
  const [a, b] = [buildCopy("a"), buildCopy("b")];
  assert.notEqual(bundleVersion(a), bundleVersion(b));
  try {
    const first = await ensureServer(home, a);
    assert.equal(first.version, bundleVersion(a));
    const second = await ensureServer(home, b);
    assert.equal(second.version, bundleVersion(b));
    const log = fs.readFileSync(serverLogFile(home), "utf8");
    assert.match(log, new RegExp(`^--- \\S+ pid ${process.pid} starts a server of ${bundleVersion(a)} \\(found none\\)$`, "m"));
    assert.match(log, new RegExp(`^--- \\S+ pid ${process.pid} starts a server of ${bundleVersion(b)} \\(found ${first.version}, pid ${first.pid}\\)$`, "m"));
  } finally {
    await stopBoardServer(home);
  }
});
