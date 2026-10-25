// The swarm board server (swarm-relay D2): the one process that opens the store, answering every
// call of the links and CLIs over one WebSocket endpoint on the loopback.
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { openBoard, type Board, type Presence } from "../board/board.ts";
import { RPC_METHODS, bundleVersion, decode, encode, liveStartLockHolder, serverLockHolder, serverLogFile, serverStartLock, serverStateFile, SERVER_STARTER_ENV, type Call, type Frame, type Hello, type RpcMethod, type ServerState } from "../wire.ts";

/** A resent call is answered from this cache for this long (D4). */
const RESULT_CACHE_MS = 10 * 60 * 1000;
/** The board's upkeep is looked at this often, and every open run's liveness ticked (D13). */
const UPKEEP_LOOK_MS = 1000;
/** The ping that keeps a link's socket honest (D10). */
const PING_EVERY_MS = 10 * 1000;
const PONG_WITHIN_MS = 25 * 1000;
/** `serve stop` asks the running server here, over HTTP, the secret in a header (D27). */
const STOP_PATH = "/stop";
const SECRET_HEADER = "x-swarm-secret";
/** How long a closing server lets its clients finish their close handshake. */
const CLOSE_GRACE_MS = 500;

const CALLABLE: ReadonlySet<string> = new Set(RPC_METHODS);

/** `subscribed`: a reader that sent `subscribe`, told `changed` after each commit (D23). */
type Speaker = { socket: WebSocket; member: Hello["member"] | null; lastPong: number; subscribed: boolean };
/** A call running or answered, keyed by its id, whatever connection sent it. */
type CallRecord = { speaker: Speaker; answer: string | null; answeredAt: number; cancelWait: AbortController | null };

type ServerOptions = { dataRoot: string; host?: string; port?: number; now?: () => Date };

/** Starts the board server of `opts.dataRoot`, its start lock taken first (D40): while another live
 *  server holds it, this one refuses to start; a lock left by a dead process is replaced. */
export async function startBoardServer(opts: ServerOptions): Promise<{ url: string; close(): Promise<void> }> {
  logStart(opts.dataRoot);
  await takeStartLock(opts.dataRoot);
  try {
    return await runBoardServer(opts);
  } catch (e) {
    releaseStartLock(opts.dataRoot);
    throw e;
  }
}

/** D42: first in the log, who this server is and who started it, so a stray server can be traced. */
function logStart(dataRoot: string): void {
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.appendFileSync(serverLogFile(dataRoot), `serve: home ${path.resolve(dataRoot)}, pid ${process.pid}, started by ${process.ppid} ${starterCommandLine()}\n`);
}

/** The starter's command line: what a spawning CLI passed, else read from /proc where there is one, else "unknown". */
function starterCommandLine(): string {
  const passed = process.env[SERVER_STARTER_ENV];
  if (passed) return passed;
  try {
    const read = fs.readFileSync(`/proc/${process.ppid}/cmdline`, "utf8").split("\0").filter(Boolean).join(" ");
    if (read) return read;
  } catch {}
  return "unknown";
}

/** How often, and how many times, a start lock found empty (its taker mid-write) is read again. */
const LOCK_READ_RETRY_MS = 50;
const LOCK_READ_RETRIES = 20;

/** Takes `dataRoot`'s start lock for this process (D40); throws while a live server holds it. */
async function takeStartLock(dataRoot: string): Promise<void> {
  fs.mkdirSync(dataRoot, { recursive: true });
  const lock = serverStartLock(dataRoot);
  for (let emptyReads = 0; ; ) {
    try {
      // exclusive create: of the servers racing on one data home, one takes it (D40)
      fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    const holder = serverLockHolder(dataRoot);
    // a server of this process restarting on the same data home (the tests' in-process servers)
    if (holder === process.pid) return;
    if (holder !== null && liveStartLockHolder(dataRoot) === holder) throw new Error(`swarm: a board server already runs on this data home (pid ${holder})`);
    if (holder === null && ++emptyReads <= LOCK_READ_RETRIES) {
      await new Promise((r) => setTimeout(r, LOCK_READ_RETRY_MS));
      continue;
    }
    // its holder is dead, or it never got a pid: stale, replaced
    await removeStaleStartLock(dataRoot, holder);
    emptyReads = 0;
  }
}

/** How old a stale lock's breaker must be to be taken for abandoned: its taker died mid-replace. */
const BREAKER_STALE_MS = 5_000;

/** Removes the start lock if it still names `seen`, the stale holder read, under a breaker file: two
 *  servers that both read the same stale lock would otherwise each remove it, the second removing the
 *  lock the first had just taken, and both would run (D40). */
async function removeStaleStartLock(dataRoot: string, seen: number | null): Promise<void> {
  const breaker = `${serverStartLock(dataRoot)}.break`;
  try {
    fs.writeFileSync(breaker, String(process.pid), { flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    // another server is replacing it: read the lock again after it
    try {
      if (Date.now() - fs.statSync(breaker).mtimeMs > BREAKER_STALE_MS) fs.rmSync(breaker, { force: true });
    } catch {}
    await new Promise((r) => setTimeout(r, LOCK_READ_RETRY_MS));
    return;
  }
  try {
    if (serverLockHolder(dataRoot) === seen) fs.rmSync(serverStartLock(dataRoot), { force: true });
  } finally {
    fs.rmSync(breaker, { force: true });
  }
}

/** Removes the start lock if this process holds it. */
function releaseStartLock(dataRoot: string): void {
  if (serverLockHolder(dataRoot) === process.pid) fs.rmSync(serverStartLock(dataRoot), { force: true });
}

async function runBoardServer(opts: ServerOptions): Promise<{ url: string; close(): Promise<void> }> {
  const host = opts.host ?? "127.0.0.1";
  const now = opts.now ?? (() => new Date());
  const board: Board = await openBoard(path.join(opts.dataRoot, "swarm.sqlite"));
  const secret = crypto.randomBytes(24).toString("hex");
  const version = bundleVersion();
  const speakers = new Set<Speaker>();
  const calls = new Map<string, CallRecord>();
  /** Per run, per member (its seat or slice id): its link connected, else since when it is lost (D12). */
  const links = new Map<number, Map<string, { connected: boolean; lostAt: number | null }>>();
  const memberOf = (name: string): string => name.slice(name.lastIndexOf("/") + 1);
  /** Sets a member's link here and in the store (D37). */
  const keepLink = (run: number, member: string, link: { connected: boolean; lostAt: number | null }): void => {
    const members = links.get(run) ?? new Map<string, { connected: boolean; lostAt: number | null }>();
    links.set(run, members);
    members.set(member, link);
    logged("recordLink", () => board.recordLink(run, member, link));
  };
  const linked = (m: NonNullable<Speaker["member"]>, connected: boolean): void =>
    keepLink(m.run, memberOf(m.name), connected ? { connected: true, lostAt: null } : { connected: false, lostAt: now().getTime() });
  /** Per run, per member: the transcript path its link last sent (idea 1, rule 4). */
  const transcripts = new Map<number, Map<string, string>>();
  /** A transcript's mtime, a stat and never a read; null when it is not a file. */
  const grewAt = (file: string | undefined): number | null => {
    if (!file) return null;
    try {
      const st = fs.statSync(file);
      return st.isFile() ? st.mtimeMs : null;
    } catch {
      return null;
    }
  };
  const presenceIn = (run: number): Presence => (member) => {
    const link = links.get(run)?.get(member) ?? { connected: false, lostAt: null };
    return link.connected ? link : { ...link, transcriptGrewAt: grewAt(transcripts.get(run)?.get(member)) };
  };
  /** An upkeep or tick that throws is logged, and the server goes on (S21). */
  const logged = (what: string, fn: () => void): void => {
    try {
      fn();
    } catch (e) {
      console.error(`swarm server: ${what} failed: ${(e as Error).stack ?? (e as Error).message}`);
    }
  };

  // D37: presence outlives a restart. A link the last server saw connected is lost from this start: back
  // within LINK_LOST_MS it never counts, else its member is gone; a link already lost keeps its loss time.
  const startedAt = now().getTime();
  for (const saved of board.savedLinks())
    keepLink(saved.run, saved.member, saved.connected ? { connected: false, lostAt: startedAt } : { connected: false, lostAt: saved.lostAt });

  const send = (s: Speaker, f: Frame): void => {
    if (s.socket.readyState === s.socket.OPEN) s.socket.send(encode(f));
  };
  const refuse = (s: Speaker, reason: Extract<Frame, { type: "refused" }>["reason"]): void => {
    send(s, { type: "refused", reason });
    s.socket.close();
  };

  const answer = (id: string, rec: CallRecord, text: string): void => {
    rec.answer = text;
    rec.answeredAt = Date.now();
    rec.cancelWait = null;
    if (rec.speaker.socket.readyState === rec.speaker.socket.OPEN) rec.speaker.socket.send(text);
    void id;
  };

  const dropWait = (id: string): void => {
    const rec = calls.get(id);
    if (!rec || rec.answer !== null) return;
    // a cancelled wait is never cached: resent, it runs again
    calls.delete(id);
    rec.cancelWait?.abort();
  };

  const run = (s: Speaker, call: Call): void => {
    const known = calls.get(call.id);
    if (known) {
      // resent after a reconnect: answered once, from the cache or when the running call ends (D4)
      known.speaker = s;
      if (known.answer !== null) s.socket.send(known.answer);
      return;
    }
    const rec: CallRecord = { speaker: s, answer: null, answeredAt: 0, cancelWait: null };
    calls.set(call.id, rec);
    const fail = (error: string): void => answer(call.id, rec, encode({ type: "result", id: call.id, ok: false, error }));
    if (!CALLABLE.has(call.method)) return fail(`unknown method ${String(call.method)}`);
    const args = Array.isArray(call.args) ? [...call.args] : [];
    if (call.method === "wait") {
      rec.cancelWait = new AbortController();
      args[1] = { ...((args[1] as object | undefined) ?? {}), signal: rec.cancelWait.signal };
    }
    let out: unknown;
    try {
      out = (board[call.method as RpcMethod] as (...a: unknown[]) => unknown)(...args);
    } catch (e) {
      return fail((e as Error).message);
    }
    const settle = (value: unknown): void => {
      if (calls.get(call.id) !== rec) return; // cancelled meanwhile
      answer(call.id, rec, encode({ type: "result", id: call.id, ok: true, value: value === undefined ? null : value }));
      if (call.method === "closeRun") closed(Number(args[0]));
    };
    if (out instanceof Promise) out.then(settle, (e: Error) => calls.get(call.id) === rec && fail(e.message));
    else settle(out);
  };

  // D30: a closed run's links are told so
  const closed = (run: number): void => {
    for (const s of speakers) if (s.member?.run === run) refuse(s, "closed");
  };

  const httpServer = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === STOP_PATH && req.headers[SECRET_HEADER] === secret) {
      res.end("stopping");
      void close();
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (socket) => {
    const s: Speaker = { socket, member: null, lastPong: Date.now(), subscribed: false };
    let welcomed = false;
    socket.on("pong", () => (s.lastPong = Date.now()));
    socket.on("message", (data) => {
      let f: Frame;
      try {
        f = decode(String(data));
      } catch {
        return socket.close();
      }
      if (!welcomed) {
        if (f.type !== "hello") return socket.close();
        if (f.secret !== secret) return refuse(s, "secret");
        if (f.version !== version) return refuse(s, "version");
        if (f.member) {
          for (const other of speakers)
            if (f.supersede && other.member && other.member.name === f.member.name && other.member.run === f.member.run) refuse(other, "superseded");
          s.member = f.member;
          linked(f.member, true);
        }
        welcomed = true;
        speakers.add(s);
        return send(s, { type: "welcome", version });
      }
      if (f.type === "call") run(s, f);
      else if (f.type === "cancel") dropWait(f.id);
      else if (f.type === "bye") socket.close();
      else if (f.type === "activity" && s.member) {
        const m = s.member;
        const file = f.activity.transcript;
        if (file) {
          const members = transcripts.get(m.run) ?? new Map<string, string>();
          transcripts.set(m.run, members);
          members.set(memberOf(m.name), file);
        }
        logged("activity", () => board.recordActivity(m.run, memberOf(m.name), f.activity, now()));
      } else if (f.type === "subscribe") s.subscribed = true;
    });
    socket.on("close", () => {
      speakers.delete(s);
      // its link lost, unless another link of the same member took over (superseded)
      const m = s.member;
      if (m && ![...speakers].some((o) => o.member?.run === m.run && o.member.name === m.name)) linked(m, false);
      // D16: a wait whose link went is cancelled at once; resent after a reconnect, it runs again
      for (const [id, rec] of calls) if (rec.speaker === s && rec.answer === null && rec.cancelWait) dropWait(id);
    });
  });

  const port = await listen(httpServer, host, opts.port ?? 0);
  const state: ServerState = { pid: process.pid, port, secret, version };
  const stateFile = serverStateFile(opts.dataRoot);
  fs.mkdirSync(opts.dataRoot, { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state));

  // D23: every commit, as the board sees it in this process, told to the readers that subscribed
  const stopTellingReaders = board.onChange((repo) => {
    for (const s of speakers) if (s.subscribed) send(s, { type: "changed", repo });
  });

  const upkeep = setInterval(() => {
    const at = now();
    logged("upkeep", () => board.upkeepIfDue(at));
    // D13: the per-run poller's tick, in the server
    logged("liveness", () => {
      // one run's failing tick never stops another's
      for (const r of board.runs()) logged(`liveness of run ${r.id}`, () => board.livenessTick(r.id, at, presenceIn(r.id)));
    });
    const t = Date.now();
    for (const [id, rec] of calls) if (rec.answer !== null && t - rec.answeredAt > RESULT_CACHE_MS) calls.delete(id);
  }, UPKEEP_LOOK_MS);
  const ping = setInterval(() => {
    const t = Date.now();
    for (const s of speakers) {
      if (t - s.lastPong > PONG_WITHIN_MS) s.socket.terminate();
      else s.socket.ping();
    }
  }, PING_EVERY_MS);

  let closing: Promise<void> | null = null;
  const close = (): Promise<void> =>
    (closing ??= (async () => {
      clearInterval(upkeep);
      clearInterval(ping);
      stopTellingReaders();
      for (const s of speakers) refuse(s, "shutdown");
      for (const id of [...calls.keys()]) dropWait(id);
      // wss.close waits for every client: one caught mid-close would hold it for its own timeout
      const wssClosed = new Promise<void>((r) => wss.close(() => r()));
      const cut = setTimeout(() => wss.clients.forEach((c) => c.terminate()), CLOSE_GRACE_MS);
      await wssClosed;
      clearTimeout(cut);
      await new Promise<void>((r) => httpServer.close(() => r()));
      board.close();
      try {
        const written = JSON.parse(fs.readFileSync(stateFile, "utf8")) as ServerState;
        if (written.pid === state.pid && written.port === state.port) fs.rmSync(stateFile);
      } catch {}
      releaseStartLock(opts.dataRoot);
      closedListeners.forEach((l) => l());
    })());
  const closedListeners: (() => void)[] = [];
  serversClosed.set(stateFile, closedListeners);

  return { url: `ws://${host}:${port}`, close };
}

/** Per state file, what to run once the server writing it has closed: the `serve` verb exits there. */
const serversClosed = new Map<string, (() => void)[]>();

/** Runs `then` once the server of this data home started in this process has closed. */
export function onBoardServerClosed(dataRoot: string, then: () => void): void {
  serversClosed.get(serverStateFile(dataRoot))?.push(then);
}

/** What `serve stop` runs (D27): asks the running server to stop and waits for its state file to go.
 *  False when none ran; a state file left by a dead server is removed. */
export async function stopBoardServer(dataRoot: string): Promise<boolean> {
  const file = serverStateFile(dataRoot);
  let state: ServerState;
  try {
    state = JSON.parse(fs.readFileSync(file, "utf8")) as ServerState;
  } catch {
    return false;
  }
  try {
    const res = await fetch(`http://127.0.0.1:${state.port}${STOP_PATH}`, { method: "POST", headers: { [SECRET_HEADER]: state.secret } });
    if (!res.ok) throw new Error(`refused ${res.status}`);
  } catch {
    fs.rmSync(file, { force: true });
    // and the start lock its dead server left (D40)
    const holder = serverLockHolder(dataRoot);
    if (holder !== null && liveStartLockHolder(dataRoot) === null) fs.rmSync(serverStartLock(dataRoot), { force: true });
    return false;
  }
  for (let i = 0; i < 100 && fs.existsSync(file); i++) await new Promise((r) => setTimeout(r, 50));
  return true;
}

/** Listens on `port`; a port in use is retried on another (0). */
function listen(server: http.Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (e: NodeJS.ErrnoException): void => {
      if (e.code === "EADDRINUSE" && port !== 0) {
        server.off("error", onError);
        resolve(listen(server, host, 0));
      } else reject(e);
    };
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve((server.address() as { port: number }).port);
    });
  });
}
