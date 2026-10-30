// The HTTP server: 5 API routes + static UI. Phase 3: still serves the legacy
// ui.html + vendor/ for parity; Phase 4 switches static serving to dist/.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { openBrowser } from "../core/browser.ts";
import { TOOL_ROOT, type Document, type Index } from "../core/db.ts";
import type {
  DocumentsResponse,
  DocumentResponse,
  PendingEventPayload,
  IndexEventPayload,
  DataChangedEventPayload,
  ShowDoneEventPayload,
  ShowEventPayload,
  ShowResponse,
  OpenEventPayload,
} from "../core/api.ts";
import { projectForCwd } from "../core/projects.ts";
import { resolveBindings } from "../core/bind.ts";
import { formatOf, isHtml, isPdf, readDoc } from "../core/paths.ts";
import { isName } from "../core/pointer.ts";
import { clearServerFiles, writeServerFiles } from "../core/serverstate.ts";
import { collectionVersion } from "../core/collectionversion.ts";
import { DocWatcher, type DataChangedEvent } from "../core/watcher.ts";
import { mountBoard } from "./board.ts";
import { createSseHub } from "./sse.ts";

export interface ServeOptions {
  port: number;
  open: boolean;
  startDoc: Document | null;
  /** Where dist/ lives. Injectable for tests. */
  toolRoot?: string;
  /** Claim the data home's pid/port files. Tests pass false so a suite run never
   *  clobbers the state of the real server the user has open. */
  writeState?: boolean;
  /** How often open tabs are pinged. Injectable for tests. */
  heartbeatMs?: number;
  /** The data home whose swarm board server is read; the data home's by default. Tests pass
   *  their own so a suite run never reads the real board. */
  boardDataRoot?: string;
  /** The swarm launcher a board server is started from when none answers; beside aiview's by default. */
  swarmEntry?: string;
  /** Opens a new browser tab on a URL (board-split#D41: an agent's open or pointer on a project no tab shows).
   *  The system browser by default; tests pass their own. */
  openTab?: (url: string) => void;
}

const MIME: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

/** The entry bundle dist/index.html loads now (`index-<hash>.js`); null with no build. */
export function servedBuild(distDir: string): string | null {
  try {
    return /assets\/(index-[\w-]+\.js)/.exec(fs.readFileSync(path.join(distDir, "index.html"), "utf8"))?.[1] ?? null;
  } catch {
    return null;
  }
}

export function startServer(
  index: Index,
  { port, open, startDoc, toolRoot = TOOL_ROOT, writeState = true, heartbeatMs, boardDataRoot, swarmEntry, openTab = openBrowser }: ServeOptions,
): http.Server {
  // the hello names the build dist/ serves now: a tab drawn by an older build reloads (app/lib/build.ts)
  const sse = createSseHub(heartbeatMs, () => {
    const build = servedBuild(path.join(toolRoot, "dist"));
    return build ? { build } : {};
  });
  const board = mountBoard(sse, { dataRoot: boardDataRoot, swarmEntry });
  const version = collectionVersion(toolRoot);
  const watcher = new DocWatcher((dir, name) =>
    index
      .all()
      .find((d) => path.dirname(d.abs_path) === dir && path.basename(d.abs_path) === name),
  );
  watcher.on("changed", ({ id }: { id: number }) => {
    index.touch(id);
    sse.broadcast({ type: "changed", id });
  });
  watcher.on("data-changed", ({ id }: DataChangedEvent) => {
    sse.broadcast({ type: "data-changed", id } satisfies DataChangedEventPayload);
  });
  for (const d of index.all()) if (d.exists) watcher.ensureWatch(d);

  const send = (
    res: http.ServerResponse,
    status: number,
    body: string | Buffer,
    type = "application/json; charset=utf-8",
    cacheControl = "no-store",
  ) => {
    res.writeHead(status, { "content-type": type, "cache-control": cacheControl });
    res.end(body);
  };
  const json = (res: http.ServerResponse, obj: unknown, status = 200) => send(res, status, JSON.stringify(obj));

  /** The project a board hash's `project=` names (D41, D47): a project's slug, or the name of a repository on a project's
   *  board, mapped to the project whose paths cover it; null when none does. */
  const projectOfBoardKey = (key: string): string | null => {
    const projects = index.allProjects();
    if (projects.some((x) => x.slug === key)) return key;
    // a board keys a repository by its git dir or its checkout: the checkout is the folder the name is
    const checkoutOf = (repo: string): string => repo.replace(/[\\/]+$/, "").replace(/[\\/]\.git$/i, "");
    const named = (repo: string): boolean => path.basename(checkoutOf(repo)).toLowerCase() === key.toLowerCase();
    for (const x of projects) {
      const repo = index.boardRepos(x.slug).find(named);
      if (repo) return projectForCwd(checkoutOf(repo), projects)?.slug ?? x.slug;
    }
    return null;
  };
  /** Moves the tabs on `project` (D41), or, none open there, opens a new tab at `hash`; the tabs that heard it. */
  const toProjectTabs = (project: string, event: unknown, hash: string): { tabs: number; opened: boolean } => {
    const tabs = sse.broadcastTo(project, event);
    if (tabs > 0) return { tabs, opened: false };
    openTab(`http://localhost:${(server.address() as { port: number }).port}/#${hash}`);
    return { tabs: 0, opened: true };
  };

  // Static UI: the built app in dist/. The CLI's ensureDist builds it before serve/open.
  const distDir = path.join(toolRoot, "dist");
  const useDist = fs.existsSync(path.join(distDir, "index.html"));

  const serveStatic = (res: http.ServerResponse, p: string): void => {
    if (!useDist)
      return send(res, 404, `aiview UI not built. Run: npm install && npm run build  (in ${toolRoot})`, "text/plain");
    const f = path.resolve(distDir, "." + p.replaceAll("..", ""));
    const indexHtml = path.join(distDir, "index.html");
    if (f !== indexHtml && f.startsWith(distDir) && fs.existsSync(f) && fs.statSync(f).isFile()) {
      // Vite names every file under assets/ by its content hash: a new build is a new URL.
      const hashed = f.startsWith(path.join(distDir, "assets") + path.sep);
      const mime = MIME[path.extname(f).toLowerCase()] ?? "application/octet-stream";
      return send(res, 200, fs.readFileSync(f), mime, hashed ? "public, max-age=31536000, immutable" : "no-cache");
    }
    // index.html and the SPA fallback: revalidated on every load, so a plugin update's
    // new hashed bundle is picked up by the next load, never an old cached page.
    return send(res, 200, fs.readFileSync(indexHtml), "text/html; charset=utf-8", "no-cache");
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (board.handle(req, res, url)) return;
    const p = url.pathname;
    // each tab declares the project it shows (D41), again at each reconnect after a switch
    if (p === "/events") return sse.add(res, url.searchParams.get("project") || null);
    if (p === "/api/documents")
      return json(res, {
        documents: index.all(),
        groups: Object.fromEntries(index.allGroups().map((g) => [g.slug, g.title ?? g.slug])),
        projects: Object.fromEntries(index.allProjects().map((x) => [x.slug, x.title ?? x.slug])),
        recentProject: index.recentProject(),
        start: startDoc?.id ?? null,
        version,
      } satisfies DocumentsResponse);
    // The CLI writes the index in its own process; this is how it tells an open tab
    // that the document list moved, so a new document appears without a refresh.
    if (p === "/api/index-changed" && req.method === "POST") {
      req.resume(); // drain; the notification carries nothing
      req.on("end", () => {
        sse.broadcast({ type: "index" } satisfies IndexEventPayload);
        json(res, { ok: true });
      });
      return;
    }
    // The board page's source: the repositories the project's board reads, the project named (D41: no default).
    if (p === "/api/project-board") {
      // `?project=` a slug or the name the board keys it by; an older `?repo=` (a kept link) still read (D47)
      const key = url.searchParams.get("project") || url.searchParams.get("repo") || null;
      const slug = key ? projectOfBoardKey(key) : null;
      if (slug === null) return json(res, { error: key ? `no project ${key}` : "name a project: ?project=<name>" }, key ? 404 : 400);
      return json(res, { project: slug, repos: index.boardRepos(slug) });
    }
    // Pinning is the person's, from the viewer: the index stores it, every tab hears it.
    if (p === "/api/pin" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => {
        body += c;
        if (body.length > 4096) req.destroy(); // an id and a flag, not a payload
      });
      req.on("end", () => {
        let id: unknown, pinned: unknown;
        try {
          ({ id, pinned } = JSON.parse(body) as { id?: unknown; pinned?: unknown });
        } catch {
          return json(res, { error: "bad json" }, 400);
        }
        if (typeof id !== "number" || typeof pinned !== "boolean") return json(res, { error: "id and pinned required" }, 400);
        if (!index.setPinned(id, pinned)) return json(res, { error: `no such document: ${id}` }, 404);
        sse.broadcast({ type: "index" } satisfies IndexEventPayload);
        json(res, { id, pinned });
      });
      return;
    }
    // A tab's switch or an agent's open records the project shown last, for the next new tab (D41); it moves no tab.
    if (p === "/api/recent-project" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => {
        body += c;
        if (body.length > 4096) req.destroy(); // a slug, not a payload
      });
      req.on("end", () => {
        let slug: unknown;
        try {
          slug = (JSON.parse(body) as { project?: unknown }).project;
        } catch {
          return json(res, { error: "bad json" }, 400);
        }
        if (typeof slug !== "string" || !slug) return json(res, { error: "project required" }, 400);
        if (!index.allProjects().some((x) => x.slug === slug)) return json(res, { error: `no such project: ${slug}` }, 404);
        index.recordRecentProject(slug);
        json(res, { project: slug });
      });
      return;
    }
    // The CLI writes pending rows in its own process; this tells an open tab which
    // document's cards moved. It reuses the `changed` event so the reload path is the
    // one already proven by the file watcher.
    if (p === "/api/pending-changed" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => {
        body += c;
        if (body.length > 4096) req.destroy(); // an id, not a payload
      });
      req.on("end", () => {
        let id: unknown;
        try {
          id = (JSON.parse(body) as { id?: unknown }).id;
        } catch {
          return json(res, { error: "bad json" }, 400);
        }
        if (typeof id !== "number") return json(res, { error: "id required" }, 400);
        sse.broadcast({ type: "changed", id } satisfies PendingEventPayload);
        json(res, { ok: true });
      });
      return;
    }
    // The agent points at a prototype's components (`aiview show`). The CLI has validated the
    // names against the file; here they are only held to what travels safely in a URL.
    // The answer counts the tabs that heard it, so the agent knows whether to hand the
    // person the link instead.
    if (p === "/api/show" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => {
        body += c;
        if (body.length > 4096) req.destroy(); // a few names, not a payload
      });
      req.on("end", () => {
        let asked: { id?: unknown; components?: unknown; variant?: unknown; project?: unknown };
        try {
          asked = JSON.parse(body) as typeof asked;
        } catch {
          return json(res, { error: "bad json" }, 400);
        }
        const { id, components, variant, project } = asked;
        if (typeof id !== "number" || !index.get(id)) return json(res, { error: "no such document" }, 404);
        if (!Array.isArray(components) || !components.every((c): c is string => typeof c === "string" && isName(c)))
          return json(res, { error: "components must be names" }, 400);
        if (variant !== undefined && (typeof variant !== "string" || !isName(variant)))
          return json(res, { error: "variant must be a name" }, 400);
        const event = { type: "show", id, components, ...(variant ? { variant } : {}) } satisfies ShowEventPayload;
        // the agent's project (D41): only its tabs move; without one, as before, every tab
        if (typeof project === "string" && project) {
          const hash = [`doc=${id}`, ...(components.length ? [`show=${components.join(",")}`] : []), ...(variant ? [`variant=${variant}`] : [])].join("&");
          return json(res, toProjectTabs(project, event, hash) satisfies ShowResponse);
        }
        sse.broadcast(event);
        json(res, { tabs: sse.size() } satisfies ShowResponse);
      });
      return;
    }
    // The agent opened a document (`aiview open`, D41): the tabs on its project go to it; none there, a new tab does.
    if (p === "/api/open" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => {
        body += c;
        if (body.length > 4096) req.destroy(); // an id and a slug, not a payload
      });
      req.on("end", () => {
        let asked: { id?: unknown; project?: unknown };
        try {
          asked = JSON.parse(body) as typeof asked;
        } catch {
          return json(res, { error: "bad json" }, 400);
        }
        const { id, project } = asked;
        if (typeof id !== "number" || !index.get(id)) return json(res, { error: "no such document" }, 404);
        if (typeof project !== "string" || !project) return json(res, { error: "project required" }, 400);
        json(res, toProjectTabs(project, { type: "open", id } satisfies OpenEventPayload, `doc=${id}`) satisfies ShowResponse);
      });
      return;
    }
    // The pointing is over: the tabs it moved go back to where they were.
    if (p === "/api/show-done" && req.method === "POST") {
      req.resume(); // drain; the notification carries nothing
      req.on("end", () => {
        sse.broadcast({ type: "show-done" } satisfies ShowDoneEventPayload);
        json(res, { tabs: sse.size() } satisfies ShowResponse);
      });
      return;
    }
    // Doc-relative assets, confined to the document's folder.
    const a = p.match(/^\/api\/asset\/(\d+)\/(.+)$/);
    if (a) {
      const doc = index.get(Number(a[1]));
      if (!doc) return send(res, 404, "not found", "text/plain");
      // A path that leaves the folder as written is refused before it touches the disk;
      // then real paths on both sides, so a link or junction inside cannot lead out.
      const dir = path.dirname(doc.abs_path);
      const asked = path.resolve(dir, decodeURIComponent(a[2]));
      if (asked !== dir && !asked.startsWith(dir + path.sep)) return send(res, 403, "forbidden", "text/plain");
      let base: string;
      let f: string;
      try {
        base = fs.realpathSync(dir);
        f = fs.realpathSync(asked);
      } catch {
        return send(res, 404, "not found", "text/plain");
      }
      if (f !== base && !f.startsWith(base + path.sep)) return send(res, 403, "forbidden", "text/plain");
      if (!fs.statSync(f).isFile()) return send(res, 404, "not found", "text/plain");
      return send(res, 200, fs.readFileSync(f), MIME[path.extname(f).toLowerCase()] ?? "application/octet-stream");
    }
    // Raw bytes (PDF viewing) — read per request, never held open, so writers are not blocked.
    const r = p.match(/^\/api\/raw\/(\d+)$/);
    if (r) {
      const doc = index.get(Number(r[1]));
      if (!doc || !fs.existsSync(doc.abs_path)) return send(res, 404, "not found", "text/plain");
      watcher.ensureWatch(doc);
      const type = isPdf(doc.file_path)
        ? "application/pdf"
        : isHtml(doc.file_path)
          ? "text/html; charset=utf-8"
          : "text/plain; charset=utf-8";
      return send(res, 200, fs.readFileSync(doc.abs_path), type);
    }
    const m = p.match(/^\/api\/document\/(\d+)$/);
    if (m) {
      const doc = index.get(Number(m[1]));
      if (!doc) return json(res, { error: "not found" }, 404);
      const pending = index.pendingFor(doc.id);
      if (!fs.existsSync(doc.abs_path))
        return json(res, { document: doc, content: null, pending } satisfies DocumentResponse);
      watcher.ensureWatch(doc);
      if (isPdf(doc.file_path))
        return json(res, { document: doc, format: "pdf", content: null, pending } satisfies DocumentResponse);
      // An html prototype is composed here, never on disk: data-bind placeholders are replaced
      // from sibling files of the same folder (bare names only), and the watcher learns
      // which files this document now depends on. readDoc stays raw for the indexer.
      if (isHtml(doc.file_path)) {
        const dir = path.dirname(doc.abs_path);
        const reader = (name: string): string | undefined => {
          if (/[\\/]/.test(name) || name.includes("..")) return undefined;
          const f = path.join(dir, name);
          return fs.existsSync(f) && fs.statSync(f).isFile() ? readDoc(f) : undefined;
        };
        const { html, sources, errors, warnings } = resolveBindings(readDoc(doc.abs_path), reader);
        watcher.setSources(doc.id, sources.map((s) => path.join(dir, s)));
        return json(res, {
          document: doc,
          format: "html",
          content: html,
          pending,
          bindings: { sources, errors, warnings },
        } satisfies DocumentResponse);
      }
      return json(res, {
        document: doc,
        format: formatOf(doc.file_path),
        content: readDoc(doc.abs_path),
        pending,
      } satisfies DocumentResponse);
    }
    if (p.startsWith("/api/")) return send(res, 404, "not found", "text/plain");
    serveStatic(res, p);
  });

  server.on("close", () => {
    board.close();
    watcher.close();
    sse.close();
  });
  // Without this the process dies unhandled and, when detached with stdio ignored,
  // silently — the caller only sees "did not come up within 10s".
  server.on("error", (err: NodeJS.ErrnoException) => {
    console.error(
      err.code === "EADDRINUSE"
        ? `aiview: port ${port} is already in use. Retry with --port <n> or set AIVIEW_PORT.`
        : `aiview: server error: ${err.message}`,
    );
    process.exit(1);
  });
  server.listen(port, "127.0.0.1", () => {
    const actualPort = (server.address() as { port: number }).port;
    if (writeState) {
      writeServerFiles(actualPort, version);
      process.on("exit", clearServerFiles);
    }
    const url = `http://localhost:${actualPort}/${startDoc ? `#doc=${startDoc.id}` : ""}`;
    console.log(`aiview  ${startDoc ? startDoc.title : "(index)"}\n  url   ${url}`);
    if (open) openBrowser(url);
  });
  return server;
}
