#!/usr/bin/env node
// The board's load probe (board-fixes#D1): a board server on a scratch data home, 8 member links sending 200 mixed
// calls each, all at once. Prints how many calls were dropped (failed, or never answered) and how many took 10 s or
// more, then the server log's close and slow lines. Manual, never shipped, no suite runs it; exits 0 whatever it counts.
// Usage: node scripts/board-load.mjs [--links 8] [--calls 200]
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const flag = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? Number(process.argv[at + 1]) : fallback;
};
const LINKS = flag("--links", 8);
const CALLS_PER_LINK = flag("--calls", 200);
const SLOW_MS = 10_000;
const GIVE_UP_MS = 60_000;
const REPO = "/repos/board-load/.git";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const boardCli = path.join(repoRoot, "skills/companions/swarm-board/src/cli/index.ts");
const scratchHome = fs.mkdtempSync(path.join(os.tmpdir(), "board-load-"));

const server = spawn(process.execPath, [boardCli, "serve"], { env: { ...process.env, SWARMSTORM_HOME: scratchHome }, stdio: ["ignore", "pipe", "inherit"], windowsHide: true });
const url = await new Promise((resolve, reject) => {
  server.stdout.on("data", (chunk) => {
    const found = String(chunk).match(/ws:\/\/\S+/);
    if (found) resolve(found[0]);
  });
  server.on("exit", (code) => reject(new Error(`server exited ${code}`)));
});
const serverState = JSON.parse(fs.readFileSync(path.join(scratchHome, "swarm-server.json"), "utf8"));

/** One WebSocket to the server, welcomed: `call` answers with { ok, value | error, ms }, or { dropped } once it closes. */
async function connectAs(member) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 0;
  let welcomed;
  const welcome = new Promise((r) => (welcomed = r));
  socket.addEventListener("message", (e) => {
    const frame = JSON.parse(String(e.data));
    if (frame.type === "welcome" || frame.type === "refused") return welcomed(frame);
    if (frame.type !== "result") return;
    const waiting = pending.get(frame.id);
    pending.delete(frame.id);
    waiting?.(frame.ok ? { ok: true, value: frame.value } : { ok: false, error: frame.error });
  });
  socket.addEventListener("close", () => {
    for (const settle of pending.values()) settle({ dropped: "socket closed" });
    pending.clear();
  });
  await new Promise((r, j) => {
    socket.addEventListener("open", () => r());
    socket.addEventListener("error", () => j(new Error("no connection")));
  });
  socket.send(JSON.stringify({ type: "hello", version: serverState.version, secret: serverState.secret, ...(member ? { member, supersede: true } : {}) }));
  const greeting = await welcome;
  if (greeting.type !== "welcome") throw new Error(`refused: ${greeting.reason}`);
  const call = (method, ...args) => {
    const id = `p${++nextId}`;
    const started = Date.now();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ dropped: "no answer" });
      }, GIVE_UP_MS);
      pending.set(id, (outcome) => {
        clearTimeout(timer);
        resolve({ ...outcome, ms: Date.now() - started });
      });
      socket.send(JSON.stringify({ type: "call", id, method, args }));
    });
  };
  return { call, close: () => socket.close() };
}

const opener = await connectAs(null);
const seats = Array.from({ length: LINKS }, (_, i) => ({ id: `L${i + 1}`, blockers: [] }));
const run = (await opener.call("openRun", { repo: REPO, group: "load", title: "board load probe", seats })).value;
const members = [];
for (const seat of seats) {
  const joiner = await connectAs(null);
  members.push((await joiner.call("join", { run: run.id, seat: seat.id, doing: "load", files: [] })).value.member);
  joiner.close();
}
const links = await Promise.all(members.map((m) => connectAs({ name: m.name, run: run.id })));

/** The mix a working member sends: mostly reads, a post in five. */
const mixedCall = (link, member, n) => {
  switch (n % 5) {
    case 0: return link.call("post", member, `load ${n} from ${member.name}`);
    case 1: return link.call("roster", REPO);
    case 2: return link.call("participant", member.name);
    case 3: return link.call("currentPhase", run.id);
    default: return link.call("runs");
  }
};
const started = Date.now();
const outcomes = (await Promise.all(links.flatMap((link, i) => Array.from({ length: CALLS_PER_LINK }, (_, n) => mixedCall(link, members[i], n))))).flat();
const tookMs = Date.now() - started;

const dropped = outcomes.filter((o) => o.dropped || o.ok === false);
const slow = outcomes.filter((o) => (o.ms ?? 0) >= SLOW_MS);
console.log(`board-load: ${LINKS} links x ${CALLS_PER_LINK} calls = ${outcomes.length} calls in ${tookMs} ms`);
console.log(`dropped: ${dropped.length}${dropped.length ? ` (${[...new Set(dropped.map((o) => o.dropped ?? o.error))].join("; ")})` : ""}`);
console.log(`>= 10 s: ${slow.length}; slowest ${Math.max(...outcomes.map((o) => o.ms ?? 0))} ms`);

for (const link of links) link.close();
opener.close();
await new Promise((r) => setTimeout(r, 300));
const serverGone = new Promise((r) => server.once("exit", r));
server.kill();
await serverGone;
const logged = fs.readFileSync(path.join(scratchHome, "swarm-server.log"), "utf8").split(/\r?\n/).filter((l) => / (close|slow): /.test(l));
console.log(`server log (${scratchHome}): ${logged.length} close/slow line(s)`);
for (const line of logged) console.log(`  ${line}`);
try {
  fs.rmSync(scratchHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
} catch {
  console.log(`scratch home left: ${scratchHome}`);
}
process.exit(0);
