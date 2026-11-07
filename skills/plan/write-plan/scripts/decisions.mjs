#!/usr/bin/env node
// The decision ids of a project's plans and boards, judged against each other and against
// every citation of them: two documents of one kind sharing a topic, an id defined twice, a
// citation that resolves to no row. It reports; it renumbers and rewrites nothing.
//
//   node decisions.mjs <docs-dir>... [--code <dir>]... [--json]
//
// Inside its document a decision is `D3`. Outside it, `<topic>#D3` is a plan's decision and
// `<topic>.board#D3` a board's, the topic being the slug of `YYYY-MM-DD-<topic>.<kind>.md`.
// A document from a project's older global series carries `> **Decision ids**: legacy series`,
// and a bare `D96` cited from code resolves against those documents only.
//
// Exit 1 on any finding, 2 on a usage error.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DOCUMENT = /^\d{4}-\d{2}-\d{2}-(.+)\.(plan|brainstorm|slice)\.md$/;
const ROW = /^\|\s*(D\d+)\s*\|/;
const LEGACY = /^>\s*\*\*Decision ids\*\*:\s*legacy series\b/m;
const QUALIFIED = /(?:(?<=\\[a-z])|(?<![\w.\\-]))([a-z0-9]+(?:-[a-z0-9]+)*)(\.board)?#(D\d+)\b/g; // after `\n` too
const BARE = /(?<![\w#.-])(D\d+)\b/g;
const SKIPPED = new Set([".git", "node_modules", "dist", "dist-cli"]);

/** Every plan, board and slice document directly in the given folders, with the ids its decisions table defines. */
export function readDocuments(dirs) {
  const documents = [];
  for (const dir of dirs) {
    for (const name of readdirSync(dir).sort()) {
      const m = name.match(DOCUMENT);
      if (!m) continue;
      const file = join(dir, name);
      const text = readFileSync(file, "utf8");
      const ids = [];
      let fence = false;
      text.split(/\r?\n/).forEach((line, i) => {
        if (/^\s*(```|~~~)/.test(line)) fence = !fence;
        const row = !fence && line.match(ROW);
        if (row) ids.push({ id: row[1], line: i + 1 });
      });
      documents.push({ file, kind: m[2], topic: m[1], legacy: LEGACY.test(text), ids });
    }
  }
  return documents;
}

/** The citations in the documents (qualified only, outside code spans and fences) and in the code (qualified and bare). */
export function readCitations(dirs, { code = [] } = {}) {
  const citations = [];
  for (const dir of dirs) {
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith(".md")) continue;
      const file = join(dir, name);
      let fence = false;
      readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
        if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return; }
        if (fence) return;
        // a citation shown in code is an example of the form, not a reference
        for (const c of qualified(line.replace(/`[^`]*`/g, ""))) citations.push({ file, line: i + 1, ...c });
      });
    }
  }
  for (const dir of code) {
    for (const file of codeFiles(dir)) {
      readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
        for (const c of qualified(line)) citations.push({ file, line: i + 1, ...c });
        for (const m of line.matchAll(BARE)) citations.push({ file, line: i + 1, topic: "", board: false, id: m[1], bare: true });
      });
    }
  }
  return citations;
}

/** The findings: `topic`, `duplicate` and `dangling`, each with the file and line it stands on. */
export function judge(documents, citations) {
  const findings = [];
  const judged = documents.filter((d) => d.kind !== "slice"); // a slice's short ids are its plan's

  const byTopic = new Map();
  for (const d of judged) {
    const key = `${d.kind}:${d.topic}`;
    byTopic.set(key, [...(byTopic.get(key) ?? []), d]);
  }
  for (const [key, ds] of byTopic) {
    if (ds.length < 2) continue;
    findings.push({ rule: "topic", file: ds[1].file, line: 1, text: `topic ${key.split(":")[1]} is used by ${ds.length} ${ds[0].kind} documents: ${ds.map((d) => basename(d.file)).join(", ")}` });
  }

  for (const d of judged) {
    const seen = new Map();
    for (const { id, line } of d.ids) {
      if (seen.has(id)) findings.push({ rule: "duplicate", file: d.file, line, text: `${id} is defined twice in this document (first at line ${seen.get(id)})` });
      else seen.set(id, line);
    }
  }

  const legacy = judged.filter((d) => d.legacy);
  const legacyIds = new Map();
  for (const d of legacy) {
    for (const id of new Set(d.ids.map((x) => x.id))) legacyIds.set(id, [...(legacyIds.get(id) ?? []), d]);
  }
  for (const [id, ds] of legacyIds) {
    if (ds.length < 2) continue;
    const at = ds[1].ids.find((x) => x.id === id).line;
    findings.push({ rule: "duplicate", file: ds[1].file, line: at, text: `${id} of the legacy series is defined in ${ds.length} documents: ${ds.map((d) => basename(d.file)).join(", ")}` });
  }

  for (const c of citations) {
    if (c.bare) {
      if (legacy.length && !legacyIds.has(c.id)) findings.push({ rule: "dangling", file: c.file, line: c.line, text: `${c.id} is in no document of the legacy series` });
      continue;
    }
    const kind = c.board ? "brainstorm" : "plan";
    const target = judged.find((d) => d.kind === kind && d.topic === c.topic);
    const cited = `${c.topic}${c.board ? ".board" : ""}#${c.id}`;
    if (!target) findings.push({ rule: "dangling", file: c.file, line: c.line, text: `${cited}: no ${c.board ? "board" : "plan"} has the topic ${c.topic}` });
    else if (!target.ids.some((x) => x.id === c.id)) findings.push({ rule: "dangling", file: c.file, line: c.line, text: `${cited}: ${basename(target.file)} has no row ${c.id}` });
  }
  return findings;
}

function qualified(line) {
  return [...line.matchAll(QUALIFIED)].map((m) => ({ topic: m[1], board: Boolean(m[2]), id: m[3], bare: false }));
}

/** The tracked text files of a tree when it is a git repository, otherwise every file outside the skipped folders. */
function codeFiles(dir) {
  try {
    const out = execFileSync("git", ["grep", "-I", "-l", "-E", "D[0-9]", "--", "."], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.split("\n").filter(Boolean).map((f) => join(dir, f));
  } catch (e) {
    if (e.status === 1 && e.stdout === "") return []; // a repository with no match
  }
  const files = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (SKIPPED.has(name)) continue;
      const f = join(d, name);
      const st = statSync(f);
      if (st.isDirectory()) walk(f);
      else if (st.size < 1_000_000 && !readFileSync(f).includes(0)) files.push(f);
    }
  };
  walk(dir);
  return files;
}

function main(argv) {
  const json = argv.includes("--json");
  const code = [];
  const docs = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") continue;
    if (argv[i] === "--code") code.push(resolve(argv[++i] ?? ""));
    else docs.push(resolve(argv[i]));
  }
  const missing = [...docs, ...code].filter((d) => !existsSync(d) || !statSync(d).isDirectory());
  if (!docs.length || missing.length) {
    console.error(`decisions: ${missing.length ? `not a folder: ${missing.join(", ")}` : "name the folders holding the plans and boards"}`);
    console.error("usage: node decisions.mjs <docs-dir>... [--code <dir>]... [--json]");
    return 2;
  }
  const documents = readDocuments(docs);
  const citations = readCitations(docs, { code });
  const findings = judge(documents, citations);
  const here = (f) => relative(process.cwd(), f) || f;
  if (json) console.log(JSON.stringify({ documents, citations, findings }, null, 2));
  else {
    const ids = documents.reduce((n, d) => n + d.ids.length, 0);
    const legacy = documents.filter((d) => d.legacy).length;
    console.log(`${documents.length} documents, ${ids} decision ids${legacy ? ` (${legacy} in the legacy series)` : ""}, ${citations.length} citations, ${findings.length} finding${findings.length === 1 ? "" : "s"}`);
    for (const f of findings) console.log(`  ${f.rule.padEnd(9)} ${here(f.file)}:${f.line}  ${f.text}`);
  }
  return findings.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
