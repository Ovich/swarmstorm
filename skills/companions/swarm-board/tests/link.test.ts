// A member's link, at its pipe (swarm-relay D4, D7, D15, D16, D27, D30), against a stub board
// server written here: it speaks the plan's §3 frames over a bare WebSocket, so the test owns
// every answer, every drop and every refusal.
import { test, afterEach } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { linkPipe, runLink, type LinkStop, type LinkTiming } from "../src/link/link.ts";
import { bundleVersion, decode, encode, serverLogFile, serverStateFile, type Call, type Frame } from "../src/wire.ts";
import { bashCall, textLine, writeSubagent } from "./fixtures/transcripts.ts";

const MEMBER = "plan-x/S1";
const RUN = 68;
const FAST: Partial<LinkTiming> = { reconnectEveryMs: 50, reconnectGiveUpMs: 60_000, idleMs: 60 * 60_000, stateFileWaitMs: 500 };

/** A connection the stub accepted: the frames it got, and how to answer or drop it. */
type StubConnection = { frames: Frame[]; send(f: Frame): void; drop(): void };

/** A minimal WebSocket server: text frames, close, ping; enough for the link's client. */
async function stubServer(onFrame: (f: Frame, conn: StubConnection) => void = defaultAnswers) {
  const connections: StubConnection[] = [];
  const sockets = new Set<net.Socket>();
  const server = http.createServer();
  server.on("upgrade", (req, socket: net.Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    const accept = crypto.createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const sendRaw = (opcode: number, payload: Buffer) => {
      const len = payload.length;
      const head = len < 126 ? Buffer.from([0x80 | opcode, len]) : len < 65536 ? Buffer.from([0x80 | opcode, 126, len >> 8, len & 255]) : null;
      if (!head) throw new Error("frame too long for the stub");
      if (!socket.destroyed) socket.write(Buffer.concat([head, payload]));
    };
    const conn: StubConnection = { frames: [], send: (f) => sendRaw(1, Buffer.from(encode(f))), drop: () => socket.destroy() };
    connections.push(conn);
    let buf = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (buf.length < 2) return;
        const opcode = buf[0] & 15;
        let len = buf[1] & 127;
        let at = 2;
        if (len === 126) (len = buf.readUInt16BE(2), (at = 4));
        else if (len === 127) (len = Number(buf.readBigUInt64BE(2)), (at = 10));
        if (buf.length < at + 4 + len) return;
        const mask = buf.subarray(at, at + 4);
        const payload = Buffer.from(buf.subarray(at + 4, at + 4 + len)).map((b, i) => b ^ mask[i % 4]);
        buf = buf.subarray(at + 4 + len);
        if (opcode === 8) return void (sendRaw(8, Buffer.alloc(0)), socket.end());
        if (opcode === 9) sendRaw(10, Buffer.from(payload));
        if (opcode !== 1) continue;
        const f = decode(Buffer.from(payload).toString("utf8"));
        conn.frames.push(f);
        onFrame(f, conn);
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    connections,
    /** every frame of every connection, in order */
    frames: () => connections.flatMap((c) => c.frames),
    /** stops listening and cuts every connection: the server is gone */
    stop: () => new Promise<void>((r) => (server.close(() => r()), sockets.forEach((s) => s.destroy()))),
  };
}

/** Welcomes a hello; answers every call but a wait at once, with its method as the value. */
function defaultAnswers(f: Frame, conn: StubConnection) {
  if (f.type === "hello") conn.send({ type: "welcome", version: f.version });
  if (f.type === "call" && f.method !== "wait") conn.send({ type: "result", id: f.id, ok: true, value: f.method });
}

const homes: string[] = [];
const servers: { stop(): Promise<void> }[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.stop();
  for (const h of homes.splice(0)) fs.rmSync(h, { recursive: true, force: true });
});

function dataHome(port?: number): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-link-"));
  homes.push(home);
  if (port !== undefined) writeState(home, port);
  return home;
}
function writeState(home: string, port: number) {
  fs.writeFileSync(serverStateFile(home), JSON.stringify({ pid: process.pid, port, secret: "s3cret", version: bundleVersion() }));
}

/** A link with no session to search: it sends no activity. */
function startLink(home: string, timing: Partial<LinkTiming> = FAST, member = MEMBER) {
  return runLinkWith(home, {}, timing, member);
}
function runLinkWith(home: string, env: NodeJS.ProcessEnv, timing: Partial<LinkTiming> = FAST, member = MEMBER) {
  let exited = false;
  const done = runLink({ dataRoot: home, member, run: RUN, env, binding: { verb: "join", run: RUN, seat: "S1" }, timing }).then((stop) => {
    exited = true;
    return stop;
  });
  return { done, exited: () => exited };
}

/** A CLI's end of the pipe: lines it writes, results it reads. */
async function openPipe(home: string, member = MEMBER) {
  const pipePath = linkPipe(home, RUN, member);
  let socket: net.Socket | null = null;
  for (let i = 0; i < 100 && !socket; i++) {
    socket = await new Promise<net.Socket | null>((r) => {
      const s = net.connect(pipePath, () => r(s));
      s.once("error", () => r(null));
    });
    if (!socket) await pause(20);
  }
  assert.ok(socket, "the link's pipe never listened");
  const received: Frame[] = [];
  let buffered = "";
  socket.setEncoding("utf8");
  socket.on("data", (c: string) => {
    buffered += c;
    for (let nl = buffered.indexOf("\n"); nl >= 0; nl = buffered.indexOf("\n")) {
      received.push(decode(buffered.slice(0, nl)));
      buffered = buffered.slice(nl + 1);
    }
  });
  return { received, call: (c: Omit<Call, "type">) => socket!.write(encode({ type: "call", ...c }) + "\n"), close: () => socket!.destroy() };
}

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Every line written to stderr from here until `restore` (D42: a link says why it stops there). */
function captureStderr() {
  const lines: string[] = [];
  const write = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    lines.push(...String(chunk).split("\n").filter(Boolean));
    return (write as (...a: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stderr.write;
  return { lines, restore: () => void (process.stderr.write = write) };
}
const serverLogLines = (home: string): string[] => (fs.existsSync(serverLogFile(home)) ? fs.readFileSync(serverLogFile(home), "utf8").split("\n").filter(Boolean) : []);

/** Runs `body`, then checks the link said `line` once on stderr, and in the server's log or not (D42). */
async function saysWhy(line: RegExp, inServerLog: boolean, body: () => Promise<{ home: string; stop: LinkStop }>) {
  const stderr = captureStderr();
  let home: string;
  try {
    ({ home } = await body());
  } finally {
    stderr.restore();
  }
  assert.deepEqual(stderr.lines.filter((l) => l.startsWith("link ")).map((l) => line.test(l)), [true], `stderr: ${stderr.lines.join(" | ")}`);
  assert.deepEqual(serverLogLines(home).filter((l) => line.test(l)).length, inServerLog ? 1 : 0, `server log: ${serverLogLines(home).join(" | ")}`);
}

async function until(what: string, ok: () => boolean, ms = 3000) {
  for (const start = Date.now(); !ok(); await pause(10)) if (Date.now() - start > ms) assert.fail(`timed out: ${what}`);
}
const callsOf = (frames: Frame[], id: string) => frames.filter((f) => f.type === "call" && f.id === id);
const exitLink = async (server: { connections: StubConnection[] }, link: { done: Promise<LinkStop> }) => {
  server.connections.at(-1)!.send({ type: "refused", reason: "shutdown" });
  await link.done;
};

test("a call through the pipe reaches the server once and its result comes back; two pipes are not crossed", async () => {
  const server = await stubServer();
  servers.push(server);
  const home = dataHome(server.port);
  const link = startLink(home);
  const a = await openPipe(home);
  const b = await openPipe(home);
  a.call({ id: "a1", method: "roster", args: [] });
  b.call({ id: "b1", method: "post", args: ["hi"] });
  a.call({ id: "a2", method: "deliver", args: [] });
  await until("three results", () => a.received.length === 2 && b.received.length === 1);
  assert.deepEqual(a.received.map((f) => f.type === "result" && f.id), ["a1", "a2"]);
  assert.deepEqual(b.received, [{ type: "result", id: "b1", ok: true, value: "post" }]);
  for (const id of ["a1", "a2", "b1"]) assert.equal(callsOf(server.frames(), id).length, 1);
  await exitLink(server, link);
});

test("a wait pending on a pipe that closes is cancelled at the server (D16, D30)", async () => {
  const server = await stubServer();
  servers.push(server);
  const home = dataHome(server.port);
  const link = startLink(home);
  const cli = await openPipe(home);
  cli.call({ id: "w7", method: "wait", args: [] });
  await until("the wait reached the server", () => callsOf(server.frames(), "w7").length === 1);
  cli.close();
  await until("the cancel", () => server.frames().some((f) => f.type === "cancel" && f.id === "w7"));
  await exitLink(server, link);
});

for (const reason of ["secret", "version", "superseded", "shutdown", "closed"] as const) {
  test(`hello names the member with supersede; refused ${reason} makes the link exit (D15, D27, D30)`, async () => {
    const server = await stubServer((f, conn) => f.type === "hello" && conn.send({ type: "refused", reason }));
    servers.push(server);
    const said = reason === "closed" ? "run closed" : `refused ${reason}`;
    await saysWhy(new RegExp(`^link ${MEMBER}: ${said}$`), true, async () => {
      const home = dataHome(server.port);
      return { home, stop: await startLink(home).done };
    });
    const hello = server.frames()[0];
    assert.equal(hello.type, "hello");
    assert.deepEqual(hello.type === "hello" && [hello.member, hello.supersede, hello.secret], [{ name: MEMBER, run: RUN }, true, "s3cret"]);
  });
}

test("the server dropped and back: unanswered calls are resent, none answered twice to a pipe", async () => {
  let answering = false;
  const server = await stubServer((f, conn) => {
    if (f.type === "hello") conn.send({ type: "welcome", version: f.version });
    if (f.type === "call" && answering) {
      // the server answers from its cache, and once more for good measure: the pipe sees it once
      conn.send({ type: "result", id: f.id, ok: true, value: f.method });
      conn.send({ type: "result", id: f.id, ok: true, value: f.method });
    }
  });
  servers.push(server);
  const home = dataHome(server.port);
  const link = startLink(home);
  const cli = await openPipe(home);
  cli.call({ id: "w7", method: "wait", args: [] });
  cli.call({ id: "p3", method: "post", args: ["x"] });
  await until("both calls up", () => server.frames().filter((f) => f.type === "call").length === 2);
  answering = true;
  server.connections[0].drop();
  await until("a second connection resent both", () => server.connections.length === 2 && server.connections[1].frames.filter((f) => f.type === "call").length === 2);
  await until("both answers", () => cli.received.length === 2);
  await pause(100);
  assert.deepEqual(cli.received.map((f) => f.type === "result" && f.id).sort(), ["p3", "w7"]);
  await exitLink(server, link);
});

test("no server answers for the give-up time after a drop: the link exits (D27)", async () => {
  const server = await stubServer();
  const home = dataHome(server.port);
  await saysWhy(new RegExp(`^link ${MEMBER}: no server for \\d+ s$`), false, async () => {
    const link = startLink(home, { ...FAST, reconnectGiveUpMs: 300 });
    await openPipe(home);
    await until("connected", () => server.connections.length === 1);
    await server.stop();
    return { home, stop: await link.done };
  });
});

test("the member's end relayed: the link sends bye ended and exits (D15)", async () => {
  const server = await stubServer();
  servers.push(server);
  const home = dataHome(server.port);
  const link = startLink(home);
  const cli = await openPipe(home);
  await saysWhy(new RegExp(`^link ${MEMBER}: ended$`), true, async () => {
    cli.call({ id: "e1", method: "end", args: [] });
    return { home, stop: await link.done };
  });
  await until("the end's result", () => cli.received.length === 1);
  assert.deepEqual(cli.received, [{ type: "result", id: "e1", ok: true, value: "end" }]);
  await until("bye ended", () => server.frames().some((f) => f.type === "bye" && f.reason === "ended"));
});

test("no call on any pipe for the idle time: the link exits (D15)", async () => {
  const server = await stubServer();
  servers.push(server);
  const home = dataHome(server.port);
  const link = startLink(home, { ...FAST, idleMs: 300 });
  const cli = await openPipe(home);
  await saysWhy(new RegExp(`^link ${MEMBER}: idle$`), true, async () => {
    cli.call({ id: "r1", method: "roster", args: [] });
    await pause(150);
    assert.equal(link.exited(), false);
    return { home, stop: await link.done };
  });
  await until("bye idle", () => server.frames().some((f) => f.type === "bye" && f.reason === "idle"));
});

test("pipe names differ by data home; a second link of the same member exits at once (D7)", async () => {
  assert.notEqual(linkPipe("/home/one", RUN, MEMBER), linkPipe("/home/two", RUN, MEMBER));
  assert.equal(linkPipe("/home/one", RUN, MEMBER), linkPipe("/home/one", RUN, MEMBER));
  const server = await stubServer();
  servers.push(server);
  const home = dataHome(server.port);
  const first = startLink(home);
  await openPipe(home);
  await until("connected", () => server.connections.length === 1);
  await saysWhy(new RegExp(`^link ${MEMBER}: pipe taken$`), false, async () => ({ home, stop: await startLink(home).done }));
  assert.equal(first.exited(), false);
  await exitLink(server, first);
});

test("a member's link started twice as the CLI: one runs, the second exits 0, saying pipe taken on stderr alone (D37, D42)", { timeout: 30000 }, async () => {
  const server = await stubServer();
  servers.push(server);
  const home = dataHome(server.port);
  const first = startLink(home);
  await openPipe(home);
  await until("connected", () => server.connections.length === 1);
  const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "cli", "index.ts");
  const second = spawnSync(process.execPath, [cli, "link", "--as", MEMBER, "--run", String(RUN)], {
    encoding: "utf8",
    timeout: 20000,
    env: { ...process.env, SWARMSTORM_HOME: home, SWARM_ROOT: home, CLAUDE_CODE_SESSION_ID: "" },
  });
  assert.deepEqual([second.status, second.stdout, second.stderr.trim()], [0, "", `link ${MEMBER}: pipe taken`]);
  assert.equal(serverLogLines(home).length, 0, "pipe taken is never in the server's log");
  assert.equal(server.connections.length, 1, "the second link never reached the server");
  assert.equal(first.exited(), false, "the first link still runs");
  await exitLink(server, first);
});

test("no server state file: the link gives up after its wait, naming the data home", async () => {
  const home = dataHome();
  await assert.rejects(startLink(home, { ...FAST, stateFileWaitMs: 200 }).done, (e: Error) => e.message.includes(home));
});

// ── activity (swarm-relay S22: D8, D10, D15), from fixture sessions under SWARM_TRANSCRIPTS_ROOT ──

const SESSION = "33333333-aaaa-bbbb-cccc-000000000003";
const PROJECT = "C--repos-link";
const JOIN_COMMAND = `node C:/x/swarm.mjs join --run ${RUN} --seat S1 --doing "start"`;

/** A fixture session root, and the environment a link of that session sees. */
function sessionRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-link-session-"));
  homes.push(root);
  return { root, env: { CLAUDE_CODE_SESSION_ID: SESSION, SWARM_TRANSCRIPTS_ROOT: root } as NodeJS.ProcessEnv };
}
const usage = (n: number) => ({ input_tokens: n, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 });
const activities = (frames: Frame[]) => frames.filter((f): f is Extract<Frame, { type: "activity" }> => f.type === "activity");

/** Records when each frame arrived, answering as the default stub does. */
function timedAnswers(arrivals: { f: Frame; at: number }[]) {
  return (f: Frame, conn: StubConnection) => {
    arrivals.push({ f, at: Date.now() });
    defaultAnswers(f, conn);
  };
}

test("a link whose session holds its member's join sends a first activity within 2 s of the join being written, locate retried each second (US1, D8)", async () => {
  const arrivals: { f: Frame; at: number }[] = [];
  const server = await stubServer(timedAnswers(arrivals));
  servers.push(server);
  const { root, env } = sessionRoot();
  const link = runLinkWith(dataHome(server.port), env, { ...FAST, watchEveryMs: 1000, activityGapMs: 3000 });
  await pause(1200); // the link has looked, and found nothing
  assert.equal(activities(server.frames()).length, 0);
  const writtenAt = Date.now();
  writeSubagent(root, PROJECT, SESSION, "a1", [bashCall(JOIN_COMMAND)], {});
  await until("a first activity", () => activities(server.frames()).length > 0, 2500);
  const first = arrivals.find((a) => a.f.type === "activity")!;
  assert.ok(first.at - writtenAt <= 2000, `${first.at - writtenAt} ms after the join was written`);
  await exitLink(server, link);
});

test("activity is sent only on change, never more than one per gap (D10)", async () => {
  const arrivals: { f: Frame; at: number }[] = [];
  const server = await stubServer(timedAnswers(arrivals));
  servers.push(server);
  const { root, env } = sessionRoot();
  const file = writeSubagent(root, PROJECT, SESSION, "a1", [bashCall(JOIN_COMMAND)], {});
  const link = runLinkWith(dataHome(server.port), env, { ...FAST, watchEveryMs: 20, activityGapMs: 300 });
  await until("a first activity", () => activities(server.frames()).length === 1);
  // growing every 20 ms for a second: never more than one per 300 ms
  for (let i = 0; i < 50; i++) {
    fs.appendFileSync(file, JSON.stringify(textLine(`step ${i}`, usage(i + 1))) + "\n");
    await pause(20);
  }
  await pause(400);
  const sent = arrivals.filter((a) => a.f.type === "activity").map((a) => a.at);
  assert.ok(sent.length >= 3, `${sent.length} activities`);
  for (let i = 1; i < sent.length; i++) assert.ok(sent[i] - sent[i - 1] >= 280, `gap ${sent[i] - sent[i - 1]} ms`);
  assert.equal(activities(server.frames()).at(-1)!.activity.context, 50, "the newest state is the last sent");
  // nothing changes: nothing is sent
  const before = activities(server.frames()).length;
  await pause(700);
  assert.equal(activities(server.frames()).length, before);
  await exitLink(server, link);
});

test("activity queues behind calls, a queued one replaced by a newer while the socket is behind (D10, §3)", async () => {
  let welcoming = false;
  const server = await stubServer((f, conn) => {
    if (f.type === "hello") {
      const answer = (): unknown => (welcoming ? conn.send({ type: "welcome", version: f.version }) : setTimeout(answer, 20));
      answer();
    }
    if (f.type === "call") conn.send({ type: "result", id: f.id, ok: true, value: f.method });
  });
  servers.push(server);
  const { root, env } = sessionRoot();
  const home = dataHome(server.port);
  const file = writeSubagent(root, PROJECT, SESSION, "a1", [bashCall(JOIN_COMMAND)], {});
  const link = runLinkWith(home, env, { ...FAST, watchEveryMs: 20, activityGapMs: 0 });
  const cli = await openPipe(home);
  cli.call({ id: "c1", method: "roster", args: [] });
  // not welcomed yet: nothing goes up; three changes, the newest kept
  for (let i = 1; i <= 3; i++) {
    fs.appendFileSync(file, JSON.stringify(textLine(`step ${i}`, usage(i * 10))) + "\n");
    await pause(80);
  }
  welcoming = true;
  await until("the call answered", () => cli.received.length === 1);
  await until("an activity", () => activities(server.frames()).length > 0);
  await pause(100);
  const frames = server.frames();
  const sent = activities(frames);
  const callAt = frames.findIndex((f) => f.type === "call" && f.id === "c1");
  assert.ok(callAt >= 0 && callAt < frames.indexOf(sent[0]), "the call went before the activity");
  assert.equal(sent.length, 1, "one activity: the queued ones replaced");
  assert.equal(sent[0].activity.context, 30);
  await exitLink(server, link);
});

test("finished: true in the transcript's meta.json: a last activity, bye finished, and the link exits (D15, E14)", async () => {
  const server = await stubServer();
  servers.push(server);
  const { root, env } = sessionRoot();
  writeSubagent(root, PROJECT, SESSION, "a1", [bashCall(JOIN_COMMAND)], {});
  const home = dataHome(server.port);
  const link = runLinkWith(home, env, { ...FAST, watchEveryMs: 20, activityGapMs: 3000 });
  await until("a first activity", () => activities(server.frames()).length === 1);
  await saysWhy(new RegExp(`^link ${MEMBER}: finished$`), true, async () => {
    writeSubagent(root, PROJECT, SESSION, "a1", [bashCall(JOIN_COMMAND), textLine("done", usage(7))], { finished: true });
    return { home, stop: await link.done };
  });
  await until("the bye reached the server", () => server.frames().some((f) => f.type === "bye"));
  const frames = server.frames();
  const last = activities(frames).at(-1)!;
  assert.equal(activities(frames).length, 2, "the last one sent at once, the gap aside");
  assert.equal(last.activity.finished, true);
  assert.deepEqual(frames.at(-1), { type: "bye", reason: "finished" });
  assert.equal(frames.indexOf(last), frames.length - 2);
});

test("no transcript found (no session id, or another harness): the link sends no activity, and still relays calls", async () => {
  const server = await stubServer();
  servers.push(server);
  const { root } = sessionRoot();
  writeSubagent(root, PROJECT, SESSION, "a1", [bashCall(JOIN_COMMAND)], {});
  const home = dataHome(server.port);
  const link = runLinkWith(home, { SWARM_TRANSCRIPTS_ROOT: root }, { ...FAST, watchEveryMs: 20 });
  const cli = await openPipe(home);
  cli.call({ id: "c1", method: "roster", args: [] });
  await until("the call answered", () => cli.received.length === 1);
  await pause(300);
  assert.equal(activities(server.frames()).length, 0);
  await exitLink(server, link);
});
