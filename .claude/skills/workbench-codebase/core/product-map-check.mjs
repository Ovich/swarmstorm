// The product-map gate inside `check` (product-shape#D14): the guide-screaming-architecture checker, called
// as the program it is, never copied. Its new violations become the bench's regressions; its summary, one line.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const CHECKER_PATH = "skills/guides/guide-screaming-architecture/scripts/check.mjs";
const VIOLATION_LINE = /^\s+(M\d+) /;

/**
 * The checker run against `base` on the working tree: `{ line, regressions }`, `line` null when this
 * repository ships no checker. A checker that fails to run is a line, never a regression.
 */
export function productMapCheckOf(root, base) {
  const checker = join(root, CHECKER_PATH);
  if (!existsSync(checker)) return { line: null, regressions: [] };
  const run = spawnSync(process.execPath, [checker, "--base", base], { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 1 << 26 });
  if (run.status !== 0 && run.status !== 1) return { line: `product map: the checker did not run (${(run.stderr || run.error?.message || `exit ${run.status}`).trim()})`, regressions: [] };
  const output = run.stdout.trim().split("\n");
  const regressions = output.filter((l) => VIOLATION_LINE.test(l)).map((l) => ({ kind: "product-map", text: `product map ${l.trim()}` }));
  return { line: `product map: ${output.at(-1)}`, regressions };
}
