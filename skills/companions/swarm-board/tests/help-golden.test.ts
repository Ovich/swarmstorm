// codebase-rework#D23: swarm's help pinned byte for byte before the CLI becomes a verb table (D11): `--help`,
// `--help code` and the hidden verbs' help, as the CLI prints them, the CLI's own command line normalised to `swarm`.
// A pinned help lives in `golden/pinned/help.<name>.txt`; `GOLDEN_UPDATE=1 npm test` writes them instead of comparing.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { shellWord, verbHelp } from "../src/cli/answer/index.ts";

const TOOL = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SOURCE_CLI = path.join(TOOL, "src", "cli", "index.ts");
const PINNED = path.join(TOOL, "tests", "golden", "pinned");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-help-"));
after(() => fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

function matchesPinned(name: string, text: string): void {
  const file = path.join(PINNED, `help.${name}.txt`);
  if (process.env.GOLDEN_UPDATE === "1") fs.writeFileSync(file, text);
  assert.equal(text, fs.readFileSync(file, "utf8"), `help.${name}.txt`);
}

/** The CLI's answer to `argv`, exit 0 asked, its own command line (the first usage line names it) replaced by `swarm`. */
function helpOf(argv: string[]): string {
  const r = spawnSync(process.execPath, [SOURCE_CLI, ...argv], { encoding: "utf8", env: { ...process.env, SWARMSTORM_HOME: home } });
  assert.equal(r.status, 0, r.stderr);
  const cli = /^usage: (.+?) (?:<verb>|serve|link) /.exec(r.stdout)?.[1];
  assert.ok(cli, r.stdout);
  return r.stdout.split(cli).join("swarm");
}

test("D23: --help and --help code print the pinned help", () => {
  matchesPinned("core", helpOf(["--help"]));
  matchesPinned("code", helpOf(["--help", "code"]));
});

test("D23: a hidden verb's help prints its pinned usage line and starts nothing", () => {
  for (const verb of ["serve", "link"]) matchesPinned(verb, helpOf([verb, "--help"]));
});

// Each verb's own usage, as an argument error prints it (V9), pinned from today's `verbHelp` (cli/index.ts at
// 00ad156e) over `swarm` and no --as: one entry per verb of `help.verbs.json`.
test("D23: each verb's own usage and corrected form render as pinned", () => {
  const file = path.join(PINNED, "help.verbs.json");
  const pinned = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>;
  const rendered = Object.fromEntries(Object.keys(pinned).map((verb) => [verb, verbHelp("swarm", verb, shellWord("<group>/<seat>"))]));
  if (process.env.GOLDEN_UPDATE === "1") fs.writeFileSync(file, `${JSON.stringify(rendered, null, 2)}\n`);
  assert.deepEqual(rendered, pinned);
});

// codebase-rework#D12 (P2): the verb table's keys equal VERB_USAGE's keys; the assertion lands here with the table.
// D12-TABLE-KEYS
