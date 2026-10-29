// Claims by the CLI (D58): `swarm claim` before an edit, and `swarm end` reconciling what the
// member wrote without one. Two members of one run, each in a worktree of its own.
import { test, beforeEach, afterEach } from "node:test";
import { stopServerOf } from "./fixtures/server.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBoard } from "../src/board/board.ts";
import { codeVerbs } from "../src/packs/code/calls.ts";

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
/** The claim's own answer: the listener line a member with no listener gets last (D61), checked
 *  present and taken off; `answerJson` does the same with `next`, its --json form. */
const LISTENER = /^start your listener now, in the background \(your harness's background task\): node \S+ wait --mentions --as \S+\n$/m;
const answer = (stdout: string): string => {
  assert.match(stdout, LISTENER);
  return stdout.replace(LISTENER, "");
};
const answerJson = (stdout: string): Record<string, unknown> => {
  const { next, ...rest } = JSON.parse(stdout);
  assert.match(next, /wait --mentions --as /);
  return rest;
};
const git = (cwd: string, ...argv: string[]): void => {
  const r = spawnSync("git", argv, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
};

const SLICES = JSON.stringify([
  { id: "S3", blockers: [] },
  { id: "S5", blockers: [] },
]);

/** A run with S3 in worktree a (holding src/a.ts) and S5 in worktree b; S3's funny name. */
const running = (): string => {
  const slices = path.join(home, "slices.json");
  fs.writeFileSync(slices, SLICES);
  const id = cli(repo, "open", "--plan", "review-tool", "--title", "T", "--seats", slices).split("\n")[0].trim(); // the run id, then the page's URL
  const s3 = JSON.parse(cli(wtA, "join", "--run", id, "--seat", "S3", "--doing", "the page", "--files", "src/a.ts:inside", "--json"));
  cli(wtB, "join", "--run", id, "--seat", "S5", "--doing", "the skill");
  cli(wtA, "deliver");
  cli(wtB, "deliver");
  return s3.nick;
};

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-claim-"));
  repo = path.join(home, "repo");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src", "old.ts"), "export {};\n");
  fs.writeFileSync(path.join(repo, "src", "a.ts"), "export {};\n");
  git(repo, "init", "-q", "-b", "main");
  git(repo, "add", ".");
  git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "root");
  wtA = path.join(home, "wt-a");
  wtB = path.join(home, "wt-b");
  git(repo, "worktree", "add", "-q", "-b", "a", wtA);
  git(repo, "worktree", "add", "-q", "-b", "b", wtB);
  // main checked out nowhere, as a run's target must be
  git(repo, "checkout", "-q", "--detach");
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

test("claim on a free path claims it, exit 0; another member is then held on it", () => {
  running();
  const r = swarm(wtA, "claim", "src/new.ts", "--new");
  assert.deepEqual([r.status, answer(r.stdout), r.stderr], [0, "claimed src/new.ts\n", ""]);
  const held = swarm(wtB, "claim", "src/new.ts", "--new");
  assert.equal(held.status, 3);
  assert.match(held.stdout, /src\/new\.ts is also held by review-tool\/S3/);
});

test("claim on a shared path before a post holds it: the holder, its note, the post to make, exit 3 (D41)", () => {
  const nick = running();
  const r = swarm(wtB, "claim", "src/a.ts");
  assert.equal(r.status, 3, r.stderr);
  assert.equal(
    answer(r.stdout),
    `src/a.ts is also held by review-tool/S3 (${nick}: the page). You may share it, but first tell its holder what you change in it: ` +
      '`swarm post "@review-tool/S3 …" --about src/a.ts`; its holder answers with an agreement on who changes what ' +
      "(`swarm agree … --about src/a.ts`), and that agreement goes. Claim again once posted; do not wait for the agreement.\n",
  );
  // held again until the post is made
  assert.equal(swarm(wtB, "claim", "src/a.ts").status, 3);
  const json = swarm(wtB, "claim", "src/a.ts", "--json");
  assert.equal(json.status, 3);
  assert.deepEqual(Object.keys(answerJson(json.stdout)).sort(), ["allowed", "refusal"]);
});

test("claim on a shared path after a post: claimed, the other holder named once, exit 0 (D40)", () => {
  const nick = running();
  swarm(wtB, "claim", "src/a.ts");
  cli(wtB, "post", "@S3 I add isExpired() at the end", "--about", "src/a.ts");
  const first = swarm(wtB, "claim", "src/a.ts");
  assert.deepEqual([first.status, answer(first.stdout)], [0, `claimed src/a.ts, also held by review-tool/S3 · ${nick}: the page\n`]);
  assert.equal(answer(cli(wtB, "claim", "src/a.ts")), "claimed src/a.ts\n", "the notice, once per member and path");
  assert.deepEqual(answerJson(cli(wtB, "claim", "src/a.ts", "--json")), {
    allowed: true,
    sharedWith: [{ member: "review-tool/S3", doing: "the page" }],
    notice: null,
  });
});

test("the claimer's post reaches the holder ending on the agreement to answer with; nothing else does (D62)", () => {
  running();
  swarm(wtB, "claim", "src/a.ts");
  cli(wtB, "post", "@S3 I add isExpired() at the end", "--about", "src/a.ts");
  const AGREE = 'answer with an agreement on who changes what: swarm agree "<who changes what in src/a.ts>" --about src/a.ts';
  const heard = cli(wtA, "deliver");
  assert.ok(heard.includes(`I add isExpired() at the end\n${AGREE}\n`), heard);
  // the holder's answer, and a post once the claimer holds the file, carry no such line
  cli(wtB, "claim", "src/a.ts");
  cli(wtA, "agree", "@S5 S5 adds isExpired() at the end, S3 the rest", "--about", "src/a.ts");
  cli(wtB, "post", "@S3 done with my part", "--about", "src/a.ts");
  assert.ok(!cli(wtB, "deliver").includes("answer with an agreement"));
  assert.ok(!cli(wtA, "deliver").includes("answer with an agreement"));
});

test("claim --interface claims the path as an interface", async () => {
  running();
  assert.equal(answer(cli(wtA, "claim", "src/api.ts", "--interface", "--new")), "claimed src/api.ts\n");
  const board = await openBoard(path.join(home, "swarm.sqlite"));
  try {
    const files = board.snapshot(board.repos()[0].repo).files;
    assert.deepEqual(
      files.find((f) => f.path === "src/api.ts"),
      { path: "src/api.ts", holders: ["review-tool/S3"], interface: true },
    );
  } finally {
    board.close();
  }
});

test("end reconciles git status before releasing: a shell write and a rename claimed, a held write flagged", () => {
  running();
  // written by a shell command, never claimed
  const shell = spawnSync("echo x > src/new.ts", { cwd: wtB, shell: true, encoding: "utf8" });
  assert.equal(shell.status, 0, shell.stderr);
  git(wtB, "mv", "src/old.ts", "src/renamed.ts");
  fs.writeFileSync(path.join(wtB, "src", "a.ts"), "// S3's\n");
  const r = JSON.parse(cli(wtB, "end", "--seat", "S5", "--as", "review-tool/orchestrator", "--json"));
  assert.equal(r.ended, true);
  assert.deepEqual([...r.reconciled].sort(), ["src/a.ts", "src/new.ts", "src/old.ts", "src/renamed.ts"]);
  assert.deepEqual(
    r.flags.map((f: { path: string; holder: string }) => [f.path, f.holder]),
    [["src/a.ts", "review-tool/S3"]],
  );
  // the flag is on the thread, mentioning both
  const forS3 = JSON.parse(cli(wtA, "deliver", "--json"));
  const flag = forS3.full.find((m: { body: string }) => /flag:/.test(m.body));
  assert.ok(flag, JSON.stringify(forS3));
  assert.deepEqual([...flag.mentions].sort(), ["review-tool/S3", "review-tool/S5"]);
});

test("end lists what it reconciled, then the end", () => {
  running();
  fs.writeFileSync(path.join(wtB, "src", "new.ts"), "export const x = 1;\n");
  fs.writeFileSync(path.join(wtB, "src", "a.ts"), "// S3's\n");
  const out = cli(wtB, "end", "--seat", "S5", "--as", "review-tool/orchestrator").split("\n");
  const lines = out.filter((l) => l.startsWith("reconciled "));
  assert.equal(lines.length, 1, out.join("\n"));
  assert.match(lines[0], /^reconciled 2 written without a claim: (src\/a\.ts, src\/new\.ts|src\/new\.ts, src\/a\.ts)$/);
  assert.ok(out.some((l) => /^#\d+ flagged: you wrote src\/a\.ts outside your claim; review-tool\/S3 holds it/.test(l)), out.join("\n"));
  assert.ok(out.includes("review-tool/S5 ended"));
});

const commit = (cwd: string, msg: string): void => {
  git(cwd, "add", "-A");
  git(cwd, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", msg);
};

test("merge-lock reconciles the branch's commits against --onto: a never-claimed file claimed, the lock granted (D59)", () => {
  running();
  fs.writeFileSync(path.join(wtB, "src", "new.ts"), "export const x = 1;\n");
  commit(wtB, "new");
  const out = cli(wtB, "merge-lock", "--onto", "main").split("\n");
  assert.deepEqual(out.filter((l) => l.startsWith("reconciled ")), ["reconciled 1 written without a claim: src/new.ts"]);
  assert.ok(out.some((l) => l.startsWith("granted: ")), out.join("\n"));
  // claimed: another member is now held on it
  assert.equal(swarm(wtA, "claim", "src/new.ts", "--new").status, 3);
});

test("merge-lock flags a committed file another member holds, mentioning both, and still grants the lock (D59)", () => {
  running();
  fs.writeFileSync(path.join(wtB, "src", "a.ts"), "// S3's\n");
  commit(wtB, "a");
  const r = JSON.parse(cli(wtB, "merge-lock", "--onto", "main", "--json"));
  assert.equal(r.granted, true);
  assert.deepEqual(r.reconciled, ["src/a.ts"]);
  assert.deepEqual(
    r.flags.map((f: { path: string; holder: string }) => [f.path, f.holder]),
    [["src/a.ts", "review-tool/S3"]],
  );
  const forS3 = JSON.parse(cli(wtA, "deliver", "--json"));
  const flag = forS3.full.find((m: { body: string }) => /flag:/.test(m.body));
  assert.ok(flag, JSON.stringify(forS3));
  assert.deepEqual([...flag.mentions].sort(), ["review-tool/S3", "review-tool/S5"]);
});

test("merge-lock claims both paths of a committed rename, and an uncommitted write beside it (D59)", () => {
  running();
  git(wtB, "mv", "src/old.ts", "src/renamed.ts");
  commit(wtB, "rename");
  fs.writeFileSync(path.join(wtB, "src", "wip.ts"), "export {};\n");
  const r = JSON.parse(cli(wtB, "merge-lock", "--onto", "main", "--json"));
  assert.equal(r.granted, true);
  assert.deepEqual([...r.reconciled].sort(), ["src/old.ts", "src/renamed.ts", "src/wip.ts"]);
  for (const f of ["src/old.ts", "src/renamed.ts", "src/wip.ts"]) assert.equal(swarm(wtA, "claim", f, "--new").status, 3, f);
});

test("merge-lock without --onto takes the branch the run was opened onto (D59, F3)", () => {
  running();
  const r = swarm(wtB, "merge-lock");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^granted: /m);
});

test("merge-lock onto a branch checked out in a worktree names the worktree, says what to do and grants nothing (validation finding 4)", () => {
  running();
  git(repo, "checkout", "-q", "main");
  const r = swarm(wtB, "merge-lock", "--onto", "main");
  assert.equal(r.status, 5, r.stderr);
  const lines = r.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 1, r.stdout);
  assert.match(lines[0], /^main is checked out at (.+): ask the orchestrator to detach it, then run merge-lock again$/);
  assert.equal(path.resolve(lines[0].match(/at (.+?): ask/)![1]), fs.realpathSync.native(repo));
  git(repo, "checkout", "-q", "--detach");
  assert.ok(cli(wtA, "merge-lock", "--onto", "main").includes("granted: "), "the refusal held no lock");
});

// Claims across runs (D26): global per repository; what crosses runs lands in main.
const crossRuns = async () => {
  const board = await openBoard(path.join(home, "cross.sqlite"));
  const REPO = "/repos/one/.git";
  const seats = [{ id: "S3", blockers: [] }];
  const a = board.openRun({ repo: REPO, group: "review-tool", title: "A", seats });
  const b = board.openRun({ repo: REPO, group: "swarm", title: "B", seats });
  const mine = board.join({ run: a.id, seat: "S3", doing: "page", files: [] }).member;
  const theirs = board.join({ run: b.id, seat: "S3", doing: "schema", files: [{ path: "src/x.ts", interface: true }] }).member;
  board.deliver(mine);
  board.deliver(theirs);
  return { board, mine, theirs };
};

test("across runs: the post that opens a held file keeps its author's run and opens it; the agreement reaches the claimer", async () => {
  const { board, mine, theirs } = await crossRuns();
  try {
    assert.equal(codeVerbs(board).checkEdit(mine, "src/x.ts").allowed, false);
    const ask = board.post(mine, "@swarm/S3 I add a helper to src/x.ts", { about: "src/x.ts" });
    assert.equal(ask.run, mine.run);
    assert.deepEqual(board.deliver(theirs).full.map((m) => m.seq), [ask.seq]);
    assert.equal(codeVerbs(board).checkEdit(mine, "src/x.ts").allowed, true);
    const agreed = board.post(theirs, "review-tool/S3 adds the helper at the end", { about: "src/x.ts", kind: "agreement" });
    assert.equal(agreed.run, theirs.run);
    assert.deepEqual(board.deliver(mine).full.map((m) => m.seq), [agreed.seq]);
  } finally {
    board.close();
  }
});

test("across runs: the answer line the holder gets carries no --main, and its agreement reaches the claimer before its reclaim (D12)", async () => {
  const { board, mine, theirs } = await crossRuns();
  try {
    assert.equal(codeVerbs(board).checkEdit(mine, "src/x.ts").allowed, false);
    board.post(mine, "@swarm/S3 I add a helper to src/x.ts", { about: "src/x.ts" }); // settles the claim (D7)
    const heard = board.deliver(theirs).full[0] as { answer?: string };
    assert.equal(heard.answer, 'answer with an agreement on who changes what: swarm agree "<who changes what in src/x.ts>" --about src/x.ts');
    const agreed = board.post(theirs, "review-tool/S3 adds the helper at the end", { about: "src/x.ts", kind: "agreement" });
    assert.deepEqual(board.deliver(mine).full.map((m) => m.seq), [agreed.seq]);
  } finally {
    board.close();
  }
});

test("across runs: a merge notice keeps the merger's run and reaches another run's holder in full", async () => {
  const { board, mine, theirs } = await crossRuns();
  try {
    board.post(mine, "@swarm/S3 I add a helper", { about: "src/x.ts" });
    assert.equal(codeVerbs(board).checkEdit(mine, "src/x.ts").allowed, true);
    board.deliver(theirs);
    assert.equal(codeVerbs(board).lockMerge(mine).granted, true);
    codeVerbs(board).merged(mine, "abc123", ["src/x.ts"]);
    const got = board.deliver(theirs).full;
    assert.equal(got.length, 1);
    assert.equal(got[0].run, mine.run);
    assert.match(got[0].body, /merged abc123/);
  } finally {
    board.close();
  }
});

// D6: a relative path from the current folder, else from the repository root; neither is refused unless --new.
test("from a subfolder: a root-relative path lands on the root file, a cwd-relative one on its file; the answer names it (D6)", () => {
  running();
  const sub = path.join(wtA, "src");
  assert.equal(answer(cli(sub, "claim", "src/old.ts")), "claimed src/old.ts\n");
  fs.writeFileSync(path.join(sub, "here.ts"), "export {};\n");
  assert.equal(answer(cli(sub, "claim", "here.ts")), "claimed src/here.ts\n");
});

test("a path that exists from neither folder exits 1 naming both tries; --new claims it from the current folder (D6)", () => {
  running();
  const sub = path.join(wtA, "src");
  const r = swarm(sub, "claim", "src/ghost.ts");
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes(path.join(sub, "src", "ghost.ts")) && r.stderr.includes(path.join(wtA, "src", "ghost.ts")), r.stderr);
  assert.match(r.stderr, /--new/);
  assert.equal(answer(cli(sub, "claim", "ghost.ts", "--new")), "claimed src/ghost.ts\n");
  assert.equal(swarm(wtA, "release", "src/nope.ts").status, 1, "release resolves the same way");
  assert.equal(swarm(sub, "post", "x", "--about", "src/nope.ts").status, 1, "so does --about");
});

test("after a held claim, the post about the path mentioning the holder claims it; the second claim still works (D7)", () => {
  running();
  assert.equal(swarm(wtB, "claim", "src/a.ts").status, 3);
  const out = cli(wtB, "post", "@S3 I add isExpired() at the end", "--about", "src/a.ts");
  assert.match(out, /^claimed src\/a\.ts, shared with review-tool\/S3$/m);
  assert.equal(swarm(wtB, "claim", "src/a.ts").status, 0);
});

test("a flag is posted once, whether merge-lock or end finds it; it is the flag event with its settle line (D8, D10)", async () => {
  running();
  fs.writeFileSync(path.join(wtB, "src", "a.ts"), "// S3's\n");
  commit(wtB, "a");
  assert.equal(JSON.parse(cli(wtB, "merge-lock", "--onto", "main", "--json")).flags.length, 1);
  assert.deepEqual(JSON.parse(cli(wtB, "end", "--seat", "S5", "--as", "review-tool/orchestrator", "--json")).flags, []);
  const heard = cli(wtA, "deliver");
  assert.match(heard, /settle it: .* agree "@review-tool\/S5 <who changes what>" --about src\/a\.ts/);
  const board = await openBoard(path.join(home, "swarm.sqlite"));
  try {
    const flags = board.snapshot(board.repos()[0].repo).events.filter((e) => /flag:/.test(e.body));
    assert.equal(flags.length, 1);
    assert.deepEqual([flags[0].kind, flags[0].event, flags[0].mentions], ["event", "flag", ["review-tool/S3", "review-tool/S5"]]);
  } finally {
    board.close();
  }
});

test("the merged event names the branch from merge-lock --onto and stores whom it told (D9, D11)", async () => {
  running();
  cli(wtB, "merge-lock", "--onto", "main");
  // V1: a sha git knows on main: main's own head stands in for the merge
  const sha = spawnSync("git", ["rev-parse", "--short", "main"], { cwd: wtB, encoding: "utf8" }).stdout.trim();
  cli(wtB, "merged", "--report", "-", sha, "--files", "src/a.ts");
  const board = await openBoard(path.join(home, "swarm.sqlite"));
  try {
    const merged = board.snapshot(board.repos()[0].repo).events.find((e) => e.event === "merged")!;
    assert.ok(merged.body.startsWith(`merged ${sha} into main: rebase your branch onto it.\n`), merged.body);
    // no rebase since the grant: conflicts known and empty, so nobody is told (D5)
    assert.deepEqual(merged.meta, { rebase: ["review-tool/S3"], tell: [] });
  } finally {
    board.close();
  }
});

test("join declares a file the seat will create: claimed from the repository root, another member held on it", () => {
  const slices = path.join(home, "slices.json");
  fs.writeFileSync(slices, SLICES);
  const id = cli(repo, "open", "--plan", "review-tool", "--title", "T", "--seats", slices).split("\n")[0].trim();
  cli(path.join(wtA, "src"), "join", "--run", id, "--seat", "S3", "--doing", "the page", "--files", "src/fresh.ts:interface");
  cli(wtB, "join", "--run", id, "--seat", "S5", "--doing", "the skill");
  assert.equal(swarm(wtB, "claim", "src/fresh.ts", "--new").status, 3);
});

test("merge-lock tells nothing of a file written under a claim", () => {
  running();
  cli(wtB, "claim", "src/mine.ts", "--new");
  fs.writeFileSync(path.join(wtB, "src", "mine.ts"), "export const y = 1;\n");
  commit(wtB, "mine");
  const out = cli(wtB, "merge-lock", "--onto", "main").split("\n");
  assert.deepEqual(out.filter((l) => l.startsWith("reconciled ")), []);
  assert.ok(out.some((l) => l.startsWith("granted: ")), out.join("\n"));
});

test("a mention of a member who has ended says so", () => {
  running();
  cli(wtB, "end", "--seat", "S5", "--as", "review-tool/orchestrator");
  const out = cli(wtA, "post", "@review-tool/S5 I resolved it");
  assert.match(out, /^@review-tool\/S5 has ended: the post stays on the thread, read at the seat's next join$/m);
});

test("a plan runs in phases: the orchestrator opens one, each member's done counts, all-done told", () => {
  running();
  cli(repo, "phase", "build", "every member: your seat, then done build", "--as", "review-tool/orchestrator");
  cli(wtA, "done", "build");
  cli(wtB, "done", "build");
  const told = cli(repo, "deliver", "--as", "review-tool/orchestrator");
  assert.match(told, /all.done/i, told);
});

test("a paused run refuses claim and merge-lock with exit 4, tells the member to wait; resume lets it claim again", () => {
  running();
  cli(repo, "pause", "hold on", "--as", "review-tool/orchestrator");
  const refused = swarm(wtA, "claim", "src/b.ts");
  assert.equal(refused.status, 4, refused.stderr);
  assert.match(refused.stdout, /^claim refused: run \d+ is paused: hold on\. Stop where you are: .*wait in the foreground for the resume \(it holds 170 s, as Claude Code detaches a foreground command that runs past 180 s; run it again when it returns empty\): node \S+ wait --mentions --as review-tool\/S3 --timeout 170000$/m);
  const lock = swarm(wtA, "merge-lock", "--onto", "main");
  assert.equal(lock.status, 4, lock.stderr);
  const roster = cli(wtA, "deliver");
  assert.match(roster, /PAUSED: hold on/);
  cli(repo, "resume", "go on", "--as", "review-tool/orchestrator");
  assert.match(cli(wtA, "claim", "src/a.ts"), /claimed src\/a\.ts/);
});

test("F3 (D2): merge-lock in a run opened --onto scratch takes scratch with no --onto flag", () => {
  git(repo, "branch", "scratch", "main");
  const slices = path.join(home, "slices.json");
  fs.writeFileSync(slices, SLICES);
  const id = cli(repo, "open", "--plan", "review-tool", "--title", "T", "--seats", slices, "--onto", "scratch").split("\n")[0].trim();
  cli(wtB, "join", "--run", id, "--seat", "S5", "--doing", "the skill");
  fs.writeFileSync(path.join(wtB, "src", "new.ts"), "export const x = 1;\n");
  commit(wtB, "new");
  // scratch checked out elsewhere: the refusal names the run's own branch, never main
  const wtS = path.join(home, "wt-s");
  git(repo, "worktree", "add", "-q", wtS, "scratch");
  const held = swarm(wtB, "merge-lock");
  assert.equal(held.status, 5, held.stderr);
  assert.match(held.stdout, /^scratch is checked out at /m);
  git(repo, "worktree", "remove", "--force", wtS);
  const granted = swarm(wtB, "merge-lock");
  assert.equal(granted.status, 0, granted.stderr);
  assert.match(granted.stdout, /^granted: /m);
  assert.doesNotMatch(granted.stdout + granted.stderr, /--onto is required|main/);
});
