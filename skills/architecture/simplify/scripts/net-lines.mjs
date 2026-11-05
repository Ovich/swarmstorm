#!/usr/bin/env node
// Net lines of the working tree against <base>, and files touched outside --scope.
// Usage: node net-lines.mjs <base> [--scope <path>...]
// Exit 0: net negative, scope respected. Exit 1: either failed. Exit 2: bad usage.
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const base = args[0];
if (!base || base.startsWith("--")) {
  console.error("usage: net-lines.mjs <base> [--scope <path>...]");
  process.exit(2);
}
const at = args.indexOf("--scope");
const scope = at === -1 ? [] : args.slice(at + 1).map((p) => p.replaceAll("\\", "/").replace(/\/$/, ""));

const numstat = execFileSync("git", ["diff", "--numstat", base], { encoding: "utf8" });
let added = 0;
let deleted = 0;
const outside = [];
for (const line of numstat.split("\n").filter(Boolean)) {
  const [a, d, file] = line.split("\t");
  if (a !== "-") added += Number(a);
  if (d !== "-") deleted += Number(d);
  const inScope = scope.length === 0 || scope.some((s) => file === s || file.startsWith(`${s}/`));
  if (!inScope) outside.push(file);
}
const net = added - deleted;
console.log(`net ${net >= 0 ? "+" : ""}${net} (added ${added}, deleted ${deleted})`);
if (outside.length) console.log(`outside scope: ${outside.join(", ")}`);
process.exit(net < 0 && outside.length === 0 ? 0 : 1);
