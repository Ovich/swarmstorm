// The swarm board server (swarm-relay D2): the one process that opens the store, answering every
// call of the links and CLIs over one WebSocket endpoint on the loopback. This root wires the instance,
// presence, calls and connections (plan 2026-11-27-codebase-rework#D14), runs the interval jobs and closes in order.
import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { WebSocketServer } from "ws";
import { makeTracer, setTracer, trace } from "../host/trace.ts";
import { openBoard, type Board } from "../board/board.ts";
import { makeAuthority } from "./authority.ts";
import { bundleVersion, type ServerState } from "../contract/wire.ts";
import { serverStateFile } from "../host/home.ts";
import { takeInstance, listen, stopInstance, type Instance } from "./instance.ts";
import { openPresence } from "./presence.ts";
import { makeCallTable, type AfterTable } from "./calls.ts";
import { makeConnections, PING_EVERY_MS, type Connections } from "./connections.ts";
import { guarded } from "./guarded.ts";

export { silentTooLong } from "./connections.ts";

/** The board's upkeep is looked at this often, and every open run's liveness ticked (D13). */
const UPKEEP_LOOK_MS = 1000;
/** The trace's snapshot period. */
const SNAPSHOT_MS = 30_000;
/** How long a closing server lets its clients finish their close handshake. */
const CLOSE_GRACE_MS = 500;

type ServerOptions = { dataRoot: string; host?: string; port?: number; now?: () => Date };

/** Starts the board server of `opts.dataRoot`, its start lock taken first (D40): while another live
 *  server holds it, this one refuses to start; a lock left by a dead process is replaced. */
export async function startBoardServer(opts: ServerOptions): Promise<{ url: string; close(): Promise<void> }> {
  const instance = await takeInstance(opts.dataRoot);
  try {
    return await runBoardServer(opts, instance);
  } catch (e) {
    instance.release();
    throw e;
  }
}

async function runBoardServer(opts: ServerOptions, instance: Instance): Promise<{ url: string; close(): Promise<void> }> {
  const host = opts.host ?? "127.0.0.1";
  const now = opts.now ?? (() => new Date());
  const board: Board = await openBoard(path.join(opts.dataRoot, "swarm.sqlite"));
  // the trace (logs/<day>/): this server is its one writer
  const tracer = makeTracer(opts.dataRoot);
  setTracer(tracer);
  tracer.prune();
  tracer.event("server", { action: "start", pid: process.pid });
  const authority = makeAuthority(board);
  const ticket = crypto.randomBytes(24).toString("hex");
  const version = bundleVersion();
  // D37, board-split D55: presence outlives a restart
  const presence = openPresence(board, now);
  // bound late: the connections are made from the calls whose effects reach them
  let connections: Connections;
  const after: AfterTable = {
    closeRun: (args) => connections.closeRun(Number(args[0])),
    // V-17 (D56): an ended member's link is told so, and exits 0 on its own before its worktree goes
    end: (args) => connections.ended((args[0] as { name?: string } | undefined)?.name),
    join: (_args, value) => presence.joined(value as { member: { run: number; seat: string } }),
  };
  const calls = makeCallTable({ board, authority, log: instance.log, after });
  connections = makeConnections({ board, authority, calls, presence, ticket, version, log: instance.log, logVersionRefused: instance.logVersionRefused });

  const httpServer = http.createServer(instance.stopListener(ticket, () => void close()));
  const wss = new WebSocketServer({ server: httpServer });
  wss.on("connection", (socket, upgrade) => connections.accept(socket, upgrade));

  const port = await listen(httpServer, host, opts.port ?? 0);
  const stateFile = serverStateFile(opts.dataRoot);
  instance.publish({ pid: process.pid, port, ticket, version } satisfies ServerState);

  // D23: every commit, as the board sees it in this process, told to the readers that subscribed
  const stopTellingReaders = board.onChange((repo) => connections.tellChanged(repo));

  const upkeep = setInterval(() => {
    const at = now();
    guarded("upkeep", () => board.upkeepIfDue(at));
    // D13: the per-run poller's tick, in the server
    guarded("liveness", () => {
      // one run's failing tick never stops another's
      for (const r of board.runs()) guarded(`liveness of run ${r.id}`, () => board.livenessTick(r.id, at, presence.presenceIn(r.id)));
    });
    calls.forgetOld();
  }, UPKEEP_LOOK_MS);
  // the trace's snapshot: every member of every open run, its state, unread and doing; the old days pruned once a day
  let prunedDay = new Date().toISOString().slice(0, 10);
  const snapshot = setInterval(() => {
    guarded("trace snapshot", () => {
      const day = new Date().toISOString().slice(0, 10);
      if (day !== prunedDay) {
        prunedDay = day;
        tracer.prune();
      }
      for (const repo of new Set(board.runs().map((r) => r.repo))) {
        const roster = board.roster(repo);
        for (const run of new Set(roster.map((m) => m.run))) {
          const members = roster.filter((m) => m.run === run);
          const states: Record<string, number> = {};
          for (const m of members) states[String(m.state)] = (states[String(m.state)] ?? 0) + 1;
          trace().event("snapshot", { run, states, members: members.map((m) => ({ seat: m.seat, state: m.state, unread: m.unread, doing: m.doing })) });
        }
      }
    });
  }, SNAPSHOT_MS);
  const ping = setInterval(() => connections.pingRound(), PING_EVERY_MS);

  let closing: Promise<void> | null = null;
  const close = (): Promise<void> =>
    (closing ??= (async () => {
      clearInterval(upkeep);
      clearInterval(snapshot);
      setTracer(null);
      clearInterval(ping);
      stopTellingReaders();
      connections.shutdown();
      calls.dropAll();
      // wss.close waits for every client: one caught mid-close would hold it for its own timeout
      const wssClosed = new Promise<void>((r) => wss.close(() => r()));
      const cut = setTimeout(() => wss.clients.forEach((c) => c.terminate()), CLOSE_GRACE_MS);
      await wssClosed;
      clearTimeout(cut);
      await new Promise<void>((r) => httpServer.close(() => r()));
      board.close();
      instance.release();
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
export const stopBoardServer = stopInstance;
