// check.mjs against a fixture repository: a violation new since the base fails, an old one only counts, --all fails on it.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const CHECKER = join(dirname(fileURLToPath(import.meta.url)), "check.mjs");
const fixtures = [];
after(() => fixtures.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const PRODUCT_MAP = `# Product map

## Map

| word | entries | home | retired |
|---|---|---|---|
| conversation | post, thread, view | src/conversation, app/conversation | chatter |
| members | join | src/members | — |
| run | open | src/cli/verbs/run | — |

## Horizontal

- \`src/store\`
- \`src/cli\`

## Stoplist

- util
- view
`;

const git = (repo, ...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", windowsHide: true }).trim();

function writeFiles(repo, files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  }
}

/** A repository whose base commit holds the map, homes, a horizontal folder, and one old spread and hidden folder. */
function fixtureRepo({ withMap = true } = {}) {
  const repo = mkdtempSync(join(tmpdir(), "check-fixture-"));
  fixtures.push(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "fixture@example.invalid");
  git(repo, "config", "user.name", "fixture");
  writeFiles(repo, {
    ...(withMap ? { ".claude/skills/guide-product-map/SKILL.md": PRODUCT_MAP } : {}),
    "src/conversation/post.ts": "export const post = 1;\n",
    "app/conversation/post.ts": "export const view = 1;\n",
    "src/members/join.ts": "export const join = 1;\n",
    "src/members/util.ts": "export const helper = 1;\n",
    "src/store/db.ts": "export const db = 1;\n",
    "src/legacy/post.ts": "export const oldPost = 1;\n",
  });
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  return { repo, base: git(repo, "rev-parse", "HEAD") };
}

function runChecker(repo, ...args) {
  // A home with no dependency-cruiser cache, so M4 is reported not measured whatever this machine holds.
  const env = { ...process.env, HOME: repo, USERPROFILE: repo };
  const run = spawnSync(process.execPath, [CHECKER, ...args], { cwd: repo, encoding: "utf8", env, windowsHide: true });
  return { status: run.status, out: run.stdout + run.stderr };
}

test("an old violation only counts: exit 0", () => {
  const { repo, base } = fixtureRepo();
  const { status, out } = runChecker(repo, "--base", base);
  assert.equal(status, 0, out);
  assert.match(out, /M1 spread: 1 \(0 new\)/);
  assert.match(out, /M2 hidden concept: 1 \(0 new\)/);
  assert.match(out, /M3 word drift: 0 \(0 new\)/);
  assert.match(out, /M4 not measured/);
  assert.match(out, /alignment 80% \(4 of 5 files/);
  assert.match(out, /no new violation since/);
});

test("--all fails on the old violations, each naming its file and fix", () => {
  const { repo, base } = fixtureRepo();
  const { status, out } = runChecker(repo, "--base", base, "--all");
  assert.equal(status, 1, out);
  assert.match(out, /M1 src\/legacy\/post\.ts: carries "post" outside src\/conversation\/, app\/conversation\/; fix: move it under src\/conversation\/ or app\/conversation\//);
  assert.match(out, /M2 src\/legacy\/: .*; fix: name it in the map/);
});

test("a new violation fails, the old ones are not listed", () => {
  const { repo, base } = fixtureRepo();
  writeFiles(repo, {
    "src/members/thread.ts": "export const t = 1;\n",
    "src/members/join.ts": "export const chatterLevel = 1;\n",
  });
  const { status, out } = runChecker(repo, "--base", base);
  assert.equal(status, 1, out);
  assert.match(out, /M1 src\/members\/thread\.ts: carries "thread" .*\(new\); fix: move it under src\/conversation\//);
  assert.match(out, /M3 src\/members\/join\.ts: the retired word "chatter" in `chatterLevel` at line 1 \(new\); fix: rename it to the product word "conversation"/);
  assert.doesNotMatch(out, /src\/legacy\/post\.ts/);
  assert.match(out, /2 new violations/);
});

test("M3 reads identifiers only: a retired word in a comment, a string or a regex is no drift", () => {
  const { repo, base } = fixtureRepo();
  writeFiles(repo, {
    "src/members/join.ts": [
      "/** the old name was",
      " *  chatter, in prose */",
      'export const label = "chatter"; // chatter again',
      "export const spelled = `C:\\\\chatter~1 ${label} chatter`, matcher = /chatter`/;",
      "export const chatterLevel = 1;",
      "",
    ].join("\n"),
  });
  const { status, out } = runChecker(repo, "--base", base);
  assert.equal(status, 1, out);
  assert.match(out, /M3 word drift: 1 \(1 new\)/);
  assert.match(out, /M3 src\/members\/join\.ts: the retired word "chatter" in `chatterLevel` at line 5 \(new\)/);
});

test("the new violation committed still counts against the base, and --scope narrows to it", () => {
  const { repo, base } = fixtureRepo();
  writeFiles(repo, { "src/members/thread.ts": "export const t = 1;\n" });
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "spread");
  assert.equal(runChecker(repo, "--base", base).status, 1);
  const scoped = runChecker(repo, "--base", base, "--all", "--scope", "src/conversation");
  assert.equal(scoped.status, 0, scoped.out);
});

test("a word inside a compound name is spread; a stoplist word, alone or as a token, is not", () => {
  const { repo, base } = fixtureRepo();
  writeFiles(repo, {
    "src/members/postQueue.ts": "export const q = 1;\n",
    "src/members/view-cache.ts": "export const c = 1;\n",
    "src/members/view.ts": "export const v = 1;\n",
  });
  const { status, out } = runChecker(repo, "--base", base);
  assert.equal(status, 1, out);
  assert.match(out, /M1 src\/members\/postQueue\.ts: carries "post" .*\(new\)/);
  assert.doesNotMatch(out, /src\/members\/view/);
  assert.match(out, /1 new violation:/);
});

test("a home under a horizontal folder is a home; its sibling folders are feature folders", () => {
  const { repo, base } = fixtureRepo();
  writeFiles(repo, {
    "src/cli/verbs/run/open.ts": "export const o = 1;\n",
    "src/cli/verbs/run/post.ts": "export const p = 1;\n",
    "src/cli/verbs/misc/x.ts": "export const x = 1;\n",
    "src/cli/answer/wording.ts": "export const w = 1;\n",
  });
  const { status, out } = runChecker(repo, "--base", base);
  assert.equal(status, 1, out);
  assert.match(out, /M1 src\/cli\/verbs\/run\/post\.ts: carries "post" .*\(new\)/);
  assert.match(out, /M2 src\/cli\/verbs\/misc\/: .*\(new\)/);
  assert.doesNotMatch(out, /src\/cli\/verbs\/run\/open\.ts|src\/cli\/answer/);
  assert.match(out, /alignment 75% \(6 of 8 files/);
  assert.match(out, /2 new violations/);
});

test("M4: an import within one feature across its layers is none; into another feature's folder is one", () => {
  const { repo, base } = fixtureRepo();
  // a stand-in dependency-cruiser, found as the repository's own, answering with these imports
  const modules = [
    { source: "app/conversation/post.ts", dependencies: [{ resolved: "src/conversation/post.ts" }, { resolved: "src/members/join.ts" }] },
  ];
  writeFiles(repo, { "node_modules/dependency-cruiser/bin/dependency-cruiser.mjs": `console.log(${JSON.stringify(JSON.stringify({ modules }))});\n` });
  const { out } = runChecker(repo, "--base", base, "--all");
  assert.match(out, /M4 app\/conversation\/post\.ts: imports src\/members\/join\.ts from the feature src\/members\//);
  assert.doesNotMatch(out, /M4 app\/conversation\/post\.ts: imports src\/conversation\//);
  assert.match(out, /M4 cross-feature imports: 1 /);
});

test("no map: one line naming the guide's product-map reference, exit 0", () => {
  const { repo, base } = fixtureRepo({ withMap: false });
  const { status, out } = runChecker(repo, "--base", base);
  assert.equal(status, 0, out);
  assert.match(out, /references\/product-map\.md/);
  assert.equal(out.trim().split("\n").length, 1);
});
