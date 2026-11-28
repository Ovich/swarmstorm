// plan 2026-11-27-codebase-rework#D23: the board server's wire, pinned across its split (D14): the welcome's
// `watched`, an ended member's link refused, and a start lock's stale breaker cleared.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startBoardServer } from "../src/server/server.ts";
import { decode, encode, type Frame, type Hello, type RpcMethod, type ServerState } from "../src/contract/wire.ts";
import { serverStartLock, serverStateFile } from "../src/host/home.ts";

const REPO = "/repos/one/.git";
const SEATS = [{ id: "S1", blockers: [] }];

let dir: string;
let server: { url: string; close(): Promise<void> } | null;
const sockets: WebSocket[] = [];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-wire-"));
  server = null;
});

afterEach(async () => {
  for (const s of sockets.splice(0)) s.close();
  await server?.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const state = (): ServerState => JSON.parse(fs.readFileSync(serverStateFile(dir), "utf8")) as ServerState;

/** A client that has said hello: the reply to it, then each frame it receives, in order. */
async function hello(over: Partial<Hello> = {}): Promise<{ reply: Frame; next(): Promise<Frame>; send(f: Frame): void }> {
  const socket = new WebSocket(server!.url);
  sockets.push(socket);
  const queue: Frame[] = [];
  const waiting: ((f: Frame) => void)[] = [];
  socket.addEventListener("message", (e) => {
    const f = decode(String(e.data));
    const w = waiting.shift();
    if (w) w(f);
    else queue.push(f);
  });
  await new Promise<void>((r, j) => {
    socket.addEventListener("open", () => r());
    socket.addEventListener("error", () => j(new Error("no connection")));
  });
  const next = (): Promise<Frame> => (queue.length ? Promise.resolve(queue.shift()!) : new Promise((r) => waiting.push(r)));
  const send = (f: Frame): void => socket.send(encode(f));
  send({ type: "hello", version: state().version, ticket: state().ticket, ...over });
  return { reply: await next(), next, send };
}

let ids = 0;
async function value(c: { next(): Promise<Frame>; send(f: Frame): void }, method: RpcMethod, ...args: unknown[]): Promise<any> {
  const id = `w${++ids}`;
  c.send({ type: "call", id, method, args });
  const f = await c.next();
  assert.ok(f.type === "result" && f.id === id && f.ok, JSON.stringify(f));
  return f.type === "result" && f.ok ? f.value : undefined;
}

test("a member's link is welcomed with the worktree it watches and the branch it is read against", async () => {
  server = await startBoardServer({ dataRoot: dir });
  const cli = await hello();
  const run = await value(cli, "openRun", { repo: REPO, group: "p", title: "T", seats: SEATS, base: "main" });
  const place = path.resolve("/worktrees/s1");
  const s1 = (await value(cli, "join", { run: run.id, seat: "S1", doing: "x", files: [], place })).member;
  assert.deepEqual((await hello({ member: { name: s1.name, run: run.id } })).reply, { type: "welcome", version: state().version, watched: { dir: place, against: "main" } });
  assert.deepEqual((await hello()).reply, { type: "welcome", version: state().version });
});

test("the link of a member that has ended is refused as closed", async () => {
  server = await startBoardServer({ dataRoot: dir });
  const cli = await hello();
  const run = await value(cli, "openRun", { repo: REPO, group: "p", title: "T", seats: SEATS });
  const s1 = (await value(cli, "join", { run: run.id, seat: "S1", doing: "x", files: [] })).member;
  await value(cli, "end", s1);
  assert.deepEqual((await hello({ member: { name: s1.name, run: run.id } })).reply, { type: "refused", reason: "closed" });
});

test("a start lock of a dead server under an abandoned breaker is replaced: the breaker cleared, the new server started", async () => {
  const dead = Number(spawnSync(process.execPath, ["-e", "console.log(process.pid)"], { encoding: "utf8" }).stdout.trim());
  fs.writeFileSync(serverStartLock(dir), String(dead));
  const breaker = `${serverStartLock(dir)}.break`;
  fs.writeFileSync(breaker, String(dead));
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(breaker, old, old);
  server = await startBoardServer({ dataRoot: dir });
  assert.equal(fs.readFileSync(serverStartLock(dir), "utf8").trim(), String(process.pid));
  assert.equal(fs.existsSync(breaker), false);
});
