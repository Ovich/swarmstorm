// spec §7: the link's changed set read from git in a member's worktree, and the board setting the member's holdings
// to it, an overlap posted once to both members with the agree command.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { changedSet } from "../src/link/changes.ts";
import { openBoard, type Board, type Message } from "../src/board/board.ts";
import { codeVerbs } from "../src/packs/code/calls.ts";
import { codeEventStep } from "../src/cli/answer/code-rules.ts";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-autoclaim-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const git = (cwd: string, ...args: string[]): string => execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8" });

test("changedSet: unstaged, staged, committed, new, deleted, renamed (both paths); ignored never; a file back to its base drops out", () => {
  const repo = path.join(dir, "repo");
  fs.mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  for (const f of ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"]) fs.writeFileSync(path.join(repo, f), `${f}\n`);
  fs.writeFileSync(path.join(repo, ".gitignore"), "out/\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "base");
  git(repo, "checkout", "-qb", "work");
  assert.deepEqual(changedSet(repo, "main"), [], "a clean worktree holds nothing");
  fs.appendFileSync(path.join(repo, "a.ts"), "x\n"); // unstaged
  fs.appendFileSync(path.join(repo, "b.ts"), "x\n");
  git(repo, "add", "b.ts"); // staged
  fs.appendFileSync(path.join(repo, "c.ts"), "x\n");
  git(repo, "commit", "-qm", "c", "c.ts"); // committed
  fs.writeFileSync(path.join(repo, "new.ts"), "n\n"); // untracked
  fs.rmSync(path.join(repo, "d.ts")); // deleted
  git(repo, "mv", "e.ts", "e2.ts"); // renamed
  fs.mkdirSync(path.join(repo, "out"));
  fs.writeFileSync(path.join(repo, "out", "x.js"), "1"); // ignored
  assert.deepEqual(changedSet(repo, "main"), ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "e2.ts", "new.ts"]);
  git(repo, "checkout", "--", "a.ts");
  assert.ok(!changedSet(repo, "main")!.includes("a.ts"), "reverted: released");
  assert.equal(changedSet(repo, "no-such-branch"), null, "a git error keeps the last set");
});

let board: Board;
const REPO = "/repos/autoclaim/.git";

test("the board sets holdings to the set, releases what left it, and posts an overlap once to both, never when they agreed", async () => {
  board = await openBoard(path.join(dir, "swarm.sqlite"));
  try {
    const run = board.openRun({ repo: REPO, kind: "task", group: "g", title: "T", seats: ["w1", "w2", "w3"].map((id) => ({ id, blockers: [] })) });
    const [w1, w2, w3] = ["w1", "w2", "w3"].map((seat) => board.join({ run: run.id, seat, doing: "x", files: [] }).member);
    const code = codeVerbs(board);
    const overlaps = () => board.snapshot(REPO).events.filter((e) => e.event === "flag");
    code.changes(w1, ["src/a.ts", "src/b.ts"]);
    assert.deepEqual(board.heldBy(w1).sort(), ["src/a.ts", "src/b.ts"]);
    code.changes(w1, ["src/a.ts"]);
    assert.deepEqual(board.heldBy(w1), ["src/a.ts"], "a path that left the set is released");
    // w2 changes a.ts too: one post to both, about the path, each told the agree command with the other
    code.changes(w2, ["src/a.ts"]);
    code.changes(w2, ["src/a.ts"]);
    assert.equal(overlaps().length, 1, "once");
    const post = board.snapshot(REPO).events.find((e) => e.event === "flag")!;
    assert.equal(post.about, "src/a.ts");
    assert.deepEqual(post.mentions, ["g/w1", "g/w2"]);
    const message = post as unknown as Message;
    assert.equal(codeEventStep(message, w2, "swarm"), 'settle it: swarm agree "@w1 <who changes what>" --with g/w1 --about src/a.ts --as g/w2');
    assert.equal(codeEventStep(message, w1, "swarm"), 'settle it: swarm agree "@w2 <who changes what>" --with g/w2 --about src/a.ts --as g/w1');
    // an agreement between w1 and w3 about b.ts already stands: w3 changing it posts nothing
    code.changes(w1, ["src/a.ts", "src/b.ts"]);
    board.post(w1, "@w3 I change b.ts first, you after", { kind: "agreement", about: "src/b.ts" });
    code.changes(w3, ["src/b.ts"]);
    assert.equal(overlaps().length, 1);
    void w3;
  } finally {
    board.close();
  }
});
