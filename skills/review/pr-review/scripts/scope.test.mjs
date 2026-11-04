// node --test skills/review/pr-review/scripts   (from the repository root; needs git on PATH)
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "scope.mjs");
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const run = (cwd, ...a) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...a], { cwd, encoding: "utf8" });
  return { status: r.status, out: r.stdout, err: r.stderr, json: a.includes("--json") && r.stdout ? JSON.parse(r.stdout) : null };
};

function repo() {
  const d = mkdtempSync(join(tmpdir(), "scope-"));
  git(d, "init", "-q", "-b", "main");
  git(d, "config", "user.email", "t@t"); git(d, "config", "user.name", "t");
  const put = (f, s) => { mkdirSync(join(d, dirname(f)), { recursive: true }); writeFileSync(join(d, f), s); };
  put("src/a.ts", "export const a = 1;\n");
  put("src/b.tsx", "export const B = () => null;\n");
  put("package-lock.json", "{}\n");
  put("dist/bundle.js", "x\n");
  put("README.md", "# r\n");
  git(d, "add", "-A"); git(d, "commit", "-qm", "init");
  return { d, put };
}

test("diff: the working tree against HEAD, skip list applied, exit 1 on an empty scope", () => {
  const { d, put } = repo();
  assert.equal(run(d, "diff").status, 1);
  put("src/a.ts", "export const a = 2;\nexport const c = 3;\n");
  put("package-lock.json", "{\"x\":1}\n");
  put("dist/bundle.js", "y\n");
  const r = run(d, "diff", "--json");
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.json.files.map((f) => f.file), ["src/a.ts"]);
  assert.equal(r.json.files[0].added, 2);
  assert.deepEqual(r.json.skipped.map((f) => f.file).sort(), ["dist/bundle.js", "package-lock.json"]);
});

test("branch: merge-base with the base, commits as the intent, L3 from data paths, --ext filter", () => {
  const { d, put } = repo();
  git(d, "checkout", "-qb", "feat");
  put("db/migrations/001_users.sql", "create table users(id int);\n");
  put("src/b.tsx", "export const B = () => <div/>;\n");
  put("src/c.js", "module.exports = 1;\n");
  git(d, "add", "-A"); git(d, "commit", "-qm", "feat: add the users table and render B as a div");
  git(d, "checkout", "-q", "main");
  put("README.md", "# r\nmoved on\n"); git(d, "add", "-A"); git(d, "commit", "-qm", "docs");
  git(d, "checkout", "-q", "feat");
  const r = run(d, "branch", "main", "--layers", "--json");
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.json.files.map((f) => f.file).sort(), ["db/migrations/001_users.sql", "src/b.tsx", "src/c.js"]);
  assert.match(r.json.base, /^main @ [0-9a-f]{10}$/);
  assert.equal(r.json.layers.L3.material, true);
  assert.deepEqual(r.json.layers.L3.evidence, ["db/migrations/001_users.sql"]);
  assert.equal(r.json.layers.L5.material, true);
  assert.deepEqual(r.json.intent.commits, ["feat: add the users table and render B as a div"]);
  const ts = run(d, "branch", "main", "--ext", "ts,tsx", "--json");
  assert.deepEqual(ts.json.files.map((f) => f.file), ["src/b.tsx"]);
  const text = run(d, "branch", "main", "--layers");
  assert.match(text.out, /L3 Data: material\s+\(db\/migrations\/001_users\.sql\)/);
  assert.match(text.out, /L5 Delivery & Intent: material/);
});

test("branch: a one-word commit is no stated intent", () => {
  const { d, put } = repo();
  git(d, "checkout", "-qb", "wip");
  put("src/a.ts", "export const a = 9;\n"); git(d, "add", "-A"); git(d, "commit", "-qm", "wip");
  const r = run(d, "branch", "main", "--layers", "--json");
  assert.equal(r.json.layers.L5.material, false);
  assert.match(r.json.layers.L5.note, /no stated intent/);
});

test("path and all: the tree with the skip list, no line counts", () => {
  const { d } = repo();
  const p = run(d, "path", "src", "--json");
  assert.deepEqual(p.json.files.map((f) => f.file).sort(), ["src/a.ts", "src/b.tsx"]);
  assert.equal(p.json.files[0].added, null);
  const all = run(d, "all", "--json");
  assert.deepEqual(all.json.files.map((f) => f.file).sort(), ["README.md", "src/a.ts", "src/b.tsx"]);
  assert.equal(run(d, "path", "nope").status, 2);
  assert.equal(run(d, "branch", "nope").status, 2);
  assert.equal(run(d, "bogus").status, 2);
});

test("pr takes only a number, branch refuses a base starting with -, before git or gh runs (D11)", () => {
  const { d } = repo();
  for (const n of ["12a", "-x", "https://github.com/o/r/pull/1", "1;id", "feat"]) {
    const r = run(d, "pr", n);
    assert.equal(r.status, 2, n);
    assert.match(r.err, /is not a number/, n);
  }
  const dash = run(d, "branch", "-x");
  assert.equal(dash.status, 2);
  assert.match(dash.err, /starts with "-"/);
  const output = run(d, "branch", "-output=/tmp/x");
  assert.equal(output.status, 2);
  assert.match(output.err, /starts with "-"/);
});
