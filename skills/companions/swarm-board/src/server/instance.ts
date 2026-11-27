// The one server of a data home (D40, plan 2026-11-27-codebase-rework#D14): its start lock and the breaker that
// replaces a stale one, its state file, its log, the port it listens on, and how `serve stop` asks it to stop (D27).
import fs from "node:fs";
import type http from "node:http";
import path from "node:path";
import { bundleVersion, liveStartLockHolder, serverLockHolder, SERVER_STARTER_ENV, type ServerState } from "../contract/wire.ts";
import { serverLogFile, serverStartLock, serverStateFile } from "../host/home.ts";

/** `serve stop` asks the running server here, over HTTP, the ticket in a header (D27). */
const STOP_PATH = "/stop";
const TICKET_HEADER = "x-swarm-ticket";
/** How often, and how many times, a start lock found empty (its taker mid-write) is read again. */
const LOCK_READ_RETRY_MS = 50;
const LOCK_READ_RETRIES = 20;
/** How old a stale lock's breaker must be to be taken for abandoned: its taker died mid-replace. */
const BREAKER_STALE_MS = 5_000;

export type Instance = {
  /** One line of swarm-server.log, timestamped. */
  log(line: string): void;
  /** U-F14: every refusal for a version is evidence, appended to the server's log: which server, which hello. */
  logVersionRefused(theirs: string, from: string): void;
  /** The state file written: clients find the server by it. */
  publish(state: ServerState): void;
  /** The HTTP handler answering `serve stop` with this ticket by running `stop`; any other request a 404. */
  stopListener(ticket: string, stop: () => void): http.RequestListener;
  /** The state file removed if this server wrote it, and the start lock if this process holds it. */
  release(): void;
};

/** Takes `dataRoot` for this process (D40): its log started, then its start lock taken; throws while another live
 *  server holds it. A lock left by a dead process is replaced. */
export async function takeInstance(dataRoot: string): Promise<Instance> {
  logStart(dataRoot);
  await takeStartLock(dataRoot);
  const since = new Date().toISOString();
  const stateFile = serverStateFile(dataRoot);
  let published: ServerState | null = null;
  return {
    log(line) {
      try {
        fs.appendFileSync(serverLogFile(dataRoot), `${new Date().toISOString()} ${line}\n`);
      } catch {}
    },
    logVersionRefused(theirs, from) {
      try {
        fs.appendFileSync(serverLogFile(dataRoot), `swarm server ${process.pid} (version ${bundleVersion()}, since ${since}): refused version ${theirs} from ${from}\n`);
      } catch {}
    },
    publish(state) {
      fs.mkdirSync(dataRoot, { recursive: true });
      fs.writeFileSync(stateFile, JSON.stringify(state));
      published = state;
    },
    stopListener: (ticket, stop) => (req, res) => {
      if (req.method === "POST" && req.url === STOP_PATH && req.headers[TICKET_HEADER] === ticket) {
        res.end("stopping");
        stop();
        return;
      }
      res.statusCode = 404;
      res.end();
    },
    release() {
      if (published) {
        try {
          const written = JSON.parse(fs.readFileSync(stateFile, "utf8")) as ServerState;
          if (written.pid === published.pid && written.port === published.port) fs.rmSync(stateFile);
        } catch {}
      }
      releaseStartLock(dataRoot);
    },
  };
}

/** What `serve stop` runs (D27): asks the running server to stop and waits for its state file to go.
 *  False when none ran; a state file left by a dead server is removed. */
export async function stopInstance(dataRoot: string): Promise<boolean> {
  const file = serverStateFile(dataRoot);
  let state: ServerState;
  try {
    state = JSON.parse(fs.readFileSync(file, "utf8")) as ServerState;
  } catch {
    return false;
  }
  try {
    const res = await fetch(`http://127.0.0.1:${state.port}${STOP_PATH}`, { method: "POST", headers: { [TICKET_HEADER]: state.ticket } });
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

/** The ports the fetch standard blocks, above 1023: Node's WebSocket client (undici) refuses to connect to them, so a
 *  server the OS bound to one answers no verb ("does not answer", S31). The list is the standard's "bad port" list. */
const FETCH_BLOCKED_PORTS = new Set([1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080]);

/** Listens on `port`; a port in use is retried on another (0), and a port the OS gave that clients cannot reach is
 *  given back for another. */
export function listen(server: http.Server, host: string, port: number): Promise<number> {
  return bind(server, host, port).then((bound) => (FETCH_BLOCKED_PORTS.has(bound) ? new Promise<void>((done) => server.close(() => done())).then(() => listen(server, host, 0)) : bound));
}

function bind(server: http.Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (e: NodeJS.ErrnoException): void => {
      if (e.code === "EADDRINUSE" && port !== 0) {
        server.off("error", onError);
        resolve(bind(server, host, 0));
      } else reject(e);
    };
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve((server.address() as { port: number }).port);
    });
  });
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

/** Takes `dataRoot`'s start lock for this process (D40); throws while a live server holds it. */
async function takeStartLock(dataRoot: string): Promise<void> {
  fs.mkdirSync(dataRoot, { recursive: true });
  const lock = serverStartLock(dataRoot);
  for (let emptyReads = 0; ; ) {
    try {
      // exclusive create: of the servers racing on one data home, one takes it (D40)
      fs.writeFileSync(lock, String(process.pid), { flag: "wx" }); // AGENTS EXCEPTION (D24): node's open flag, not the code pack's
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

/** Removes the start lock if it still names `seen`, the stale holder read, under a breaker file: two
 *  servers that both read the same stale lock would otherwise each remove it, the second removing the
 *  lock the first had just taken, and both would run (D40). */
async function removeStaleStartLock(dataRoot: string, seen: number | null): Promise<void> {
  const breaker = `${serverStartLock(dataRoot)}.break`;
  try {
    fs.writeFileSync(breaker, String(process.pid), { flag: "wx" }); // AGENTS EXCEPTION (D24): node's open flag, not the code pack's
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
