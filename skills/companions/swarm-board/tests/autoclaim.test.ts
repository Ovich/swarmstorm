// spec §7: the link's changed set read from git in a member's worktree, and the board setting the member's holdings
// to it, an overlap posted once to both members with the agree command.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { changedSet, driftedSet } from "../src/packs/code/changes.ts";
import { CODE_WORDING } from "../src/cli/answer/code-wording.ts";
import { decode, type Frame } from "../src/wire.ts";
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

test("changedSet: a worktree switched to another commit (a base to compare against) keeps the last set, back on its branch it reads again", () => {
  const repo = path.join(dir, "repo");
  fs.mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(repo, "a.ts"), "a\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "base");
  git(repo, "checkout", "-qb", "work");
  fs.appendFileSync(path.join(repo, "a.ts"), "x\n");
  git(repo, "commit", "-qam", "work");
  assert.deepEqual(changedSet(repo, "main"), ["a.ts"]);
  git(repo, "checkout", "-q", "--detach", "main");
  assert.equal(changedSet(repo, "main"), null, "detached on the base: the claims stay");
  git(repo, "checkout", "-q", "work");
  assert.deepEqual(changedSet(repo, "main"), ["a.ts"]);
});

test("the board sets holdings to the set, keeps what left it (claims-phase), and posts an overlap once to both, never when they agreed", async () => {
  board = await openBoard(path.join(dir, "swarm.sqlite"));
  try {
    const run = board.openRun({ repo: REPO, kind: "task", group: "g", title: "T", seats: ["w1", "w2", "w3"].map((id) => ({ id, blockers: [] })) });
    const [w1, w2, w3] = ["w1", "w2", "w3"].map((seat) => board.join({ run: run.id, seat, doing: "x", files: [] }).member);
    const code = codeVerbs(board);
    const overlaps = () => board.snapshot(REPO).events.filter((e) => e.event === "flag");
    code.changes(w1, ["src/a.ts", "src/b.ts"]);
    assert.deepEqual(board.heldBy(w1).sort(), ["src/a.ts", "src/b.ts"]);
    code.changes(w1, ["src/a.ts"]);
    assert.deepEqual(board.heldBy(w1).sort(), ["src/a.ts", "src/b.ts"], "a path that left the set is kept until the phase ends");
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

test("board-fixes#D8: an agreement clears the pair's overlap flags on its path, and only theirs", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const file = path.join(dir, "swarm.sqlite");
  board = await openBoard(file);
  try {
    const run = board.openRun({ repo: REPO, kind: "task", group: "g", title: "T", seats: ["w1", "w2", "w3"].map((id) => ({ id, blockers: [] })) });
    const [w1, w2, w3] = ["w1", "w2", "w3"].map((seat) => board.join({ run: run.id, seat, doing: "x", files: [] }).member);
    const code = codeVerbs(board);
    code.changes(w1, ["src/a.ts", "src/c.ts"]);
    code.changes(w2, ["src/a.ts"]);
    code.changes(w3, ["src/a.ts", "src/c.ts"]);
    const raw = new DatabaseSync(file);
    for (const [p, id] of [["src/a.ts", w1.id], ["src/a.ts", w2.id], ["src/a.ts", w3.id], ["src/c.ts", w1.id]] as const) raw.prepare("INSERT INTO flags (repo, path, participant) VALUES (?, ?, ?)").run(REPO, p, id);
    raw.prepare("INSERT INTO notices (repo, path, participant, other) VALUES (?, ?, ?, ?)").run(REPO, "src/a.ts", w1.id, w2.id);
    raw.prepare("INSERT INTO notices (repo, path, participant, other) VALUES (?, ?, ?, ?)").run(REPO, "src/a.ts", w1.id, w3.id);
    board.post(w1, "@w2 I change a.ts first, you after", { kind: "agreement", about: "src/a.ts" });
    const flags = (raw.prepare("SELECT path, participant FROM flags ORDER BY path, participant").all() as { path: string; participant: number }[]).map((r) => `${r.path}:${r.participant}`);
    assert.deepEqual(flags, [`src/a.ts:${w3.id}`, `src/c.ts:${w1.id}`], "the pair's flags on a.ts go; w3's and c.ts's stay");
    const notices = (raw.prepare("SELECT other FROM notices").all() as { other: number }[]).map((r) => r.other);
    assert.deepEqual(notices, [w3.id], "the pair's notice goes; w1's with w3 stays");
    raw.close();
  } finally {
    board.close();
  }
});

test("driftedSet (claims-phase): a changed file the target changed since the merge-base is drifted with that commit's sha; once the branch has it, not", () => {
  const repo = path.join(dir, "repo");
  fs.mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  for (const f of ["a.ts", "b.ts", "c.ts"]) fs.writeFileSync(path.join(repo, f), `${f}\n`);
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "base");
  git(repo, "checkout", "-qb", "work");
  fs.appendFileSync(path.join(repo, "a.ts"), "mine\n");
  fs.appendFileSync(path.join(repo, "b.ts"), "mine\n");
  git(repo, "commit", "-qam", "work");
  assert.deepEqual(driftedSet(repo, "main", ["a.ts", "b.ts"]), [], "the target has not moved");
  // another member merges a.ts twice and c.ts into main: a.ts drifts with the newer sha; c.ts is not this member's
  git(repo, "checkout", "-q", "main");
  fs.writeFileSync(path.join(repo, "a.ts"), "theirs 1\n");
  git(repo, "commit", "-qam", "a1");
  fs.writeFileSync(path.join(repo, "a.ts"), "theirs 2\n");
  fs.appendFileSync(path.join(repo, "c.ts"), "theirs\n");
  git(repo, "commit", "-qam", "a2");
  const newest = git(repo, "rev-parse", "HEAD").trim();
  git(repo, "checkout", "-q", "work");
  assert.deepEqual(driftedSet(repo, "main", ["a.ts", "b.ts"]), [{ path: "a.ts", sha: newest }]);
  assert.deepEqual(driftedSet(repo, "main", []), [], "no changed file, nothing drifted");
  // rebased onto main: the branch has it
  git(repo, "rebase", "-q", "-X", "ours", "main");
  assert.deepEqual(driftedSet(repo, "main", ["a.ts", "b.ts"]), [], "rebased: not drifted");
  // a branch made after the merge: not drifted
  git(repo, "checkout", "-qb", "later", "main");
  fs.appendFileSync(path.join(repo, "a.ts"), "later\n");
  assert.deepEqual(driftedSet(repo, "main", ["a.ts"]), []);
  // as changedSet: a git error or a detached HEAD keeps the last set
  assert.equal(driftedSet(repo, "no-such-branch", ["a.ts"]), null);
  git(repo, "checkout", "-q", "--", "a.ts");
  git(repo, "checkout", "-q", "--detach", "main");
  assert.equal(driftedSet(repo, "main", ["a.ts"]), null);
});

test("claims-phase: a changes call without drifted (an older link) is still taken, and a drift event's step is the rebase onto its sha", async () => {
  board = await openBoard(path.join(dir, "swarm.sqlite"));
  try {
    const run = board.openRun({ repo: REPO, kind: "task", group: "g", title: "T", seats: ["w1", "w2"].map((id) => ({ id, blockers: [] })) });
    const [w1, w2] = ["w1", "w2"].map((seat) => board.join({ run: run.id, seat, doing: "x", files: [] }).member);
    board.packCall(w1, "changes", { files: ["src/a.ts"] });
    assert.deepEqual(board.heldBy(w1), ["src/a.ts"], "the old frame's input, no drifted field");
    codeVerbs(board).changes(w1, ["src/a.ts"], [{ path: "src/a.ts", sha: "abc1234def" }]);
    assert.deepEqual(board.heldBy(w1), ["src/a.ts"]);
    const drift = { mentions: [w1.name], about: "src/a.ts", meta: { event: "drift", sha: "abc1234def" } } as unknown as Message;
    assert.equal(codeEventStep(drift, w1, "swarm", "drift"), "commit what you have, then: git rebase abc1234def");
    assert.equal(codeEventStep(drift, w2, "swarm", "drift"), null, "nothing asked of another member");
    assert.equal(CODE_WORDING.driftNotice(w1.name, "src/a.ts", w2.name, "abc1234def"), "@g/w1 src/a.ts was merged by g/w2 (abc1234) and is not in your branch: rebase now");
  } finally {
    board.close();
  }
});

test("claims-phase: a changes frame without drifted still decodes", () => {
  const f = decode(JSON.stringify({ type: "changes", files: ["a.ts"] }));
  assert.equal(f.type, "changes");
  assert.equal((f as Extract<Frame, { type: "changes" }>).drifted ?? null, null);
});
