// The board server at its wire (swarm-relay S11): a test client (Node's WebSocket) against
// startBoardServer on a temporary data home.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openRawStore } from "./fixtures/raw-store.ts";
import { openBoard } from "../src/board/board.ts";
import { startBoardServer, stopBoardServer } from "../src/server/server.ts";
import { decode, encode, serverLogFile, serverStateFile, SERVER_STARTER_ENV, type Frame, type Hello, type MemberActivity, type RpcMethod, type ServerState } from "../src/wire.ts";

const REPO = "/repos/one/.git";
const SEATS = [
  { id: "S1", blockers: [] },
  { id: "S2", blockers: [] },
];

let dir: string;
let server: { url: string; close(): Promise<void> } | null;
const sockets: WebSocket[] = [];
/** The server's clock runs this far ahead of the real one: a test moves time without sleeping. */
let skew = 0;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-server-"));
  skew = 0;
  server = await startBoardServer({ dataRoot: dir, now: () => new Date(Date.now() + skew) });
});

afterEach(async () => {
  for (const s of sockets.splice(0)) s.close();
  await server?.close();
  server = null;
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const state = (): ServerState => JSON.parse(fs.readFileSync(serverStateFile(dir), "utf8")) as ServerState;

/** A connected test client: every frame it receives, in order, awaited one by one. */
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
  return {
    socket,
    closed,
    send: (f) => socket.send(encode(f)),
    next: () => (queue.length ? Promise.resolve(queue.shift()!) : new Promise((r) => waiting.push(r))),
  };
};
const hello = async (over: Partial<Hello> = {}): Promise<{ c: Client; reply: Frame }> => {
  const c = await connect();
  c.send({ type: "hello", version: state().version, secret: state().secret, ...over });
  return { c, reply: await c.next() };
};
const welcomed = async (over: Partial<Hello> = {}): Promise<Client> => {
  const { c, reply } = await hello(over);
  assert.equal(reply.type, "welcome");
  return c;
};
let ids = 0;
const call = async (c: Client, method: string, ...args: unknown[]): Promise<Frame> => {
  const id = `c${++ids}`;
  c.send({ type: "call", id, method: method as RpcMethod, args });
  const f = await c.next();
  assert.equal(f.type === "result" && f.id, id);
  return f;
};
const value = async (c: Client, method: string, ...args: unknown[]): Promise<any> => {
  const f = await call(c, method, ...args);
  assert.ok(f.type === "result" && f.ok, JSON.stringify(f));
  return f.type === "result" && f.ok ? f.value : undefined;
};

test("a hello with the secret and this version is welcomed; a wrong secret or version refused", async () => {
  const c = await welcomed();
  c.socket.close();
  assert.deepEqual((await hello({ secret: "nope" })).reply, { type: "refused", reason: "secret" });
  assert.deepEqual((await hello({ version: "other" })).reply, { type: "refused", reason: "version" });
  // U-F14: the refusal is evidence in the server's log: which server, its version, the hello's
  const logged = fs.readFileSync(serverLogFile(dir), "utf8").split(/\r?\n/).find((l) => l.startsWith(`swarm server ${process.pid} (version ${state().version}, since `));
  assert.ok(logged?.endsWith("): refused version other from a reader"), logged ?? "no refusal logged");
});

test("a second hello for the same member with supersede refuses the older connection", async () => {
  const member = { name: "p/S1", run: 1 };
  const old = await welcomed({ member });
  await welcomed({ member, supersede: true });
  assert.deepEqual(await old.next(), { type: "refused", reason: "superseded" });
});

test("every method answers over the wire what the Board answers in process; an unknown one names itself", async () => {
  const c = await welcomed();
  const run = await value(c, "openRun", { repo: REPO, group: "g", title: "T", seats: SEATS });
  const s1 = (await value(c, "join", { run: run.id, seat: "S1", doing: "x", files: [] })).member;
  const s2 = (await value(c, "join", { run: run.id, seat: "S2", doing: "y", files: [] })).member;
  await value(c, "post", s1, "hello @S2");
  // the same store opened in process reads what the wire answered
  const local = await openBoard(path.join(dir, "swarm.sqlite"));
  try {
    const same: [string, unknown[]][] = [
      ["runs", []],
      ["roster", [REPO]],
      ["participant", [s1.name]],
      ["heldBy", [s1]],
      ["currentPhase", [run.id]],
      ["pausedOf", [run.id]],
      ["phaseProgress", [run.id]],
      ["lastActivity", [run.id]],
      ["owedPhase", [s2]],
      ["endedMembers", [REPO]],
      ["packCall", [s1, "held-merge-lock", {}]],
      ["repos", []],
      ["snapshot", [REPO]],
    ];
    for (const [m, args] of same) {
      const wire = await value(c, m, ...args);
      const here = JSON.parse(JSON.stringify((local as any)[m](...args) ?? null));
      // a read counts a call: compared on the fields a call does not move
      if (m === "snapshot" || m === "roster" || m === "runs" || m === "repos" || m === "lastActivity") assert.equal(typeof wire, typeof here, m);
      else assert.deepEqual(wire, here, m);
    }
  } finally {
    local.close();
  }
  // writes answer as in process
  assert.equal((await value(c, "deliverMentions", s2)).full.length, 1);
  assert.notEqual(await value(c, "packCall", s1, "held-merge-lock", {}), undefined, "a pack verb answers over the wire");
  const unknown = await call(c, "markStaleRuns");
  assert.deepEqual(unknown.type === "result" && !unknown.ok && unknown.error, "unknown method markStaleRuns");
  const thrown = await call(c, "endorse", s1, 99999);
  assert.ok(thrown.type === "result" && !thrown.ok && /unknown message/.test(thrown.error));
});

test("a resent call is answered from the cache: one post in the store, not two", async () => {
  const c = await welcomed();
  const run = await value(c, "openRun", { repo: REPO, group: "g", title: "T", seats: SEATS });
  const s1 = (await value(c, "join", { run: run.id, seat: "S1", doing: "x", files: [] })).member;
  const frame: Frame = { type: "call", id: "post-once", method: "post", args: [s1, "only once"] };
  c.send(frame);
  const first = await c.next();
  // reconnected, the same call resent
  const again = await welcomed();
  again.send(frame);
  assert.deepEqual(await again.next(), first);
  const local = await openBoard(path.join(dir, "swarm.sqlite"));
  try {
    const all = local.snapshot(REPO).events.filter((e) => e.body === "only once");
    assert.equal(all.length, 1);
  } finally {
    local.close();
  }
});

test("a wait returns within 200 ms of a post on another connection", async () => {
  const a = await welcomed();
  const run = await value(a, "openRun", { repo: REPO, group: "g", title: "T", seats: SEATS });
  const s1 = (await value(a, "join", { run: run.id, seat: "S1", doing: "x", files: [] })).member;
  const s2 = (await value(a, "join", { run: run.id, seat: "S2", doing: "y", files: [] })).member;
  await value(a, "deliverMentions", s1);
  await value(a, "deliverMentions", s2);
  const b = await welcomed({ member: { name: s2.name, run: run.id } });
  b.send({ type: "call", id: "w7", method: "wait", args: [s2, { mentionsOnly: true }] });
  await new Promise((r) => setTimeout(r, 100));
  const t0 = Date.now();
  await value(a, "post", s1, "@S2 wake");
  const woke = await b.next();
  assert.ok(Date.now() - t0 < 200, `woke after ${Date.now() - t0} ms`);
  assert.ok(woke.type === "result" && woke.id === "w7" && woke.ok && (woke.value as { full: unknown[] }).full.length === 1);
});

test("closeRun over the wire refuses every member connection of that run", async () => {
  const a = await welcomed();
  const run = await value(a, "openRun", { repo: REPO, group: "g", title: "T", seats: SEATS });
  const s1 = (await value(a, "join", { run: run.id, seat: "S1", doing: "x", files: [] })).member;
  const link = await welcomed({ member: { name: s1.name, run: run.id } });
  await value(a, "closeRun", run.id);
  assert.deepEqual(await link.next(), { type: "refused", reason: "closed" });
});

test("serve stop refuses every connection with shutdown and removes the state file", async () => {
  const c = await welcomed();
  assert.equal(await stopBoardServer(dir), true);
  assert.deepEqual(await c.next(), { type: "refused", reason: "shutdown" });
  assert.equal(fs.existsSync(serverStateFile(dir)), false);
  assert.equal(await stopBoardServer(dir), false);
  server = null;
});

test("the built bundle, alone in an empty folder, runs serve, answers a client and stops on serve stop", { timeout: 60000 }, async () => {
  await server!.close();
  server = null;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const out = path.join(dir, "alone", "cli.mjs");
  // the package's own build, written elsewhere: what ships, with nothing beside it
  const built = spawn(process.execPath, [path.join(here, "..", "build.mjs"), "--outfile", out], { cwd: path.join(here, ".."), stdio: "ignore" });
  assert.equal(await new Promise((r) => built.on("exit", r)), 0);
  const home = path.join(dir, "home");
  const env = { ...process.env, SWARMSTORM_HOME: home };
  const serve = spawn(process.execPath, [out, "serve"], { cwd: path.dirname(out), env, stdio: ["ignore", "pipe", "pipe"] });
  const exited = new Promise<number | null>((r) => serve.on("exit", (code) => r(code)));
  const url = await new Promise<string>((r, j) => {
    let text = "";
    serve.stdout.on("data", (d) => {
      text += String(d);
      const m = /ws:\/\/\S+/.exec(text);
      if (m) r(m[0]);
    });
    serve.on("exit", () => j(new Error(`serve exited early`)));
  });
  const st = JSON.parse(fs.readFileSync(serverStateFile(home), "utf8")) as ServerState;
  const socket = new WebSocket(url);
  sockets.push(socket);
  const frames: Frame[] = [];
  const got = (n: number): Promise<void> =>
    new Promise((r) => {
      const look = (): void => (frames.length >= n ? r() : void setTimeout(look, 20));
      look();
    });
  socket.addEventListener("message", (e) => frames.push(decode(String(e.data))));
  await new Promise((r) => socket.addEventListener("open", r));
  socket.send(encode({ type: "hello", version: st.version, secret: st.secret }));
  await got(1);
  assert.equal(frames[0].type, "welcome");
  socket.send(encode({ type: "call", id: "r1", method: "runs", args: [] }));
  await got(2);
  assert.deepEqual(frames[1], { type: "result", id: "r1", ok: true, value: [] });
  const stop = spawn(process.execPath, [out, "serve", "stop"], { cwd: path.dirname(out), env, stdio: "ignore" });
  assert.equal(await new Promise((r) => stop.on("exit", r)), 0);
  assert.equal(await exited, 0);
  await got(3);
  assert.deepEqual(frames[2], { type: "refused", reason: "shutdown" });
  assert.equal(fs.existsSync(serverStateFile(home)), false);
});

// ── liveness in the server (swarm-relay S21) ──────────────────────────────────────────
const activity = (o: Partial<MemberActivity> = {}): MemberActivity => ({ grewAt: Date.now(), tokens: 0, context: null, openTool: null, lastTool: null, finished: false, ...o });
/** Asks the snapshot every 100 ms until `ok`, or fails after `ms`. */
const within = async <T>(c: Client, ms: number, pick: (snap: any) => T | undefined): Promise<T> => {
  const until = Date.now() + ms;
  for (;;) {
    const got = pick(await value(c, "snapshot", REPO));
    if (got !== undefined) return got;
    if (Date.now() > until) assert.fail(`not within ${ms} ms`);
    await new Promise((r) => setTimeout(r, 100));
  }
};
/** Until the server has recorded `seat`'s link lost, read off the store: the loss is timed on the server's clock when
 *  it sees the close, which a loaded machine may run after the test has skewed that clock (S31). */
const untilLinkLost = async (run: number, seat: string): Promise<void> => {
  for (let i = 0; i < 100; i++) {
    const db = openRawStore(path.join(dir, "swarm.sqlite"));
    try {
      const row = db.prepare("SELECT lost_at FROM member_links WHERE run = ? AND member = ?").get(run, seat) as { lost_at: number | null } | undefined;
      if (row?.lost_at != null) return;
    } finally {
      db.close();
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail(`${seat}'s link never recorded lost`);
};
const goneEvents = (snap: any): { body: string; mentions: string[]; at: string }[] => snap.events.filter((e: { event?: string }) => e.event === "lost");
/** A run with S1 and S2 joined, and S1's link welcomed. */
const linkedRun = async () => {
  const c = await welcomed();
  const run = await value(c, "openRun", { repo: REPO, group: "g", title: "T", seats: SEATS });
  const s1 = (await value(c, "join", { run: run.id, seat: "S1", doing: "x", files: [] })).member;
  await value(c, "join", { run: run.id, seat: "S2", doing: "y", files: [] });
  // a phase open for both: each owes work, so a link down reads lost
  await value(c, "phase", await value(c, "participant", "g/orchestrator"), "p1", "go");
  const link = await welcomed({ member: { name: s1.name, run: run.id } });
  return { c, run, s1, link };
};

test("an activity frame from a member's link updates its member_activity row and a token reading; the snapshot carries state and doing", async () => {
  const { c, run, link } = await linkedRun();
  link.send({ type: "activity", at: Date.now(), activity: activity({ tokens: 77, openTool: { name: "Bash", target: "npm test", since: Date.now() } }) });
  const live = await within(c, 3000, (snap) => snap.roster.find((r: { member: string; liveness?: { tokens: number | null } }) => r.member === "g/S1" && r.liveness?.tokens === 77)?.liveness);
  assert.deepEqual([live.state, live.doing], ["busy", "Bash npm test"]);
  const db = openRawStore(path.join(dir, "swarm.sqlite"));
  try {
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM token_readings WHERE run = ? AND member = 'S1'").get(run.id) as { n: number }).n, 1);
    assert.equal((db.prepare("SELECT open_tool FROM member_activity WHERE run = ? AND member = 'S1'").get(run.id) as { open_tool: string }).open_tool, "Bash");
  } finally {
    db.close();
  }
});

test("an activity with finished and no end, the link alive, draws no lost and no badge (board-split D49: never from the transcript)", async () => {
  const { c, link } = await linkedRun();
  link.send({ type: "activity", at: Date.now(), activity: activity({ finished: true, tokens: 5 }) });
  // the frame has landed (its tokens read back), and two ticks have passed since
  await within(c, 3000, (snap) => snap.roster.find((r: { member: string; liveness?: { tokens: number | null } }) => r.member === "g/S1" && r.liveness?.tokens === 5));
  await new Promise((r) => setTimeout(r, 2500));
  const snap = await value(c, "snapshot", REPO);
  assert.equal(goneEvents(snap).length, 0);
  assert.equal(snap.roster.find((r: { member: string }) => r.member === "g/S1").badge, null);
});

test("gone is posted within 65 s of a link lost and not back; never for an ended member (US3, D12, board-split D55)", async () => {
  const { c, run, s1, link } = await linkedRun();
  const s2 = await value(c, "participant", "g/S2");
  const link2 = await welcomed({ member: { name: s2.name, run: run.id } });
  link.socket.close();
  await link.closed;
  await untilLinkLost(run.id, "S1");
  // S2 ends, then its link goes: never gone
  await value(c, "end", s2);
  link2.socket.close();
  await link2.closed;
  skew += 59_000;
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(goneEvents(await value(c, "snapshot", REPO)).length, 0, "not before LOST_MS");
  skew += 2_000;
  // past LOST_MS on the server's clock: the gone is posted at its next tick. Waited for as the event, and timed by the
  // event's own time on that clock, never by how fast this loaded process reads snapshots (S31, T14)
  const crossedAt = Date.now() + skew;
  const gone = await within(c, 60_000, (snap) => goneEvents(snap)[0]);
  assert.equal(gone.body, `lost ${s1.name}: its link was lost (socket)`);
  assert.ok(Date.parse(gone.at) - crossedAt <= 4000, `gone posted ${Date.parse(gone.at) - crossedAt} ms after 61 s on the server's clock`);
  await new Promise((r) => setTimeout(r, 1500));
  assert.deepEqual(goneEvents(await value(c, "snapshot", REPO)).map((e) => e.body), [`lost ${s1.name}: its link was lost (socket)`]);
});

test("plan D56 (amended): a member's link of an older bundle, refused for its version, is a drop of cause `version`, never lost within the window", async () => {
  const { c, run, s1, link } = await linkedRun();
  link.socket.close();
  await link.closed;
  await untilLinkLost(run.id, "S1");
  const { reply } = await hello({ version: "0000000000000000", member: { name: s1.name, run: run.id } });
  assert.deepEqual(reply, { type: "refused", reason: "version" });
  const db = openRawStore(path.join(dir, "swarm.sqlite"));
  try {
    assert.equal((db.prepare("SELECT cause FROM member_links WHERE run = ? AND member = 'S1'").get(run.id) as { cause: string }).cause, "version");
  } finally {
    db.close();
  }
  // its relaunched link, on the server's bundle, comes back within the window: no lost
  await welcomed({ member: { name: s1.name, run: run.id } });
  skew += 61_000;
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(goneEvents(await value(c, "snapshot", REPO)).filter((e) => e.body.includes(s1.name)).length, 0);
});

test("an upkeep or tick that throws is logged to stderr, and the server goes on", async () => {
  const { c, run, link } = await linkedRun();
  const broken = await value(c, "openRun", { repo: REPO, group: "b", title: "B", seats: SEATS });
  await value(c, "join", { run: broken.id, seat: "S1", doing: "x", files: [] });
  // the broken run's tick throws: pruning its old token reading is refused by a trigger
  const db = openRawStore(path.join(dir, "swarm.sqlite"));
  try {
    db.prepare("INSERT INTO token_readings (run, member, t, tokens) VALUES (?, 'S1', '2000-01-01T00:00:00.000Z', 1)").run(broken.id);
    db.exec(`CREATE TRIGGER refuse_prune BEFORE DELETE ON token_readings WHEN old.run = ${Number(broken.id)} BEGIN SELECT RAISE(ABORT, 'refused'); END`);
  } finally {
    db.close();
  }
  const logged: string[] = [];
  const was = console.error;
  console.error = (...a: unknown[]) => void logged.push(a.join(" "));
  try {
    await new Promise((r) => setTimeout(r, 1500));
    assert.ok(logged.some((l) => l.startsWith(`swarm server: liveness of run ${broken.id} failed`)), logged.join("\n"));
    // the other run still ticks (its member's link lost past LOST_MS is told lost), and the server still answers
    link.socket.close();
    await link.closed;
    await untilLinkLost(run.id, "S1");
    skew += 61_000;
    assert.equal((await within(c, 5000, (snap) => goneEvents(snap).find((e) => e.mentions.includes("g/orchestrator")))).body, "lost g/S1: its link was lost (socket)");
    assert.ok((await value(c, "runs")).some((r: { id: number }) => r.id === run.id));
  } finally {
    console.error = was;
  }
});

// ── presence outlives a restart (swarm-relay S42, D37) ──
/** `serve stop`, then a new server on the same data home, on the same skewed clock. */
const restart = async (): Promise<void> => {
  await server!.close();
  server = await startBoardServer({ dataRoot: dir, now: () => new Date(Date.now() + skew) });
};

test("after a restart, a member that had a link and has none LOST_MS later is gone, posted once, never again after a second restart (D37, board-split D55)", async () => {
  const { s1 } = await linkedRun();
  await restart();
  const c = await welcomed();
  skew += 58_000; // with the 1.5 s below, 59.5 s since the start
  await new Promise((r) => setTimeout(r, 1500));
  assert.deepEqual(goneEvents(await value(c, "snapshot", REPO)).map((e) => e.body), [], "not before LOST_MS after the start");
  skew += 3_000;
  const gone = await within(c, 4000, (snap) => goneEvents(snap).find((e) => e.body.includes(s1.name)));
  assert.equal(gone.body, `lost ${s1.name}: its link was lost (server-restart)`);
  // U-F3: S2 never had a link: lost once LOST_MS has passed since its join; a second restart tells neither again
  await restart();
  const again = await welcomed();
  skew += 60_000;
  await new Promise((r) => setTimeout(r, 1500));
  assert.deepEqual(goneEvents(await value(again, "snapshot", REPO)).map((e) => e.body).sort(), [`lost ${s1.name}: its link was lost (server-restart)`, "lost g/S2: no link since its join"]);
});

test("a link lost and back within 30 s, across a restart or not, is never gone (D37)", async () => {
  const { c, run, s1, link } = await linkedRun();
  link.socket.close();
  await link.closed;
  skew += 20_000;
  await welcomed({ member: { name: s1.name, run: run.id } });
  skew += 40_000;
  await new Promise((r) => setTimeout(r, 1500));
  // S2 never linked: lost by U-F3; S1, back in time, never
  const s1Lost = (snap: unknown) => goneEvents(snap).filter((e) => e.body.includes(s1.name));
  assert.equal(s1Lost(await value(c, "snapshot", REPO)).length, 0, "back in time, no restart");
  await restart();
  skew += 20_000;
  const reader = await welcomed();
  await welcomed({ member: { name: s1.name, run: run.id } });
  skew += 40_000;
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(s1Lost(await value(reader, "snapshot", REPO)).length, 0, "back in time after a restart");
});

// ── who started it (swarm-relay D42) ──────────────────────────────────────────
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("a server's log starts with its data home, its pid, and its starter's pid and command line, else unknown (D42)", async () => {
  const first = fs.readFileSync(serverLogFile(dir), "utf8").split("\n")[0];
  const unknownOrProc = process.platform === "win32" ? "unknown" : "\\S.*";
  assert.match(first, new RegExp(`^serve: home ${escapeRegExp(path.resolve(dir))}, pid ${process.pid}, started by ${process.ppid} ${unknownOrProc}$`));
  await server!.close();
  server = null;
  const home = path.join(dir, "named");
  process.env[SERVER_STARTER_ENV] = "node swarm.mjs join --run 72";
  try {
    server = await startBoardServer({ dataRoot: home });
  } finally {
    delete process.env[SERVER_STARTER_ENV];
  }
  assert.equal(fs.readFileSync(serverLogFile(home), "utf8").split("\n")[0], `serve: home ${path.resolve(home)}, pid ${process.pid}, started by ${process.ppid} node swarm.mjs join --run 72`);
});
