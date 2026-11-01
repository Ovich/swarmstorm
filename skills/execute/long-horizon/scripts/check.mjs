#!/usr/bin/env node
// Checks a long-horizon document: the rows the format forbids, and the open elements
// not checked against the branch head (to re-check before the person sees the list).
// Usage: node check.mjs <document> [--repo <checkout>] [--head <sha>]
// Exit 0: clean. Exit 1: findings printed. Exit 2: usage or read error.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const OPEN = ["proposed", "asked", "accepted", "doing", "done", "verified"];
const CLOSED = ["ticked", "dropped"];

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const file = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!file) {
  console.error("usage: node check.mjs <document> [--repo <checkout>] [--head <sha>]");
  process.exit(2);
}

let text;
try {
  text = readFileSync(file, "utf8");
} catch (e) {
  console.error(`cannot read ${file}: ${e.message}`);
  process.exit(2);
}

let head = opt("--head");
if (!head) {
  try {
    head = execFileSync("git", ["-C", opt("--repo") ?? ".", "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    console.error("cannot read the branch head: pass --repo <checkout> or --head <sha>");
    process.exit(2);
  }
}
head = head.toLowerCase();

const section = (title) => {
  const m = text.match(new RegExp(`^##\\s+${title}\\s*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, "m"));
  return m ? m[1] : null;
};

const findings = [];
const stale = [];
const seen = new Map();
const note = (n, where) => {
  if (seen.has(n)) findings.push(`#${n}: number used twice (${seen.get(n)} and ${where})`);
  else seen.set(n, where);
};

for (const title of ["Summary", "Elements", "Closed"])
  if (section(title) === null) findings.push(`missing section: ## ${title}`);

const elements = section("Elements") ?? "";
const rows = elements
  .split("\n")
  .filter((l) => l.trim().startsWith("|"))
  .map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()))
  .filter((c) => !/^-+$/.test(c[0]) && c[0] !== "#");

for (const [num, element = "", status = "", , checked = ""] of rows) {
  const n = num.replace(/^#/, "");
  if (!/^\d+$/.test(n)) {
    findings.push(`row "${num}": the number is not an integer`);
    continue;
  }
  note(n, "Elements");
  const s = status.toLowerCase();
  if (CLOSED.includes(s)) findings.push(`#${n}: status ${s} belongs in ## Closed, one line`);
  else if (!OPEN.includes(s)) findings.push(`#${n}: unknown status "${status}" (${[...OPEN, ...CLOSED].join(", ")})`);
  if (!OPEN.includes(s)) continue;
  const sha = checked.match(/\b[0-9a-f]{7,40}\b/i)?.[0]?.toLowerCase();
  const current = sha && (head.startsWith(sha) || sha.startsWith(head));
  if (!current) stale.push(`#${n} [${s}] ${element} (checked @ ${checked || "nothing"})`);
}

for (const line of (section("Closed") ?? "").split("\n").filter((l) => /^\s*-\s/.test(l))) {
  const m = line.match(/^\s*-\s*(\w+)\s*·\s*#?(\d+)\s*·/);
  if (!m) {
    findings.push(`Closed line not "- <ticked|dropped> · <n> · ...": ${line.trim()}`);
    continue;
  }
  if (!CLOSED.includes(m[1].toLowerCase())) findings.push(`#${m[2]}: Closed holds only ticked or dropped, not ${m[1]}`);
  if (m[1].toLowerCase() === "ticked" && !/["“]/.test(line)) findings.push(`#${m[2]}: ticked without the person's quoted word`);
  note(m[2], "Closed");
}

const summary = (section("Summary") ?? "").split("\n").filter((l) => l.trim()).length;
if (summary > 10) findings.push(`Summary is ${summary} lines, at most 10`);

for (const f of findings) console.log(`format: ${f}`);
if (stale.length) {
  console.log(`stale against ${head.slice(0, 8)}: ${stale.length} open element(s)`);
  for (const s of stale) console.log(`  ${s}`);
  console.log("next: re-check each stale element, one read-only subagent per element, before the person sees the list");
}
if (!findings.length && !stale.length) console.log(`clean: every open element checked @ ${head.slice(0, 8)}`);
process.exit(findings.length || stale.length ? 1 : 0);
