#!/usr/bin/env node
// board-split D55: one live scenario of the liveness model, on a scratch data home, with a real board server and real
// link processes, no harness. Each member is a CLI identity with its own fake Claude Code session (a transcript file
// its link reads). It plays, at once: a server restart with live members (their links reconnecting, D56), a link
// drop and reconnect within seconds, a phase opened and its task posted later, a long background test,
// park then the agent ends, a rejoin by a fresh agent; and one control, an agent truly gone. After LOST_MS and two
// ticks it checks that only the control is lost and that nobody is stalled.
//
//   node scripts/liveness-scenario.mjs [--cli <path to swarm.mjs>] [--keep]
//
// Exit 0: no false lost or stalled, and the control was told lost. The scratch home is removed unless --keep.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const argOf = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};
const CLI = path.resolve(argOf("--cli") ?? path.join(here, "..", "swarm.mjs"));
const KEEP = process.argv.includes("--keep");
const LOST_S = 60;
const GROUP = "liv";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-liveness-"));
const repo = path.join(home, "repo");
const transcripts = path.join(home, "transcripts", "project");
fs.mkdirSync(repo, { recursive: true });
fs.mkdirSync(transcripts, { recursive: true });
spawnSync("git", ["init", "-q", "-b", "main", repo]);
spawnSync("git", ["-C", repo, "-c", "user.name=s", "-c", "user.email=s@s", "commit", "-q", "--allow-empty", "-m", "root"]);

const log = (line) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`);
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
let sessions = 0;
/** One agent: its session, its transcript, its env. */
const agentFor = (member) => {
  const session = `5ce7a000-0000-4000-8000-${String(++sessions).padStart(12, "0")}`;
  const transcript = path.join(transcripts, `${session}.jsonl`);
  fs.writeFileSync(transcript, "");
  const env = { ...process.env, SWARMSTORM_HOME: home, SWARM_ROOT: home, CLAUDE_CODE_SESSION_ID: session, SWARM_TRANSCRIPTS_ROOT: path.dirname(transcripts) };
  return { member, session, transcript, env, link: null, linkArgv: null };
};
const swarm = (agent, ...args) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env: agent.env, encoding: "utf8", timeout: 60_000 });
  if (r.status !== 0) throw new Error(`swarm ${args.join(" ")}: ${r.stderr || r.stdout}`);
  return r.stdout;
};
const LINK_LINE = /start your link now[^:]*: .*?node (\S+) (link .*)$/m;
const startLink = (agent) => {
  agent.link = spawn(process.execPath, agent.linkArgv, { cwd: repo, env: agent.env, stdio: "ignore" });
  return agent.link;
};
const killLink = async (agent) => {
  if (!agent.link || agent.link.exitCode !== null) return;
  const gone = new Promise((r) => agent.link.once("exit", r));
  agent.link.kill();
  await gone;
};
/** One transcript line, as Claude Code writes them; the link reads it as growth. */
const write = (agent, line) => fs.appendFileSync(agent.transcript, JSON.stringify({ timestamp: new Date().toISOString(), ...line }) + "\n");
const toolUse = (agent, id, name, input) => write(agent, { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }], usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } });
const toolResult = (agent, id, text) => write(agent, { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: text }] } });

const seats = ["restart", "drop", "tasked", "background", "parked", "rejoin", "gone"];
const seatsFile = path.join(home, "seats.json");
fs.writeFileSync(seatsFile, JSON.stringify(seats.map((id) => ({ id, blockers: [] }))));

const orch = agentFor(`${GROUP}/orchestrator`);
const agents = Object.fromEntries(seats.map((s) => [s, agentFor(`${GROUP}/${s}`)]));
let failures = 0;
const check = (ok, what) => {
  log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
};

try {
  const opened = swarm(orch, "open", "--kind", "brainstorm", "--group", GROUP, "--title", "liveness scenario", "--seats", seatsFile);
  const run = opened.split(/\r?\n/)[0].trim();
  orch.linkArgv = (() => {
    const m = opened.match(LINK_LINE);
    return m ? [m[1], ...m[2].trim().split(" ")] : ["--", "noop"];
  })();
  if (opened.match(LINK_LINE)) startLink(orch);
  for (const [seat, agent] of Object.entries(agents)) {
    const joined = swarm(agent, "join", "--run", run, "--seat", seat, "--doing", "scenario", "--as", agent.member);
    const m = joined.match(LINK_LINE);
    if (!m) throw new Error(`join ${seat}: no link line in\n${joined}`);
    agent.linkArgv = [m[1], ...m[2].trim().split(" ")];
    startLink(agent);
    toolUse(agent, `t-${seat}-0`, "Read", { file_path: "x" });
    toolResult(agent, `t-${seat}-0`, "ok");
  }
  log(`run ${run} on ${home}, ${seats.length} seats joined, links up`);
  await sleep(5);

  // a long background test: a Bash run_in_background, moved to the background, not yet notified
  toolUse(agents.background, "bg-1", "Bash", { command: "npm test", run_in_background: true });
  toolResult(agents.background, "bg-1", "Command running in background with ID: bg1. Output is being written to: x");

  // the phase opens; the task to `tasked` is posted 15 s later
  swarm(orch, "phase", "p1", "go", "--for", "tasked", "--as", orch.member);

  // park, then that agent ends: its link goes, no call after
  swarm(orch, "park", "parked", "--as", orch.member);
  await killLink(agents.parked);

  // the control: an agent gone (its link killed, no call, no growth after)
  await killLink(agents.gone);

  // a link drop, back within seconds
  await killLink(agents.drop);
  await sleep(3);
  startLink(agents.drop);

  // a rejoin: the seat's member ended by the orchestrator, a fresh agent joins it
  await killLink(agents.rejoin);
  swarm(orch, "end", "--seat", "rejoin", "--as", orch.member);
  const fresh = agentFor(`${GROUP}/rejoin`);
  const rejoined = swarm(fresh, "join", "--run", run, "--seat", "rejoin", "--doing", "fresh", "--as", fresh.member);
  fresh.linkArgv = (() => {
    const m = rejoined.match(LINK_LINE);
    return [m[1], ...m[2].trim().split(" ")];
  })();
  startLink(fresh);
  agents.rejoin = fresh;

  await sleep(12);
  swarm(orch, "post", "@tasked your part of p1", "--task", "--as", orch.member);

  // the server restarts with live members: their links reconnect by themselves (plan D56)
  log("server restart");
  spawnSync(process.execPath, [CLI, "serve", "stop"], { cwd: repo, env: orch.env, encoding: "utf8" });
  swarm(orch, "status");
  const liveLinks = [orch, agents.restart, agents.drop, agents.tasked, agents.background, agents.rejoin];
  await sleep(3);
  check(liveLinks.every((a) => a.link && a.link.exitCode === null), "every live link outlived the restart");

  // members at work keep their transcripts growing now and then
  const working = [agents.restart, agents.drop, agents.tasked, agents.rejoin];
  for (let s = 0; s < LOST_S + 15; s += 10) {
    for (const a of working) {
      const id = `w-${a.session}-${s}`;
      toolUse(a, id, "Read", { file_path: "y" });
      toolResult(a, id, "ok");
    }
    await sleep(10);
  }

  const roster = JSON.parse(swarm(orch, "roster", "--json"));
  const entryOf = (seat) => (Array.isArray(roster) ? roster : roster.members ?? roster.roster ?? []).find((r) => r.name === `${GROUP}/${seat}`);
  // the alarms are events to the orchestrator: what it has been told, in full
  const thread = swarm(orch, "deliver", "--as", orch.member);
  const toldLost = (seat) => new RegExp(`lost ${GROUP}/${seat}\\b`).test(thread);
  const toldStalled = /stalled /.test(thread);
  for (const seat of ["restart", "drop", "tasked", "background", "rejoin"]) {
    const e = entryOf(seat);
    check(e && e.badge == null, `${seat}: no badge (${e?.state ?? "missing"}${e?.badge ? `, ${e.badge.name}: ${e.badge.reason}` : ""})`);
    check(!toldLost(seat), `${seat}: never told lost`);
  }
  const parked = entryOf("parked");
  check(parked && parked.badge == null && !toldLost("parked"), `parked: no badge, never told lost (${parked?.state ?? "missing"})`);
  const gone = entryOf("gone");
  check(gone?.badge?.name === "lost" && toldLost("gone"), `gone (control): lost and told (${gone?.badge?.name ?? "no badge"})`);
  check(!toldStalled, "nobody told stalled");
} catch (e) {
  failures++;
  log(`FAIL ${e.stack ?? e}`);
} finally {
  for (const a of [orch, ...Object.values(agents)]) if (a.link && a.link.exitCode === null) a.link.kill();
  spawnSync(process.execPath, [CLI, "serve", "stop"], { cwd: repo, env: orch.env });
  if (!KEEP) fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  else log(`kept ${home}`);
}
log(failures ? `${failures} failure(s)` : "scenario holds: no false lost or stalled");
process.exit(failures ? 1 : 0);
