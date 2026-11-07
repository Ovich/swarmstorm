#!/usr/bin/env node
// Resolve a review scope to a file list, deterministically.
//
//   node scope.mjs                      the working diff (HEAD), else upstream...HEAD
//   node scope.mjs diff                 same
//   node scope.mjs pr <number>          a GitHub PR, through gh
//   node scope.mjs branch [<base>]      this branch against its merge-base with <base> (default: the default branch)
//   node scope.mjs path <p>...          files under these paths (whole-codebase reviews)
//   node scope.mjs all                  the whole tree
//   --ext ts,tsx                        keep these extensions only
//   --layers                            also say which of L3 and L5 have material, with the evidence
//   --json                              machine output (the default is a short listing)
//
// Vendored, generated, build, lockfile and binary paths are skipped. Nothing here is
// judgment: it prints what a reviewer would otherwise re-derive by hand each time.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const has = (n) => argv.includes(n);
const positional = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--ext");
const json = has("--json");
const layers = has("--layers");
const ext = (flag("--ext") ?? "").split(",").map((e) => e.trim().replace(/^\./, "")).filter(Boolean);

const SKIP = [
  /(^|\/)node_modules\//, /(^|\/)vendor\//, /(^|\/)third[_-]party\//, /(^|\/)\.git\//,
  /(^|\/)(dist|build|out|target|bin|obj|coverage|\.next|\.nuxt|\.turbo|\.cache|__pycache__)\//,
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|Cargo\.lock|poetry\.lock|Pipfile\.lock|composer\.lock|Gemfile\.lock|go\.sum)$/,
  /\.(min\.js|min\.css|map|snap|lock)$/,
  /\.(png|jpe?g|gif|webp|svg|ico|pdf|woff2?|ttf|eot|zip|gz|tgz|wasm|sqlite|db|mp[34]|mov)$/i,
  /(^|\/)[^/]*\.generated\.[^/]+$/, /(^|\/)generated\//, /\.g\.(cs|dart)$/, /\.pb\.(go|ts|js|py)$/,
];
const skipped = (f) => SKIP.some((r) => r.test(f)) || (ext.length > 0 && !ext.includes(extname(f).slice(1)));

const git = (...a) => execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const tryGit = (...a) => { try { return git(...a); } catch { return null; } };

function numstat(range) {
  const out = tryGit("diff", "--numstat", "-M", ...range) ?? "";
  const files = [];
  for (const l of out.split("\n").filter(Boolean)) {
    const [add, del, ...rest] = l.split("\t");
    let file = rest.join("\t");
    const m = file.match(/^(.*)\{(.*) => (.*)\}(.*)$/) || file.match(/^(.*) => (.*)$/);
    if (m) file = m.length === 5 ? `${m[1]}${m[3]}${m[4]}` : m[2];
    files.push({ file, added: add === "-" ? null : Number(add), removed: del === "-" ? null : Number(del), binary: add === "-" });
  }
  return files;
}

function defaultBranch() {
  const ref = tryGit("symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD");
  if (ref) return ref.replace(/^origin\//, "");
  for (const b of ["main", "master"]) if (tryGit("rev-parse", "--verify", "--quiet", b)) return b;
  return null;
}

function walk(root) {
  const out = [];
  const rec = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      const rel = relative(process.cwd(), p).replace(/\\/g, "/");
      if (e.isDirectory()) { if (!SKIP.some((r) => r.test(rel + "/"))) rec(p); }
      else out.push({ file: rel, added: null, removed: null, binary: false });
    }
  };
  if (statSync(root).isDirectory()) rec(root);
  else out.push({ file: relative(process.cwd(), root).replace(/\\/g, "/"), added: null, removed: null, binary: false });
  return out;
}

const mode = positional[0] ?? "diff";
const result = { mode, base: null, head: null, intent: null, files: [], skipped: [] };
let all = [];

if (mode === "diff") {
  const upstream = tryGit("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}");
  if (tryGit("diff", "--quiet", "HEAD") === null && tryGit("rev-parse", "HEAD")) {
    result.base = "HEAD"; result.head = "working tree"; all = numstat(["HEAD"]);
  } else if (upstream) {
    result.base = upstream; result.head = "HEAD"; all = numstat([`${upstream}...HEAD`]);
  } else {
    result.base = "HEAD"; result.head = "working tree"; all = numstat(["HEAD"]);
  }
} else if (mode === "branch") {
  const base = positional[1] ?? defaultBranch();
  if (!base) { console.error("scope: no base branch found; pass one"); process.exit(2); }
  // trust-adaptations#D11: a base git would read as an option never reaches it
  if (base.startsWith("-")) { console.error(`scope: the base ${base} starts with "-"; pass a branch name`); process.exit(2); }
  const mb = tryGit("merge-base", base, "HEAD");
  if (!mb) { console.error(`scope: no merge-base between ${base} and HEAD (is ${base} a branch here?)`); process.exit(2); }
  result.base = `${base} @ ${mb.slice(0, 10)}`; result.head = `HEAD @ ${git("rev-parse", "--short", "HEAD")}`;
  all = numstat([`${mb}...HEAD`]);
  if (layers) result.intent = intentFromCommits(mb);
} else if (mode === "pr") {
  const n = positional[1];
  // trust-adaptations#D11: gh is given a PR number only, never a URL, a branch or an option
  if (!n || !/^\d+$/.test(n)) { console.error(`scope: pr <number>${n ? `; ${n} is not a number` : ""}`); process.exit(2); }
  const meta = JSON.parse(execFileSync("gh", ["pr", "view", n, "--json", "number,title,body,baseRefName,headRefName,headRefOid,commits,closingIssuesReferences,url"], { encoding: "utf8" }));
  result.base = meta.baseRefName; result.head = `${meta.headRefName} @ ${String(meta.headRefOid).slice(0, 10)}`; result.url = meta.url;
  const diff = execFileSync("gh", ["pr", "diff", n, "--name-only"], { encoding: "utf8" }).split("\n").filter(Boolean);
  // numstat through the local checkout when the head is fetched, else names only
  const local = tryGit("cat-file", "-e", meta.headRefOid) !== null ? numstat([`${git("merge-base", `origin/${meta.baseRefName}`, meta.headRefOid)}...${meta.headRefOid}`]) : null;
  all = local ?? diff.map((file) => ({ file, added: null, removed: null, binary: false }));
  if (layers) {
    const body = (meta.body ?? "").trim();
    const commits = (meta.commits ?? []).map((c) => c.messageHeadline).filter(Boolean);
    const issues = (meta.closingIssuesReferences ?? []).map((i) => `#${i.number}`);
    result.intent = { title: meta.title, description: body ? `${body.split("\n")[0].slice(0, 200)}${body.length > 200 ? "…" : ""}` : null, descriptionChars: body.length, linkedIssues: issues, commits };
  }
} else if (mode === "path") {
  const roots = positional.slice(1);
  if (!roots.length) { console.error("scope: path <p>..."); process.exit(2); }
  for (const r of roots) { if (!existsSync(r)) { console.error(`scope: no such path ${r}`); process.exit(2); } all.push(...walk(r)); }
} else if (mode === "all") {
  const tracked = tryGit("ls-files");
  all = tracked ? tracked.split("\n").filter(Boolean).map((file) => ({ file, added: null, removed: null, binary: false })) : walk(".");
} else {
  console.error(`scope: unknown mode ${mode}`); process.exit(2);
}

function intentFromCommits(mb) {
  const log = tryGit("log", "--format=%s", `${mb}..HEAD`) ?? "";
  const commits = log.split("\n").filter(Boolean);
  return { title: null, description: null, descriptionChars: 0, linkedIssues: [], commits };
}

for (const f of all) (skipped(f.file) || f.binary ? result.skipped : result.files).push(f);

if (layers) {
  const DATA = /(^|\/)(migrations?|migrate|db|database|prisma|drizzle|schema|models?|entities|alembic)(\/|$)|\.(sql|prisma)$|schema\.(ts|js|py|rb|graphql|gql|json)$|(^|\/)[^/]*migration[^/]*$|(^|\/)structure\.sql$|(^|\/)db\/seeds?/i;
  const data = result.files.filter((f) => DATA.test(f.file)).map((f) => f.file);
  const it = result.intent ?? {};
  const stated = Boolean((it.descriptionChars ?? 0) >= 40 || (it.linkedIssues ?? []).length || (it.commits ?? []).some((c) => c.length > 20));
  result.layers = {
    L3: { material: data.length > 0, evidence: data },
    L5: { material: stated, evidence: it, note: stated ? "an intent is stated; L5 checks the diff against it" : "no stated intent: L5 not run, and the verdict says so" },
  };
}

if (json) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`${result.mode}${result.base ? `  ${result.base} → ${result.head}` : ""}  ${result.files.length} files, ${result.skipped.length} skipped`);
  for (const f of result.files) console.log(`  ${f.added === null ? "" : `+${f.added} -${f.removed}`.padEnd(12)}${f.file}`);
  if (result.layers) {
    console.log(`L3 Data: ${result.layers.L3.material ? "material" : "nothing"}${result.layers.L3.evidence.length ? `  (${result.layers.L3.evidence.join(", ")})` : ""}`);
    console.log(`L5 Delivery & Intent: ${result.layers.L5.material ? "material" : "nothing"}  ${result.layers.L5.note}`);
  }
}
process.exit(result.files.length ? 0 : 1);
