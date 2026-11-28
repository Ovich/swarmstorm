// The thread read back from the CLI: phases, a page with its next page's command, one post in full; a member joining a
// run under way is told how to read what came before it.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { makeRepo, openTwoMembers, type Repo } from "./fixtures/worktrees.ts";

let repos: Repo[] = [];
afterEach(() => {
  for (const r of repos) r.cleanup();
  repos = [];
});

test("phases, thread and read: one line per post, the next page's command, a post whole", () => {
  const r = makeRepo();
  repos.push(r);
  const run = String(openTwoMembers(r));
  const as = ["--as", "review-tool/orchestrator"];
  r.cli(r.repo, "phase", "build", "go", "--confirm", ...as);
  for (let i = 0; i < 22; i++) r.cli(r.wtA, "post", `@S5 note ${i} ${"y".repeat(150)}`);
  const phases = r.cli(r.repo, "phases", "--run", run);
  assert.match(phases, /^#\d+ {2}build {2}opened .* {2}22 posts {2}0 done {2}\(current\)$/m);
  const page = r.cli(r.repo, "thread", "--run", run, "--by", "S3");
  assert.match(page, /· {2}phase build from #\d+ {2}· {2}20 of 22 posts/);
  assert.match(page, /^#\d+ \d\d-\d\d \d\d:\d\d {2}S3 → S5 {2}@S5 note 21 y+…$/m);
  const earlier = page.match(/^earlier: .* thread (.*)$/m)?.[1];
  assert.ok(earlier, page);
  assert.match(earlier!, /^--run \d+ --phase build --by S3 --before \d+$/);
  const back = r.cli(r.repo, "thread", ...earlier!.split(" "));
  assert.match(back, /2 of 22 posts/);
  const seq = page.match(/^#(\d+) .*note 21/m)![1];
  const full = r.cli(r.repo, "read", seq);
  assert.match(full, new RegExp(`^@S5 note 21 ${"y".repeat(150)}$`, "m"));
  // the caller's own run without --run
  assert.match(r.cli(r.wtB, "thread", "--to", "S5", "--limit", "1"), /1 of 22 posts/);
});

test("a member taking a seat back, in a run under way, is told how to read what came before it", () => {
  const r = makeRepo();
  repos.push(r);
  const run = String(openTwoMembers(r));
  r.cli(r.repo, "phase", "build", "go", "--confirm", "--as", "review-tool/orchestrator");
  r.cli(r.repo, "end", "--seat", "S5", "--as", "review-tool/orchestrator");
  const joined = r.cli(r.wtB, "join", "--run", run, "--seat", "S5", "--doing", "again");
  assert.match(joined, new RegExp(`^before you: .* thread --run ${run} --with S5 --phase all; the run's phases: .* phases --run ${run}$`, "m"));
});
