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
import { discoverGuides, globRegex, guidesFor, guidesNamed, parseGuide } from "../src/cli/guides.ts";

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
  const out = cli(wtA, "merged", sha, "--files", "src/ui/page.ts", "--report", "done", "--guides", "all:ok fits, ui:n/a no screen, only a constant");
  const seq = /reported as #(\d+)/.exec(out)?.[1];
  assert.ok(seq, out);
  assert.match(cli(repo, "read", seq), /guides: all:ok fits, ui:n\/a no screen, only a constant/);
});

test("a branch touching no guide's paths merges without --guides", () => {
  fs.rmSync(path.join(repo, ".claude"), { recursive: true });
  fs.rmSync(path.join(wtA, ".claude"), { recursive: true });
  commit(wtA, "no guides");
  const lock = cli(wtA, "merge-lock", "--onto", "main");
  assert.doesNotMatch(lock, /guides of this merge/);
  cli(wtA, "merged", git(wtA, "rev-parse", "HEAD").trim(), "--files", ".claude", "--report", "-");
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
  assert.deepEqual(guidesNamed("a:ok, b:n/a why, with comma, c: ok"), ["a", "b", "c"]);
});
