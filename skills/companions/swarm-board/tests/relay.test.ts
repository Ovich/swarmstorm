// Every verb reaches the board through a link or the server (swarm-relay S13; D6, D16, D19, D27, D28,
// D29): two members in two processes, the server and the links started on demand, never twice, another
// version replaced, a server that cannot start named, a killed wait cleared. Under a temporary data home.
import { test, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import child_process, { spawn, spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectBoard } from "../src/client/remote.ts";
import { linkPipe } from "../src/link/link.ts";
import { bundleVersion, serverStateFile, type ServerState } from "../src/wire.ts";
import { makeRepo, openTwoRunners, type Repo } from "./fixtures/worktrees.ts";
import { stopServerOf } from "./fixtures/server.ts";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "cli", "index.ts");
// the in-process client spawns and versions as the CLI does: from the CLI's entry (D28)
process.argv[1] = CLI;

let repos: Repo[] = [];
const fresh = (): Repo => {
  const r = makeRepo("swarm-relay-");
  repos.push(r);
  return r;
};
afterEach(() => {
  mock.restoreAll();
  syncBuiltinESMExports();
  for (const r of repos) r.cleanup();
  repos = [];
});

const state = (home: string): ServerState | null => {
  try {
    return JSON.parse(fs.readFileSync(serverStateFile(home), "utf8")) as ServerState;
  } catch {
    return null;
  }
};
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const until = async (what: () => boolean, ms = 5000): Promise<boolean> => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (what()) return true;
  return what();
};
const answers = (pipe: string): Promise<boolean> =>
  new Promise((resolve) => {
    const s = net.createConnection(pipe);
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
  });

/** Every process the client spawns from here on, by its verb (`serve`, `link`). */
function countSpawns(): string[] {
  const verbs: string[] = [];
  const real = child_process.spawn;
  mock.method(child_process, "spawn", (cmd: string, argv: string[], opts: object) => {
    verbs.push(argv[argv.indexOf(CLI) + 1]);
    return real(cmd, argv, opts as never);
  });
  syncBuiltinESMExports();
  return verbs;
}

test("a post of A in one process wakes B's wait in another, through the server and both links", async () => {
  const r = fresh();
  openTwoRunners(r);
  const wait = spawn(process.execPath, [CLI, "wait", "--mentions", "--timeout", "20000"], { cwd: r.wtB, env: { ...process.env, SWARM_ROOT: r.home, SWARMSTORM_HOME: r.home } });
  let out = "";
  wait.stdout.on("data", (b) => (out += b));
  const exited = new Promise<number | null>((resolve) => wait.on("exit", resolve));
  await new Promise((res) => setTimeout(res, 1500)); // the wait is pending on its link
  r.cli(r.wtA, "post", "@S5 the page is in");
  assert.equal(await exited, 0);
  assert.match(out, /the page is in/);
  assert.match(out, /start this listener again/);
});

test("the server and a link are started when absent, a verb that finds no link answering spawning a detached one, and the second verb in a row starts nothing (D6, D32)", async () => {
  const r = fresh();
  const run = openTwoRunners(r);
  const member = { name: "review-tool/S3", run };
  stopServerOf(r.home);
  assert.ok(await until(() => state(r.home) === null || !alive(state(r.home)!.pid)), "serve stop stopped the server");
  await new Promise((res) => setTimeout(res, 500)); // its links see it go and exit
  const spawned = countSpawns();
  // no server, no link: both started
  const first = await connectBoard({ dataRoot: r.home, member });
  try {
    assert.equal((await first.participant(member.name))?.name, member.name);
  } finally {
    first.close();
  }
  assert.deepEqual(spawned.sort(), ["link", "serve"]);
  const pid = state(r.home)!.pid;
  // both running: nothing started
  const again = await connectBoard({ dataRoot: r.home, member });
  again.close();
  const anon = await connectBoard({ dataRoot: r.home });
  anon.close();
  assert.deepEqual(spawned, ["link", "serve"]);
  assert.equal(state(r.home)!.pid, pid);
});

test("open ends on the command that starts the member's link, join prints it before its listener line (swarm-relay D33); started from it, it answers the member's pipe, and the next verb starts no other (D32)", async () => {
  const r = fresh();
  const slices = path.join(r.home, "slices-link.json");
  fs.writeFileSync(slices, JSON.stringify([{ id: "S3", blockers: [] }]));
  const opened = r.cli(r.repo, "open", "--plan", "link-plan", "--title", "T", "--seats", slices).trimEnd().split(/\r?\n/);
  const run = Number(opened[0]);
  const linkLine = /^start your link now, in the background \(your harness's background task\): node (\S+) (link .*)$/;
  // idea 3: the link line, then the next step, last
  assert.match(opened.at(-1)!, /^next: /);
  assert.match(opened.at(-2)!, linkLine);
  assert.ok(opened.at(-2)!.endsWith(`link --run ${run} --as link-plan/orchestrator`), opened.at(-2)!);
  const joined = r.cli(r.wtA, "join", "--run", String(run), "--seat", "S3", "--doing", "x").trimEnd().split(/\r?\n/);
  const [, entry, verb] = joined.at(-2)!.match(linkLine)!;
  assert.equal(verb, `link --run ${run} --as link-plan/S3`);
  assert.match(joined.at(-1)!, /^start your listener now, in the background/);
  // no verb ran since join: no link of S3 yet
  assert.equal(await answers(linkPipe(r.home, run, "link-plan/S3")), false, "join spawns no link of its own");
  // the agent's background task
  const link = spawn(process.execPath, [entry, ...verb.split(" ")], { cwd: r.wtA, env: { ...process.env, SWARM_ROOT: r.home, SWARMSTORM_HOME: r.home }, stdio: "ignore" });
  const linkExited = new Promise((resolve) => link.on("exit", resolve));
  try {
    let answered = false;
    for (let i = 0; i < 100 && !answered; i++) {
      answered = await answers(linkPipe(r.home, run, "link-plan/S3"));
      if (!answered) await new Promise((res) => setTimeout(res, 50));
    }
    assert.ok(answered, "the started link answers the member's pipe");
    const spawned = countSpawns();
    const member = { name: "link-plan/S3", run };
    const b = await connectBoard({ dataRoot: r.home, member });
    try {
      assert.equal((await b.participant(member.name))?.name, member.name);
    } finally {
      b.close();
    }
    assert.deepEqual(spawned, [], "the next verb started no other link");
  } finally {
    link.kill();
    await linkExited;
    stopServerOf(r.home);
  }
});

test("a server of another version is stopped and replaced by the verb (D28)", async () => {
  const r = fresh();
  const old = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  const gone = new Promise((resolve) => old.on("exit", resolve));
  try {
    fs.writeFileSync(serverStateFile(r.home), JSON.stringify({ pid: old.pid, port: 1, secret: "x", version: "another" }));
    const out = r.cli(r.repo, "status");
    assert.match(out, /no open run/);
    await gone;
    const now = state(r.home)!;
    assert.equal(now.version, bundleVersion(CLI));
    assert.notEqual(now.pid, old.pid);
  } finally {
    old.kill();
  }
});

test("a server that cannot start makes the verb exit 1, naming swarm serve (D19)", () => {
  const r = fresh();
  // a data home that is a file: no store can open there
  const home = path.join(r.home, "not-a-folder");
  fs.writeFileSync(home, "");
  const s = spawnSync(process.execPath, [CLI, "status"], { cwd: r.repo, encoding: "utf8", env: { ...process.env, SWARM_ROOT: r.home, SWARMSTORM_HOME: home, SWARM_NO_POLLER: "1" } });
  assert.equal(s.status, 1);
  assert.match(s.stderr, /^swarm: the board server did not start: .+; run swarm serve to see it$/m);
});

test("a wait whose process is killed leaves the member not waiting (D16)", async () => {
  const r = fresh();
  openTwoRunners(r);
  const waiting = () => {
    const db = new DatabaseSync(r.store, { readOnly: true });
    try {
      return Number((db.prepare("SELECT waiting FROM participants WHERE slice = 'S5'").get() as { waiting: number }).waiting);
    } finally {
      db.close();
    }
  };
  const wait = spawn(process.execPath, [CLI, "wait", "--timeout", "20000"], { cwd: r.wtB, env: { ...process.env, SWARM_ROOT: r.home, SWARMSTORM_HOME: r.home } });
  const exited = new Promise((resolve) => wait.on("exit", resolve));
  assert.ok(await until(() => waiting() === 1), "the wait is pending");
  wait.kill();
  await exited;
  assert.ok(await until(() => waiting() === 0), "the killed wait was cancelled");
});

test("stopping the data home's server leaves no node process of it behind (D27)", async () => {
  const r = fresh();
  const run = openTwoRunners(r);
  const pid = state(r.home)!.pid;
  stopServerOf(r.home);
  assert.ok(await until(() => !alive(pid)), "the server exited");
  await new Promise((res) => setTimeout(res, 500));
  assert.equal(await answers(linkPipe(r.home, run, "review-tool/S3")), false, "its links exited with it");
});
