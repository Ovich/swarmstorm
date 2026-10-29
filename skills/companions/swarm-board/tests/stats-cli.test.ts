// `swarm stats`, the outside reader's verb (US3, US4; plan D6, D33, D34, D35, D40): the figures the page
// draws, read from the CLI's output alone. Runs older than the CLI's clock are opened in process on a
// fake Date first (the spawned CLI runs on the real clock), then read by the spawned CLI.
import { test, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { openBoard } from "../src/board/board.ts";
import { LINES, makeRepo, openTwoRunners, type Repo } from "./fixtures/worktrees.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

let repos: Repo[] = [];
const fresh = (): Repo => {
  const r = makeRepo("swarm-stats-");
  repos.push(r);
  return r;
};
afterEach(() => {
  mock.timers.reset();
  for (const r of repos) r.cleanup();
  repos = [];
});

const edit = (i: number, text: string): string[] => LINES.map((l, k) => (k === i ? text : l));
type Figures = { runs: { run: number; title: string; kind: string; members: { member: string; marks: { what: string; path?: string }[] }[]; plan?: { conflicts: unknown } }[]; scope: { repo: string } };
const statsJson = (r: Repo, ...argv: string[]): Figures => JSON.parse(r.cli(r.repo, "stats", ...argv, "--json"));
const titles = (r: Repo, ...argv: string[]): string[] => statsJson(r, ...argv).runs.map((x) => x.title);

/** Run A: S5 merges a conflict it resolved after the grant (known), then S3 merges on an old git (unknown). */
const runWithBothMerges = (r: Repo, afterKnown?: (id: number) => void): number => {
  const id = openTwoRunners(r, "review-tool", "A");
  r.commitFile(r.wtB, "src/a.ts", edit(0, "export const one = 'b';"));
  r.commitFile(r.repo, "src/a.ts", edit(0, "export const one = 'main';"));
  r.cli(r.wtB, "merge-lock", "--onto", "main");
  r.rebaseOntoMain(r.wtB, { "src/a.ts": edit(0, "export const one = 'both';") });
  r.cli(r.wtB, "merged", "--report", "-", r.git(r.wtB, "rev-parse", "HEAD").trim(), "--files", "src/a.ts");
  afterKnown?.(id);
  r.commitFile(r.wtA, "src/c.ts", edit(0, "export const one = 'a';"));
  for (const argv of [["merge-lock", "--onto", "main"], ["merged", "--report", "-", r.git(r.wtA, "rev-parse", "HEAD").trim(), "--files", "src/c.ts"]]) {
    const out = r.swarm(r.wtA, argv, { oldGit: true });
    assert.equal(out.status, 0, out.stderr);
  }
  return id;
};

/** The scene of the period cases: Old (plan, closed 40 days ago), Mid (plan, closed 20 days ago), A (plan, open, both
 *  merges), B (plan, closed today, no merge), Brain (brainstorm, open). Old and Mid predate the records. */
const scene = async (r: Repo, afterKnown?: (id: number) => void) => {
  const a = runWithBothMerges(r, afterKnown);
  const repo = statsJson(r).scope.repo;
  const seatsFile = path.join(r.home, "seats.json");
  fs.writeFileSync(seatsFile, JSON.stringify([{ id: "S1", blockers: [] }]));
  const b = Number(r.cli(r.repo, "open", "--plan", "billing", "--title", "B", "--seats", seatsFile).split("\n")[0].trim());
  r.cli(r.repo, "close", "--run", String(b));
  fs.writeFileSync(seatsFile, JSON.stringify([{ id: "skeptic", blockers: [] }]));
  const brain = Number(r.cli(r.repo, "open", "--kind", "brainstorm", "--group", "ideas", "--title", "Brain", "--seats", seatsFile).split("\n")[0].trim());
  // in process, on a fake Date: two runs older than the CLI's clock
  const now = Date.now();
  const board = await openBoard(r.store);
  let old: number;
  try {
    mock.timers.enable({ apis: ["Date"], now: now - 40 * DAY_MS });
    old = board.openRun({ repo, group: "legacy", title: "Old", seats: [{ id: "S1", blockers: [] }] }).id;
    mock.timers.setTime(now - 40 * DAY_MS + 2 * 60 * 60 * 1000);
    board.closeRun(old);
    mock.timers.setTime(now - 25 * DAY_MS);
    const mid = board.openRun({ repo, group: "middle", title: "Mid", seats: [{ id: "S1", blockers: [] }] }).id;
    mock.timers.setTime(now - 20 * DAY_MS);
    board.closeRun(mid);
  } finally {
    mock.timers.reset();
    board.close();
  }
  return { a, b, brain, old };
};

test("`stats --run <id> --json` names the conflicted file's merge under `plan.conflicts`, and an unknown merge under `unknownMerges`, never as 0 (US3, US4)", () => {
  const r = fresh();
  const id = runWithBothMerges(r);
  const run = statsJson(r, "--run", String(id)).runs[0];
  assert.deepEqual(run.plan!.conflicts, { known: 1, inShared: 1, unknownMerges: 1 });
  const s5 = run.members.find((m) => m.member === "review-tool/S5")!;
  assert.deepEqual(s5.marks.filter((m) => m.what === "conflict").map((m) => m.path), ["src/a.ts"]);
  const s3 = run.members.find((m) => m.member === "review-tool/S3")!;
  assert.deepEqual(s3.marks.filter((m) => m.what === "conflict"), [], "the unknown merge is no conflict counted");
});

const LENGTH = String.raw`(?:\d+h \d{2}m|\d+m|\d+s|—)`;
const line = (title: string, kind: string, state: string, conflicts: string): RegExp =>
  new RegExp(`^\\S+ ${title} · ${kind} · ${LENGTH} · ${state} · conflicts ${conflicts}$`);

test("the text line: `<code> <title> · <kind> · <length> · <open|closed> · conflicts <n|unknown>`, `conflicts —` with no merge, `<n> + <m> unknown`, then `swarm stats --json for every figure` (D34, D35)", async () => {
  const r = fresh();
  let knownOnly = "";
  await scene(r, (id) => {
    knownOnly = r.cli(r.repo, "stats", "--run", String(id));
  });
  const one = knownOnly.split(/\r?\n/).filter(Boolean);
  assert.equal(one.length, 2, knownOnly);
  assert.match(one[0], line("A", "plan", "open", "1"));
  assert.equal(one[1], "swarm stats --json for every figure");

  const lines = r.cli(r.repo, "stats", "--all").split(/\r?\n/).filter(Boolean);
  assert.equal(lines.length, 6, lines.join("\n"));
  assert.match(lines[0], line("Old", "plan", "closed", "unknown"));
  assert.match(lines[1], line("Mid", "plan", "closed", "unknown"));
  assert.match(lines[2], line("A", "plan", "open", "1 \\+ 1 unknown"));
  assert.match(lines[3], line("B", "plan", "closed", "—"));
  assert.match(lines[4], line("Brain", "brainstorm", "open", "—"));
  assert.equal(lines[5], "swarm stats --json for every figure");
});

test("`--since` defaults to 30d, `--all` keeps every run, `--closed` leaves open runs out, `--kind` narrows (D34)", async () => {
  const r = fresh();
  await scene(r);
  assert.deepEqual(titles(r), ["Mid", "A", "B", "Brain"]);
  assert.deepEqual(titles(r), titles(r, "--since", "30d"));
  assert.deepEqual(titles(r, "--since", "7d"), ["A", "B", "Brain"]);
  assert.deepEqual(titles(r, "--all"), ["Old", "Mid", "A", "B", "Brain"]);
  assert.deepEqual(titles(r, "--closed"), ["Mid", "B"]);
  assert.deepEqual(titles(r, "--all", "--closed"), ["Old", "Mid", "B"]);
  assert.deepEqual(titles(r, "--kind", "brainstorm"), ["Brain"]);
  assert.deepEqual(titles(r, "--all", "--kind", "plan"), ["Old", "Mid", "A", "B"]);
  assert.deepEqual(titles(r, "--all", "--kind", "plan,brainstorm"), ["Old", "Mid", "A", "B", "Brain"]);
});

test("`--since` with `--all`, an unknown run, an unknown kind or an unreadable `--since` exits 1 naming it", () => {
  const r = fresh();
  openTwoRunners(r);
  const cases: [string[], RegExp][] = [
    [["--since", "7d", "--all"], /--since or --all/],
    [["--run", "9999"], /no run 9999/],
    [["--kind", "debate"], /unknown kind debate/],
    [["--since", "yesterday"], /yesterday/],
  ];
  for (const [argv, names] of cases) {
    const out = r.swarm(r.repo, ["stats", ...argv]);
    assert.equal(out.status, 1, `${argv.join(" ")}: ${out.stdout}`);
    assert.match(out.stderr, names, argv.join(" "));
  }
});

test("`--run` applies no period: a run opened 40 days ago is read by `stats --run <id>`, and left out by `stats` (D40)", async () => {
  const r = fresh();
  const { old } = await scene(r);
  assert.deepEqual(statsJson(r, "--run", String(old)).runs.map((x) => [x.run, x.title]), [[old, "Old"]]);
  assert.match(r.cli(r.repo, "stats", "--run", String(old)).split(/\r?\n/)[0], line("Old", "plan", "closed", "unknown"));
  assert.ok(!titles(r).includes("Old"));
  assert.ok(!r.cli(r.repo, "stats").includes(" Old · "));
});

test("`stats` is absent from the members' USAGE, from `--help` and from `--help code`; `stats --help` prints its own (D6, D33)", () => {
  const r = fresh();
  const STATS = /\bstats\b/;
  const bare = r.swarm(r.repo, []);
  assert.equal(bare.status, 1);
  assert.match(bare.stderr, /^usage: (SWARMSTORM_HOME=[^ ]+ )?node [^ ]+ <verb>/);
  assert.doesNotMatch(bare.stderr, STATS);
  const help = r.swarm(r.repo, ["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^usage: (SWARMSTORM_HOME=[^ ]+ )?node [^ ]+ <verb>/);
  assert.doesNotMatch(help.stdout, STATS);
  const code = r.swarm(r.repo, ["--help", "code"]);
  assert.equal(code.status, 0);
  assert.match(code.stdout, /merge-lock/);
  assert.doesNotMatch(code.stdout, STATS);
  const own = r.swarm(r.repo, ["stats", "--help"]);
  assert.equal(own.status, 0);
  assert.match(own.stdout, /^usage: (SWARMSTORM_HOME=[^ ]+ )?node [^ ]+ stats /);
  assert.match(own.stdout, /--run <id>/);
});
