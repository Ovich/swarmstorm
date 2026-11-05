#!/usr/bin/env node
// The one release check (trust-adaptations#D13): nothing ships unless it is what the source builds.
//
//   node scripts/release-check.mjs            # everything below
//   node scripts/release-check.mjs --dist     # only: rebuild and compare the bundles
//
// It builds both companions from their locks, then asks git whether the committed bundles
// changed (trust-adaptations#D12), checks that the four manifests declare one version (the
// rule tag-release.yml applies), and, without --dist, runs every test the release needs.
// It imports no companion source: it runs their own npm scripts and compares, nothing more.
// Exit 0 when every check passes; else 1, one line per failure naming the file or manifest
// and the command that fixes it.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const onlyBundles = process.argv.includes("--dist");

// swarm-board first: aiview's CLI bundles swarm-board's client/reader.ts.
const companions = [
  { dir: "skills/companions/swarm-board", bundlePaths: ["skills/companions/swarm-board/dist-cli"] },
  {
    dir: "skills/companions/aiview",
    bundlePaths: ["skills/companions/aiview/dist", "skills/companions/aiview/dist-cli"],
    extraTestScripts: ["test:app"],
  },
];

// The skill scripts' own tests, as RELEASING.md lists them.
const skillScriptTests = [
  "skills/plan/write-plan/scripts/decisions.test.mjs",
  "skills/review/pr-review/scripts/scope.test.mjs",
  "skills/project/write-conventions/scripts/rules.test.mjs",
  "skills/workbench/create-workbench/scripts/*.test.mjs",
];

const manifestVersionReaders = [
  [".claude-plugin/plugin.json", (m) => m.version],
  [".claude-plugin/marketplace.json", (m) => m.plugins?.[0]?.version],
  [".codex-plugin/plugin.json", (m) => m.version],
  [".cursor-plugin/plugin.json", (m) => m.version],
];

/** Runs a command in `cwd` (relative to the repository root), its output shown as it comes; true when it exits 0. */
function runSucceeds(command, args, { cwd = ".", env = process.env } = {}) {
  const options = { cwd: join(repoRoot, cwd), env, stdio: "inherit" };
  // npm is a .cmd shim on Windows, which only a shell starts; the arguments are this file's own words.
  const result =
    command === "npm" && process.platform === "win32"
      ? spawnSync([command, ...args].join(" "), { ...options, shell: true })
      : spawnSync(command, args, options);
  return result.status === 0;
}

function buildFailures() {
  for (const { dir } of companions) {
    for (const step of [["ci"], ["run", "build"]]) {
      console.log(`\n== ${dir}: npm ${step.join(" ")}`);
      if (!runSucceeds("npm", step, { cwd: dir })) {
        return [`${dir}: npm ${step.join(" ")} failed; fix it, then: cd ${dir} && npm ci && npm run build`];
      }
    }
  }
  return [];
}

function staleBundleFailures() {
  const bundlePaths = companions.flatMap((c) => c.bundlePaths);
  const status = spawnSync("git", ["status", "--porcelain", "-z", "--untracked-files=all", "--", ...bundlePaths], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (status.status !== 0) return [`git status failed: ${status.stderr.trim()}`];
  return status.stdout
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const file = entry.slice(3);
      const companion = companions.find((c) => c.bundlePaths.some((p) => file.startsWith(`${p}/`)));
      return `${file}: differs from what the source builds; rebuild and commit it: cd ${companion.dir} && npm ci && npm run build`;
    });
}

function manifestFailures() {
  const declared = manifestVersionReaders.map(([file, versionOf]) => {
    try {
      return { file, version: versionOf(JSON.parse(readFileSync(join(repoRoot, file), "utf8"))) ?? "" };
    } catch (error) {
      return { file, version: "", unreadable: error.message };
    }
  });
  const failures = declared
    .filter((m) => m.unreadable || !m.version)
    .map((m) => `${m.file}: ${m.unreadable ?? "no version declared"}; declare the release's version in it (RELEASING.md)`);
  if (failures.length) return failures;
  const [reference, ...others] = declared;
  const disagreeing = others.filter((m) => m.version !== reference.version);
  return disagreeing.map(
    (m) =>
      `${m.file}: version '${m.version}', ${reference.file} says '${reference.version}'; bump all four manifests to the same value (RELEASING.md)`,
  );
}

function testFailures() {
  // trust-adaptations#D24: the suites run on a scratch data home, never the person's.
  const scratchHome = mkdtempSync(join(tmpdir(), "release-check-home-"));
  const env = { ...process.env, SWARMSTORM_HOME: scratchHome };
  const failures = [];
  try {
    for (const { dir, extraTestScripts = [] } of companions) {
      for (const script of ["test", "typecheck", ...extraTestScripts]) {
        console.log(`\n== ${dir}: npm run ${script}`);
        if (!runSucceeds("npm", ["run", script], { cwd: dir, env })) {
          failures.push(`${dir}: npm run ${script} failed; rerun it there: cd ${dir} && npm run ${script}`);
        }
      }
    }
    for (const testFile of skillScriptTests) {
      console.log(`\n== node --test ${testFile}`);
      if (!runSucceeds(process.execPath, ["--test", testFile], { env })) {
        failures.push(`${testFile}: node --test failed; rerun it: node --test "${testFile}"`);
      }
    }
  } finally {
    rmSync(scratchHome, { recursive: true, force: true });
  }
  return failures;
}

const failures = buildFailures();
if (!failures.length) {
  failures.push(...staleBundleFailures(), ...manifestFailures());
  if (!onlyBundles) failures.push(...testFailures());
}

if (failures.length) {
  console.error(`\nrelease-check: ${failures.length} failure(s)`);
  for (const line of failures) console.error(line);
  process.exit(1);
}
console.log(`\nrelease-check: ${onlyBundles ? "bundles match the source, manifests agree" : "every check passed"}`);
