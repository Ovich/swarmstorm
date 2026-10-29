// Architecture guides: the first claim that touches a guide's paths names it, once per member;
// merge-lock lists the guides of the branch's changes; merged refuses until each is settled.
import { test, beforeEach, afterEach } from "node:test";
import { stopServerOf } from "./fixtures/server.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverGuides, globRegex, guidesFor, guidesSettlement, parseGuide, projectGuidesAt } from "../src/cli/guides.ts";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "cli", "index.ts");

let home: string;
let repo: string;
let wtA: string;
let wtB: string;

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
  commit(repo, "root");
  wtA = path.join(home, "wt-a");
  wtB = path.join(home, "wt-b");
  git(repo, "worktree", "add", "-q", "-b", "a", wtA);
  git(repo, "worktree", "add", "-q", "-b", "b", wtB);
  git(repo, "checkout", "-q", "--detach");
  const seats = path.join(home, "seats.json");
  fs.writeFileSync(seats, JSON.stringify([{ id: "S1", blockers: [] }, { id: "S2", blockers: [] }]));
  const id = cli(repo, "open", "--plan", "g", "--title", "T", "--seats", seats).split("\n")[0].trim();
  cli(wtA, "join", "--run", id, "--seat", "S1", "--doing", "x");
  cli(wtB, "join", "--run", id, "--seat", "S2", "--doing", "y");
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

const guidesLineOf = (out: string): string | undefined => out.split("\n").find((l) => l.startsWith("guides for this work: "));

test("the first claim names every matching guide, globals included; later claims only new ones, once per member", () => {
  assert.equal(guidesLineOf(cli(wtA, "claim", "src/a.ts")), "guides for this work: all (guide-all); load each before editing");
  assert.equal(guidesLineOf(cli(wtA, "claim", "src/a.ts")), undefined);
  assert.equal(guidesLineOf(cli(wtA, "claim", "src/ui/page.ts")), "guides for this work: ui (guide-ui); load each before editing");
  assert.equal(guidesLineOf(cli(wtA, "claim", "src/ui/page.ts")), undefined);
  // another member is told for itself
  assert.match(guidesLineOf(cli(wtB, "claim", "src/ui/new.ts", "--new")) ?? "", /all \(guide-all\), ui \(guide-ui\)/);
});

test("merge-lock lists the branch's guides; merged refuses until every one is settled, then records them", () => {
  fs.writeFileSync(path.join(wtA, "src", "ui", "page.ts"), "export const p = 1;\n");
  commit(wtA, "page");
  const lock = cli(wtA, "merge-lock", "--onto", "main");
  assert.match(lock, /guides of this merge: all \(guide-all\), ui \(guide-ui\)/);
  const sha = git(wtA, "rev-parse", "HEAD").trim();
  const missing = swarm(wtA, "merged", sha, "--files", "src/ui/page.ts", "--report", "done", "--guides", "all:ok fits");
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /missing: ui/);
  git(wtA, "push", "-q", ".", "HEAD:main");
  const out = cli(wtA, "merged", sha, "--files", "src/ui/page.ts", "--report", "done", "--guides", "all:ok fits, ui:n/a no screen, only a constant");
  const seq = /reported as #(\d+)/.exec(out)?.[1];
  assert.ok(seq, out);
  assert.match(cli(repo, "read", seq), /guides: all:ok fits, ui:n\/a no screen, only a constant/);
});

test("a branch touching no guide's paths merges without --guides", () => {
  // the target drops its guides, and the branch takes that before its own change
  git(repo, "checkout", "-q", "main");
  fs.rmSync(path.join(repo, ".claude"), { recursive: true });
  commit(repo, "no guides");
  git(repo, "checkout", "-q", "--detach");
  git(wtA, "rebase", "-q", "main");
  fs.writeFileSync(path.join(wtA, "src", "a.ts"), "export const b = 1;\n");
  commit(wtA, "a");
  const lock = cli(wtA, "merge-lock", "--onto", "main");
  assert.doesNotMatch(lock, /guides of this merge/);
  git(wtA, "push", "-q", ".", "HEAD:main");
  cli(wtA, "merged", git(wtA, "rev-parse", "HEAD").trim(), "--files", "src/a.ts", "--report", "-");
});

test("guides: frontmatter forms, globs, shipped and project sources, settled names", () => {
  assert.deepEqual(parseGuide('---\nname: s\npaths: ["a/**", \'b/*.ts\']\n---\n', "guide-x"), { name: "x", skill: "s", paths: ["a/**", "b/*.ts"] });
  assert.deepEqual(parseGuide("---\nname: s\npaths: src/**\n---\n", "y"), { name: "y", skill: "s", paths: ["src/**"] });
  assert.equal(parseGuide("---\nname: s\n---\n", "z"), null);
  assert.ok(globRegex("**").test("a/b/c.ts"));
  assert.ok(globRegex("src/**/*.ts").test("src/x.ts"));
  assert.ok(globRegex("src/**/*.ts").test("src/a/b/x.ts"));
  assert.ok(!globRegex("src/*.ts").test("src/a/x.ts"));
  const plugin = path.join(home, "plugin");
  guideFile(path.join(plugin, "skills", "guides"), "layers", 'name: guide-layers\npaths: ["src/**"]');
  guideFile(path.join(plugin, "skills", "guides"), "all", 'name: shipped-all\npaths: ["**"]');
  const found = discoverGuides(path.join(plugin, "skills", "companions", "swarm-board"), repo);
  // the project's guide-all stands in for the shipped one of the same name
  assert.deepEqual(found.map((g) => `${g.name}:${g.skill}`), ["layers:guide-layers", "all:guide-all", "ui:guide-ui"]);
  assert.deepEqual(guidesFor(found, ["docs/x.md"]).map((g) => g.name), ["all"]);
  assert.deepEqual(guidesSettlement("a:ok, b:n/a why, with comma, c: ok", ["a", "b", "c"]), { missing: [], unknown: [], unjudged: [] });
  assert.deepEqual(guidesSettlement("a:fine, b:n/a, x:ok", ["a", "b", "c"]), { missing: ["c"], unknown: ["x"], unjudged: ["a", "b"] });
  // the target's tree, read through git: only guide-* folders
  const tree: Record<string, string> = { ".claude/skills/guide-t/SKILL.md": '---\nname: guide-t\npaths: ["lib/**"]\n---\n' };
  assert.deepEqual(projectGuidesAt((spec) => tree[spec] ?? null, "guide-t\nother"), [{ name: "t", skill: "guide-t", paths: ["lib/**"] }]);
});

test("merged refuses an unknown guide, a verdict that is neither ok nor n/a with a why, and a sha not on the branch", () => {
  fs.writeFileSync(path.join(wtA, "src", "ui", "page.ts"), "export const p = 2;\n");
  commit(wtA, "page");
  cli(wtA, "merge-lock", "--onto", "main");
  const sha = git(wtA, "rev-parse", "HEAD").trim();
  const merged = (guides: string) => swarm(wtA, "merged", sha, "--files", "src/ui/page.ts", "--report", "-", "--guides", guides);
  assert.match(merged("all:ok, ui:ok, bogus:ok").stderr, /names bogus, which merge-lock did not list/);
  assert.match(merged("all:ok, ui:n/a").stderr, /gives ui no verdict/);
  // not pushed onto main yet: not merged
  assert.match(merged("all:ok, ui:ok").stderr, /is not on main; fast-forward it first/);
  git(wtA, "push", "-q", ".", "HEAD:main");
  const out = cli(wtA, "merged", sha, "--files", "src/ui/page.ts", "--report", "-", "--guides", "all:ok, ui:ok");
  // a silent merge still records its guides in the run
  const seq = /guides recorded as #(\d+)/.exec(out)?.[1];
  assert.ok(seq, out);
  assert.match(cli(repo, "read", seq), /guides: all:ok, ui:ok/);
});

test("merge-lock names a guide the target gained since the branch left it", () => {
  guideFile(path.join(repo, ".claude", "skills"), "guide-lib", 'name: guide-lib\npaths: ["src/a.ts"]');
  git(repo, "checkout", "-q", "main");
  commit(repo, "lib guide");
  git(repo, "checkout", "-q", "--detach");
  fs.writeFileSync(path.join(wtA, "src", "a.ts"), "export const a = 1;\n");
  commit(wtA, "a");
  assert.match(cli(wtA, "merge-lock", "--onto", "main"), /guides of this merge: all \(guide-all\), lib \(guide-lib\)/);
});

test("claim takes several paths, and resolves them in the member's worktree whatever the shell's folder", () => {
  const out = cli(home, "claim", "src/a.ts", "src/ui/page.ts", "--as", "g/S1");
  assert.match(out, /^claimed src\/a\.ts$/m);
  assert.match(out, /^claimed src\/ui\/page\.ts$/m);
  // the other member is held on both
  const held = swarm(wtB, "claim", "src/a.ts");
  assert.equal(held.status, 3);
});
