// A connection carrying a member's calls without being its link (trust-adaptations#D5, client half): the CLI's direct
// and fallback connections declare the member with `presence: false`, and the server takes such a Hello as no link:
// welcomed for an ended member, writing no presence, superseding nothing.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { openBoard } from "../src/board/board.ts";
import { connectBoard, connectDirectBoard } from "../src/client/remote.ts";
import { startBoardServer } from "../src/server/server.ts";
import { bundleVersion, decode, encode, serverStateFile, type Frame, type Hello, type ServerState } from "../src/wire.ts";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "cli", "index.ts");
// the in-process client versions as the CLI does: from the CLI's entry (D28)
process.argv[1] = CLI;

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});
const tempHome = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-direct-"));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  return dir;
};

/** A stand-in board server of this version that records every Hello and answers every call with null. */
async function recordingServer(home: string): Promise<Hello[]> {
  const hellos: Hello[] = [];
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((r) => wss.once("listening", () => r()));
  const port = (wss.address() as { port: number }).port;
  const version = bundleVersion(CLI);
  const state: ServerState = { pid: process.pid, port, secret: "s", version };
  fs.writeFileSync(serverStateFile(home), JSON.stringify(state));
  wss.on("connection", (socket) =>
    socket.on("message", (data) => {
      const f = decode(String(data));
      if (f.type === "hello") {
        hellos.push(f);
        socket.send(encode({ type: "welcome", version }));
      } else if (f.type === "call") socket.send(encode({ type: "result", id: f.id, ok: true, value: null }));
    }),
  );
  cleanups.push(() => new Promise<void>((r) => wss.close(() => r())));
  return hellos;
}

const member = { name: "g/w1", run: 7 };

test("a direct board for a member declares it in its Hello, with presence false", async () => {
  const home = tempHome();
  const hellos = await recordingServer(home);
  const board = await connectDirectBoard(home, member);
  await board.runs();
  board.close();
  assert.deepEqual(hellos.map(({ member, presence, supersede }) => ({ member, presence, supersede })), [{ member, presence: false, supersede: undefined }]);
});

test("the fallback when no link answers declares the member, with presence false; an anonymous board declares none", async () => {
  const home = tempHome();
  const hellos = await recordingServer(home);
  const fallback = await connectBoard({ dataRoot: home, member, harness: true, harnessWaitMs: 50 });
  assert.equal(fallback.linkMissing, true);
  await fallback.runs();
  fallback.close();
  const anonymous = await connectBoard({ dataRoot: home });
  await anonymous.runs();
  anonymous.close();
  assert.deepEqual(hellos.map(({ member, presence }) => ({ member, presence })), [{ member, presence: false }, { member: undefined, presence: undefined }]);
});

/** The real server, a run with S1 joined, and a raw Hello sender. */
async function realServer(): Promise<{ home: string; hello: (over: Partial<Hello>) => Promise<{ reply: Frame; socket: WebSocket; next: () => Promise<Frame> }>; s1: { name: string; run: number } }> {
  const home = tempHome();
  const server = await startBoardServer({ dataRoot: home });
  cleanups.push(() => server.close());
  const st = JSON.parse(fs.readFileSync(serverStateFile(home), "utf8")) as ServerState;
  const hello = async (over: Partial<Hello>) => {
    const socket = new WebSocket(server.url);
    cleanups.push(() => socket.close());
    const queue: Frame[] = [];
    const waiting: ((f: Frame) => void)[] = [];
    socket.addEventListener("message", (e) => {
      const f = decode(String(e.data));
      const w = waiting.shift();
      if (w) w(f);
      else queue.push(f);
    });
    await new Promise<void>((r) => socket.addEventListener("open", () => r()));
    const next = (): Promise<Frame> => (queue.length ? Promise.resolve(queue.shift()!) : new Promise((r) => waiting.push(r)));
    socket.send(encode({ type: "hello", version: st.version, secret: st.secret, ...over }));
    return { reply: await next(), socket, next };
  };
  const local = await openBoard(path.join(home, "swarm.sqlite"));
  const run = local.openRun({ repo: "/repos/one/.git", group: "g", title: "T", seats: [{ id: "S1", blockers: [] }] });
  const s1 = local.join({ run: run.id, seat: "S1", doing: "x", files: [] }).member;
  local.close();
  return { home, hello, s1: { name: s1.name, run: s1.run } };
}

test("the server welcomes a presence-false Hello of an ended member, where a link of it is refused closed", async () => {
  const { home, hello, s1 } = await realServer();
  const local = await openBoard(path.join(home, "swarm.sqlite"));
  local.end(local.participant(s1.name)!);
  local.close();
  assert.equal((await hello({ member: s1, presence: false })).reply.type, "welcome");
  assert.deepEqual((await hello({ member: s1 })).reply, { type: "refused", reason: "closed" });
});

test("a presence-false Hello writes no presence and supersedes no link", async () => {
  const { home, hello, s1 } = await realServer();
  const link = await hello({ member: s1 });
  assert.equal(link.reply.type, "welcome");
  const direct = await hello({ member: s1, presence: false, supersede: true });
  assert.equal(direct.reply.type, "welcome");
  const local = await openBoard(path.join(home, "swarm.sqlite"));
  const before = local.savedLinks().filter((l) => l.run === s1.run);
  direct.socket.close();
  await new Promise((r) => setTimeout(r, 200));
  // the link still connected: neither superseded by the direct connection nor dropped by its close
  assert.deepEqual(local.savedLinks().filter((l) => l.run === s1.run).map((l) => l.connected), before.map((l) => l.connected));
  assert.equal(before.length, 1);
  assert.ok(before[0].connected);
  local.close();
  link.socket.send(encode({ type: "call", id: "r1", method: "runs", args: [] }));
  assert.equal((await link.next()).type, "result");
});
