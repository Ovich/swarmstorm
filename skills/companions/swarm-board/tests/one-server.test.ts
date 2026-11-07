// One board server per data home (swarm-relay D40): clients racing to start one start one, a live
// server of the client's version is used as it is, a stale state file is replaced by one new server.
// Each client is its own process, its server spawned from a launcher of the test's own temporary data
// home, so the `serve` processes counted are this test's alone, whatever else the suite runs.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serverStartLock, serverStateFile, type ServerState } from "../src/wire.ts";
import { stopServerOf } from "./fixtures/server.ts";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const LAUNCHER = "swarm-launcher.mjs";

let homes: string[] = [];
afterEach(() => {
  for (const h of homes) {
    stopServerOf(h);
    // a case that failed may have left more than one: none outlives it
    for (const pid of servesOf(path.join(h, LAUNCHER)))
      try {
        process.kill(pid);
      } catch {}
    try {
      fs.rmSync(h, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      console.warn(`cleanup: temp dir left behind: ${h}`);
    }
  }
  homes = [];
});

/** A temporary data home with its launcher (the CLI, under a path naming this home) and a client
 *  script: it connects to the board as a verb does and prints the runs it was answered. */
function freshHome(): { home: string; launcher: string; client: string } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-one-server-"));
  homes.push(home);
  const launcher = path.join(home, LAUNCHER);
  fs.writeFileSync(launcher, `import ${JSON.stringify(pathToFileURL(path.join(SRC, "cli", "index.ts")).href)};\n`);
  const client = path.join(home, "board-client.mjs");
  fs.writeFileSync(
    client,
    [
      `process.argv[1] = ${JSON.stringify(launcher)};`,
      `const { connectBoard } = await import(${JSON.stringify(pathToFileURL(path.join(SRC, "client", "remote.ts")).href)});`,
      `const board = await connectBoard({ dataRoot: process.env.SWARMSTORM_HOME });`,
      `console.log(JSON.stringify({ runs: await board.runs() }));`,
      `board.close();`,
    ].join("\n"),
  );
  return { home, launcher, client };
}

/** Outside a harness session, so the client calls the server straight (D39 is the other seat's). */
const clientEnv = (home: string): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...process.env, SWARMSTORM_HOME: home, SWARM_ROOT: home, SWARM_NO_POLLER: "1" };
  delete env.CLAUDE_CODE_SESSION_ID;
  return env;
};

/** One client's run: its exit code and what it printed. */
function runClient(home: string, client: string): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [client], { cwd: home, env: clientEnv(home), windowsHide: true });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("exit", (code) => resolve({ code, out, err }));
  });
}

/** The pids of the live `serve` processes spawned from `launcher`. */
function servesOf(launcher: string): number[] {
  const needle = path.basename(launcher);
  const listing =
    process.platform === "win32"
      ? spawnSync("powershell.exe", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process -Filter \"name='node.exe'\" | ForEach-Object { \"$($_.ProcessId) $($_.CommandLine)\" }"], { encoding: "utf8", windowsHide: true }).stdout
      : spawnSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" }).stdout;
  return listing
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.includes(path.dirname(launcher)) && l.includes(needle) && / serve\s*$/.test(l))
    .map((l) => Number(l.split(/\s+/)[0]));
}

/** `servesOf` once every serve that lost the start lock has had time to exit: a listing takes a second or
 *  more on Windows under a full suite's load, so the window allows several. */
async function settledServesOf(launcher: string, expected: number): Promise<number[]> {
  let pids = servesOf(launcher);
  for (const end = Date.now() + 20_000; pids.length !== expected && Date.now() < end; pids = servesOf(launcher)) await new Promise((r) => setTimeout(r, 200));
  return pids;
}

const stateOf = (home: string): ServerState => JSON.parse(fs.readFileSync(serverStateFile(home), "utf8")) as ServerState;

/** A pid no process holds: a node process started and gone. */
function deadPid(): number {
  const p = spawnSync(process.execPath, ["-e", "console.log(process.pid)"], { encoding: "utf8" });
  return Number(p.stdout.trim());
}

test("ten clients started at once on an empty data home leave exactly one serve process, and all ten get answers (D40)", async () => {
  const { home, launcher, client } = freshHome();
  const results = await Promise.all(Array.from({ length: 10 }, () => runClient(home, client)));
  for (const r of results) {
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(JSON.parse(r.out), { runs: [] });
  }
  const serves = await settledServesOf(launcher, 1);
  assert.deepEqual(serves, [stateOf(home).pid]);
});

test("a client finding a live server of its version starts none (D40)", async () => {
  const { home, launcher, client } = freshHome();
  assert.equal((await runClient(home, client)).code, 0);
  const first = stateOf(home).pid;
  const again = await runClient(home, client);
  assert.equal(again.code, 0, again.err);
  assert.equal(stateOf(home).pid, first);
  assert.deepEqual(await settledServesOf(launcher, 1), [first]);
});

test("a stale state file and start lock (a dead pid) are replaced by one new server (D40)", async () => {
  const { home, launcher, client } = freshHome();
  const dead = deadPid();
  fs.writeFileSync(serverStateFile(home), JSON.stringify({ pid: dead, port: 1, ticket: "x", version: "stale" }));
  fs.writeFileSync(serverStartLock(home), String(dead));
  const results = await Promise.all(Array.from({ length: 3 }, () => runClient(home, client)));
  for (const r of results) assert.equal(r.code, 0, r.err);
  const now = stateOf(home).pid;
  assert.notEqual(now, dead);
  assert.equal(fs.readFileSync(serverStartLock(home), "utf8").trim(), String(now));
  assert.deepEqual(await settledServesOf(launcher, 1), [now]);
});
