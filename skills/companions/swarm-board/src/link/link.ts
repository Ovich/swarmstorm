// A member's link (swarm-relay D1): the pipe its member's CLI calls come in on, one WebSocket to the
// board server, every Call forwarded and its Result sent back to the pipe that asked. It keeps no
// state file (D15): a restart re-locates the server and re-reads. Its one file is its pid, for `stopLinks`.
import { hiddenSpawnSync } from "../proc.ts";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { DATA_ROOT } from "../board/home.ts";
import { HEARTBEAT_MS } from "../board/liveness.ts";
import { bundleVersion, decode, encode, isAlive, serverLogFile, serverStateFile, type Activity, type Bye, type Call, type Refused, type Frame, type ServerState } from "../wire.ts";
import { locate, observe, type Binding, type TranscriptCursor } from "./transcripts.ts";

type RunId = number;

/** What started the link: the verb its transcript search looks for (declared by transcripts.ts). */
export type { Binding };

/** The link's clocks; tests shorten them. */
export type LinkTiming = {
  /** after a drop, how long the link tries to reach a server before it exits (D27) */
  reconnectGiveUpMs: number;
  /** between two reconnect attempts */
  reconnectEveryMs: number;
  /** no call on any pipe and no transcript growth for this long, none pending: the link exits (D15) */
  idleMs: number;
  /** between two looks at the transcript: a locate until found, then a read (D8) */
  watchEveryMs: number;
  /** the least time between two activity frames (D10) */
  activityGapMs: number;
  /** at start, how long to wait for the server's state file */
  stateFileWaitMs: number;
};

const DEFAULT_TIMING: LinkTiming = { reconnectGiveUpMs: 60_000, reconnectEveryMs: 500, idleMs: 2 * 60 * 60_000, stateFileWaitMs: 5_000, watchEveryMs: 1_000, activityGapMs: 3_000 };

/** D7: keyed by the data home. `\\.\pipe\swarm-<hash>-<run>-<member>` on Windows, a socket file in
 *  the OS temp folder elsewhere. Built in code: a pipe path passed through Git Bash loses its
 *  backslashes. */
export function linkPipe(dataRoot: string, run: RunId, member: string): string {
  const home = crypto.createHash("sha256").update(path.resolve(dataRoot)).digest("hex").slice(0, 12);
  const name = `swarm-${home}-${run}-${member.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  return process.platform === "win32" ? `\\\\.\\pipe\\${name}` : path.join(os.tmpdir(), `${name}.sock`);
}

/** Where a live link writes its pid: under its data home, so a stop never reaches another home's link. */
export function linkPidFile(dataRoot: string, run: RunId, member: string): string {
  return path.join(dataRoot, "links", `${run}-${member.replace(/[^A-Za-z0-9_-]/g, "_")}.pid`);
}

function readServerState(dataRoot: string): ServerState | null {
  try {
    return JSON.parse(fs.readFileSync(serverStateFile(dataRoot), "utf8")) as ServerState;
  } catch {
    return null;
  }
}

/** Why a link stopped (D42): said on stderr, and in the server's log while the server answers. */
export type LinkStop =
  | { why: "refused"; reason: Refused["reason"] }
  | { why: "no server"; forMs: number }
  | { why: "ended" | "closed" | "finished" | "idle" | "pipe taken" | "server of another version" };

function describeStop(stop: LinkStop): string {
  if (stop.why === "refused") return `refused ${stop.reason}`;
  if (stop.why === "no server") return `no server for ${Math.round(stop.forMs / 1000)} s`;
  if (stop.why === "closed") return "run closed";
  return stop.why;
}

/** Prints `link <member>: <reason>` to stderr; with `toServerLog`, also appends it to the server's log
 *  when the server answers, its state file naming a live process (D42). */
function sayStop(dataRoot: string, member: string, stop: LinkStop, toServerLog: boolean): void {
  const line = `link ${member}: ${describeStop(stop)}`;
  process.stderr.write(line + "\n");
  const state = toServerLog ? readServerState(dataRoot) : null;
  if (!state || !isAlive(state.pid)) return;
  try {
    fs.appendFileSync(serverLogFile(dataRoot), line + "\n");
  } catch {}
}

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));


/** Does another link answer on this pipe? */
const pipeAnswers = (pipe: string): Promise<boolean> =>
  new Promise<boolean>((resolve) => {
    const probe = net.connect(pipe, () => (probe.destroy(), resolve(true)));
    probe.once("error", () => resolve(false));
  });

/** Listens on the member's pipe; null when another link of the same member already holds it (D37:
 *  the pipe answering is the test, asked first, whatever error a listen on a taken pipe gives). */
async function listenOnPipe(pipe: string, onPipe: (s: net.Socket) => void): Promise<net.Server | null> {
  if (await pipeAnswers(pipe)) return null;
  const tryListen = () =>
    new Promise<net.Server | "taken">((resolve) => {
      const server = net.createServer(onPipe);
      // any refusal is a link that took the pipe meanwhile, or a pipe it holds: this link is the second
      server.once("error", () => resolve("taken"));
      server.listen(pipe, () => resolve(server));
    });
  const first = await tryListen();
  if (first !== "taken") return first;
  if (process.platform === "win32" || (await pipeAnswers(pipe))) return null;
  // a socket file left by a link that died
  fs.rmSync(pipe, { force: true });
  const second = await tryListen();
  return second === "taken" ? null : second;
}

/** Runs one member's link until it exits: its member's `end`, a `refused`, no server for a minute
 *  after a drop, idle, or its agent finished (D15). Meanwhile it finds its member's transcript and
 *  sends the board what the agent is doing (D8, D10). Resolves with why it stopped, said on stderr
 *  (D42); rejects only when no server state file appears at start. */
export async function runLink(opts: {
  dataRoot: string;
  member: string;
  run: RunId;
  binding: Binding;
  /** where the transcript search reads the session and the harness root from; process.env by default */
  env?: NodeJS.ProcessEnv;
  timing?: Partial<LinkTiming>;
}): Promise<LinkStop> {
  const timing = { ...DEFAULT_TIMING, ...opts.timing };
  // D37: one link per member; a second, its pipe answering, exits at once, before anything else can fail it
  const pipeTaken = (): LinkStop => {
    const stop: LinkStop = { why: "pipe taken" };
    sayStop(opts.dataRoot, opts.member, stop, false); // D37: stderr only, the link stays at exit 0
    return stop;
  };
  if (await pipeAnswers(linkPipe(opts.dataRoot, opts.run, opts.member))) return pipeTaken();

  let state = readServerState(opts.dataRoot);
  for (const startedAt = Date.now(); !state && Date.now() - startedAt < timing.stateFileWaitMs; ) {
    await pause(100);
    state = readServerState(opts.dataRoot);
  }
  if (!state) throw new Error(`no board server state file in ${opts.dataRoot}`);

  /** Calls sent and not yet answered, by id, with the pipe that asked. */
  const unanswered = new Map<string, { call: Call; pipe: net.Socket }>();
  const pipes = new Set<net.Socket>();
  let socket: WebSocket | null = null;
  let welcomed = false;
  let exiting = false;
  /** the last call on a pipe or growth of the transcript: what keeps the link from idling out */
  let lastStirAt = Date.now();
  let finish!: (stop: LinkStop) => void;
  const finished = new Promise<LinkStop>((r) => (finish = r));

  const sendUp = (f: Frame) => {
    if (socket && welcomed && socket.readyState === WebSocket.OPEN) socket.send(encode(f));
  };

  // ── activity (D10): on change only, at most one per gap, behind the calls ──
  /** the newest activity not yet sent; a newer one replaces it while the socket is behind */
  let queuedActivity: Activity | null = null;
  let lastActivitySentAt = -Infinity;
  /** sends the queued activity when the socket has nothing of the calls left to write; `now`: the gap ignored */
  const flushActivity = (now = false) => {
    if (!queuedActivity || !socket || !welcomed || socket.readyState !== WebSocket.OPEN) return;
    if (!now && (socket.bufferedAmount > 0 || Date.now() - lastActivitySentAt < timing.activityGapMs)) return;
    socket.send(encode(queuedActivity));
    lastActivitySentAt = Date.now();
    queuedActivity = null;
  };

  let transcript: string | null = null;
  let cursor: TranscriptCursor | null = null;
  let lastSeen: string | null = null;
  const env = opts.env ?? process.env;
  /** one look: locate until found (D8), then read what was appended; a change queues an activity */
  const watchTranscript = () => {
    if (exiting) return;
    transcript ??= locate(opts.binding, env);
    if (!transcript) return; // not found (yet), or a harness that keeps none: no activity
    const read = observe(transcript, cursor, opts.binding);
    const grew = read.cursor.offset !== cursor?.offset;
    cursor = read.cursor;
    if (grew) lastStirAt = Date.now();
    // the path rides along so the server can stat it while this link is lost (idea 1, link lost)
    const activity = { ...read.activity, transcript };
    const seen = JSON.stringify(activity);
    if (seen !== lastSeen) {
      lastSeen = seen;
      queuedActivity = { type: "activity", at: Date.now(), activity };
    }
    // S40 (board-split D31): a turn ended on a background task of its own is resumed by the harness when the task
    // ends: the link stays, so its member reads busy on that task, never lost
    if (read.activity.finished && !read.activity.background) {
      // the harness says the agent ended (E14): the last activity, then bye
      flushActivity(true);
      return exit({ why: "finished" }, "finished");
    }
    flushActivity();
  };

  /** `bye`: the reason told the server, for a stop the link chose (D15) */
  const exit = (stop: LinkStop, bye?: Bye["reason"]) => {
    if (exiting) return;
    exiting = true;
    if (bye) sendUp({ type: "bye", reason: bye });
    sayStop(opts.dataRoot, opts.member, stop, stop.why !== "no server");
    clearInterval(idleCheck);
    clearInterval(watch);
    clearInterval(heartbeat);
    pipeServer?.close();
    for (const p of pipes) p.end(); // a result just written still reaches its CLI
    socket?.close();
    finish(stop);
  };

  const onDown = (f: Frame) => {
    if (f.type === "welcome") {
      welcomed = true;
      for (const { call } of unanswered.values()) sendUp(call); // D4: resent, answered from the cache
      flushActivity();
    } else if (f.type === "refused") {
      // U-F14: refused for its version, the link re-reads the state file and tries once more: a server replaced between
      // its read and its hello is met again; a second refusal, or a state of another version, ends it
      if (f.reason === "version" && !versionRetried) {
        versionRetried = true;
        console.error(`swarm link ${opts.member} (pid ${process.pid}, version ${bundleVersion()}): refused version by the server on port ${socket?.url ?? "?"}; re-reading the state, one retry`);
        socket?.close();
        return;
      }
      exit(f.reason === "closed" ? { why: "closed" } : { why: "refused", reason: f.reason });
    } else if (f.type === "result") {
      const asked = unanswered.get(f.id);
      if (!asked) return; // already answered, or its pipe closed: never delivered twice
      unanswered.delete(f.id);
      if (!asked.pipe.destroyed) asked.pipe.write(encode(f) + "\n");
      if (asked.call.method === "end" && f.ok) exit({ why: "ended" }, "ended");
    }
  };

  /** One connection; resolves when it closes, true when the server welcomed it. */
  const connectOnce = (s: ServerState) =>
    new Promise<boolean>((resolve) => {
      welcomed = false;
      let wasWelcomed = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(`ws://127.0.0.1:${s.port}`);
      } catch {
        return resolve(false);
      }
      socket = ws;
      ws.onopen = () =>
        ws.send(encode({ type: "hello", version: bundleVersion(), secret: s.secret, member: { name: opts.member, run: opts.run }, supersede: true }));
      ws.onmessage = (ev) => {
        try {
          onDown(decode(String(ev.data)));
        } catch {
          /* a frame this link does not read */
        }
        wasWelcomed ||= welcomed;
      };
      ws.onclose = () => {
        welcomed = false;
        resolve(wasWelcomed);
      };
      ws.onerror = () => {};
    });

  /** Connects, and after each drop reconnects (re-reading the state file: a restarted server has a
   *  new port and secret); D27: no server answers for a minute after a drop, the link exits. */
  /** U-F14: one retry after a `refused version`, per link. */
  let versionRetried = false;
  const connectionLoop = async () => {
    let lastAnsweredAt = Date.now();
    let s: ServerState | null = state;
    while (!exiting) {
      if (s) {
        const welcomedThisTime = await connectOnce(s);
        if (exiting) return;
        if (welcomedThisTime) lastAnsweredAt = Date.now();
      }
      if (Date.now() - lastAnsweredAt >= timing.reconnectGiveUpMs) return exit({ why: "no server", forMs: Date.now() - lastAnsweredAt });
      await pause(timing.reconnectEveryMs);
      s = readServerState(opts.dataRoot);
      // D28: a server of another version would refuse it; said as such, never as a bare refusal
      if (s && s.version !== bundleVersion()) return exit({ why: "server of another version" });
    }
  };

  const onPipe = (pipe: net.Socket) => {
    pipes.add(pipe);
    let buffered = "";
    pipe.setEncoding("utf8");
    pipe.on("data", (chunk: string) => {
      buffered += chunk;
      for (let nl = buffered.indexOf("\n"); nl >= 0; nl = buffered.indexOf("\n")) {
        const line = buffered.slice(0, nl).trim();
        buffered = buffered.slice(nl + 1);
        if (!line) continue;
        let f: Frame;
        try {
          f = decode(line);
        } catch {
          continue;
        }
        if (f.type === "call") {
          lastStirAt = Date.now();
          unanswered.set(f.id, { call: f, pipe });
          sendUp(f);
        } else if (f.type === "cancel") {
          unanswered.delete(f.id);
          sendUp(f);
        }
      }
    });
    pipe.on("error", () => {});
    pipe.on("close", () => {
      pipes.delete(pipe);
      // D16, D30: the CLI went away; its pending wait is cancelled at the server at once
      for (const [id, asked] of unanswered) {
        if (asked.pipe !== pipe) continue;
        unanswered.delete(id);
        if (asked.call.method === "wait") sendUp({ type: "cancel", id });
      }
    });
  };

  const pipeServer = await listenOnPipe(linkPipe(opts.dataRoot, opts.run, opts.member), onPipe);
  if (!pipeServer) return pipeTaken(); // one link per member per data home: this one is the second
  // its pid, for the stop before its worktree goes; removed at exit when still its own
  const pidFile = linkPidFile(opts.dataRoot, opts.run, opts.member);
  try {
    fs.mkdirSync(path.dirname(pidFile), { recursive: true });
    fs.writeFileSync(pidFile, String(process.pid));
  } catch {}
  const dropPid = (): void => {
    try {
      if (fs.readFileSync(pidFile, "utf8").trim() === String(process.pid)) fs.rmSync(pidFile);
    } catch {}
  };
  process.once("exit", dropPid);
  void finished.then(dropPid, dropPid);

  const idleCheck = setInterval(() => {
    if (unanswered.size === 0 && Date.now() - lastStirAt >= timing.idleMs) exit({ why: "idle" }, "idle");
  }, Math.min(60_000, Math.max(10, Math.floor(timing.idleMs / 4))));

  const watch = setInterval(watchTranscript, timing.watchEveryMs);
  // board-split D55: a sign of life every HEARTBEAT_MS, whatever the agent does
  const heartbeat = setInterval(() => sendUp({ type: "beat" }), HEARTBEAT_MS);
  if (state.version !== bundleVersion()) exit({ why: "server of another version" }); // D28: a server of another version would refuse it
  if (!exiting) {
    void connectionLoop();
    watchTranscript();
  }
  return finished;
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** The command line of a live process; null when it is gone or cannot be read. */
function commandLine(pid: number): string | null {
  const r =
    process.platform === "win32"
      ? hiddenSpawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`], { encoding: "utf8", windowsHide: true })
      : hiddenSpawnSync("ps", ["-o", "args=", "-p", String(pid)], { encoding: "utf8" });
  return (r.stdout ?? "").trim() || null;
}

/** Stops the members' links before their worktrees go (Windows refuses to remove a folder a live process holds):
 *  only the pid each link wrote under this data home, and only while that process is still a link. */
export function stopLinks(runId: number, members: string[]): void {
  const pids: number[] = [];
  for (const member of members) {
    const file = linkPidFile(DATA_ROOT, runId, member);
    let pid: number;
    try {
      pid = Number(fs.readFileSync(file, "utf8").trim());
    } catch {
      continue;
    }
    if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && alive(pid) && /\slink(\s|$)/.test(commandLine(pid) ?? "")) {
      try {
        process.kill(pid);
        pids.push(pid);
      } catch {}
    }
    try {
      fs.rmSync(file);
    } catch {}
  }
  for (let i = 0; i < 40 && pids.some(alive); i++) hiddenSpawnSync(process.execPath, ["-e", "setTimeout(()=>{},50)"]);
}
