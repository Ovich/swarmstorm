import { test, beforeEach, afterEach } from "node:test";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBoard } from "../src/board/board.ts";
import { stopServerOf } from "./fixtures/server.ts";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "cli", "index.ts");

let toolRoot: string;
let repo: string;

// SWARM_ROOT = where the code would be; SWARMSTORM_HOME = where the data goes.
// The suite points both at one temp dir so a run leaves nothing in the real home.
const env = () => ({ ...process.env, SWARM_ROOT: toolRoot, SWARMSTORM_HOME: toolRoot, SWARM_NO_POLLER: "1" });

const runIn = (cwd: string, ...argv: string[]) => spawnSync(process.execPath, [CLI, ...argv], { cwd, encoding: "utf8", env: env() });
const run = (...argv: string[]) => runIn(repo, ...argv);

const git = (cwd: string, ...argv: string[]): void => {
  const r = spawnSync("git", argv, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
};

const SLICES = JSON.stringify([
  { id: "S3", title: "the page", blockers: [] },
  { id: "S5", title: "the skill", blockers: ["S3"] },
]);

const openRun = (plan = "review-tool", cwd = repo): number => {
  const slices = path.join(toolRoot, `${plan}.slices.json`);
  fs.writeFileSync(slices, SLICES);
  const r = runIn(cwd, "open", "--plan", plan, "--title", "A plan", "--slices", slices);
  assert.equal(r.status, 0, r.stderr);
  return Number(r.stdout.split("\n")[0].trim()); // the run id, then the board's URL when aiview registered it
};

beforeEach(() => {
  toolRoot = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-cli-"));
  repo = path.join(toolRoot, "repo");
  fs.mkdirSync(repo);
  git(repo, "init", "-q");
  // the files the tests claim and post about: a claim of a path that exists nowhere is refused (D6)
  for (const f of ["a", "b", "held", "holds", "mine", "nobody", "page", "x", "board/board"]) {
    fs.mkdirSync(path.dirname(path.join(repo, "src", `${f}.ts`)), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", `${f}.ts`), "export {};\n");
  }
  git(repo, "add", ".");
  git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "root");
});

afterEach(() => {
  stopServerOf(toolRoot);
  // Windows may briefly hold handles of a just-ended child; a leaked temp dir
  // must not fail the suite.
  for (let i = 0; ; i++) {
    try {
      fs.rmSync(toolRoot, { recursive: true, force: true });
      return;
    } catch {
      if (i >= 5) {
        console.warn(`cleanup: temp dir left behind: ${toolRoot}`);
        return;
      }
      spawnSync(process.execPath, ["-e", "setTimeout(()=>{},200)"]);
    }
  }
});

test("no verb prints usage and exits 1", () => {
  const r = run();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^usage: swarm <verb>/);
});

test("open then join prints the roster", () => {
  const id = openRun();
  assert.ok(id > 0);
  const r = run("join", "--run", String(id), "--slice", "S3", "--doing", "the page", "--file", "src/page.ts:interface", "--file", "src/a.ts");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /you are review-tool\/S3/);
  assert.match(r.stdout, /review-tool\/S3 {2}run \d+ {2}quiet {2}doing: the page {2}files: src\/page\.ts \(interface\), src\/a\.ts/);
  assert.match(r.stdout, /review-tool\/orchestrator/);
});

/** A stand-in for aiview's CLI: `status` answers project `p`, `board --repo` adds the repository to
 *  the project's board in `<toolRoot>/boards.json` and answers the /board link; every call's argv is logged. */
const fakeAiview = (): { launcher: string; log: string; boards: string } => {
  const launcher = path.join(toolRoot, "fake-aiview.mjs");
  const log = path.join(toolRoot, "aiview.log");
  const boards = path.join(toolRoot, "boards.json");
  fs.writeFileSync(boards, "{}");
  fs.writeFileSync(
    launcher,
    `import fs from "node:fs";
const argv = process.argv.slice(2).filter((a) => a !== "--json");
const [verb] = argv;
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + "\\n");
const file = ${JSON.stringify(boards)};
const all = JSON.parse(fs.readFileSync(file, "utf8"));
const flag = (n) => argv[argv.indexOf(n) + 1];
if (verb === "status") console.log(JSON.stringify({ cwdProject: "p" }));
else if (verb === "board") {
  const project = flag("--project");
  const repos = all[project] ?? [];
  if (!repos.includes(flag("--repo"))) repos.push(flag("--repo"));
  all[project] = repos;
  fs.writeFileSync(file, JSON.stringify(all));
  console.log(JSON.stringify({ project, repos, url: "http://localhost:4321/board" }));
}
else process.exit(1);
`,
  );
  return { launcher, log, boards };
};

const aiviewCalls = (log: string): string[][] => fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as string[]);
const boardRepos = (boards: string): string[] => (JSON.parse(fs.readFileSync(boards, "utf8")) as Record<string, string[]>).p ?? [];

const openWith = (aiview: string, cwd = repo) => {
  const slices = path.join(toolRoot, "s.json");
  fs.writeFileSync(slices, SLICES);
  return spawnSync(process.execPath, [CLI, "open", "--plan", "review-tool", "--title", "A plan", "--slices", slices, "--json"], {
    cwd,
    encoding: "utf8",
    env: { ...env(), SWARM_AIVIEW: aiview },
  });
};

test("open adds the run's repository to the project's board page and prints its link; no document is written", () => {
  const { launcher, log, boards } = fakeAiview();
  const r = openWith(launcher);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout) as { url: string; repo: string };
  assert.equal(out.url, "http://localhost:4321/board");
  assert.deepEqual(boardRepos(boards), [out.repo]);
  const calls = aiviewCalls(log);
  assert.deepEqual(calls.find((c) => c[0] === "board"), ["board", "--repo", out.repo, "--project", "p", "--json"]);
  assert.equal(calls.some((c) => c[0] === "open" || c[0] === "path"), false);
});

test("a second repository joins the same board once; reopening either adds nothing", () => {
  const { launcher, boards } = fakeAiview();
  const first = JSON.parse(openWith(launcher).stdout) as { url: string; repo: string };
  const other = path.join(toolRoot, "other");
  fs.mkdirSync(other);
  git(other, "init", "-q");
  git(other, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "root");
  const r = openWith(launcher, other);
  assert.equal(r.status, 0, r.stderr);
  const second = JSON.parse(r.stdout) as { url: string; repo: string };
  assert.notEqual(second.repo, first.repo);
  assert.equal(second.url, first.url);
  assert.equal(openWith(launcher, other).status, 0);
  assert.equal(openWith(launcher).status, 0);
  assert.deepEqual(boardRepos(boards), [first.repo, second.repo]);
});

test("open without aiview opens the run and exits 0, printing no URL and saying the board is read in aiview once installed (D13)", async () => {
  const r = openWith(path.join(toolRoot, "none.mjs"));
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout) as { run: number; url: string | null };
  assert.equal(out.url, null);
  assert.match(r.stderr, /aiview not found: the run is open; its board is read in aiview once aiview is installed/);
  assert.doesNotMatch(r.stderr + r.stdout, /https?:\/\//);
  const slices = path.join(toolRoot, "s.json");
  const text = runIn(repo, "open", "--plan", "other", "--title", "T", "--slices", slices);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /^\d+\nstart your link now, [^\n]* link --run \d+ --as other\/orchestrator\n$/, "the run id, then the link line alone");
  const board = await openBoard(path.join(toolRoot, "swarm.sqlite"));
  try {
    assert.deepEqual(board.runs().map((x) => x.id).sort(), [out.run, Number(text.stdout.split("\n")[0])].sort());
  } finally {
    board.close();
  }
  assert.equal(fs.existsSync(path.join(toolRoot, "swarm.pid")), false, "no server started");
  assert.equal(fs.existsSync(path.join(toolRoot, "swarm.port")), false, "no server started");
});

test("the roster shows a runner's funny name beside it; open keeps the links (D43, D44)", async () => {
  const slices = path.join(toolRoot, "linked.json");
  fs.writeFileSync(slices, JSON.stringify([{ id: "S3", title: "the page", blockers: [], link: "http://localhost:4321/d/7" }]));
  const opened = run("open", "--plan", "review-tool", "--title", "A plan", "--slices", slices, "--link", "http://localhost:4321/d/6", "--json");
  assert.equal(opened.status, 0, opened.stderr);
  const id = String(JSON.parse(opened.stdout).run);
  const joined = JSON.parse(run("join", "--run", id, "--slice", "S3", "--doing", "the page", "--json").stdout);
  assert.match(joined.nick, /^[A-Z][a-z]+ [A-Z][a-z]+$/);
  const roster = run("roster").stdout;
  assert.ok(roster.includes(`${joined.nick} · review-tool/S3  run ${id}`), roster);
  assert.match(roster, /^review-tool\/orchestrator {2}run/m);
  const board = await openBoard(path.join(toolRoot, "swarm.sqlite"));
  try {
    const r = board.runs()[0];
    assert.deepEqual([r.link, r.slices[0].link], ["http://localhost:4321/d/6", "http://localhost:4321/d/7"]);
  } finally {
    board.close();
  }
});

test("status --json lists each open run with its kind; the text names the kind (D58)", () => {
  const id = openRun();
  const s = JSON.parse(run("status", "--json").stdout);
  assert.equal(s.runs, 1);
  const nick = s.open[0]?.members[0]?.nick as string;
  assert.match(nick, /^[A-Z][a-z]+ [A-Z][a-z]+$/, "the orchestrator's funny name, given at open (D17)");
  assert.deepEqual(s.open, [{ run: id, kind: "plan", protocol: null, group: "review-tool", title: "A plan", phase: null, progress: null, members: [{ name: "review-tool/orchestrator", nick, worktree: null, state: "quiet", activity: null, progressAt: s.open[0].members[0].progressAt, aliveAt: null }], lastActivity: s.open[0].lastActivity, forgotten: false }]);
  assert.match(run("status").stdout, new RegExp(`run ${id}  plan  review-tool  A plan`));
});

test("--json on every verb parses", () => {
  const slices = path.join(toolRoot, "s.json");
  fs.writeFileSync(slices, SLICES);
  const opened = JSON.parse(run("open", "--plan", "review-tool", "--title", "T", "--slices", slices, "--json").stdout);
  assert.deepEqual(Object.keys(opened).sort(), ["group", "kind", "link", "plan", "repo", "run", "url"]);
  const id = String(opened.run);
  const as = ["--as", "review-tool/S3"];
  const verbs: string[][] = [
    ["join", "--run", id, "--slice", "S3", "--doing", "x"],
    ["join", "--run", id, "--slice", "S5", "--doing", "y"],
    ["doing", ...as, "still x"],
    ["post", ...as, "@S5 hello"],
    ["agree", ...as, "@S5 I go first", "--about", "src/a.ts"],
    ["claim", ...as, "src/b.ts"],
    ["read", "1"],
    ["deliver", "--as", "review-tool/S5"],
    ["wait", "--as", "review-tool/S5", "--timeout", "50"],
    ["roster"],
    ["slice", "S3", "--run", id, "--state", "running"],
    ["status"],
    ["end", ...as],
    ["close", "--run", id],
  ];
  for (const argv of verbs) {
    const r = run(...argv, "--json");
    assert.equal(r.status, 0, `${argv[0]}: ${r.stderr}`);
    assert.doesNotThrow(() => JSON.parse(r.stdout), `${argv[0]} printed ${r.stdout}`);
  }
});

test("an unknown run or runner is one line naming it, exit 1", () => {
  const r1 = run("join", "--run", "7", "--slice", "S3", "--doing", "x");
  assert.equal(r1.status, 1);
  assert.match(r1.stderr, /unknown run 7/);
  const r2 = run("post", "--as", "nope/S1", "hi");
  assert.equal(r2.status, 1);
  assert.match(r2.stderr, /unknown runner nope\/S1/);
});

test("wait in a child process wakes on a post from another", async () => {
  const id = String(openRun());
  run("join", "--run", id, "--slice", "S3", "--doing", "x");
  run("join", "--run", id, "--slice", "S5", "--doing", "y");
  run("deliver", "--as", "review-tool/S5");

  const child = spawn(process.execPath, [CLI, "wait", "--as", "review-tool/S5", "--timeout", "15000"], { cwd: repo, env: env() });
  let out = "";
  child.stdout.on("data", (b) => (out += b));
  const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));
  await new Promise((r) => setTimeout(r, 1500)); // the child is up and watching
  const posted = run("post", "--as", "review-tool/S3", "@S5 your turn");
  assert.equal(posted.status, 0, posted.stderr);
  const t0 = Date.now();
  const code = await exited;
  assert.equal(code, 0);
  assert.match(out, /review-tool\/S3[^\n]*\n@S5 your turn/);
  assert.ok(Date.now() - t0 < 5000, "wait did not wake on the post");
});

test("wait prints, before the message, the line that re-arms it with the exact command, --as included", () => {
  const id = String(openRun());
  run("join", "--run", id, "--slice", "S3", "--doing", "x");
  run("join", "--run", id, "--slice", "S5", "--doing", "y");
  run("deliver", "--as", "review-tool/S5");
  run("post", "--as", "review-tool/S3", "@S5 your turn");
  const r = run("wait", "--as", "review-tool/S5", "--mentions", "--timeout", "5000");
  assert.equal(r.status, 0, r.stderr);
  const [hint, ...message] = r.stdout.trimEnd().split("\n");
  const script = CLI.replace(/\\/g, "/");
  assert.equal(
    hint,
    `answer on the thread if needed, then start this listener again, in the background while you work, in the foreground when you are waiting: node ${script} wait --mentions --as review-tool/S5 --timeout 5000`,
  );
  assert.match(message.join("\n"), /review-tool\/S3[^\n]*\n@S5 your turn/);
  // the command it names runs as written: nothing more for S5, so it times out, silent
  const again = run("wait", "--as", "review-tool/S5", "--mentions", "--timeout", "50");
  assert.equal(again.status, 0, again.stderr);
  assert.equal(again.stdout, "");
});

const LISTEN = (runner: string): string =>
  `start your listener now, in the background (your harness's background task): node ${CLI.replace(/\\/g, "/")} wait --mentions --as ${runner}`;

const START_LINK = (member: string, run: string): string =>
  `start your link now, in the background (your harness's background task): node ${CLI.replace(/\\/g, "/")} link --run ${run} --as ${member}`;

test("join prints the link line, then the line that starts the listener, the exact command with --as, last; --json carries them as link then next (D61, D32, swarm-relay D33)", () => {
  const id = String(openRun());
  const r = run("join", "--run", id, "--slice", "S5", "--doing", "y");
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trimEnd().split("\n");
  // the agent starts its link before a wait could block it
  assert.equal(lines.at(-2), START_LINK("review-tool/S5", id));
  assert.equal(lines.at(-1), LISTEN("review-tool/S5"));
  assert.equal(lines.filter((l) => l.startsWith("start your listener")).length, 1);
  const json = JSON.parse(run("join", "--run", id, "--slice", "S3", "--doing", "x", "--json").stdout);
  assert.equal(json.next, LISTEN("review-tool/S3"));
  assert.equal(json.link, START_LINK("review-tool/S3", id));
  const keys = Object.keys(json);
  assert.ok(keys.indexOf("link") < keys.indexOf("next"), keys.join(","));
});

test("merged ends, for each merged path another runner holds or held, on the line that tells them; --json carries the lines as tell (D63)", () => {
  const id = String(openRun());
  run("join", "--run", id, "--slice", "S3", "--doing", "x");
  run("join", "--run", id, "--slice", "S5", "--doing", "y");
  const s3 = ["--as", "review-tool/S3"];
  const s5 = ["--as", "review-tool/S5"];
  for (const f of ["src/held.ts", "src/holds.ts"]) assert.equal(run("claim", ...s3, f).status, 0);
  assert.equal(run("release", ...s3, "src/held.ts").status, 0);
  assert.equal(run("claim", ...s5, "src/mine.ts").status, 0);

  const TELL = (f: string): string =>
    `if you resolved a conflict in ${f}, tell them: swarm post "@review-tool/S3 I resolved ${f}: <how>" --about ${f}`;
  const r = run("merged", ...s5, "abc123", "--files", "src/held.ts", "src/holds.ts", "src/mine.ts", "src/nobody.ts");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trimEnd().split("\n"), ["merged abc123: lock released", TELL("src/held.ts"), TELL("src/holds.ts")]);

  const j = JSON.parse(run("merged", ...s5, "def456", "--files", "src/held.ts", "--json").stdout);
  assert.deepEqual(j.tell, [TELL("src/held.ts")]);

  // a path nobody else held: the merge line alone
  assert.equal(run("merged", ...s5, "fed789", "--files", "src/mine.ts", "src/nobody.ts").stdout, "merged fed789: lock released\n");
});

test("claim, post and doing end on the listener line while no listener is pending, and not while one is (D61)", async () => {
  const id = String(openRun());
  run("join", "--run", id, "--slice", "S5", "--doing", "y");
  const as = ["--as", "review-tool/S5"];
  const unheard = [run("claim", ...as, "src/a.ts"), run("post", ...as, "hello"), run("doing", ...as, "the page")];
  for (const r of unheard) {
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.trimEnd().split("\n");
    assert.equal(lines.at(-1), LISTEN("review-tool/S5"), r.stdout);
    assert.equal(lines.length, 2, r.stdout); // the verb's own line, then the listener line, once
  }
  assert.equal(JSON.parse(run("post", ...as, "again", "--json").stdout).next, LISTEN("review-tool/S5"));

  const child = spawn(process.execPath, [CLI, "wait", "--mentions", ...as, "--timeout", "15000"], { cwd: repo, env: env() });
  const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));
  try {
    await new Promise((r) => setTimeout(r, 1500)); // the child is up and listening
    const claimed = run("claim", ...as, "src/b.ts");
    assert.equal(claimed.stdout, "claimed src/b.ts\n");
    const posted = run("post", ...as, "hello again");
    assert.match(posted.stdout, /^#\d+\n$/);
    assert.equal(JSON.parse(run("post", ...as, "once more", "--json").stdout).next, undefined);
  } finally {
    run("end", ...as); // releases the child's wait
    await exited;
  }
  // ended: no line
  assert.doesNotMatch(run("doing", ...as, "nothing").stdout, /start your listener/);
});

test("a mentions-only wait in a child process sleeps through a join and wakes on a mention", async () => {
  const id = String(openRun());
  run("join", "--run", id, "--slice", "S5", "--doing", "y");
  run("deliver", "--as", "review-tool/S5");
  const child = spawn(process.execPath, [CLI, "wait", "--mentions", "--as", "review-tool/S5", "--timeout", "15000"], { cwd: repo, env: env() });
  let out = "";
  child.stdout.on("data", (b) => (out += b));
  let exitedAt = 0;
  const exited = new Promise<number | null>((resolve) =>
    child.on("exit", (c) => {
      exitedAt = Date.now();
      resolve(c);
    }),
  );
  await new Promise((r) => setTimeout(r, 1500)); // the child is up and watching
  run("join", "--run", id, "--slice", "S3", "--doing", "x"); // a roster line: not a mention
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(exitedAt, 0, `a join line woke the listener: ${out}`);
  run("post", "--as", "review-tool/S3", "@S5 your turn");
  assert.equal(await exited, 0);
  assert.match(out, /^answer on the thread if needed[^\n]*wait --mentions --as review-tool\/S5 --timeout 15000\n/);
  assert.match(out, /@S5 your turn/);
  assert.doesNotMatch(out, /joined/);
});

test("a foreground wait supersedes the background listener in another process; the listener prints so, the wait gets the mention", async () => {
  const id = String(openRun());
  run("join", "--run", id, "--slice", "S3", "--doing", "x");
  run("join", "--run", id, "--slice", "S5", "--doing", "y");
  run("deliver", "--as", "review-tool/S5");
  const start = (...argv: string[]) => {
    const child = spawn(process.execPath, [CLI, "wait", "--mentions", "--as", "review-tool/S5", "--timeout", "15000", ...argv], { cwd: repo, env: env() });
    let out = "";
    child.stdout.on("data", (b) => (out += b));
    const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));
    return { exited, out: () => out };
  };
  const listener = start("--json");
  await new Promise((r) => setTimeout(r, 1500)); // the listener is up and watching
  const foreground = start();
  assert.equal(await listener.exited, 0);
  assert.deepEqual(JSON.parse(listener.out()), { full: [], lines: [], superseded: true });
  run("post", "--as", "review-tool/S3", "@S5 rebase onto abc");
  assert.equal(await foreground.exited, 0);
  assert.match(foreground.out(), /^answer on the thread if needed[^\n]*\n[^\n]*review-tool\/S3[^\n]*\n@S5 rebase onto abc/);
  // the human form, superseded by a short foreground wait
  const third = start();
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(run("wait", "--as", "review-tool/S5", "--timeout", "100").status, 0);
  assert.equal(await third.exited, 0);
  assert.equal(third.out(), "superseded by a newer wait\n");
});

test("end releases a runner's pending wait in another process", async () => {
  const id = String(openRun());
  run("join", "--run", id, "--slice", "S5", "--doing", "y");
  const child = spawn(process.execPath, [CLI, "wait", "--mentions", "--as", "review-tool/S5", "--timeout", "15000"], { cwd: repo, env: env() });
  let out = "";
  child.stdout.on("data", (b) => (out += b));
  const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));
  await new Promise((r) => setTimeout(r, 1500));
  const ended = run("end", "--as", "review-tool/S5");
  assert.equal(ended.status, 0, ended.stderr);
  const t0 = Date.now();
  assert.equal(await exited, 0);
  assert.ok(Date.now() - t0 < 5000, "end did not release the wait");
  assert.equal(out, "");
});

test("two worktrees of one repository share one thread", () => {
  const a = path.join(toolRoot, "wt-a");
  const b = path.join(toolRoot, "wt-b");
  git(repo, "worktree", "add", "-q", "-b", "a", a);
  git(repo, "worktree", "add", "-q", "-b", "b", b);
  const id = String(openRun());

  const ja = runIn(a, "join", "--run", id, "--slice", "S3", "--doing", "x", "--json");
  const jb = runIn(b, "join", "--run", id, "--slice", "S5", "--doing", "y", "--json");
  assert.equal(ja.status, 0, ja.stderr);
  assert.deepEqual(JSON.parse(jb.stdout).roster.map((r: { name: string }) => r.name).sort(), [
    "review-tool/S3",
    "review-tool/S5",
    "review-tool/orchestrator",
  ]);
  runIn(a, "deliver");

  // no --as: each worktree's runner is the one that joined from it (D28)
  const posted = runIn(b, "post", "@S3 from the other worktree");
  assert.equal(posted.status, 0, posted.stderr);
  const got = runIn(a, "deliver", "--json");
  assert.equal(got.status, 0, got.stderr);
  const d = JSON.parse(got.stdout);
  assert.equal(d.full.length, 1);
  assert.equal(d.full[0].from, "review-tool/S5");

  const rosters = [repo, a, b].map((cwd) => JSON.parse(runIn(cwd, "roster", "--json").stdout));
  assert.equal(new Set(rosters.map((r) => r.repo)).size, 1);
});

test("two runs of two plans on one repository share one thread and one roster", () => {
  const one = String(openRun("review-tool"));
  const two = String(openRun("swarm"));
  run("join", "--run", one, "--slice", "S3", "--doing", "x");
  run("join", "--run", two, "--slice", "S5", "--doing", "y");
  const roster = JSON.parse(run("roster", "--json").stdout).roster.map((r: { name: string }) => r.name);
  assert.ok(roster.includes("review-tool/S3") && roster.includes("swarm/S5"));
  run("deliver", "--as", "review-tool/S3");
  run("post", "--as", "swarm/S5", "@review-tool/S3 one thread");
  const d = JSON.parse(run("deliver", "--as", "review-tool/S3", "--json").stdout);
  assert.equal(d.full[0].body, "@review-tool/S3 one thread");
});

test("the launcher prints the build command when dist-cli is absent", () => {
  const fake = path.join(toolRoot, "tool");
  fs.mkdirSync(fake);
  const launcher = path.resolve(path.dirname(CLI), "..", "..", "swarm.mjs");
  fs.copyFileSync(launcher, path.join(fake, "swarm.mjs"));
  const r = spawnSync(process.execPath, [path.join(fake, "swarm.mjs"), "status"], { encoding: "utf8", env: env() });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not built\. Run: npm install && npm run build/);
});

test("the launcher has no hook verb: usage, exit 1, and the usage never names a hook (D58)", () => {
  const launcher = path.resolve(path.dirname(CLI), "..", "..", "swarm.mjs");
  assert.ok(fs.existsSync(path.join(path.dirname(launcher), "dist-cli", "cli.mjs")), "build first: npm run build");
  for (const kind of ["pre", "post"]) {
    const r = spawnSync(process.execPath, [launcher, "hook", kind], { cwd: repo, input: "{}", encoding: "utf8", env: env() });
    assert.equal(r.status, 1, kind);
    assert.match(r.stderr, /^usage: swarm <verb>/);
    assert.doesNotMatch(r.stderr, /hook/i);
    assert.equal(r.stdout, "");
  }
});

// ── serve is a hidden verb (swarm-relay D6); its server is tested in server.test.ts ─────────

test("--help lists no serve: the board server is a hidden verb", () => {
  for (const help of [run("--help"), run("--help", "code")]) assert.doesNotMatch(help.stdout, /serve/);
});

test("status has no server: the data home, the store and the open runs", () => {
  const empty = run("status", "--json");
  assert.equal(empty.status, 0, empty.stderr);
  assert.deepEqual(Object.keys(JSON.parse(empty.stdout)).sort(), ["home", "open", "runs", "sqlite"]);
  const id = openRun();
  const s = JSON.parse(run("status", "--json").stdout);
  assert.deepEqual(Object.keys(s).sort(), ["home", "open", "runs", "sqlite"]);
  assert.equal(s.home, toolRoot);
  assert.equal(s.runs, 1);
  const text = run("status").stdout;
  assert.match(text, new RegExp(`^run ${id} `, "m"));
  assert.doesNotMatch(text, /^page /m);
  assert.doesNotMatch(text, /serve|localhost/);
});

test("status flags a run idle a day with its close command, never a fresh one", () => {
  const id = openRun();
  const fresh = JSON.parse(run("status", "--json").stdout).open.find((o: { run: number }) => o.run === id);
  assert.equal(fresh.forgotten, false);
  assert.ok(fresh.lastActivity);
  assert.doesNotMatch(run("status").stdout, /no activity for/);
  const old = new Date(Date.now() - 2 * 86400000).toISOString();
  const db = new DatabaseSync(path.join(toolRoot, "swarm.sqlite"));
  db.prepare("UPDATE runs SET opened_at = ? WHERE id = ?").run(old, id);
  db.prepare("UPDATE participants SET joined_at = ?, last_call = NULL WHERE run = ?").run(old, id);
  db.prepare("UPDATE messages SET at = ? WHERE author IN (SELECT id FROM participants WHERE run = ?)").run(old, id);
  db.close();
  const stale = JSON.parse(run("status", "--json").stdout).open.find((o: { run: number }) => o.run === id);
  assert.equal(stale.forgotten, true);
  assert.match(run("status").stdout, new RegExp(`no activity for 2 d: .*close --run ${id}`));
});

// The retention setting (D32): read, set, refuse; prune uses what was set.
test("config retention prints 30, sets 7 that prune then uses, refuses 0", async () => {
  const read = run("config", "retention");
  assert.equal(read.status, 0, read.stderr);
  assert.equal(read.stdout.trim(), "30");
  const set = run("config", "retention", "7");
  assert.equal(set.status, 0, set.stderr);
  assert.equal(set.stdout.trim(), "7");
  assert.equal(run("config", "retention").stdout.trim(), "7");
  const refused = run("config", "retention", "0");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /positive whole number/);
  const board = await openBoard(path.join(toolRoot, "swarm.sqlite"));
  try {
    assert.equal(board.setting("retention-days"), 7);
    const r = board.openRun({ repo: "/repos/x/.git", group: "g", title: "T", seats: [] });
    board.closeRun(r.id);
    assert.equal(board.prune(new Date(Date.now() + 8 * 24 * 60 * 60 * 1000)).runs, 1);
  } finally {
    board.close();
  }
});

// ---- kinds: open, join, post, endorse, delivery, code verbs, help (SL2) ----

const SEATS = JSON.stringify([
  { id: "architect", title: "the architect", role: "designs", blockers: [] },
  { id: "skeptic", title: "the skeptic", role: "doubts", blockers: [] },
]);

const openBrainstorm = (group = "idea"): number => {
  const seats = path.join(toolRoot, `${group}.seats.json`);
  fs.writeFileSync(seats, SEATS);
  const r = run("open", "--kind", "brainstorm", "--group", group, "--title", "An idea", "--seats", seats);
  assert.equal(r.status, 0, r.stderr);
  return Number(r.stdout.split("\n")[0].trim());
};

const joinSeat = (id: number, seat: string, ...extra: string[]) => run("join", "--run", String(id), "--seat", seat, "--doing", "thinking", ...extra);
const seqOf = (out: string): string => out.match(/^#(\d+)/m)![1];

test("open --kind brainstorm --group --seats opens a brainstorm run; a seat's role is accepted", () => {
  const seats = path.join(toolRoot, "seats.json");
  fs.writeFileSync(seats, SEATS);
  const r = run("open", "--kind", "brainstorm", "--group", "idea", "--title", "An idea", "--seats", seats, "--json");
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.kind, "brainstorm");
  assert.equal(out.group, "idea");
  assert.equal(out.plan, "idea");
  assert.equal(JSON.parse(run("status", "--json").stdout).runs, 1);
});

test("open refuses an unknown kind, --plan with a brainstorm kind, and a missing group", () => {
  const seats = path.join(toolRoot, "seats.json");
  fs.writeFileSync(seats, SEATS);
  const nope = run("open", "--kind", "nope", "--group", "g", "--title", "t", "--seats", seats);
  assert.equal(nope.status, 1);
  assert.match(nope.stderr, /unknown kind nope: the kinds are plan, brainstorm, task/);
  const both = run("open", "--kind", "brainstorm", "--plan", "g", "--title", "t", "--seats", seats);
  assert.equal(both.status, 1);
  assert.match(both.stderr, /--plan means --kind plan/);
  const noGroup = run("open", "--kind", "brainstorm", "--title", "t", "--seats", seats);
  assert.equal(noGroup.status, 1);
  assert.match(noGroup.stderr, /--group <slug> is required/);
});

test("a seats file entry without an id is refused", () => {
  const seats = path.join(toolRoot, "bad.json");
  fs.writeFileSync(seats, JSON.stringify([{ title: "no id", role: "x" }]));
  const r = run("open", "--kind", "brainstorm", "--group", "g", "--title", "t", "--seats", seats);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /without an id/);
});

test("join --seat is --slice; both naming different ids exit 1 (D49)", () => {
  const id = openRun();
  const r = run("join", "--run", String(id), "--seat", "S3", "--doing", "the page");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /you are review-tool\/S3/);
  const both = run("join", "--run", String(id), "--seat", "S5", "--slice", "S3", "--doing", "x");
  assert.equal(both.status, 1);
  assert.match(both.stderr, /--seat S5 and --slice S3 name different members/);
});

test("a seat joining from the shared checkout is told its --as and its next commands, the listener before the link line", () => {
  const id = openBrainstorm();
  const r = joinSeat(id, "architect");
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trimEnd().split("\n");
  assert.match(lines[0], /^you are idea\/architect/);
  assert.ok(lines.includes("pass --as idea/architect on every call: this checkout is shared, the board cannot tell you apart"));
  for (const verb of ["post", "agree", "endorse", "wait --mentions"]) {
    assert.ok(lines.some((l) => l.includes(` ${verb} `) && l.includes("--as idea/architect")), `${verb} line with --as`);
  }
  assert.doesNotMatch(r.stdout, /--slice/);
  // a seat waits in the foreground, never a background listener
  assert.equal(lines.at(-2), START_LINK("idea/architect", String(id)));
  assert.match(lines.at(-1)!, /^wait now, in the foreground \(never a background listener.* wait --mentions --as idea\/architect$/);
  const json = JSON.parse(run("join", "--run", String(id), "--seat", "skeptic", "--doing", "doubting", "--json").stdout);
  assert.equal(json.as, "idea/skeptic");
  assert.equal(json.commands.length, 4);
  assert.ok(json.commands.every((c: string) => c.includes("--as idea/skeptic")));
});

test("every join tells the member its posts are markdown, before the link line: a seat and a runner alike", () => {
  const markdown = /^posts are markdown, rendered on the board: .*mermaid block; more than one line goes through post --file <path>$/;
  const lines = joinSeat(openBrainstorm(), "architect").stdout.trimEnd().split("\n");
  assert.match(lines.at(-3)!, markdown);
  const runner = run("join", "--run", String(openRun()), "--slice", "S3", "--doing", "x");
  assert.equal(runner.status, 0, runner.stderr);
  assert.ok(runner.stdout.split("\n").some((l) => markdown.test(l)), runner.stdout);
});

test("a seat's --files is refused by the board", () => {
  const id = openBrainstorm();
  const r = joinSeat(id, "architect", "--files", "src/x.ts");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /join: a brainstorm run has no claims/);
});

test("post, agree and endorse --main exit 2 naming the mention to use, writing nothing; a cross-run mention posts as any other (D12)", () => {
  const id = openBrainstorm();
  joinSeat(id, "architect");
  joinSeat(id, "skeptic");
  const agreed = run("agree", "we keep D3", "--about", "D3", "--as", "idea/architect");
  const before = run("read", seqOf(agreed.stdout));
  for (const argv of [
    ["post", "hello all", "--main"],
    ["agree", "we keep D4", "--about", "D4", "--main"],
    ["endorse", seqOf(agreed.stdout), "--main"],
  ]) {
    const r = run(...argv, "--as", "idea/skeptic");
    assert.equal(r.status, 2, argv[0]);
    assert.match(r.stderr, /there is no Main any more: the conversation is one; mention who you mean \(@IW, @IW·SL3, @swarm\)/);
  }
  assert.equal(before.status, 0);
  assert.equal(run("read", String(Number(seqOf(agreed.stdout)) + 1)).status, 1, "nothing was written");
  const inRun = run("post", "in the run", "--about", "D3", "--as", "idea/architect");
  assert.match(inRun.stdout, /^#\d+$/m);
  const other = openRun();
  run("join", "--run", String(other), "--slice", "S3", "--doing", "x");
  const cross = run("post", "@review-tool/S3 a question", "--as", "idea/architect");
  assert.equal(cross.status, 0, cross.stderr);
  assert.match(cross.stdout, /^#\d+$/m);
});

test("endorse backs an agreement and prints its seq; a plain post exits 1", () => {
  const id = openBrainstorm();
  joinSeat(id, "architect");
  joinSeat(id, "skeptic");
  const agreed = run("agree", "we keep D3 because it is simple", "--about", "D3", "--as", "idea/architect");
  const ok = run("endorse", `#${seqOf(agreed.stdout)}`, "--as", "idea/skeptic");
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /^#\d+/);
  const plain = run("post", "just a note", "--as", "idea/architect");
  const bad = run("endorse", seqOf(plain.stdout), "--as", "idea/skeptic");
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /is not an agreement/);
});

test("a seat's wait that receives an agreement prints the back-it line; a plan runner's does not", () => {
  const id = openBrainstorm();
  joinSeat(id, "architect");
  joinSeat(id, "skeptic");
  const agreed = run("agree", "@skeptic we keep D3", "--about", "D3", "--as", "idea/architect");
  const w = run("wait", "--mentions", "--timeout", "2000", "--as", "idea/skeptic");
  assert.equal(w.status, 0, w.stderr);
  assert.match(w.stdout, new RegExp(`back it: node \\S+ endorse ${seqOf(agreed.stdout)} --as idea/skeptic`));
  const plan = openRun();
  run("join", "--run", String(plan), "--slice", "S3", "--doing", "x");
  run("join", "--run", String(plan), "--slice", "S5", "--doing", "y");
  run("agree", "@S5 S3 owns the page", "--as", "review-tool/S3");
  const pw = run("wait", "--mentions", "--timeout", "2000", "--as", "review-tool/S5");
  assert.equal(pw.status, 0, pw.stderr);
  assert.match(pw.stdout, /S3 owns the page/);
  assert.doesNotMatch(pw.stdout, /back it:/);
});

test("the code verbs, called by a seat, exit 1 naming the kind", () => {
  const id = openBrainstorm();
  joinSeat(id, "architect");
  for (const argv of [["claim", "src/x.ts"], ["release", "src/x.ts"], ["merge-lock", "--onto", "main"], ["merged", "abc", "--files", "x"]]) {
    const r = run(...argv, "--as", "idea/architect");
    assert.equal(r.status, 1, argv.join(" "));
    assert.match(r.stderr, new RegExp(`${argv[0]}: a brainstorm run has no claims`));
  }
});

test("--help prints the core verbs, --help code the claim and merge verbs; no verb the core usage", () => {
  const core = run("--help");
  assert.equal(core.status, 0);
  for (const v of ["open", "join", "post", "agree", "endorse", "wait"]) assert.match(core.stdout, new RegExp(`^  ${v} `, "m"));
  for (const v of ["claim", "release", "merge-lock", "merged"]) assert.doesNotMatch(core.stdout, new RegExp(`^  ${v} `, "m"));
  assert.match(core.stdout.trimEnd().split("\n").at(-1)!, /^a member is <group>\/<seat>, the orchestrator <group>\/orchestrator/);
  const code = run("--help", "code");
  assert.equal(code.status, 0);
  for (const v of ["claim", "release", "merge-lock", "merged"]) assert.match(code.stdout, new RegExp(`^  ${v} `, "m"));
  const none = run();
  assert.equal(none.status, 1);
  assert.match(none.stderr, /^  endorse /m);
  assert.doesNotMatch(none.stderr, /^  claim /m);
});

// SL12: subscriptions (D59) and slices added mid-run (D60)
test("join --on with an unknown event exits 1 listing the known ones; --on stores both", () => {
  const id = openBrainstorm();
  const bad = joinSeat(id, "architect", "--on", "agreed");
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /unknown event agreed: the events are agreement, endorsement, merged, joined, ended, stale, quiet, back, opened, closed, urgent, phase, pause, resume, done, all-done, idle, stalled, recovered, gone, liveness, flag/);
  const ok = joinSeat(id, "architect", "--on", "agreement,any:merged");
  assert.equal(ok.status, 0, ok.stderr);
  const roster = run("roster");
  assert.match(roster.stdout, /idea\/architect .*on: agreement, any:merged/);
});

test("subscribe and unsubscribe print the member's subscriptions after", () => {
  const id = openBrainstorm();
  joinSeat(id, "architect");
  const s = run("subscribe", "agreement,any:merged", "--as", "idea/architect");
  assert.equal(s.status, 0, s.stderr);
  assert.match(s.stdout, /idea\/architect wakes on: agreement, any:merged/);
  const u = run("unsubscribe", "agreement", "--as", "idea/architect");
  assert.match(u.stdout, /wakes on: any:merged$/m);
  const bad = run("subscribe", "nope", "--as", "idea/architect");
  assert.equal(bad.status, 1);
});

test("a seat subscribed through its seats row wakes on an agreement with no mention, and the output carries back it", () => {
  const seats = path.join(toolRoot, "on.seats.json");
  fs.writeFileSync(seats, JSON.stringify([
    { id: "architect", title: "the architect", blockers: [] },
    { id: "skeptic", title: "the skeptic", blockers: [], on: ["agreement"] },
  ]));
  const r = run("open", "--kind", "brainstorm", "--group", "idea", "--title", "An idea", "--seats", seats);
  assert.equal(r.status, 0, r.stderr);
  const id = Number(r.stdout.split("\n")[0].trim());
  joinSeat(id, "architect");
  joinSeat(id, "skeptic");
  const agreed = run("agree", "we keep D3", "--about", "D3", "--as", "idea/architect");
  const w = run("wait", "--mentions", "--timeout", "3000", "--as", "idea/skeptic");
  assert.equal(w.status, 0, w.stderr);
  assert.match(w.stdout, new RegExp(`back it: node \\S+ endorse ${seqOf(agreed.stdout)} --as idea/skeptic`));
});

test("slice add adds a slice mid-run that can be joined; a duplicate id and a closed run exit 1", () => {
  const id = openRun();
  const a = run("slice", "add", "S7", "--run", String(id), "--title", "the late one", "--blockers", "S3");
  assert.equal(a.status, 0, a.stderr);
  assert.match(a.stdout, /^S7 added$/m);
  const j = run("join", "--run", String(id), "--slice", "S7", "--doing", "late");
  assert.equal(j.status, 0, j.stderr);
  const dup = run("slice", "add", "S7", "--run", String(id), "--title", "again");
  assert.equal(dup.status, 1);
  assert.match(dup.stderr, /already in run/);
  run("close", "--run", String(id));
  const closed = run("slice", "add", "S8", "--run", String(id), "--title", "x");
  assert.equal(closed.status, 1);
  assert.match(closed.stderr, /is closed/);
});

test("--help names --on, subscribe, unsubscribe, slice add and the known events", () => {
  const h = run("--help");
  for (const w of ["--on", "subscribe", "unsubscribe", "slice   add", "agreement, endorsement, merged"]) assert.ok(h.stdout.includes(w), w);
});

test("a mention naming nobody is told to its author, closest names offered; the message is unchanged (D63)", () => {
  const id = String(openRun());
  const s3 = JSON.parse(run("join", "--run", id, "--slice", "S3", "--doing", "the page", "--json").stdout);
  const nick = s3.nick.replace(/\s+/g, "");
  const r = run("post", "@S4 and @S3 and @orchestrator and @swarm and @RT and @all: the header", "--as", "review-tool/S3");
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.split("\n");
  assert.match(lines[0], /^#\d+/);
  assert.equal(lines[1], `@S4 matched nobody on the board: did you mean @review-tool/S3 or @${nick}, @review-tool/orchestrator?`);
  // @all names nobody now (D3): told so, @swarm offered
  assert.equal(lines[2], "@all matched nobody on the board: did you mean @swarm?");
  for (const fine of ["@S3", "@orchestrator", "@swarm", "@RT"]) assert.ok(!r.stdout.includes(`${fine} matched`), r.stdout);
  // a two-letter token naming no open run's code: the open codes offered
  const code = run("post", "@ZZ the header", "--as", "review-tool/S3");
  assert.match(code.stdout, /^@ZZ matched nobody on the board: did you mean @RT\?$/m);
  assert.equal(run("read", seqOf(r.stdout)).stdout.includes("@S4 and @S3"), true);
  const agreed = run("agree", "@Nobody owns it", "--as", "review-tool/S3", "--json");
  assert.equal(agreed.status, 0, agreed.stderr);
  assert.equal(JSON.parse(agreed.stdout).unmatched[0].startsWith("@Nobody matched nobody on the board"), true);
  const clean = JSON.parse(run("post", `@${nick} fine`, "--as", "review-tool/S3", "--json").stdout);
  assert.equal(clean.unmatched, undefined);
});

test("roster --json and status --json give each member's worktree, null for a seat (D64)", () => {
  const id = String(openRun());
  run("join", "--run", id, "--slice", "S3", "--doing", "the page");
  const roster = JSON.parse(run("roster", "--json").stdout).roster as { name: string; worktree: string | null }[];
  const s3 = roster.find((m) => m.name === "review-tool/S3")!;
  assert.ok(s3.worktree && fs.realpathSync(s3.worktree) === fs.realpathSync(repo), String(s3.worktree));
  const seat = openBrainstorm();
  assert.equal(joinSeat(seat, "skeptic").status, 0);
  const open = JSON.parse(run("status", "--json").stdout).open as { run: number; members: { name: string; worktree: string | null }[] }[];
  assert.ok(open.find((r) => r.run === Number(id))!.members.some((m) => m.name === "review-tool/S3" && m.worktree !== null));
  assert.ok(open.find((r) => r.run === seat)!.members.filter((m) => m.name.endsWith("/skeptic")).every((m) => m.worktree === null));
});

test("phase opens a phase: prints its seq, then the listener and the next phase to open, never an end; end is a name like any; a seat exits 1", () => {
  const seats = path.join(toolRoot, "seats.json");
  fs.writeFileSync(seats, SEATS);
  const id = Number(run("open", "--kind", "brainstorm", "--group", "idea", "--title", "An idea", "--seats", seats).stdout.split("\n")[0]);
  const first = JSON.parse(SEATS)[0].id as string;
  assert.equal(run("join", "--run", String(id), "--seat", first, "--doing", "x").status, 0);
  const r = run("phase", "diverge", "every", "idea", "--as", "idea/orchestrator");
  assert.equal(r.status, 0, r.stderr);
  const [seq, brief, next] = r.stdout.trim().split("\n");
  assert.match(seq, /^#\d+$/);
  // the person hears of every phase in the session they talk to (rule 10)
  assert.equal(brief, "brief the person: the list of what is done since the session began, one short phrase each, then what comes next");
  assert.match(next, /wait --mentions --as idea\/orchestrator.*open the next phase: .* phase <name> "<text>" --as idea\/orchestrator/);
  assert.match(next, new RegExp(`close --run ${id}`));
  assert.doesNotMatch(next, /end(s|ing)? (a|the|one) phase/);
  const named = run("phase", "end", "the board is written", "--as", "idea/orchestrator");
  assert.equal(named.status, 0, named.stderr);
  assert.match(named.stdout, /phase end is open/);
  const refused = run("phase", "x", "y", "--as", `idea/${first}`);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /only the orchestrator opens a phase/);
  const help = run("--help").stdout;
  assert.match(help, /^ {2}phase {3}<name> <text> \[--as <member>\] +# opens phase <name>; the current phase ends with it/m);
  assert.match(help, /^ {2}done {4}<phase> \[--as <member>\]/m);
  assert.doesNotMatch(help, /phase end /);
});

test("done: a member's done is counted, roster and status show n/m done, the last done tells the orchestrator every member is done; the answer says wait", () => {
  const seats = path.join(toolRoot, "seats.json");
  fs.writeFileSync(seats, SEATS);
  const id = Number(run("open", "--kind", "brainstorm", "--group", "idea", "--title", "An idea", "--seats", seats).stdout.split("\n")[0]);
  const [a, b] = (JSON.parse(SEATS) as { id: string }[]).map((s) => s.id);
  for (const s of [a, b]) assert.equal(run("join", "--run", String(id), "--seat", s, "--doing", "x").status, 0);
  assert.equal(run("done", "diverge", "--as", `idea/${a}`).status, 1, "no phase open yet");
  run("phase", "diverge", "every idea", "--as", "idea/orchestrator");
  run("deliver", "--as", "idea/orchestrator");
  const wrong = run("done", "converge", "--as", `idea/${a}`);
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /the current phase is diverge/);
  const first = run("done", "diverge", "--as", `idea/${a}`);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /^done diverge: 1\/2 members done$/m);
  assert.match(first.stdout, /wait for the next phase.* wait --mentions --as idea\//);
  assert.match(run("roster").stdout, new RegExp(`^run ${id} {2}An idea {2}phase diverge: every idea {2}1/2 done$`, "m"));
  assert.match(run("status").stdout, /phase diverge: every idea {2}1\/2 done/);
  const told = run("deliver", "--as", "idea/orchestrator").stdout;
  assert.match(told, /done diverge \(1\/2\)/);
  assert.doesNotMatch(told, /all done/);
  const last = JSON.parse(run("done", "diverge", "--as", `idea/${b}`, "--json").stdout);
  assert.deepEqual([last.done, last.of, last.all], [2, 2, true]);
  const all = run("deliver", "--as", "idea/orchestrator").stdout;
  assert.match(all, /all done diverge: every member is done \(2\/2\)/);
  assert.match(all, /open the next phase: .* phase <name> "<text>" --as idea\/orchestrator/);
  assert.equal(JSON.parse(run("status", "--json").stdout).open[0].progress.done, 2);
  assert.equal(run("done", "diverge", "--as", "idea/orchestrator").status, 1);
});

test("end on an ended member exits 0 and says nothing; on a closed run it prints the summary prompt the closed line promised, never a link line (S62)", () => {
  const id = openRun();
  assert.equal(run("join", "--run", String(id), "--slice", "S3", "--doing", "x").status, 0);
  assert.equal(run("end", "--as", "review-tool/S3").status, 0);
  const again = run("end", "--as", "review-tool/S3");
  assert.deepEqual([again.status, again.stdout, again.stderr], [0, "", ""]);
  assert.equal(run("join", "--run", String(id), "--slice", "S5", "--doing", "x").status, 0);
  run("close", "--run", String(id));
  const closed = run("end", "--as", "review-tool/S5");
  assert.deepEqual([closed.status, closed.stdout, closed.stderr], [0, `run ${id} closed: review-tool/S5 ended; return your summary now\n`, ""]);
  assert.doesNotMatch(closed.stdout + closed.stderr, /start your link now/);
});

test("once its run is closed, a member's wait, deliver, read, roster, post and done answer the one closed line, exit 0, and write nothing", () => {
  const id = openBrainstorm();
  assert.equal(joinSeat(id, "architect").status, 0);
  const seq = seqOf(run("post", "a thought", "--as", "idea/architect").stdout);
  run("close", "--run", String(id));
  const line = new RegExp(`^run ${id} closed: run end and return your summary: node .* end --as idea/architect$`);
  const calls = [
    ["wait", "--mentions", "--timeout", "5000"],
    ["wait", "--timeout", "5000"],
    ["deliver"],
    ["read", seq],
    ["roster"],
    ["post", "still here?"],
    ["agree", "terms"],
    ["done", "diverge"],
  ];
  for (const argv of calls) {
    const r = run(...argv, "--as", "idea/architect");
    assert.equal(r.status, 0, `${argv[0]}: ${r.stderr}`);
    assert.match(r.stdout.trimEnd(), line, argv.join(" "));
    assert.equal(r.stdout.trimEnd().split("\n").length, 1, argv.join(" "));
  }
  const json = JSON.parse(run("deliver", "--as", "idea/architect", "--json").stdout);
  assert.deepEqual([json.closed, json.run], [true, id]);
  // the refused post was never written
  for (const n of [1, 2, 3]) assert.doesNotMatch(run("read", String(Number(seq) + n)).stdout, /still here\?|terms/);
});

test("a wait pending when its run closes returns the closed line, exit 0", async () => {
  const id = openBrainstorm();
  assert.equal(joinSeat(id, "architect").status, 0);
  run("deliver", "--as", "idea/architect");
  const child = spawn(process.execPath, [CLI, "wait", "--mentions", "--as", "idea/architect", "--timeout", "15000"], { cwd: repo, env: env() });
  let out = "";
  child.stdout.on("data", (b) => (out += b));
  const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));
  await new Promise((r) => setTimeout(r, 1500)); // the child is up and listening
  run("close", "--run", String(id));
  assert.equal(await exited, 0);
  assert.match(out.trimEnd(), new RegExp(`^run ${id} closed: run end and return your summary: node .* end --as idea/architect$`));
});

test("how a member listens: a seat's wait re-arms in the foreground, the orchestrator's and a runner's in the background", () => {
  const id = openBrainstorm();
  assert.equal(joinSeat(id, "architect").status, 0);
  run("deliver", "--as", "idea/architect");
  run("deliver", "--as", "idea/orchestrator");
  run("post", "@architect a question", "--as", "idea/orchestrator");
  const seat = run("wait", "--mentions", "--as", "idea/architect", "--timeout", "3000").stdout;
  assert.match(seat, /then wait again, in the foreground: node .* wait --mentions --as idea\/architect/);
  assert.doesNotMatch(seat, /background/);
  run("post", "@orchestrator an answer", "--as", "idea/architect");
  const orch = run("wait", "--mentions", "--as", "idea/orchestrator", "--timeout", "3000").stdout;
  assert.match(orch, /start this listener again, in the background: node .* wait --mentions --as idea\/orchestrator/);
  const runner = run("join", "--run", String(openRun()), "--slice", "S3", "--doing", "x").stdout.trimEnd().split("\n");
  assert.match(runner.at(-1)!, /^start your listener now, in the background/);
});

test("open --transcript, slice --transcript and the seats file's transcript are refused as unknown, and the help names none (D24)", () => {
  const seats = path.join(toolRoot, "seats.json");
  fs.writeFileSync(seats, SEATS);
  const flagged = run("open", "--kind", "brainstorm", "--group", "idea", "--title", "I", "--seats", seats, "--transcript", "t.jsonl");
  assert.equal(flagged.status, 1);
  assert.match(flagged.stderr, /^open: unknown flag --transcript/);
  const named = path.join(toolRoot, "named.json");
  fs.writeFileSync(named, JSON.stringify([{ id: "a", title: "A", blockers: [], transcript: "t.jsonl" }]));
  const fielded = run("open", "--kind", "brainstorm", "--group", "idea", "--title", "I", "--seats", named);
  assert.equal(fielded.status, 1);
  assert.match(fielded.stderr, /unknown field transcript in a/);
  const id = String(openBrainstorm());
  const sliced = run("slice", "architect", "--run", id, "--state", "running", "--transcript", "t.jsonl");
  assert.equal(sliced.status, 1);
  assert.match(sliced.stderr, /^slice: unknown flag --transcript/);
  for (const help of [run("--help").stdout, run("--help", "code").stdout]) assert.doesNotMatch(help, /transcript/);
});

test("open starts no poller process, and the hidden poll verb is gone (US6, D13)", () => {
  const seats = path.join(toolRoot, "seats.json");
  fs.writeFileSync(seats, SEATS);
  const live = { ...env(), SWARM_NO_POLLER: "0" };
  const opened = spawnSync(process.execPath, [CLI, "open", "--kind", "brainstorm", "--group", "idea", "--title", "I", "--seats", seats], { cwd: repo, encoding: "utf8", env: live });
  assert.equal(opened.status, 0, opened.stderr);
  const id = Number(opened.stdout.split("\n")[0]);
  assert.ok(!fs.readdirSync(toolRoot).some((f) => f.startsWith("swarm-poll-")), "no poller pid file");
  const poll = spawnSync(process.execPath, [CLI, "poll", "--run", String(id)], { cwd: repo, encoding: "utf8", env: live, timeout: 20000 });
  assert.notEqual(poll.status, 0, "poll is no verb");
});

test("status and roster print each member's state, what it is doing, and its two ages, progressAt and aliveAt (D38)", () => {
  const id = openRun();
  const before = Date.now();
  assert.equal(run("join", "--run", String(id), "--slice", "S3", "--doing", "page").status, 0);
  // no activity yet from its link: no evidence of work, so quiet, nothing open (swarm-relay D33); never linked: link never
  assert.match(run("roster").stdout, /review-tool\/S3  run \d+  quiet  progress \d+s ago, link never  doing: page/);
  const roster = JSON.parse(run("roster", "--json").stdout).roster.find((r: { name: string }) => r.name === "review-tool/S3");
  assert.deepEqual([roster.state, roster.activity, roster.aliveAt], ["quiet", null, null]);
  assert.ok(roster.progressAt >= before - 1000 && roster.progressAt <= Date.now(), "progress counts from the join");
  assert.match(run("status").stdout, /^  review-tool\/S3  quiet  progress \d+s ago, link never$/m);
  const status = JSON.parse(run("status", "--json").stdout).open.find((r: { run: number }) => r.run === id);
  const s3 = status.members.find((m: { name: string }) => m.name === "review-tool/S3");
  assert.deepEqual([s3.state, s3.progressAt, s3.aliveAt], ["quiet", roster.progressAt, null]);
});

test("on a plan run too: the current phase heads wait, deliver and read, follows the roster at join, and sits beside the title in roster and status", () => {
  const id = openRun();
  const s3 = "review-tool/S3";
  assert.equal(run("join", "--run", String(id), "--slice", "S3", "--doing", "page").status, 0);
  // before any phase: no header
  run("post", "@S3 before", "--as", "review-tool/orchestrator");
  assert.doesNotMatch(run("deliver", "--as", s3).stdout, /^phase /m);
  assert.equal(JSON.parse(run("deliver", "--as", s3, "--json").stdout).phase, null);

  const r = run("phase", "build", "the", "first", "wave", "--as", "review-tool/orchestrator");
  assert.equal(r.status, 0, r.stderr);
  const header = "phase build: the first wave";
  const woken = run("wait", "--mentions", "--as", s3, "--timeout", "3000");
  assert.equal(woken.stdout.split("\n")[0], header);
  assert.match(woken.stdout, /phase build: the first wave/);

  const posted = run("post", "@S3 go", "--as", "review-tool/orchestrator");
  const delivered = run("deliver", "--as", s3).stdout.split("\n");
  assert.equal(delivered[0], header);
  assert.equal(run("read", seqOf(posted.stdout), "--as", s3).stdout.split("\n")[0], header);
  assert.equal(JSON.parse(run("read", seqOf(posted.stdout), "--as", s3, "--json").stdout).phase, header);

  const joined = run("join", "--run", String(id), "--slice", "S5", "--doing", "skill").stdout.split("\n");
  const lastRoster = joined.map((l) => / run \d+ {2}\w+ .*doing: /.test(l)).lastIndexOf(true);
  assert.equal(joined[lastRoster + 1], header);

  assert.match(run("roster").stdout, new RegExp(`^run ${id} {2}A plan {2}phase build: the first wave {2}0/2 done$`, "m"));
  assert.match(run("status").stdout, new RegExp(`run ${id} {2}plan {2}review-tool {2}A plan {2}phase build: the first wave {2}0/2 done`));
  assert.deepEqual(JSON.parse(run("status", "--json").stdout).open[0].phase, { name: "build", text: "the first wave" });
});

test("a member owing the open phase is told to do it before any wait: at join, after deliver, read, post and a wake; after done, the wait step again", () => {
  const id = openBrainstorm();
  // join before any phase: the wait step, nothing owed
  const early = joinSeat(id, "architect");
  assert.equal(early.status, 0, early.stderr);
  assert.doesNotMatch(early.stdout, /is open and asks/);
  assert.match(early.stdout.trimEnd().split("\n").at(-1)!, /^wait now, in the foreground .* wait --mentions --as idea\/architect$/);

  run("phase", "ping", "say", "hi", "--as", "idea/orchestrator");
  const owed = /^phase ping is open and asks: say hi\. Read the whole phase first: node \S+ thread --as idea\/skeptic\. Do your part now, then: node \S+ done ping --as idea\/skeptic$/m;
  // a late join: the do-it step, then only then the wait
  const late = joinSeat(id, "skeptic");
  assert.equal(late.status, 0, late.stderr);
  const lines = late.stdout.trimEnd().split("\n");
  assert.match(lines.at(-2)!, owed);
  assert.match(lines.at(-1)!, /^only then wait, in the foreground .* wait --mentions --as idea\/skeptic$/);
  assert.match(JSON.parse(run("deliver", "--as", "idea/skeptic", "--json").stdout).next, owed);
  const posted = run("post", "hello", "--as", "idea/skeptic");
  assert.match(posted.stdout, owed);
  assert.match(run("read", seqOf(posted.stdout), "--as", "idea/skeptic").stdout, owed);
  assert.match(run("deliver", "--as", "idea/skeptic").stdout, owed);
  // a member woken by the phase event is told to do it before it waits again
  const woken = run("wait", "--mentions", "--as", "idea/architect", "--timeout", "3000");
  assert.match(woken.stdout, /^phase ping is open and asks: say hi\. Read the whole phase first: node \S+ thread --as idea\/architect\. Do your part now, then: node \S+ done ping --as idea\/architect$/m);
  assert.match(woken.stdout, /^only then wait again, in the foreground: .* wait --mentions --as idea\/architect/m);

  // after done: the wait step, nothing owed
  assert.equal(run("done", "ping", "--as", "idea/skeptic").status, 0);
  const after = run("post", "again", "--as", "idea/skeptic");
  assert.doesNotMatch(after.stdout, /is open and asks/);
  assert.match(after.stdout.trimEnd().split("\n").at(-1)!, /^wait now, in the foreground .* wait --mentions --as idea\/skeptic$/);
  assert.equal(JSON.parse(run("deliver", "--as", "idea/skeptic", "--json").stdout).next, undefined);
  // the orchestrator never owes a phase
  assert.doesNotMatch(run("deliver", "--as", "idea/orchestrator").stdout, /is open and asks/);
});

test("post --file posts a long body read from a file, guillemets, tables and quotes intact", () => {
  const id = openBrainstorm();
  assert.equal(joinSeat(id, "architect").status, 0);
  const body = "| # | phrase |\n|---|---|\n| 1 | « l'IA propose », \"quoted\" & `ticked` |\n@orchestrator";
  const file = path.join(toolRoot, "post.md");
  fs.writeFileSync(file, `${body}\n`);
  const r = run("post", "--file", file, "--as", "idea/architect");
  assert.equal(r.status, 0, r.stderr);
  const read = run("read", seqOf(r.stdout));
  assert.ok(read.stdout.includes(body), read.stdout);
});

test("open --protocol names the run's protocol: status and the board snapshot carry it, null without; a bad name is refused", async () => {
  const slices = path.join(toolRoot, "p.json");
  fs.writeFileSync(slices, SLICES);
  const r = run("open", "--kind", "task", "--group", "tt", "--title", "T", "--seats", slices, "--protocol", "build-verify", "--json");
  assert.equal(r.status, 0, r.stderr);
  const id = JSON.parse(r.stdout).run as number;
  const plain = openRun("other");
  const s = JSON.parse(run("status", "--json").stdout) as { open: { run: number; protocol: string | null }[] };
  assert.equal(s.open.find((o) => o.run === id)?.protocol, "build-verify");
  assert.equal(s.open.find((o) => o.run === plain)?.protocol, null);
  const board = await openBoard(path.join(toolRoot, "swarm.sqlite"));
  try {
    const opened = board.runs().find((x) => x.id === id)!;
    assert.equal(opened.protocol, "build-verify");
    const summary = board.snapshot(opened.repo).runs.find((x) => x.run === id);
    assert.equal(summary?.protocol, "build-verify");
  } finally {
    board.close();
  }
  const bad = run("open", "--kind", "task", "--group", "tt2", "--title", "T", "--seats", slices, "--protocol", "Build Verify");
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /--protocol takes a name in lower case, digits and dashes/);
});
