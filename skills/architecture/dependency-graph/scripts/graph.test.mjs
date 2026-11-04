// node --test skills/architecture/dependency-graph/scripts   (from the repository root)
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { npmInstallArgs, npmInvocation, projectTypescriptVersion } from "./cruiser-install.mjs";

const GRAPH = join(dirname(fileURLToPath(import.meta.url)), "graph.mjs");

/** A project folder whose node_modules/typescript declares `version`. */
function projectWithTypescript(version) {
  const root = mkdtempSync(join(tmpdir(), "depgraph-"));
  writeFileSync(join(root, "package.json"), "{}\n");
  mkdirSync(join(root, "node_modules", "typescript"), { recursive: true });
  writeFileSync(join(root, "node_modules", "typescript", "package.json"), JSON.stringify({ version }));
  return root;
}

test("a plain semver TypeScript version, prerelease included, is taken", () => {
  assert.deepEqual(projectTypescriptVersion(projectWithTypescript("5.6.3")), { version: "5.6.3" });
  assert.deepEqual(projectTypescriptVersion(projectWithTypescript("5.7.0-beta.1")), { version: "5.7.0-beta.1" });
});

test("a TypeScript version a shell would read is refused (D10)", () => {
  for (const version of ["5.6.3 & calc", "5.6.3\" && echo x", "^5.6.3", "5", "5.6.3;rm", "$(id)"]) {
    const found = projectTypescriptVersion(projectWithTypescript(version));
    assert.equal(found.version, undefined, version);
    assert.match(found.refused, /not a plain semver/, version);
  }
});

test("graph.mjs refuses a bad TypeScript version before any install", () => {
  const root = projectWithTypescript("5.6.3 & calc");
  const home = mkdtempSync(join(tmpdir(), "depgraph-home-"));
  const run = spawnSync(process.execPath, [GRAPH, "--root", root], { encoding: "utf8", env: { ...process.env, HOME: home, USERPROFILE: home } });
  assert.equal(run.status, 1);
  assert.match(JSON.parse(run.stdout).error, /not a plain semver/);
});

test("npm runs with no shell: on Windows node on npm-cli.js, elsewhere npm, the version one argv element", () => {
  const installArgs = npmInstallArgs("C:/cache dir", "18.5.0", "5.6.3");
  assert.deepEqual(installArgs.slice(-2), ["dependency-cruiser@18.5.0", "typescript@5.6.3"]);
  const execPath = "C:\\Program Files\\nodejs\\node.exe";
  const onWindows = npmInvocation(installArgs, { platform: "win32", execPath, exists: () => true });
  assert.equal(onWindows.program, execPath);
  assert.deepEqual(onWindows.argv, ["C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js", ...installArgs]);
  assert.ok(!/\.cmd$|^cmd/i.test(onWindows.program));
  assert.deepEqual(npmInvocation(installArgs, { platform: "linux", execPath: "/usr/bin/node" }), { program: "npm", argv: installArgs });
  assert.match(npmInvocation(installArgs, { platform: "win32", execPath, exists: () => false }).refused, /no npm-cli\.js at/);
});

test("graph.mjs passes no shell option to the npm install", () => {
  assert.doesNotMatch(readFileSync(GRAPH, "utf8"), /shell\s*:/);
});
