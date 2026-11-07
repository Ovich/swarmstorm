#!/usr/bin/env node
// The two facts of a conventions file a session otherwise reads by hand:
// the rules it holds (number, heading, first words) with the next free number,
// and every `AGENTS EXCEPTION (rule N)` marker in the tree with the rule it cites.
//
//   node rules.mjs [<AGENTS.md|CLAUDE.md>] [--json]     default: AGENTS.md, else CLAUDE.md, in the cwd
//
// Exit 1 when a marker cites a rule that does not exist.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

const argv = process.argv.slice(2);
const json = argv.includes("--json");
let file = argv.find((a) => !a.startsWith("--"));
if (!file) file = ["AGENTS.md", "CLAUDE.md"].find((f) => existsSync(f));
if (!file || !existsSync(file)) { console.error("rules: no AGENTS.md or CLAUDE.md here; pass the path"); process.exit(2); }
file = resolve(file);
const root = dirname(file);

const rules = [];
let section = "";
for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
  const h = line.match(/^##\s+(.*)$/);
  if (h) { section = h[1].trim(); continue; }
  // Any numbered bold line is a rule. The modal sits anywhere inside the bold span
  // ("**API response shapes MUST stay inferred.**"), and a rule missing one still holds
  // its number: dropping it silently hands out a number that is already taken.
  const m = line.match(/^(\d+)\.\s+\*\*(.+?)\*\*/);
  if (m) {
    const lv = m[2].match(/\b(MUST NOT|MUST|SHOULD NOT|SHOULD)\b/);
    rules.push({ number: Number(m[1]), section, level: lv ? lv[1] : "", text: m[2].trim().replace(/\.$/, "") });
  }
}
const unmodalled = rules.filter((r) => !r.level).map((r) => r.number);
const numbers = rules.map((r) => r.number);
const next = numbers.length ? Math.max(...numbers) + 1 : 1;
const duplicates = numbers.filter((n, i) => numbers.indexOf(n) !== i);

let grep = "";
try {
  grep = execFileSync("git", ["grep", "-n", "-I", "-E", "AGENTS EXCEPTION \\(rule [0-9]+\\)", "--", "."], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
} catch (e) { grep = e.stdout ?? ""; }
const markers = [];
for (const l of grep.split("\n").filter(Boolean)) {
  const m = l.match(/^(.+?):(\d+):(.*)$/);
  if (!m) continue;
  if (/`[^`]*AGENTS EXCEPTION \(rule \d+\)[^`]*`/.test(m[3])) continue; // quoted in prose, not a marker
  const cited = Number((m[3].match(/AGENTS EXCEPTION \(rule (\d+)\)/) ?? [])[1]);
  const reason = (m[3].split(/AGENTS EXCEPTION \(rule \d+\):?\s*/)[1] ?? "").trim();
  markers.push({ file: m[1], line: Number(m[2]), rule: cited, exists: numbers.includes(cited), reason });
}
const dangling = markers.filter((m) => !m.exists);

const out = { file, rules, next, duplicates, unmodalled, markers, dangling: dangling.length };
if (json) console.log(JSON.stringify(out, null, 2));
else {
  console.log(`${file}: ${rules.length} rules, next free number ${next}${duplicates.length ? `, DUPLICATE numbers ${[...new Set(duplicates)].join(", ")}` : ""}${unmodalled.length ? `, no MUST/SHOULD in ${unmodalled.join(", ")}` : ""}`);
  for (const r of rules) console.log(`  ${String(r.number).padStart(3)}  ${(r.level || "—").padEnd(10)} ${r.section ? `[${r.section}] ` : ""}${r.text.slice(0, 90)}`);
  console.log(`${markers.length} exception marker${markers.length === 1 ? "" : "s"}${dangling.length ? `, ${dangling.length} citing a rule that does not exist` : ""}`);
  for (const m of markers) console.log(`  ${m.exists ? "ok  " : "BAD "} rule ${m.rule}  ${m.file}:${m.line}  ${m.reason.slice(0, 80)}`);
}
process.exit(dangling.length || duplicates.length ? 1 : 0);
