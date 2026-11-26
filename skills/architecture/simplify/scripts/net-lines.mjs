#!/usr/bin/env node
// Net lines of the working tree against <base>, code and tests apart, and files touched outside --scope.
// Usage: node net-lines.mjs <base> [--scope <path>...]
// Exit 0: code net negative, scope respected. Exit 1: either failed. Exit 2: bad usage.
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
/** A test or a test fixture: counted apart, so a pass is judged on its code. */
const isTest = (file) => /(^|\/)(tests?|__tests__|e2e|fixtures?)\//.test(file) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
/** A built bundle (committed or not): never written by hand, so never counted. */
const isBuilt = (file) => /(^|\/)(dist(-[\w-]+)?|build)\//.test(file);
const count = { code: { added: 0, deleted: 0 }, tests: { added: 0, deleted: 0 } };
const outside = [];
for (const line of numstat.split(/\r?\n/).filter(Boolean)) {
  const [a, d, file] = line.split("\t");
  const bucket = isBuilt(file) ? null : isTest(file) ? count.tests : count.code;
  if (bucket && a !== "-") bucket.added += Number(a);
  if (bucket && d !== "-") bucket.deleted += Number(d);
  const inScope = scope.length === 0 || scope.some((s) => file === s || file.startsWith(`${s}/`));
  if (!inScope) outside.push(file);
}
const net = count.code.added - count.code.deleted;
console.log(`code -${count.code.deleted} +${count.code.added} (net ${net >= 0 ? "+" : ""}${net}) · tests -${count.tests.deleted} +${count.tests.added}`);
if (count.code.added) console.log("every code + needs its reason in the report: what it replaces, why it could not be cut");
if (outside.length) console.log(`outside scope: ${outside.join(", ")}`);
process.exit(net < 0 && outside.length === 0 ? 0 : 1);
