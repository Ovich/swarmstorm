// The page's server, started on demand by `code open` and left running detached: it serves the page and
// answers its questions by running the verbs in its own process (verbs.mjs), the model kept in memory
// per state of the repository (HEAD and the working tree's changes) and never written anywhere.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PORT_FIRST = 41000;
const PORT_SPAN = 8000;
const portFile = (root) => join(tmpdir(), "codebase-bench", `${createHash("sha256").update(root).digest("hex").slice(0, 10)}.port`);
/** The page's fixed port for a checkout: the same every time, so a link to the page keeps working. */
export const portOf = (root) => PORT_FIRST + (Number.parseInt(createHash("sha256").update(root.split("\\").join("/").toLowerCase()).digest("hex").slice(0, 8), 16) % PORT_SPAN); // per checkout: a worktree has its own page
const alive = async (port) => { try { return (await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } };
/** The code a server runs, as it says (`/api/version`); an older server that has no such door answers null. */
const versionAt = async (port) => { try { const r = await fetch(`http://127.0.0.1:${port}/api/version`, { signal: AbortSignal.timeout(800) }); return r.ok ? (await r.text()).trim() : null; } catch { return null; } };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** A hash of the bench's own files (its core and its page): a server running other code than the checkout's is restarted. */
export const codeVersion = () => {
  const hash = createHash("sha256");
  for (const dir of [here, join(here, "..", "page")]) for (const name of readdirSync(dir).sort()) if (/\.(mjs|html)$/.test(name)) hash.update(name).update(readFileSync(join(dir, name)));
  return hash.digest("hex").slice(0, 12);
};

/**
 * The page's address for this repository, always on its fixed port. A server already there running this
 * checkout's code is reused; one running other code is asked to stop and a fresh one started; nothing is killed.
 */
export async function opened(root, view) {
  const port = portOf(root), version = codeVersion(), notes = [];
  if (await alive(port)) {
    const running = await versionAt(port);
    if (running === version) return `http://127.0.0.1:${port}/${view ? `#${view}` : ""}`;
    await fetch(`http://127.0.0.1:${port}/api/stop`, { method: "POST", signal: AbortSignal.timeout(800) }).catch(() => null);
    for (let tries = 0; tries < 25 && (await alive(port)); tries++) await pause(200);
    await pause(300); // a kept-alive socket may answer once more after the close: look again once it is gone
    if (await alive(port)) throw new Error(`an older bench server holds 127.0.0.1:${port} and has no stop door: stop the node process listening on ${port}, then run code open again`);
  }
  const file = portFile(root);
  if (existsSync(file)) { const old = Number(readFileSync(file, "utf8")); if (old && old !== port && (await alive(old))) notes.push(`(an older bench server still answers on ${old}, not used any more: stop the node process listening there when convenient)`); }
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--serve", root], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
  for (let tries = 0; tries < 50 && (await versionAt(port)) !== version; tries++) await pause(200);
  if ((await versionAt(port)) !== version) throw new Error(`the page's server did not start on ${port}: run node .claude/skills/workbench-codebase/core/server.mjs --serve <repo> to see why`);
  return [`http://127.0.0.1:${port}/${view ? `#${view}` : ""}`, ...notes].join("\n");
}

async function serve(root) {
  const { VERBS } = await import("./verbs.mjs");
  const { forget } = await import("./comparison.mjs");
  let stamp = "";
  const fresh = () => {
    let now;
    try { now = execFileSync("git", ["status", "--porcelain=v1", "-uno"], { windowsHide: true, cwd: root, encoding: "utf8" }) + execFileSync("git", ["rev-parse", "HEAD"], { windowsHide: true, cwd: root, encoding: "utf8" }); } catch { forget(); return; } // git busy (a lock, a worker merging): read again rather than show a state that may be gone
    if (now !== stamp) { stamp = now; forget(); }
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const send = (code, type, body) => { res.writeHead(code, { "content-type": type, "cache-control": "no-store" }); res.end(body); };
    if (url.pathname === "/") return send(200, "text/html; charset=utf-8", readFileSync(join(here, "..", "page", "index.html")));
    if (url.pathname === "/api/ping") return send(200, "text/plain", "ok");
    if (url.pathname === "/api/version") return send(200, "text/plain", version);
    if (url.pathname === "/api/stop" && req.method === "POST") { send(200, "text/plain", "stopping"); server.close(); server.closeAllConnections(); setTimeout(() => process.exit(0), 20); return; }
    const verb = url.pathname.replace(/^\/api\//, "");
    if (!VERBS[verb]) return send(404, "text/plain", `no verb ${verb}`);
    try {
      if (verb !== "runs") fresh(); // the trace is read from files: no git call on the page's poll
      const args = url.searchParams.getAll("arg");
      const flags = { since: url.searchParams.get("since") || undefined, head: url.searchParams.get("head") || undefined, full: true };
      const answer = VERBS[verb].run(root, args, flags);
      send(200, "application/json", JSON.stringify({ root, count: answer.count, data: answer.data }));
    } catch (error) {
      send(500, "application/json", JSON.stringify({ error: error.message }));
    }
  });
  const version = codeVersion();
  server.once("error", (error) => { console.error(`port ${portOf(root)}: ${error.message}`); process.exit(1); }); // the fixed port or nothing: a link to the page must keep working
  server.listen(portOf(root), "127.0.0.1");
  server.on("listening", () => {
    mkdirSync(dirname(portFile(root)), { recursive: true });
    writeFileSync(portFile(root), String(server.address().port));
  });
}

/**
 * Makes sure this checkout's page is up, without making the caller wait: a detached, hidden process does
 * what `open` does (reuse a server on the current code, restart a stale one, start one if none) and exits.
 */
export function ensureServed(root) {
  try {
    spawn(process.execPath, [fileURLToPath(import.meta.url), "--ensure", root], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } catch {}
}

if (process.argv[2] === "--serve") serve(process.argv[3]);
if (process.argv[2] === "--ensure") opened(process.argv[3]).then(() => process.exit(0), () => process.exit(0));
