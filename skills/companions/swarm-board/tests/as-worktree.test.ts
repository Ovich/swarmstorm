// A worktree acts only as its member (trust-adaptations#D23), and close and seat add only as the run's orchestrator
// (D5, client half), the orchestrators board excepted: a real server and CLI under a temporary data home.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeRepo, openTwoRunners, type Repo } from "./fixtures/worktrees.ts";

let repos: Repo[] = [];
afterEach(() => {
  for (const r of repos) r.cleanup();
  repos = [];
});
const twoRunners = (): { r: Repo; id: string } => {
  const r = makeRepo("swarm-as-");
  repos.push(r);
  return { r, id: String(openTwoRunners(r)) };
};

test("--as naming another member from a member's worktree is refused, with the command run as that member", () => {
  const { r, id } = twoRunners();
  const other = r.swarm(r.wtA, ["doing", "x", "--as", "review-tool/S5"]);
  assert.equal(other.status, 1);
  assert.match(other.stderr, /^--as review-tool\/S5: refused: the folder you run in is review-tool\/S3's, and a member acts only as itself\. Run it as review-tool\/S3: node \S+ doing x --as review-tool\/S3$/m);
  // the orchestrator's name, from a worker's worktree, is another member too
  assert.equal(r.swarm(r.wtA, ["post", "hi", "--as", "review-tool/orchestrator"]).status, 1);
  assert.match(r.cli(r.wtA, "doing", "mine", "--as", "review-tool/S3"), /review-tool\/S3 doing: mine/);
  // outside any member's worktree, --as names whom it names
  assert.match(r.cli(r.repo, "post", "from the checkout", "--as", "review-tool/orchestrator"), /^#\d+/);
  void id;
});

test("an ended seat taken back by a fresh join calls from its worktree as before", () => {
  const { r, id } = twoRunners();
  r.cli(r.repo, "end", "--seat", "S3", "--as", "review-tool/orchestrator");
  r.cli(r.wtA, "join", "--run", id, "--seat", "S3", "--doing", "back");
  assert.match(r.cli(r.wtA, "doing", "again", "--as", "review-tool/S3"), /review-tool\/S3 doing: again/);
  assert.match(r.cli(r.wtA, "doing", "and again"), /review-tool\/S3 doing: and again/);
});

test("v1-F1: join naming another member from a live member's worktree is refused, and that member's task stays unread", () => {
  const { r, id } = twoRunners();
  r.cli(r.repo, "post", "@S5 your task", "--as", "review-tool/orchestrator");
  const unreadOfS5 = (): number => (JSON.parse(r.cli(r.repo, "roster", "--json")).roster as { name: string; unread: number }[]).find((m) => m.name === "review-tool/S5")!.unread;
  assert.equal(unreadOfS5(), 1);
  const stolen = r.swarm(r.wtA, ["join", "--run", id, "--seat", "S5", "--doing", "x", "--as", "review-tool/S5"]);
  assert.equal(stolen.status, 1);
  assert.match(stolen.stderr, /^join: refused: the folder you run in is review-tool\/S3's, a live member, and a folder joins only as its own member\. Join review-tool\/S5 from its own folder, or from the project's checkout$/m);
  assert.equal(unreadOfS5(), 1);
  assert.match(r.cli(r.wtB, "wait", "--mentions", "--timeout", "2000"), /@S5 your task/);
});

test("a seat is taken back from its own worktree while its member lives, and from the checkout once it ended", () => {
  const { r, id } = twoRunners();
  assert.match(r.cli(r.wtA, "join", "--run", id, "--seat", "S3", "--doing", "again", "--as", "review-tool/S3"), /you are review-tool\/S3/);
  r.cli(r.repo, "end", "--seat", "S5", "--as", "review-tool/orchestrator");
  assert.match(r.cli(r.repo, "join", "--run", id, "--seat", "S5", "--doing", "back", "--as", "review-tool/S5"), /you are review-tool\/S5/);
});

test("close and seat add refuse anyone but the run's orchestrator, naming the command to run as it", () => {
  const { r, id } = twoRunners();
  const asOrchestrator = (verb: string) => new RegExp(`^${verb}: refused: only the orchestrator of run ${id} may .*Run it as the orchestrator: node \\S+ ${verb} .*--run ${id} --as review-tool/orchestrator$`, "m");
  const anonymous = r.swarm(r.repo, ["close", "--run", id]);
  assert.equal(anonymous.status, 1);
  assert.match(anonymous.stderr, asOrchestrator("close"));
  const worker = r.swarm(r.wtA, ["seat", "add", "S9", "--run", id]);
  assert.equal(worker.status, 1);
  assert.match(worker.stderr, /, and review-tool\/S3 is not\./);
  assert.match(worker.stderr, asOrchestrator("seat add"));
  assert.match(r.cli(r.repo, "seat", "add", "S9", "--run", id, "--as", "review-tool/orchestrator"), /S9 added/);
  assert.match(r.cli(r.repo, "close", "--run", id, "--confirm", "--as", "review-tool/orchestrator"), new RegExp(`run ${id} closed`));
});

test("on the orchestrators board, seat add needs no --as and close --force closes it", () => {
  const r = makeRepo("swarm-as-");
  repos.push(r);
  const seats = path.join(r.home, "orchestrators.json");
  fs.writeFileSync(seats, "[]");
  const id = r.cli(r.repo, "open", "--kind", "brainstorm", "--group", "orchestrators", "--title", "Orchestrators", "--seats", seats).split(/\r?\n/)[0].trim();
  assert.match(r.cli(r.repo, "seat", "add", "alpha", "--run", id), /alpha added/);
  assert.match(r.cli(r.repo, "close", "--run", id, "--force"), new RegExp(`run ${id} closed`));
});
