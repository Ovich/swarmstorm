// Architecture guides: the board names the project's guides to a member once, at its join, as skills to load.
// It checks nothing against them: a delivery asks for no verdict, and a typed --guides is read and ignored.
import { test, beforeEach, afterEach } from "node:test";
import { stopServerOf } from "./fixtures/server.ts";
import { openRawStore } from "./fixtures/raw-store.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SHIPPED_GUIDE_PATHS, discoverGuides, parseGuide } from "../src/cli/guides.ts";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "cli", "index.ts");

let home: string;
/** A message's body as stored (the read verb is gone). */
const storedBody = (seq: string): string => {
  const db = openRawStore(path.join(home, "swarm.sqlite"), { readOnly: true });
  try {
    return String((db.prepare("SELECT body FROM messages WHERE seq = ?").get(Number(seq)) as { body: string } | undefined)?.body);
  } finally {
    db.close();
  }
};
let repo: string;
let wtA: string;
let wtB: string;
/** The run opened for each test. */
let runId: string;

const env = () => ({ ...process.env, SWARM_ROOT: home, SWARMSTORM_HOME: home, SWARM_NO_POLLER: "1" });
const swarm = (cwd: string, ...argv: string[]) => spawnSync(process.execPath, [CLI, ...argv], { cwd, encoding: "utf8", env: env() });
const cli = (cwd: string, ...argv: string[]): string => {
  const r = swarm(cwd, ...argv);
  assert.equal(r.status, 0, `${argv.join(" ")}: ${r.stderr}`);
  return r.stdout;
};
const git = (cwd: string, ...argv: string[]): string => {
  const r = spawnSync("git", argv, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};
const commit = (cwd: string, msg: string): void => {
  git(cwd, "add", "-A");
  git(cwd, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", msg);
};
const guideFile = (dir: string, folder: string, frontmatter: string): void => {
  fs.mkdirSync(path.join(dir, folder), { recursive: true });
  fs.writeFileSync(path.join(dir, folder, "SKILL.md"), `---\n${frontmatter}\n---\n\nbody\n`);
};

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-guides-"));
  repo = path.join(home, "repo");
  fs.mkdirSync(path.join(repo, "src", "ui"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src", "a.ts"), "export {};\n");
  fs.writeFileSync(path.join(repo, "src", "ui", "page.ts"), "export {};\n");
  const skills = path.join(repo, ".claude", "skills");
  guideFile(skills, "guide-all", 'name: guide-all\ndescription: x\npaths: ["**"]');
  guideFile(skills, "guide-ui", "name: guide-ui\npaths:\n  - src/ui/**");
  guideFile(skills, "not-a-guide", 'name: other\npaths: ["**"]');
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "t");
  git(repo, "config", "user.email", "t@t");
  commit(repo, "root");
  wtA = path.join(home, "wt-a");
  wtB = path.join(home, "wt-b");
  git(repo, "worktree", "add", "-q", "-b", "a", wtA);
  git(repo, "worktree", "add", "-q", "-b", "b", wtB);
  git(repo, "checkout", "-q", "--detach");
  const seats = path.join(home, "seats.json");
  fs.writeFileSync(seats, JSON.stringify([{ id: "S1", blockers: [] }, { id: "S2", blockers: [] }, { id: "S3", blockers: [] }]));
  runId = cli(repo, "open", "--plan", "g", "--title", "T", "--seats", seats).split("\n")[0].trim();
  cli(wtA, "join", "--run", runId, "--seat", "S1", "--doing", "x");
  cli(wtB, "join", "--run", runId, "--seat", "S2", "--doing", "y");
});

afterEach(() => {
  stopServerOf(home);
  for (let i = 0; ; i++) {
    try {
      fs.rmSync(home, { recursive: true, force: true });
      return;
    } catch {
      if (i >= 5) return console.warn(`cleanup: temp dir left behind: ${home}`);
      spawnSync(process.execPath, ["-e", "setTimeout(()=>{},200)"]);
    }
  }
});

test("join names the project's guides to a member the board gives a worktree, as skills to load; a folder that is no guide-* is none", () => {
  // from the repository's checkout: the board makes the seat's worktree, and reads the guides in it
  const joined = cli(repo, "join", "--run", runId, "--seat", "S3", "--doing", "z", "--as", "g/S3");
  assert.match(joined, /^guides for this work: all \(guide-all\), ui \(guide-ui\); load each before editing$/m);
});

test("a delivery asks for no verdict on a guide: it merges, and a typed --guides is read and ignored", () => {
  // the branch changes a file both guides speak for
  fs.writeFileSync(path.join(wtA, "src", "ui", "page.ts"), "export const p = 1;\n");
  commit(wtA, "page");
  const out = cli(wtA, "merge-lock", "--onto", "main", "--report", "done");
  assert.doesNotMatch(out, /guides/);
  const sha = git(wtA, "rev-parse", "HEAD").trim();
  const seq = /reported as #(\d+)/.exec(out)?.[1];
  assert.ok(seq, out);
  assert.equal(storedBody(seq), `@orchestrator merged ${sha}: done`);
  // a member on old habits types its verdicts: the merge goes through all the same, and the report carries none
  fs.writeFileSync(path.join(wtA, "src", "ui", "page.ts"), "export const p = 2;\n");
  commit(wtA, "page again");
  const typed = cli(wtA, "merge-lock", "--onto", "main", "--guides", "all:ok, ui:n/a no screen", "--report", "done again");
  const sha2 = git(wtA, "rev-parse", "HEAD").trim();
  const seq2 = /reported as #(\d+)/.exec(typed)?.[1];
  assert.ok(seq2, typed);
  assert.equal(storedBody(seq2), `@orchestrator merged ${sha2}: done again`);
});

test("by hand: the lock's grant names no guide, and merged takes its sha whatever --guides is typed before it", () => {
  fs.writeFileSync(path.join(wtA, "src", "ui", "page.ts"), "export const p = 3;\n");
  commit(wtA, "page");
  const lock = cli(wtA, "merge-lock", "--lock-only", "--onto", "main");
  assert.doesNotMatch(lock, /guides/);
  assert.match(lock, /^granted: under the lock only rebase, .* merged <sha> --report "<your report>" --as g\/S1$/m);
  git(wtA, "push", "-q", ".", "HEAD:main");
  const sha = git(wtA, "rev-parse", "HEAD").trim();
  // --guides before the sha: its value is the flag's, never the sha
  const out = cli(wtA, "merged", "--guides", "all:ok", sha, "--report", "-");
  assert.match(out, new RegExp(`^merged ${sha}: lock released$`, "m"));
});

test("guides: frontmatter forms, shipped and project sources", () => {
  assert.deepEqual(parseGuide('---\nname: s\npaths: ["a/**", \'b/*.ts\']\n---\n', "guide-x"), { name: "x", skill: "s", paths: ["a/**", "b/*.ts"] });
  assert.deepEqual(parseGuide("---\nname: s\npaths: src/**\n---\n", "y"), { name: "y", skill: "s", paths: ["src/**"] });
  assert.equal(parseGuide("---\nname: s\n---\n", "z"), null);
  // a brace glob stays one item of a flow list (G41)
  assert.deepEqual(parseGuide('---\nname: s\npaths: ["**/*.{ts,tsx}", "docs/**"]\n---\n', "guide-b")?.paths, ["**/*.{ts,tsx}", "docs/**"]);
  const plugin = path.join(home, "plugin");
  guideFile(path.join(plugin, "skills", "guides"), "layers", 'name: guide-layers\npaths: ["src/**"]');
  guideFile(path.join(plugin, "skills", "guides"), "all", 'name: shipped-all\npaths: ["**"]');
  const found = discoverGuides(path.join(plugin, "skills", "companions", "swarm-board"), repo);
  // the project's guide-all stands in for the shipped one of the same name
  assert.deepEqual(found.map((g) => `${g.name}:${g.skill}`), ["layers:guide-layers", "all:guide-all", "ui:guide-ui"]);
});

test("D11: merged refuses a sha git does not know, and a sha not on the branch; it takes a long report from --report-file (V1, G25)", () => {
  fs.writeFileSync(path.join(wtA, "src", "a.ts"), "export const a = 3;\n");
  commit(wtA, "a");
  cli(wtA, "merge-lock", "--lock-only", "--onto", "main");
  const unknown = swarm(wtA, "merged", "deadbeef", "--report", "-");
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /deadbeef is no commit git knows/);
  const sha = git(wtA, "rev-parse", "HEAD").trim();
  // not pushed onto main yet: not merged
  assert.match(swarm(wtA, "merged", sha, "--report", "-").stderr, /is not on main; fast-forward it first/);
  git(wtA, "push", "-q", ".", "HEAD:main");
  const file = path.join(home, "report.md");
  fs.writeFileSync(file, "a long report\nover two lines\n");
  const out = cli(wtA, "merged", sha, "--report-file", file);
  const seq = /reported as #(\d+)/.exec(out)?.[1];
  assert.ok(seq, out);
  assert.match(storedBody(seq!), /a long report\nover two lines/);
});

test("golden V-32 (D69): merged --report naming an existing file is refused with the --report-file line", () => {
  fs.writeFileSync(path.join(wtA, "src", "a.ts"), "export const a = 4;\n");
  commit(wtA, "a");
  cli(wtA, "merge-lock", "--lock-only", "--onto", "main");
  git(wtA, "push", "-q", ".", "HEAD:main");
  const sha = git(wtA, "rev-parse", "HEAD").trim();
  const file = path.join(home, "report-v32.md");
  fs.writeFileSync(file, "the report\n");
  const refused = swarm(wtA, "merged", sha, "--report", file);
  assert.equal(refused.status, 1);
  assert.ok(refused.stderr.includes(`merged: --report takes the report's text, and ${file} is a file: pass it as --report-file ${file}`), refused.stderr);
});

test("the shipped guides carry no paths: key, and the board gives them every code file", () => {
  const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const shipped = discoverGuides(toolRoot, null);
  assert.deepEqual(shipped.map((g) => g.name).sort(), ["complexity", "deepen-module"]);
  for (const g of shipped) assert.deepEqual(g.paths, SHIPPED_GUIDE_PATHS);
  assert.equal(parseGuide("---\nname: guide-x\ndescription: d\n---\n", "guide-x"), null, "a project guide still needs its own paths");
});
