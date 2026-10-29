// The BoardReader: the board as aiview reads it (swarm-relay D23), the one module of swarm aiview
// imports. A client of the board server, read-only: an anonymous connection (a Hello with no
// member), the reading calls, and a `subscribe` that makes the server push `changed` after each
// commit. Hides the server's start when none answers, the connection and its reconnecting.
// The client loads only when a reader opens: the board page imports this module for its types and
// pure helpers, and a browser cannot evaluate the client's node modules.
import type { BoardSnapshot, RepoSummary } from "../board/board.ts";
import type { Stats, StatsScope } from "../board/board.ts";
import type { Frame, RpcMethod } from "../wire.ts";

export type { BoardSnapshot, LockTurn, Liveness, Phase, PhaseProgress, RepoSummary, RunSummary, SnapshotMember, SnapshotEvent } from "../board/board.ts";
// The pure helpers the board page needs, so the page too reaches swarm through this door (D18).
export { planCode, nameHandle, parseMentions } from "../board/mentions.ts";
export type { Kind } from "../board/kinds.ts";
export type { Stats, StatsScope, Totals, RunStats, MemberStats, PlanRunStats, SharedFile, FileAcrossRuns, Interval, Mark, QuestionStats, BrainstormRunStats } from "../board/board.ts";

export interface BoardReader {
  /** Most recently active first, as Board.repos(). */
  repos(): Promise<RepoSummary[]>;
  /** Rejects "no repository <repo>", as Board.snapshot() throws. */
  snapshot(repo: string): Promise<BoardSnapshot>;
  /** As Board.stats: the figures of the scope's runs. */
  stats(scope: StatsScope): Promise<Stats>;
  /** The listener hears the repository of each commit, and every repository once after a reconnect. Returns the unsubscribe. */
  onChange(listener: (repo: string) => void): () => void;
  close(): void;
}

/** How long the reader waits before it tries the server again, once the connection dropped. */
const RECONNECT_MS = 200;

/** The calls a reader makes: reading only, never a write. */
const READING: readonly RpcMethod[] = ["repos", "snapshot", "stats"];

/** Opens the reader on the data home's board server, started first when none answers, as the CLI
 *  does. `swarmEntry`: the swarm launcher the server is started and versioned from. */
export async function openBoardReader(opts: { dataRoot: string; swarmEntry?: string }): Promise<BoardReader> {
  const { ensureServer, connectServer } = await import("./remote.ts");
  type Connection = Awaited<ReturnType<typeof connectServer>>;

  const listeners = new Set<(repo: string) => void>();
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let next = 0;
  let closed = false;

  const tell = (repo: string): void => {
    for (const l of [...listeners]) l(repo);
  };
  const onFrame = (f: Frame): void => {
    if (f.type === "changed") return tell(f.repo);
    if (f.type !== "result") return;
    const p = pending.get(f.id);
    if (!p) return;
    pending.delete(f.id);
    if (f.ok) p.resolve(f.value);
    else p.reject(new Error(f.error));
  };

  const connect = async (): Promise<Connection> => {
    const conn = await connectServer(await ensureServer(opts.dataRoot, opts.swarmEntry));
    conn.onFrame(onFrame);
    conn.send({ type: "subscribe" });
    conn.onClose(() => {
      // the calls in flight are lost with the connection; the next ones wait for the new one
      for (const p of pending.values()) p.reject(new Error("swarm: the board server closed the connection"));
      pending.clear();
      if (closed) return;
      connection = reconnect();
    });
    return conn;
  };
  const reconnect = async (): Promise<Connection> => {
    for (;;) {
      await new Promise((r) => setTimeout(r, RECONNECT_MS));
      if (closed) throw new Error("the reader is closed");
      try {
        const conn = await connect();
        // what moved while the server was away is unknown: every repository is told once
        const repos = (await callOn<RepoSummary[]>(conn, "repos", [])).map((r) => r.repo);
        for (const repo of repos) tell(repo);
        return conn;
      } catch {}
    }
  };
  let connection: Promise<Connection> = connect();
  await connection;

  function callOn<T>(conn: Connection, method: RpcMethod, args: unknown[]): Promise<T> {
    if (!READING.includes(method)) return Promise.reject(new Error(`the reader does not call ${method}`));
    return new Promise<T>((resolve, reject) => {
      const id = `reader-${process.pid}-${++next}`;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      try {
        conn.send({ type: "call", id, method, args });
      } catch (e) {
        pending.delete(id);
        reject(e as Error);
      }
    });
  }
  const call = <T>(method: RpcMethod, args: unknown[]): Promise<T> => connection.then((conn) => callOn<T>(conn, method, args));

  return {
    repos: () => call("repos", []),
    snapshot: (repo) => call("snapshot", [repo]),
    stats: (scope) => call("stats", [scope]),
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      closed = true;
      listeners.clear();
      void connection.then((c) => c.close(), () => {});
    },
  };
}
