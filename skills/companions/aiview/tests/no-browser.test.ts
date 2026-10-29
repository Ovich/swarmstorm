// No test path reaches a real browser (board-split: a test run flooded the person's browser with tabs).
// Every opener goes through src/core/browser.ts, which refuses under AIVIEW_NO_BROWSER=1 and for any home but the person's.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { browserRefusal } from "../src/core/browser.ts";

const SRC = path.resolve(import.meta.dirname, "..", "src");

test("the test run carries AIVIEW_NO_BROWSER=1, so every child it spawns inherits it", () => {
  assert.equal(process.env.AIVIEW_NO_BROWSER, "1", "run the suite through npm test: its preload sets it");
});

test("the opener refuses under AIVIEW_NO_BROWSER=1, and for a scratch or dev home even without it", () => {
  assert.match(browserRefusal({ AIVIEW_NO_BROWSER: "1" }, path.join(os.homedir(), "swarmstorm_appdata"))!, /AIVIEW_NO_BROWSER/);
  assert.match(browserRefusal({}, path.join(os.tmpdir(), "aiview-scratch"))!, /not the person's own/);
  assert.match(browserRefusal({}, path.join(os.homedir(), "swarm-dev-home"))!, /not the person's own/);
  assert.equal(browserRefusal({}, path.join(os.homedir(), "swarmstorm_appdata")), null);
});

test("no file under src/ but core/browser.ts names a browser launcher", () => {
  const files = fs.readdirSync(SRC, { recursive: true, encoding: "utf8" }).filter((f) => /\.(ts|tsx)$/.test(f) && path.normalize(f) !== path.normalize("core/browser.ts"));
  const launchers = files.flatMap((f) =>
    fs
      .readFileSync(path.join(SRC, f), "utf8")
      .split("\n")
      .filter((line) => /"xdg-open"|"\/c", "start"/.test(line))
      .map((line) => `${f}: ${line.trim()}`),
  );
  assert.deepEqual(launchers, []);
});
