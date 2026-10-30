// The board routes: swarm's board as aiview serves it (D3, D5), read through swarm's BoardReader, a
// client of the board server (swarm-relay D23). `/api/board` answers one repository's board and
// every repository; a commit on the server reaches every open tab on aiview's `/events` as
// `board-changed`. Hides the reader's opening (lazy, or at start when a server is there), and how a
// request names its repository. The SSE hub and the static page are the server's.
import fs from "node:fs";
import type http from "node:http";
import path from "node:path";
import { openBoardReader, type BoardReader, type Kind, type StatsScope } from "../../../swarm-board/src/client/reader.ts";
import type { BoardChangedEventPayload } from "../core/api.ts";
import { TOOL_ROOT } from "../core/db.ts";
import { DATA_ROOT } from "../core/home.ts";
import { commonGitDir } from "../../../swarm-board/src/place/place.ts";
import type { SseHub } from "./sse.ts";

export interface BoardRoutes {
  /** True when the request was a board route and has been answered (or is being). */
  handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL): boolean;
  close(): void;
}

/** The swarm launcher beside aiview's own, as the plugin lays the two companions out. */
const DEFAULT_SWARM_ENTRY = path.join(TOOL_ROOT, "..", "swarm-board", "swarm.mjs");
/** What a running board server writes in its data home: one there, the reader opens at start. */
const SERVER_STATE_FILE = "swarm-server.json";

export function mountBoard(
  sse: SseHub,
  opts: {
    dataRoot?: string;
    swarmEntry?: string;
    /** The repositories of the project a key names (its name, as `/api/project-board` resolves it); null when none. */
    reposOfProject?: (key: string) => string[] | null;
    /** The project's slug a key names, as the board's hash carries it (board-split D47); null when none. */
    projectOfKey?: (key: string) => string | null;
  } = {},
): BoardRoutes {
  const dataRoot = opts.dataRoot ?? DATA_ROOT;
  const swarmEntry = opts.swarmEntry ?? DEFAULT_SWARM_ENTRY;
  let reader: BoardReader | null = null;
  let opening: Promise<BoardReader> | null = null;
  let stopListening: (() => void) | null = null;
  let closed = false;

  // One open at a time; a failed one is forgotten, so the next request tries again.
  const openReader = (): Promise<BoardReader> => {
    if (reader) return Promise.resolve(reader);
    opening ??= openBoardReader({ dataRoot, swarmEntry }).then(
      (opened) => {
        if (closed) {
          opened.close();
          throw new Error("the server is closing");
        }
        reader = opened;
        stopListening = opened.onChange((repo) =>
          sse.broadcast({ type: "board-changed", repo } satisfies BoardChangedEventPayload),
        );
        return opened;
      },
      (err: unknown) => {
        opening = null;
        throw err;
      },
    );
    return opening;
  };
  // Opened at start when a board server is there, so a tab hears board changes before it asks.
  if (fs.existsSync(path.join(dataRoot, SERVER_STATE_FILE))) openReader().catch(() => {}); // a failure answers on the next request

  const json = (res: http.ServerResponse, obj: unknown, status = 200): void => {
    if (res.headersSent) return;
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(obj));
  };

  /** The project a request names, `?project=`, or an older `?repo=` (a kept link, D47); null when it names none. */
  const projectAsked = (q: URLSearchParams): string | null => q.get("project") ?? q.get("repo");

  /** Whether two spellings name one repository: `/` or `\`, on Windows any case, a worktree's `.git` its common one (aiview stores `/`, the board keys `\`). */
  const sameRepo = (a: string, b: string): boolean => {
    const norm = (r: string) => {
      // a worktree's own `.git` (a file) names its repository's common git dir, as the board keys it (G6)
      const g = fs.existsSync(r) && fs.statSync(r).isFile() ? commonGitDir(r) : r;
      return process.platform === "win32" ? path.resolve(g).toLowerCase() : path.resolve(g);
    };
    return norm(a) === norm(b);
  };

  /** The board's repository a key names: a git dir in any spelling, or a project's name, its first repository with a
   *  board (verify-3 F16); undefined when none. */
  const repoOfKey = (repos: { repo: string }[], key: string): string | undefined => {
    const direct = repos.find((r) => sameRepo(r.repo, key))?.repo;
    if (direct) return direct;
    for (const asked of opts.reposOfProject?.(key) ?? []) {
      const repo = repos.find((r) => sameRepo(r.repo, asked))?.repo;
      if (repo) return repo;
    }
    return undefined;
  };

  /** The board a request names: a run's, or a project's (`?project=`, an older `?repo=` still read, D47); `missing` is the
   *  404's message, never a fallback to another project (board-split#D41: no global scope). `/api/run?id=` kept as `?run=`. */
  const repoNamed = async (board: BoardReader, url: URL): Promise<{ repo: string } | { missing: string }> => {
    const run = url.searchParams.get(url.pathname === "/api/run" ? "id" : "run");
    const key = projectAsked(url.searchParams);
    const repos = await board.repos();
    if (run !== null) {
      const repo = repos.find((r) => r.runs.some((x) => x.run === Number(run)))?.repo;
      return repo ? { repo } : { missing: `no run ${run}` };
    }
    if (key !== null) {
      const repo = repoOfKey(repos, key);
      return repo ? { repo } : { missing: `no project ${key}` };
    }
    return { missing: "no project named: ask ?project=<project> or ?run=<id>" };
  };

  /** One repository's whole board. */
  const answerBoard = async (board: BoardReader, url: URL, res: http.ServerResponse): Promise<void> => {
    const named = await repoNamed(board, url);
    if ("missing" in named) return json(res, { error: named.missing }, 404);
    const [repos, snapshot] = await Promise.all([board.repos(), board.snapshot(named.repo)]);
    // board-split D47 (V-18): the project's one name, the slug the hash carries, over the checkout's folder name
    const key = projectAsked(url.searchParams);
    const slug = key === null ? null : (opts.projectOfKey?.(key) ?? null);
    const withProjectName = <T extends { name: string }>(o: T): T => (slug === null ? o : { ...o, name: slug });
    // the named repository's summary alone: an answer never carries another repository's runs (D41, Q1)
    json(res, { repos: repos.filter((r) => r.repo === named.repo).map(withProjectName), snapshot: withProjectName(snapshot) });
  };

  /** The figures of a scope, `BoardReader.stats()` as it answers; the scope maps the CLI's flags one to one
   *  (D34): `since=all` is `--all` (no since, every run kept), `closedOnly=1` is `--closed`, `kind` is `--kind`. */
  const answerStats = async (board: BoardReader, url: URL, res: http.ServerResponse): Promise<void> => {
    const q = url.searchParams;
    const key = projectAsked(q);
    // a named repository is read as `swarm stats --repo` reads it, its run whatever its age, pruned with its summary
    // kept or not in the board's list (plan D40); a run named alone is found among the runs the board lists
    const known = key !== null ? repoOfKey(await board.repos(), key) : undefined;
    const named = key !== null ? (known ? { repo: known } : { missing: `no project ${key}` }) : await repoNamed(board, url);
    if ("missing" in named) return json(res, { error: named.missing }, 404);
    const run = q.get("run");
    const since = q.get("since");
    const kinds = (q.get("kind") ?? "").split(",").filter(Boolean) as Kind[];
    // the keys in the CLI's order, so the two bodies are the same text
    const scope: StatsScope = {
      repo: named.repo,
      ...(run !== null ? { run: Number(run) } : {}),
      ...(since !== null && since !== "all" ? { since } : {}),
      ...(kinds.length ? { kinds } : {}),
      ...(q.get("closedOnly") === "1" ? { closedOnly: true } : {}),
    };
    let stats: Awaited<ReturnType<BoardReader["stats"]>>;
    try {
      stats = await board.stats(scope);
    } catch (err) {
      // a run unknown to the named repository is a 404, as an unknown repository is
      if (scope.run !== undefined && (err as Error).message === `no run ${scope.run}`) return json(res, { error: (err as Error).message }, 404);
      throw err;
    }
    json(res, stats);
  };

  const ROUTES = new Map<string, (board: BoardReader, url: URL, res: http.ServerResponse) => Promise<void>>([
    ["/api/board", answerBoard],
    ["/api/run", answerBoard],
    ["/api/stats", answerStats],
  ]);

  return {
    handle(req, res, url) {
      const answer = ROUTES.get(url.pathname);
      if (!answer) return false;
      if (req.method !== "GET" && req.method !== "HEAD") return false; // aiview's own 404 answers it
      openReader()
        .then((board) => answer(board, url, res))
        .catch((err: unknown) => json(res, { error: (err as Error).message }, 500));
      return true;
    },
    close() {
      closed = true;
      stopListening?.();
      reader?.close();
      reader = null;
    },
  };
}
