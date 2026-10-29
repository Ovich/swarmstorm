// G22: aiview's default port is derived from the data home; the default home keeps 4321.
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { defaultPort, firstFreePort } from "../src/core/home.ts";

test("G22: the default home serves on 4321", () => {
  assert.equal(defaultPort(path.join(os.homedir(), "swarmstorm_appdata")), 4321);
  assert.equal(defaultPort(path.join(os.homedir(), "charrette_appdata")), 4321);
});

test("G22: another data home gets a stable port of its own, never 4321", () => {
  const other = path.join(os.tmpdir(), "a-second-home");
  const port = defaultPort(other);
  assert.equal(defaultPort(other), port);
  assert.notEqual(port, 4321);
  assert.ok(port >= 4400 && port < 4900, String(port));
  assert.notEqual(defaultPort(path.join(os.tmpdir(), "a-third-home")), port);
});

test("V2: one home spelt differently (case, slashes, a trailing slash) gets one port", () => {
  const home = path.join(os.tmpdir(), "a-spelt-home");
  const port = defaultPort(home);
  assert.equal(defaultPort(home.toUpperCase()), port);
  assert.equal(defaultPort(home.replace(/\\/g, "/") + "/"), port);
  assert.equal(defaultPort(path.join(os.homedir(), "SWARMSTORM_APPDATA") + path.sep), 4321);
});

test("V2: a derived port something already listens on is passed over for the next free one", async () => {
  const net = await import("node:net");
  const held = net.createServer();
  await new Promise<void>((r) => held.listen(0, "127.0.0.1", () => r()));
  const taken = (held.address() as { port: number }).port;
  try {
    const free = firstFreePort(taken);
    assert.ok(free > taken && free <= taken + 20, String(free));
  } finally {
    held.close();
  }
});
