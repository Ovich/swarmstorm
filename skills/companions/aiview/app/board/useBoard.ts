// One repository's whole board, live: GET /api/board and aiview's /events; refetched on the
// `board-changed` of the snapshot's repository; `hello` and `ping` keep the connection state.
import { useEffect, useState } from "react";
import type { BoardSnapshot, RepoSummary } from "../../../swarm-board/src/client/reader.ts";
import { reloadOnNewBuild } from "../lib/build.ts";

export type Connection = "live" | "reconnecting";

export interface BoardState {
  repos: RepoSummary[];
  /** null while loading, or on error. */
  snapshot: BoardSnapshot | null;
  /** The server's 404 message. */
  error: string | null;
  connection: Connection;
}

/** The board route for the page's selection: a run's repository, a repository, or the most recently active. */
export function boardUrl({ repo, run }: { repo: string | null; run: number | null }): string {
  if (run !== null) return `/api/board?run=${run}`;
  if (repo !== null) return `/api/board?project=${encodeURIComponent(repo)}`;
  return "/api/board";
}

export function useBoard({ repo, run }: { repo: string | null; run: number | null }): BoardState {
  const [state, setState] = useState<BoardState>({ repos: [], snapshot: null, error: null, connection: "reconnecting" });

  useEffect(() => {
    let shownRepo: string | null = null;
    let live = true;
    const load = (): void => {
      void fetch(boardUrl({ repo, run }), { cache: "no-store" })
        .then(async (r) => {
          const body = (await r.json()) as { repos: RepoSummary[]; snapshot: BoardSnapshot } | { error: string };
          if (!live) return;
          if ("error" in body) return setState((s) => ({ ...s, snapshot: null, error: body.error }));
          shownRepo = body.snapshot.repo;
          setState((s) => ({ ...s, repos: body.repos, snapshot: body.snapshot, error: null }));
        })
        .catch(() => {});
    };
    load();
    const setConnection = (connection: Connection): void => setState((s) => (s.connection === connection ? s : { ...s, connection }));
    const es = new EventSource("/events");
    es.onopen = () => setConnection("live");
    es.onerror = () => setConnection("reconnecting");
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data) as { type: string; repo?: string; build?: string };
      if (ev.type === "hello") reloadOnNewBuild(ev.build);
      if (ev.type === "hello" || ev.type === "ping") setConnection("live");
      if (ev.type === "board-changed" && (shownRepo === null || ev.repo === shownRepo)) load();
    };
    return () => {
      live = false;
      es.close();
    };
  }, [repo, run]);

  return state;
}
