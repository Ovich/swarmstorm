// The help golden (codebase-rework#D23): aiview's top-level usage and every verb's usage
// refusal, byte-compared to one golden file. AIVIEW_UPDATE_GOLDEN=1 rewrites the golden.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, "..", "src", "cli", "index.ts");
const GOLDEN = path.join(HERE, "fixtures", "help-golden.txt");

/** Each invocation whose answer is a usage text, in the order the golden lists them. */
const USAGE_INVOCATIONS: string[][] = [
  [],
  ["--help"],
  ["open"],
  ["add"],
  ["update"],
  ["remove"],
  ["move"],
  ["project", "add"],
  ["project", "bogus", "x"],
  ["pending", "clear"],
  ["pending", "add", "#1"],
  ["pending", "done"],
  ["path"],
  ["components"],
  ["check"],
  ["show"],
  ["tracker"],
  ["plan"],
];

test("every usage answer reads as its golden", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "aiview-help-"));
  const cli = (argv: string[]) =>
    spawnSync(process.execPath, [CLI, ...argv], { encoding: "utf8", cwd: home, env: { ...process.env, AIVIEW_ROOT: home, SWARMSTORM_HOME: home } });
  try {
    // document #1, for the refusal that needs one registered
    fs.writeFileSync(path.join(home, "doc.md"), "# doc\n");
    assert.equal(cli(["add", path.join(home, "doc.md"), "--kind", "note"]).status, 0);
    const answers = USAGE_INVOCATIONS.map((argv) => {
      const r = cli(argv);
      return `$ aiview ${argv.join(" ")}\nexit ${r.status}\n${r.stdout}${r.stderr}`;
    }).join("\n");
    if (process.env.AIVIEW_UPDATE_GOLDEN === "1") fs.writeFileSync(GOLDEN, answers);
    assert.equal(answers, fs.readFileSync(GOLDEN, "utf8"));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("the listed verbs of the table are the keys of the usage record", async () => {
  const { VERBS } = await import("../src/cli/verbs/index.ts");
  const { VERB_USAGE } = await import("../src/cli/usage.ts");
  const listed = VERBS.filter((v) => v.help === "listed").map((v) => v.name);
  assert.deepEqual([...listed].sort(), Object.keys(VERB_USAGE).sort());
});
