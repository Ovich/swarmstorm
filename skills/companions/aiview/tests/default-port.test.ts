// G22: aiview's default port is derived from the data home; the default home keeps 4321.
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { defaultPort } from "../src/core/home.ts";

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
