// The board as the CLI sees it (swarm-relay D5, D6, D19, D29, D30, D39): every Board call a verb makes,
// awaited over a member's link or straight to the server, either started on demand.
import { hiddenSpawn } from "../proc.ts";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { Board, RunId } from "../board/board.ts";
import { RPC_METHODS, bundleVersion, decode, encode, liveStartLockHolder, serverLogFile, serverStateFile, SERVER_STARTER_ENV, type Frame, type RpcMethod, type ServerState } from "../wire.ts";
import { linkPipe } from "../link/link.ts";
import type { Binding } from "../link/transcripts.ts";

export type RemoteBoard = { [K in RpcMethod]: (...a: Parameters<Board[K]>) => Promise<Awaited<ReturnType<Board[K]>>> };
export type BoardMember = { name: string; run: RunId };

/** How long a server or a link started here has to answer (D19). */
const START_TIMEOUT_MS = 5000;
const START_POLL_MS = 50;

/** The entry this CLI runs from: what a server or a link is spawned as (D28); no node flag of the caller carried over. */
const entry = (): string[] => [process.argv[1]];

/** The environment a server or a link of `dataRoot` runs in: that data home, whatever the caller's. */
const homeEnv = (dataRoot: string): NodeJS.ProcessEnv => ({ ...process.env, SWARMSTORM_HOME: dataRoot });

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: it lives, owned by someone else
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readServerState(dataRoot: string): ServerState | null {
  try {
    const s = JSON.parse(fs.readFileSync(serverStateFile(dataRoot), "utf8")) as ServerState;
    return Number.isInteger(s.pid) && Number.isInteger(s.port) ? s : null;
  } catch {
    return null;
  }
}

/** Where a detached server or link runs: never the caller's folder. On Windows a process's cwd cannot be removed, so a
 *  link spawned from a worktree kept that worktree (and a test's temporary home) from removal while it lived (S31). */
const DETACHED_CWD = os.tmpdir();

/** A state naming a live process of `swarmEntry`'s version. */
const isCurrent = (s: ServerState | null, swarmEntry: string): boolean => !!s && s.version === bundleVersion(swarmEntry) && isAlive(s.pid);


/** The running server's state, started first when the state file names no live process or another
 *  version (D6, D28); a server that does not come up within 5 s fails with the D19 message. `swarmEntry`:
 *  the swarm launcher a server is spawned and versioned from, this CLI's own by default (aiview names it). */
export async function ensureServer(dataRoot: string, swarmEntry: string = entry()[0]): Promise<ServerState> {
  const found = readServerState(dataRoot);
  if (found && isCurrent(found, swarmEntry)) return found;
  // another version still running: stopped, then replaced (D28)
  if (found && found.pid !== process.pid && isAlive(found.pid)) {
    try {
      process.kill(found.pid);
    } catch {}
    for (const until = Date.now() + START_TIMEOUT_MS; isAlive(found.pid) && Date.now() < until; ) await pause(START_POLL_MS);
  }
  // D40: a live process holding the start lock is a server starting or running; never a second one
  const startedElsewhere = (): boolean => liveStartLockHolder(dataRoot) !== null;
  let exited: string | null = null;
  if (!startedElsewhere()) {
    let log: number | "ignore" = "ignore";
    try {
      fs.mkdirSync(dataRoot, { recursive: true });
      // U-F14: appended, never truncated, so a replaced server's refusals stay readable after its successor starts
      log = fs.openSync(serverLogFile(dataRoot), "a");
      fs.writeSync(log, `--- ${new Date().toISOString()} pid ${process.pid} starts a server of ${bundleVersion(swarmEntry)} (found ${found ? `${found.version}, pid ${found.pid}` : "none"})\n`);
    } catch {}
    const child = hiddenSpawn(process.execPath, [swarmEntry, "serve"], { detached: true, cwd: DETACHED_CWD, stdio: ["ignore", log, log], windowsHide: true, env: { ...homeEnv(dataRoot), [SERVER_STARTER_ENV]: process.argv.join(" ") } });
    child.on("exit", (code, signal) => (exited = signal ? `it was killed by ${signal}` : `it exited with code ${code}`));
    child.on("error", (e) => (exited = e.message));
    child.unref();
    if (typeof log === "number") fs.closeSync(log);
  }
  for (const until = Date.now() + START_TIMEOUT_MS; Date.now() < until; ) {
    const s = readServerState(dataRoot);
    if (s && isCurrent(s, swarmEntry)) return s;
    // ours exited: lost the start lock to another server (wait for that one), or crashed
    if (exited && !startedElsewhere()) break;
    await pause(START_POLL_MS);
  }
  let said = "";
  try {
    // the error a crash prints, else the server's last word
    const all = fs.readFileSync(serverLogFile(dataRoot), "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    // the log is appended (U-F14): only what followed the last start is this start's
    const lines = all.slice(all.map((l) => l.startsWith("--- ")).lastIndexOf(true) + 1);
    said = lines.find((l) => /^(\w*Error|swarm\b)[^:]*:/.test(l)) ?? lines.filter((l) => !/^Node\.js v/.test(l)).pop() ?? "";
  } catch {}
  const reason = said || exited || `it did not answer within ${START_TIMEOUT_MS / 1000} s`;
  throw new Error(`swarm: the board server did not start: ${reason}; run swarm serve to see it`);
}

/** The binding a member's link watches for (D29): the orchestrator's `open`, a member's `join`. */
export function bindingOf(member: BoardMember): Binding {
  const [group, id] = splitMember(member.name);
  return id === "orchestrator" ? { verb: "open", group } : { verb: "join", run: member.run, seat: id };
}

function splitMember(name: string): [string, string] {
  const at = name.lastIndexOf("/");
  return [name.slice(0, at), name.slice(at + 1)];
}

function connectPipe(pipe: string): Promise<net.Socket | null> {
  return new Promise((resolve) => {
    const s = net.createConnection(pipe);
    s.once("connect", () => {
      s.removeAllListeners("error");
      resolve(s);
    });
    s.once("error", () => resolve(null));
  });
}

/** The hidden verb that runs `member`'s link, its binding derived from the name (D29, D32). */
export const linkVerbArgs = (member: BoardMember): string[] => ["link", "--run", String(member.run), "--as", member.name];

/** How long a verb in a harness session waits for the agent's own link to answer before going straight to the server (D39). */
export const HARNESS_LINK_WAIT_MS = 10_000;

/** After one miss, a later verb of the same member waits this long only: the link is still down, a full wait would only repeat the 10 s (F11, D11). */
export const LINK_DOWN_WAIT_MS = 1_000;

/** The marker of a member whose link did not answer: in the data home, one file per member, removed when the link answers. */
export const linkDownMarker = (dataRoot: string, member: BoardMember): string =>
  path.join(dataRoot, "link-down", `${member.run}-${member.name.replace(/[^A-Za-z0-9_-]/g, "_")}`);

/** Inside a harness session: the agent runs its link as its own background task, so nothing here spawns one (D39). */
export const inHarnessSession = (env: NodeJS.ProcessEnv = process.env): boolean => !!env.CLAUDE_CODE_SESSION_ID;

/** The member's pipe. Inside a harness session, the agent's own link is waited for up to `harnessWaitMs`, never spawned:
 *  null when none answers by then (D39). Outside one, a detached link is spawned first when none answers: the fallback for
 *  an agent that did not start its own as a background task (D32), and a link that died comes back (D6). */
export async function openLinkPipe(dataRoot: string, member: BoardMember, harnessWaitMs: number | null, downWaitMs: number = LINK_DOWN_WAIT_MS): Promise<net.Socket | null> {
  const pipe = linkPipe(dataRoot, member.run, member.name);
  const marker = linkDownMarker(dataRoot, member);
  const answered = (s: net.Socket): net.Socket => {
    try {
      fs.rmSync(marker, { force: true });
    } catch {}
    return s;
  };
  const there = await connectPipe(pipe);
  if (there) return answered(there);
  if (harnessWaitMs != null) {
    // D11: a link that already failed to answer is waited for briefly, not for the full wait again
    const wait = fs.existsSync(marker) ? Math.min(harnessWaitMs, downWaitMs) : harnessWaitMs;
    for (const until = Date.now() + wait; Date.now() < until; ) {
      await pause(START_POLL_MS);
      const s = await connectPipe(pipe);
      if (s) return answered(s);
    }
    try {
      fs.mkdirSync(path.dirname(marker), { recursive: true });
      fs.writeFileSync(marker, String(Date.now()));
    } catch {}
    return null;
  }
  const child = hiddenSpawn(process.execPath, [...entry(), ...linkVerbArgs(member)], {
    detached: true,
    cwd: DETACHED_CWD,
    stdio: "ignore",
    windowsHide: true,
    env: homeEnv(dataRoot),
  });
  child.on("error", () => {});
  child.unref();
  for (const until = Date.now() + START_TIMEOUT_MS; Date.now() < until; ) {
    const s = await connectPipe(pipe);
    if (s) return s;
    await pause(START_POLL_MS);
  }
  throw new Error(`swarm: ${member.name}'s link did not start`);
}

/** One JSON frame per line, as the pipe carries them (D30). */
function lineFrames(sock: net.Socket, onFrame: (f: Frame) => void): void {
  let buf = "";
  sock.setEncoding("utf8");
  sock.on("data", (chunk: string) => {
    buf += chunk;
    for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onFrame(decode(line));
    }
  });
}

type Pending = { call: Frame; sentAt: number; resolve: (v: unknown) => void; reject: (e: Error) => void };

/** A call resent on a new channel: a wait holds only what remains of its hold, never its whole hold again (board-split D56, T45). */
function resentCall(p: Pending): Frame {
  const { call } = p;
  if (call.type !== "call" || call.method !== "wait") return call;
  const options = call.args[1] as { timeoutMs?: number } | undefined;
  if (typeof options?.timeoutMs !== "number") return call;
  const remainingMs = Math.max(0, options.timeoutMs - (Date.now() - p.sentAt));
  return { ...call, args: [call.args[0], { ...options, timeoutMs: remainingMs }, ...call.args.slice(2)] };
}
type Calls = {
  call: (method: RpcMethod, args: unknown[]) => Promise<unknown>;
  settle: (f: Frame) => void;
  fail: (why: string) => void;
  /** From now on over `send`; the calls still unanswered are sent again on it. */
  reroute: (send: (f: Frame) => void) => void;
};

/** Calls by id over one channel; a closed channel fails every call still pending, unless rerouted. */
function callsOver(firstSend: (f: Frame) => void): Calls {
  let send = firstSend;
  const pending = new Map<string, Pending>();
  let next = 0;
  // the server answers a resent id from its cache (D4): ids unique across processes, a pid being reused
  const callPrefix = crypto.randomUUID();
  let closed: string | null = null;
  return {
    call(method, args) {
      if (closed) return Promise.reject(new Error(closed));
      const id = `${callPrefix}-${++next}`;
      // JSON turns a trailing undefined into null: an optional argument left out stays left out
      const given = [...args];
      while (given.length && given[given.length - 1] === undefined) given.pop();
      const frame: Frame = { type: "call", id, method, args: given };
      return new Promise((resolve, reject) => {
        pending.set(id, { call: frame, sentAt: Date.now(), resolve, reject });
        send(frame);
      });
    },
    settle(f) {
      if (f.type === "result") {
        const p = pending.get(f.id);
        if (!p) return;
        pending.delete(f.id);
        if (f.ok) p.resolve(f.value);
        else p.reject(new Error(f.error));
      } else if (f.type === "refused") this.fail(`swarm: the board refused the connection: ${f.reason}`);
    },
    fail(why) {
      closed ??= why;
      for (const p of pending.values()) p.reject(new Error(closed));
      pending.clear();
    },
    reroute(to) {
      send = to;
      for (const p of pending.values()) send(resentCall(p));
    },
  };
}

/** The anonymous connection to the server: a Hello with no member, then calls. */
export async function connectServer(state: ServerState): Promise<{ send: (f: Frame) => void; onFrame: (h: (f: Frame) => void) => void; onClose: (h: () => void) => void; close: () => void }> {
  const ws = new WebSocket(`ws://127.0.0.1:${state.port}`);
  let handler: (f: Frame) => void = () => {};
  let closer: () => void = () => {};
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => ws.send(encode({ type: "hello", version: state.version, secret: state.secret })), { once: true });
    ws.addEventListener("message", (ev) => {
      const f = decode(String(ev.data));
      if (f.type === "welcome") resolve();
      else if (f.type === "refused") reject(new Error(`swarm: the board server refused the connection: ${f.reason}`));
      else handler(f);
    });
    ws.addEventListener("error", () => reject(new Error(`swarm: the board server at port ${state.port} does not answer; run swarm serve to see it`)), { once: true });
    ws.addEventListener("close", () => closer());
  });
  return {
    send: (f) => ws.send(encode(f)),
    onFrame: (h) => (handler = h),
    onClose: (h) => (closer = h),
    close: () => ws.close(),
  };
}

function asRemote(call: (method: RpcMethod, args: unknown[]) => Promise<unknown>): RemoteBoard {
  const board = {} as Record<RpcMethod, (...a: unknown[]) => Promise<unknown>>;
  for (const m of RPC_METHODS) board[m] = (...a: unknown[]) => call(m, a);
  return board as unknown as RemoteBoard;
}

/** A verb's board; `linkMissing`: the member's calls went straight to the server, no link of its answering (D39). */
export type ConnectedBoard = RemoteBoard & { close(): void; linkMissing: boolean };

/** The board for a verb: through `member`'s link when given, else straight to the server; the server started first when
 *  none of this version runs (D6, D29). Without a link answering, outside a harness session one is started detached (D32);
 *  inside one (`harness`, from CLAUDE_CODE_SESSION_ID by default) it is waited for `harnessWaitMs`, then the calls go
 *  straight to the server, `linkMissing` set, so the verb prints the line that starts it (D39). */
export async function connectBoard(opts: { dataRoot: string; member?: BoardMember; harness?: boolean; harnessWaitMs?: number }): Promise<ConnectedBoard> {
  const state = await ensureServer(opts.dataRoot);
  if (opts.member) {
    const member = opts.member;
    const harness = opts.harness ?? inHarnessSession();
    const linkWaitMs = harness ? (opts.harnessWaitMs ?? HARNESS_LINK_WAIT_MS) : null;
    const firstSock = await openLinkPipe(opts.dataRoot, member, linkWaitMs);
    if (firstSock) {
      let linkSock: net.Socket = firstSock;
      const calls = callsOver((f) => linkSock.write(`${encode(f)}
`));
      let direct: Awaited<ReturnType<typeof connectServer>> | null = null;
      let closing = false;
      // board-split D56 (T45): the link closes when it relaunches itself on a new version (the server replaced with it), or
      // when its member ends or its run closes (D15). The calls still pending go on, resent: to the relaunched link when one
      // answers, else straight to the server running now, never the one this verb started on.
      const rerouteAfterLinkClosed = async (): Promise<void> => {
        const relaunched = await openLinkPipe(opts.dataRoot, member, HARNESS_LINK_WAIT_MS).catch(() => null);
        if (closing) {
          relaunched?.destroy();
          return;
        }
        if (relaunched) {
          wireLink(relaunched);
          calls.reroute((f) => relaunched.write(`${encode(f)}
`));
          return;
        }
        const conn = await connectServer(await ensureServer(opts.dataRoot));
        direct = conn;
        conn.onFrame((f) => calls.settle(f));
        conn.onClose(() => calls.fail("swarm: the board server closed the connection"));
        calls.reroute(conn.send);
      };
      const wireLink = (sock: net.Socket): void => {
        linkSock = sock;
        lineFrames(sock, (f) => calls.settle(f));
        sock.on("close", () => {
          if (closing) return;
          rerouteAfterLinkClosed().catch(() => calls.fail(`swarm: ${member.name}'s link closed the pipe`));
        });
        sock.on("error", () => {});
      };
      wireLink(firstSock);
      return Object.assign(asRemote(calls.call), {
        close: () => {
          closing = true;
          linkSock.destroy();
          direct?.close();
        },
        linkMissing: false,
      });
    }
  }
  const conn = await connectServer(state);
  const calls = callsOver(conn.send);
  conn.onFrame((f) => calls.settle(f));
  conn.onClose(() => calls.fail("swarm: the board server closed the connection"));
  return Object.assign(asRemote(calls.call), { close: conn.close, linkMissing: !!opts.member });
}
