// Inside a harness session a verb waits for the agent's own link and never spawns one (swarm-relay D39): one link
// runs, the agent's; none answering, the verb goes straight to the server and ends on the line that starts it; outside
// a session the detached fallback stays (D32); a member whose only link is killed reads gone, never stalled (D12, D36).
// Real server, real links, under a temporary data home.
import { test, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import child_process, { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectBoard } from "../src/client/remote.ts";
import { openRawStore } from "./fixtures/raw-store.ts";
import { linkPipe } from "../src/link/link.ts";
import { makeRepo, type Repo } from "./fixtures/worktrees.ts";
import { stopServerOf } from "./fixtures/server.ts";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "cli", "index.ts");
// the in-process client spawns and versions as the CLI does: from the CLI's entry (D28)
process.argv[1] = CLI;
const SESSION = "51515151-aaaa-bbbb-cccc-000000000051";
const LINK_LINE = /^start your link now, in the background \(your harness's background task\): node (\S+) (link .*)$/;

let repos: Repo[] = [];
let links: ChildProcess[] = [];
afterEach(async () => {
  mock.restoreAll();
  syncBuiltinESMExports();
  for (const l of links) if (l.exitCode === null) l.kill();
  links = [];
  for (const r of repos) {
    stopServerOf(r.home);
    r.cleanup();
  }
  repos = [];
});

/** A run with one member, S3, joined from inside a harness session: no verb has run for it since, no link of it yet. */
function joinedInHarness(): { r: Repo; run: number; member: { name: string; run: number }; env: NodeJS.ProcessEnv; linkArgv: string[] } {
  const r = makeRepo("swarm-harness-");
  repos.push(r);
  const transcripts = path.join(r.home, "transcripts");
  fs.mkdirSync(transcripts);
  const env = { ...process.env, SWARM_ROOT: r.home, SWARMSTORM_HOME: r.home, SWARM_NO_POLLER: "1", CLAUDE_CODE_SESSION_ID: SESSION, SWARM_TRANSCRIPTS_ROOT: transcripts };
  const slices = path.join(r.home, "slices-harness.json");
  fs.writeFileSync(slices, JSON.stringify([{ id: "S3", blockers: [] }]));
  const run = Number(r.cli(r.repo, "open", "--plan", "harness-plan", "--title", "T", "--seats", slices).split(/\r?\n/)[0]);
  const joined = spawnSync(process.execPath, [CLI, "join", "--run", String(run), "--seat", "S3", "--doing", "x"], { cwd: r.wtA, encoding: "utf8", env });
  assert.equal(joined.status, 0, joined.stderr);
  const [, entry, verb] = joined.stdout.trimEnd().split(/\r?\n/).at(-2)!.match(LINK_LINE)!;
  return { r, run, member: { name: "harness-plan/S3", run }, env, linkArgv: [entry, ...verb.split(" ")] };
}

/** The agent's own link, its background task. */
function startAgentLink(h: ReturnType<typeof joinedInHarness>): ChildProcess {
  const link = spawn(process.execPath, h.linkArgv, { cwd: h.r.wtA, env: h.env, stdio: "ignore" });
  links.push(link);
  return link;
}

const answers = (pipe: string): Promise<boolean> =>
  new Promise((resolve) => {
    const s = net.createConnection(pipe);
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
  });

/** Every `link` process the client spawns from here on. */
function countLinkSpawns(): string[] {
  const linksSpawned: string[] = [];
  const real = child_process.spawn;
  mock.method(child_process, "spawn", (cmd: string, argv: string[], opts: object) => {
    if (argv[argv.indexOf(CLI) + 1] === "link") linksSpawned.push(argv.join(" "));
    return real(cmd, argv, opts as never);
  });
  syncBuiltinESMExports();
  return linksSpawned;
}

test("in a harness session, join, the link started in the background, then a verb at once: one link runs, the agent's; none spawned detached (D39)", async () => {
  const h = joinedInHarness();
  const spawned = countLinkSpawns();
  const link = startAgentLink(h);
  // the verb at once, before the agent's link answers
  const b = await connectBoard({ dataRoot: h.r.home, member: h.member, harness: true });
  try {
    assert.equal(b.linkMissing, false, "the verb went through the agent's link");
    assert.equal((await b.participant(h.member.name))?.name, h.member.name);
  } finally {
    b.close();
  }
  assert.deepEqual(spawned, [], "no detached link spawned");
  // the agent's link would have exited 0 on a pipe taken by another (D37): it still runs, and answers
  assert.equal(link.exitCode, null, "the agent's link still runs");
  assert.equal(await answers(linkPipe(h.r.home, h.run, h.member.name)), true);
});

test("in a harness session with no link started, the verb answers within 10 s through the server, the link line before the listener line (D39, S29)", () => {
  const h = joinedInHarness();
  const started = Date.now();
  const r = spawnSync(process.execPath, [CLI, "doing", "the client"], { cwd: h.r.wtA, encoding: "utf8", env: h.env, timeout: 30000 });
  const took = Date.now() - started;
  assert.equal(r.status, 0, r.stderr);
  assert.ok(took < 12000, `answered in ${took} ms`); // 10 s of waiting, and a node start
  const lines = r.stdout.trimEnd().split(/\r?\n/);
  const linkAt = lines.findIndex((l) => LINK_LINE.test(l));
  assert.ok(linkAt >= 0, r.stdout);
  assert.ok(lines[linkAt].endsWith(`link --run ${h.run} --as harness-plan/S3`), lines[linkAt]);
  // S29: the link starts before the listener, as join orders them
  const listenerAt = lines.findIndex((l) => l.startsWith("start your listener now"));
  assert.ok(listenerAt === -1 || listenerAt > linkAt, r.stdout);
  // the call was made: the server has it
  assert.match(h.r.cli(h.r.repo, "roster"), /doing: the client/);
  // V11: told once per member, not on every call
  const again = spawnSync(process.execPath, [CLI, "doing", "still the client"], { cwd: h.r.wtA, encoding: "utf8", env: h.env, timeout: 30000 });
  assert.equal(again.status, 0, again.stderr);
  assert.doesNotMatch(again.stdout, /start your link now/);
});

test("in a harness session, on a closed run, no verb prints the link line: end prints the summary prompt the closed line promised (S62, validation 2)", () => {
  const h = joinedInHarness();
  h.r.cli(h.r.repo, "close", "--run", String(h.run));
  for (const argv of [["post", "still here?"], ["end"], ["end"]]) {
    // a closed run's member is named: its worktree no longer identifies it
    const r = spawnSync(process.execPath, [CLI, ...argv, "--as", h.member.name], { cwd: h.r.wtA, encoding: "utf8", env: h.env, timeout: 30000 });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout + r.stderr, /start your link now/, argv.join(" "));
    if (argv[0] === "end") assert.equal(r.stdout, `run ${h.run} closed: harness-plan/S3 ended; return your summary now (your link and listener background tasks end on their own, and their end notices are not news)\n`);
  }
});

test("outside a harness session, a verb finding no link spawns one detached, as before (D32)", async () => {
  const h = joinedInHarness();
  const spawned = countLinkSpawns();
  const b = await connectBoard({ dataRoot: h.r.home, member: h.member, harness: false });
  try {
    assert.equal(b.linkMissing, false);
    assert.equal((await b.participant(h.member.name))?.name, h.member.name);
  } finally {
    b.close();
  }
  assert.equal(spawned.length, 1, "one detached link");
});

test("a member whose only link is killed reads gone within 35 s and draws no stalled (D12, D36, D39)", { timeout: 60000 }, async () => {
  const h = joinedInHarness();
  const link = startAgentLink(h);
  const exited = new Promise((resolve) => link.on("exit", resolve));
  const verb = spawnSync(process.execPath, [CLI, "doing", "the client"], { cwd: h.r.wtA, encoding: "utf8", env: h.env, timeout: 30000 });
  assert.equal(verb.status, 0, verb.stderr);
  assert.doesNotMatch(verb.stdout, /start your link now/, "the verb went through the agent's link");
  link.kill();
  await exited;
  // the page's reading, straight to the server: no link of S3 is started by it. The gone event is waited for as itself
  // and timed on the server's own clock, from when it saw the link lost to the event's time: never by how fast this
  // loaded machine runs the test's reads (S31, T14)
  const reader = await connectBoard({ dataRoot: h.r.home });
  let gone: { at: string } | undefined;
  let state = "";
  let aliveAt: number | null = null;
  try {
    const repo = (await reader.participant(h.member.name))!.repo;
    for (const end = Date.now() + 55_000; !gone && Date.now() < end; await new Promise((res) => setTimeout(res, 250))) {
      gone = (await reader.snapshot(repo)).events.find((e) => e.event === "lost" && e.body.startsWith("lost harness-plan/S3"));
    }
    const entry = (await reader.roster(repo)).find((e) => e.name === h.member.name);
    state = entry?.badge?.name ?? "";
    // the server's own last sign of the link: when it saw it lost (or, past a restart, its start, D37)
    aliveAt = entry?.aliveAt ?? null;
  } finally {
    reader.close();
  }
  assert.ok(gone, "the server's tick posted lost harness-plan/S3");
  assert.equal(state, "lost");
  const db = openRawStore(path.join(h.r.home, "swarm.sqlite"), { readOnly: true });
  const lost = db.prepare("SELECT lost_at FROM member_links WHERE run = ? AND member = 'S3'").get(h.run) as { lost_at: number | null } | undefined;
  db.close();
  assert.ok(lost?.lost_at != null && aliveAt !== null, "the server recorded S3's link lost");
  const afterLoss = Date.parse(gone.at) - aliveAt;
  assert.ok(afterLoss >= 30_000 && afterLoss <= 35_000, `gone posted ${afterLoss} ms after the server's last sign of the link (stored lost_at ${lost.lost_at}, ${Date.parse(gone.at) - lost.lost_at} ms)`);
  assert.equal(await answers(linkPipe(h.r.home, h.run, h.member.name)), false, "no link of S3 came back");
  const told = h.r.cli(h.r.repo, "deliver", "--as", "harness-plan/orchestrator");
  assert.match(told, /lost harness-plan\/S3/);
  assert.doesNotMatch(told, /stalled/);
});
