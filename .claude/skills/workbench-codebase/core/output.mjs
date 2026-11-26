// How every verb answers: a short plain summary (at most LINES_SHOWN lines, the count line last),
// `--full` every line, `--json` the data, `--md` a small markdown file for a phone (its path printed).
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LINES_SHOWN = 40;

/** The flags every verb takes: `--full`, `--json`, `--md`, `--mermaid`, `--since <ref>`. */
export function flagsOf(args) {
  const flagValue = (flag) => { const at = args.indexOf(flag); return at >= 0 ? args[at + 1] : undefined; };
  return { full: args.includes("--full"), json: args.includes("--json"), md: args.includes("--md"), mermaid: args.includes("--mermaid"), edges: args.includes("--edges"), functions: args.includes("--functions"), since: flagValue("--since"), head: flagValue("--head"), in: flagValue("--in"), perCommit: flagValue("--per-commit") };
}
/** The positional arguments, the flags and their values taken out. */
export const positionalOf = (args) => args.filter((arg, at) => !arg.startsWith("--") && !["--since", "--head", "--in", "--per-commit"].includes(args[at - 1]));

/** Prints the answer as the flags ask. */
export function print({ title, lines, count, data, raw }, flags) {
  if (flags.json) return console.log(JSON.stringify(data, null, 2));
  if (raw) return console.log(lines.join("\n"));
  if (flags.md) {
    const dir = join(tmpdir(), "codebase-bench", "md");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${title.replace(/[^\w.-]+/g, "-").slice(0, 60)}.md`);
    writeFileSync(file, `# ${title}\n\n${lines.map((line) => (line.startsWith("  ") ? `  - ${line.trim()}` : `- ${line}`)).join("\n")}\n\n${count}\n`);
    return console.log(file);
  }
  const shown = flags.full ? lines : lines.slice(0, LINES_SHOWN);
  for (const line of shown) console.log(line);
  if (shown.length < lines.length) console.log(`… ${lines.length - shown.length} more (--full)`);
  if (count) console.log(count);
}
