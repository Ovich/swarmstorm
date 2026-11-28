// The CLI's side of the aiview server: asking it, telling it what moved, building the UI it
// serves, and starting, reusing or replacing it.
import { spawnSync } from "node:child_process"; // AGENTS EXCEPTION (D39): the raw starter of the line marked so
import fs from "node:fs";
import path from "node:path";
import { hiddenSpawn, hiddenSpawnSync, isAlive } from "../../../swarm-board/src/host/proc.ts";
import { TOOL_ROOT, type Index } from "../store/index-db.ts";
import { defaultPort, firstFreePort } from "../host/home.ts";
import { readServerStatus, readServerToken, PID_FILE, PORT_FILE, type ServerStatus } from "../host/serverstate.ts";
import { TOKEN_HEADER } from "../server/guard.ts";
import { collectionVersion } from "../host/collectionversion.ts";
import type { ShowResponse } from "../contract/api.ts";
import { fail } from "./context.ts";

/** POST to the running server, synchronously (the CLI has no event loop to await on).
 *  false = no server, or it refused; the caller decides whether that matters. */
function postToServer(route: string, body: unknown): boolean {
  return askServer(route, body) !== null;
}

/** The same POST, with the server's answer: its body on a 200, null on anything else. */
export function askServer(route: string, body: unknown): string | null {
  const st = readServerStatus();
  if (!st.running || st.port === null) return null;
  const b = JSON.stringify(body);
  // the Host the server admits, and the token it wrote (trust-adaptations#D4)
  const headers = {
    host: `127.0.0.1:${st.port}`,
    "content-type": "application/json",
    "content-length": Buffer.byteLength(b),
    [TOKEN_HEADER]: readServerToken() ?? "",
  };
  const r = hiddenSpawnSync(
    process.execPath,
    [
      "-e",
      `const b=${JSON.stringify(b)};const q=require('node:http').request(
         {host:'127.0.0.1',port:${st.port},path:${JSON.stringify(route)},method:'POST',
          headers:${JSON.stringify(headers)}},
         r=>{r.pipe(process.stdout);r.on('end',()=>process.exitCode=r.statusCode===200?0:1)});
       q.on('error',()=>process.exit(1));q.end(b);`,
    ],
    { timeout: 5000, encoding: "utf8" },
  );
  return r.status === 0 ? r.stdout : null;
}

/** The server's answer to a move of the tabs, null when no server answered. */
export function askServerToMove(route: string, body: unknown): ShowResponse | null {
  const answer = askServer(route, body);
  return answer === null ? null : (JSON.parse(answer) as ShowResponse);
}

/** Records `slug` as the project shown last, the one a new tab starts on (board-split#D41), through the server when
 *  one is up, else in the index directly. It moves no tab and scopes no verb. */
export function recordRecentProject(index: Index, slug: string): void {
  if (!postToServer("/api/recent-project", { project: slug })) index.recordRecentProject(slug);
}

/** Tell an open tab that one document's pending cards moved. Reuses the `changed`
 *  event, so the tab reloads through the path the file watcher already uses. */
export function notifyPendingChanged(documentId: number): void {
  postToServer("/api/pending-changed", { id: documentId });
}

/** Tell an open tab that the document list moved. The CLI writes sqlite in its own
 *  process, so without this a newly registered document is invisible until a refresh. */
export function notifyIndexChanged(): void {
  postToServer("/api/index-changed", {});
}

/** dist/ missing but the app source present -> build once; on failure, print the command. */
export function ensureDist(): void {
  if (fs.existsSync(path.join(TOOL_ROOT, "dist", "index.html"))) return;
  if (!fs.existsSync(path.join(TOOL_ROOT, "app", "index.html"))) return; // no app source: legacy ui
  console.error("aiview: dist/ missing — building the UI once…");
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const r = spawnSync(npm, ["run", "build"], { cwd: TOOL_ROOT, stdio: "inherit", shell: process.platform === "win32" });  // AGENTS EXCEPTION (D39): the person watches the build's output in this console
  if (r.status !== 0) fail(`aiview: UI build failed. Run: npm install && npm run build  (in ${TOOL_ROOT})`);
}

/** Spawn a detached server and wait for its portfile. Returns the actual port. */
function spawnDetachedServer(port: number): number {
  // the files of an earlier server go first: a stale pid a process of another kind now holds must never read as this one
  try {
    fs.rmSync(PORT_FILE, { force: true });
    fs.rmSync(PID_FILE, { force: true });
  } catch {}
  // re-invoke the current entry (aiview.mjs in real use, the TS source under test)
  const child = hiddenSpawn(process.execPath, [process.argv[1], "serve", "--port", String(port)], {
    detached: true,
    stdio: "ignore",
    cwd: TOOL_ROOT,
  });
  child.unref();
  const t0 = Date.now();
  for (;;) {
    const st = readServerStatus();
    // up once the files are the child's own: the pid recorded is the server's (Q3)
    if (st.running && st.port !== null && st.pid === child.pid) return st.port;
    if (Date.now() - t0 > 10_000) fail(`aiview: server did not come up within 10s (port ${port} may be in use — retry with --port <n>)`);
    // synchronous CLI: a short busy-wait poll is fine here
    pause(120);
  }
}

/** Busy-wait a little: the CLI is synchronous and has no event loop to sleep on. */
const pause = (ms: number): void => {
  hiddenSpawnSync(process.execPath, ["-e", `setTimeout(()=>{},${ms})`]);
};

/** Stop the server at this pid and wait until it is gone; its files may stay behind (on
 *  Windows the kill skips its exit hook), and read as stale once the pid is dead. */
function stopServerProcess(pid: number): void {
  try {
    process.kill(pid);
  } catch {}
  const t0 = Date.now();
  while (isAlive(pid)) {
    if (Date.now() - t0 > 5_000) fail(`aiview: the running server (pid ${pid}) is an older version and did not stop within 5s; stop it and retry`);
    pause(100);
  }
}

/** The port of a server running the installed collection: the running one when its
 *  version is the installed one, else a fresh one. A running server of another version,
 *  or with none recorded, is stopped and replaced on its own port. With no installed
 *  version to compare against, any running server is reused. `asked` is the `--port` flag. */
export function portOfInstalledServer(asked: string | undefined): number {
  const wanted = asked ?? process.env.AIVIEW_PORT;
  const st: ServerStatus = readServerStatus();
  // V2: a derived port another process already holds is passed over for the next free one; an asked port is kept as asked
  if (!st.running || st.port === null || st.pid === null) return spawnDetachedServer(wanted !== undefined ? Number(wanted) : firstFreePort(defaultPort()));
  const installed = collectionVersion(TOOL_ROOT);
  if (installed === null || st.version === installed) return st.port;
  stopServerProcess(st.pid);
  return spawnDetachedServer(st.port);
}

/** What the agent reads of a move sent to its project's tabs (D41); a browser the server may not open says why
 *  (trust-adaptations v1-F5). */
export const movedLine = (r: ShowResponse, project: string, verb: string): string => {
  if (r.browserRefusal) return noBrowserLine(project, r.browserRefusal);
  if (r.opened) return `no tab showed ${project}: opened a new one`;
  return `${verb} in ${r.tabs} open tab${r.tabs > 1 ? "s" : ""} on ${project}`;
};

/** What the agent reads when no tab shows `project` and no browser may open: the reason, and the link to hand over. */
export const noBrowserLine = (project: string, refusal: string): string =>
  `no tab showed ${project}, and no browser opened (${refusal}): give the person the link`;
