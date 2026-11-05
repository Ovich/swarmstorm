// A link whose server refuses the connection with an `error` and never a `close` (Node 22's WebSocket, on a port
// nothing listens on; Node 24 fires both) still ends that connection and gives up after its time (D27).
// The WebSocket is replaced in this file's own process, so the case is the same on every Node version.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runLink } from "../src/link/link.ts";
import { bundleVersion, serverStateFile } from "../src/wire.ts";

/** A WebSocket that refuses as Node 22's does: `error`, then nothing. */
class ErrorOnlyWebSocket {
  static OPEN = 1;
  readyState = 3;
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    setTimeout(() => this.onerror?.(), 0);
  }
  send() {}
  close() {}
}

test("a refused connection that fires only error, never close, ends; the link gives up after its time (D27)", { timeout: 10_000 }, async (t) => {
  const realWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = ErrorOnlyWebSocket as unknown as typeof WebSocket;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-link-refused-"));
  t.after(() => {
    globalThis.WebSocket = realWebSocket;
    fs.rmSync(home, { recursive: true, force: true });
  });
  fs.writeFileSync(serverStateFile(home), JSON.stringify({ pid: process.pid, port: 1, secret: "s3cret", version: bundleVersion() }));

  const stop = await runLink({
    dataRoot: home,
    member: "plan-x/S1",
    run: 68,
    env: {},
    binding: { verb: "join", run: 68, seat: "S1" },
    timing: { reconnectEveryMs: 50, reconnectGiveUpMs: 300, idleMs: 60 * 60_000, stateFileWaitMs: 500 },
  });

  assert.equal(stop.why, "no server");
});
