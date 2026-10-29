// AGENTS.md rule 13: a command a member is told to run is written in the answer module (src/cli/answer/) alone.
// The sites outside it predate the rule; their count may only fall. Moving one into the module: lower BASELINE.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const BASELINE = 0;
const SRC = join(import.meta.dirname, "..", "src");
const ANSWER = join(SRC, "cli", "answer") + sep;
// a template that prints the CLI followed by a verb: `${cli} wait …`
const COMMAND = /\$\{(cli|s\.cli|CLI|this\.cli)[^}]*\} [a-z-]+/;
const EXCEPTION = "AGENTS EXCEPTION (rule 13)";

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });

test("command text outside the answer module never grows (rule 13)", () => {
  const sites = files(SRC)
    .filter((f) => !f.startsWith(ANSWER))
    .flatMap((f) =>
      readFileSync(f, "utf8").split("\n").flatMap((line, i) =>
        COMMAND.test(line) && !line.includes(EXCEPTION) ? [`${relative(SRC, f)}:${i + 1}`] : []));
  assert.ok(sites.length <= BASELINE,
    `${sites.length} command texts outside src/cli/answer/ (baseline ${BASELINE}): write the new one in the answer module\n${sites.join("\n")}`);
});
