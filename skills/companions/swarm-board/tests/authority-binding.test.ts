// The board binds each connection to its member and judges every call for it (trust-adaptations#D5), at the wire: a
// test client (Node's WebSocket) against startBoardServer on a temporary data home. Not `--authority` roles
// (authority.test.ts).
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openRawStore } from "./fixtures/raw-store.ts";
import { startBoardServer } from "../src/server/server.ts";
import { decode, encode, ORCHESTRATORS_GROUP, serverStateFile, type Frame, type Hello, type RpcMethod, type ServerState } from "../src/wire.ts";

const REPO = "/repos/one/.git";
const SEATS = [
  { id: "A", blockers: [] },
  { id: "B", blockers: [] },
];

let dir: string;
let server: { url: string; close(): Promise<void> } | null;
const sockets: WebSocket[] = [];

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-authority-"));
  server = await startBoardServer({ dataRoot: dir });
});

afterEach(async () => {
  for (const s of sockets.splice(0)) s.close();
  await server?.close();
  server = null;
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const state = (): ServerState => JSON.parse(fs.readFileSync(serverStateFile(dir), "utf8")) as ServerState;

type Client = { send(f: Frame): void; next(): Promise<Frame>; closed: Promise<void>; socket: WebSocket };
const connect = async (): Promise<Client> => {
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
  const closed = new Promise<void>((r) => socket.addEventListener("close", () => r()));
  await new Promise<void>((r, j) => {
    socket.addEventListener("open", () => r());
    socket.addEventListener("error", () => j(new Error("no connection")));
  });
  return { socket, closed, send: (f) => socket.send(encode(f)), next: () => (queue.length ? Promise.resolve(queue.shift()!) : new Promise((r) => waiting.push(r))) };
};
const hello = async (over: Partial<Hello> = {}): Promise<{ c: Client; reply: Frame }> => {
  const c = await connect();
  c.send({ type: "hello", version: state().version, secret: state().secret, ...over });
  return { c, reply: await c.next() };
};
const welcomed = async (over: Partial<Hello> = {}): Promise<Client> => {
  const { c, reply } = await hello(over);
  assert.equal(reply.type, "welcome", JSON.stringify(reply));
  return c;
};
let ids = 0;
const call = async (c: Client, method: RpcMethod, ...args: unknown[]): Promise<Extract<Frame, { type: "result" }>> => {
  const id = `c${++ids}`;
  c.send({ type: "call", id, method, args });
  const f = await c.next();
  assert.ok(f.type === "result" && f.id === id, JSON.stringify(f));
  return f as Extract<Frame, { type: "result" }>;
};
const value = async (c: Client, method: RpcMethod, ...args: unknown[]): Promise<any> => {
  const f = await call(c, method, ...args);
  assert.ok(f.ok, JSON.stringify(f));
  return f.ok ? f.value : undefined;
};
/** The call is refused by the board's authority, its text naming why. */
const refused = async (c: Client, method: RpcMethod, ...args: unknown[]): Promise<string> => {
  const f = await call(c, method, ...args);
  assert.ok(!f.ok && f.error.startsWith("refused: "), `${method} not refused by the authority: ${JSON.stringify(f)}`);
  return f.ok ? "" : f.error;
};

type Member = { id: number; name: string; run: number; seat: string };
/** A run opened on its own connection (bound to its orchestrator), and a member per seat joined on its own (bound to it). */
const openWithMembers = async (group: string): Promise<{ run: number; orchestrator: Client; members: Record<string, { member: Member; c: Client }> }> => {
  const orchestrator = await welcomed();
  const run = (await value(orchestrator, "openRun", { repo: REPO, group, title: "T", seats: SEATS })).id as number;
  const members: Record<string, { member: Member; c: Client }> = {};
  for (const { id } of SEATS) {
    const c = await welcomed();
    members[id] = { member: (await value(c, "join", { run, seat: id, doing: "x", files: [] })).member, c };
  }
  return { run, orchestrator, members };
};
const linkRow = (run: number, seat: string): { connected: number; lost_at: number | null } | undefined => {
  const db = openRawStore(path.join(dir, "swarm.sqlite"));
  try {
    return db.prepare("SELECT connected, lost_at FROM member_links WHERE run = ? AND member = ?").get(run, seat) as { connected: number; lost_at: number | null } | undefined;
  } finally {
    db.close();
  }
};

test("a connection bound to A is refused end, setDoing and post for B; an anonymous acting call is refused", async () => {
  const { members } = await openWithMembers("g");
  const { c: a } = members.A;
  const b = members.B.member;
  for (const [method, args] of [
    ["end", [b]],
    ["setDoing", [b, "as B"]],
    ["post", [b, "as B"]],
  ] as [RpcMethod, unknown[]][])
    assert.match(await refused(a, method, ...args), /acts for g\/B; this connection is g\/A/);
  // a target whose name says A but whose id is B's is judged by its id
  await refused(a, "post", { ...b, name: members.A.member.name }, "as B, renamed");
  const anonymous = await welcomed();
  assert.match(await refused(anonymous, "post", b, "anyone"), /names no member/);
  // A's own calls pass
  await value(a, "setDoing", members.A.member, "mine");
  await value(a, "post", members.A.member, "mine");
});

test("the orchestrator's end and packCall for a seat pass on its own run, are refused on another; phase from a member is refused", async () => {
  const one = await openWithMembers("g");
  const two = await openWithMembers("h");
  const seatOfOne = one.members.A.member;
  // another run's orchestrator
  await refused(two.orchestrator, "packCall", seatOfOne, "beforeEnd", {});
  await refused(two.orchestrator, "end", seatOfOne);
  // its own run's orchestrator (`end --seat`)
  await value(one.orchestrator, "packCall", seatOfOne, "beforeEnd", {});
  await value(one.orchestrator, "end", seatOfOne);
  // the orchestrator's other acting calls stay its own
  await refused(one.orchestrator, "post", one.members.B.member, "as B");
  const member = one.members.B;
  // as the orchestrator: refused by the authority; as itself: refused by the board's own rule
  const asOrchestrator = (await value(member.c, "participant", "g/orchestrator")) as Member;
  assert.match(await refused(member.c, "phase", asOrchestrator, "build", "go"), /acts for g\/orchestrator; this connection is g\/B/);
  await refused(member.c, "pause", asOrchestrator, "stop");
  const asItself = await call(member.c, "phase", member.member, "build", "go");
  assert.ok(!asItself.ok && /only the orchestrator opens a phase/.test(asItself.error), JSON.stringify(asItself));
  const anonymous = await welcomed();
  await refused(anonymous, "closeRun", one.run);
  await refused(two.orchestrator, "closeRun", one.run);
  await refused(two.orchestrator, "addSeat", one.run, { id: "C", blockers: [] });
});

test("a presence:false hello writes no presence and is accepted for an ended member", async () => {
  const { run, members } = await openWithMembers("g");
  const before = linkRow(run, "A");
  const direct = await welcomed({ member: { name: members.A.member.name, run }, presence: false, supersede: true });
  assert.deepEqual(linkRow(run, "A"), before, "no linked");
  await value(direct, "setDoing", members.A.member, "over a direct connection");
  direct.socket.close();
  await direct.closed;
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(linkRow(run, "A"), before, "no drop");
  // a member's link is not kicked by a presence:false hello naming it with supersede
  const link = await welcomed({ member: { name: members.B.member.name, run } });
  assert.equal(linkRow(run, "B")?.connected, 1);
  await welcomed({ member: { name: members.B.member.name, run }, presence: false, supersede: true });
  await value(members.B.c, "end", members.B.member);
  const kicked = await link.next();
  assert.deepEqual(kicked, { type: "refused", reason: "closed" }, "the link is closed by its member's end, not superseded");
  // ended: its link is refused as closed, a direct connection is welcomed, and the board's own rules answer it
  assert.deepEqual((await hello({ member: { name: members.B.member.name, run } })).reply, { type: "refused", reason: "closed" });
  const ended = await welcomed({ member: { name: members.B.member.name, run }, presence: false });
  await value(ended, "roster", REPO);
});

test("a successful join binds its connection: its packCall(member, join) passes", async () => {
  const orchestrator = await welcomed();
  const run = (await value(orchestrator, "openRun", { repo: REPO, group: "g", title: "T", seats: SEATS })).id as number;
  const c = await welcomed();
  const { member } = await value(c, "join", { run, seat: "A", doing: "x", files: [] });
  await value(c, "packCall", member, "join", { cwd: dir });
  await value(c, "deliverMentions", member);
  // bound once: a second join on the same connection does not re-bind it
  const other = (await value(c, "join", { run, seat: "B", doing: "y", files: [] })).member;
  await refused(c, "post", other, "as B");
  // the openRun connection was bound to its orchestrator
  await value(orchestrator, "addSeat", run, { id: "C", blockers: [] });
});

test("addSeat and closeRun on an orchestrators-group run stay open; packCall close is the run's orchestrator's", async () => {
  const opener = await welcomed();
  const board = (await value(opener, "openRun", { repo: REPO, kind: "brainstorm", group: ORCHESTRATORS_GROUP, title: "Orchestrators", seats: [] })).id as number;
  const team = await openWithMembers("g");
  await refused(team.members.A.c, "packCall", null, "close", { run: team.run });
  const anonymous = await welcomed();
  await refused(anonymous, "addSeat", team.run, { id: "C", blockers: [] });
  await value(anonymous, "addSeat", board, { id: "g", blockers: [] });
  await value(team.members.A.c, "addSeat", board, { id: "h", blockers: [] });
  await value(anonymous, "closeRun", board);
  await value(anonymous, "packCall", null, "close", { run: board });
  // the open pack verbs need no member
  await value(anonymous, "packCall", null, "legacy", {});
  await refused(anonymous, "packCall", null, "unmerged", {});
});

test("a hello naming a member that run does not have is refused", async () => {
  const { run, members } = await openWithMembers("g");
  assert.deepEqual((await hello({ member: { name: "g/nobody", run } })).reply, { type: "refused", reason: "member" });
  assert.deepEqual((await hello({ member: { name: members.A.member.name, run: run + 100 } })).reply, { type: "refused", reason: "member" });
  assert.deepEqual((await hello({ member: { name: members.A.member.name, run }, presence: false })).reply.type, "welcome");
});

test("v1-F4: a call id is its caller's own: another connection's same id runs its own call, never gets that answer or takes that call", async () => {
  const { members } = await openWithMembers("g");
  // v1's repro: two anonymous connections, one id
  const first = await welcomed();
  const second = await welcomed();
  first.send({ type: "call", id: "2", method: "participant", args: [members.A.member.name] });
  const asked = await first.next();
  assert.ok(asked.type === "result" && asked.ok && (asked.value as Member).name === "g/A", JSON.stringify(asked));
  second.send({ type: "call", id: "2", method: "roster", args: [REPO] });
  const own = await second.next();
  assert.ok(own.type === "result" && own.ok && Array.isArray(own.value), `the roster answered, not the other's participant: ${JSON.stringify(own)}`);
  // a member's running wait is not taken over by another member sending the same id
  const { c: a, member: memberA } = members.A;
  const { c: b, member: memberB } = members.B;
  a.send({ type: "call", id: "w", method: "wait", args: [memberA, { mentionsOnly: true, timeoutMs: 3000 }] });
  b.send({ type: "call", id: "w", method: "wait", args: [memberB, { mentionsOnly: true, timeoutMs: 100 }] });
  const bAnswer = await b.next();
  assert.ok(bAnswer.type === "result" && bAnswer.id === "w" && bAnswer.ok, JSON.stringify(bAnswer));
  await value(b, "post", memberB, "@A wake");
  const aAnswer = await a.next();
  assert.ok(aAnswer.type === "result" && aAnswer.id === "w" && aAnswer.ok && (aAnswer.value as { full: unknown[] }).full.length === 1, `A's own wait reached A: ${JSON.stringify(aAnswer)}`);
  // the same member resending its id, over another connection of its own, is answered from its call
  const again = await welcomed({ member: { name: memberA.name, run: memberA.run }, presence: false });
  again.send({ type: "call", id: "w", method: "wait", args: [memberA, { mentionsOnly: true }] });
  assert.deepEqual(await again.next(), aAnswer);
});
