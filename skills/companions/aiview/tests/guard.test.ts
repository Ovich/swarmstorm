// aiview admits only its own origin (trust-adaptations#D3, #D4, #D22): a page open in the person's browser
// can neither drive nor read the server; the viewer (cookie) and the CLI (header) still can.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { openIndex, type Index } from "../src/core/db.ts";
import { startServer } from "../src/server/index.ts";
import { makeGuard } from "../src/server/guard.ts";

const TOKEN = "a".repeat(64);
let tmp: string;
let index: Index;
let server: http.Server;
let port: number;
let htmlId: number;

type Answer = { status: number; headers: http.IncomingHttpHeaders; body: string };

/** One request with exactly the headers given (fetch would not let a test set Host). */
const ask = (method: string, route: string, headers: Record<string, string> = {}, body?: string): Promise<Answer> =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: route, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let text = "";
      // an SSE stream never ends: its status and headers are the answer
      if (route.startsWith("/events") && res.statusCode === 200) {
        res.destroy();
        return resolve({ status: 200, headers: res.headers, body: "" });
      }
      res.setEncoding("utf8");
      res.on("data", (c) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }));
    });
    req.on("error", reject);
    req.end(body);
  });

const JSON_TYPE = { "content-type": "application/json" };
const postIndexChanged = (headers: Record<string, string>) => ask("POST", "/api/index-changed", headers, "{}");

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aiview-guard-"));
  const root = path.join(tmp, "repo");
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "dist"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "dist", "index.html"), "<!doctype html><title>viewer</title>");
  const page = path.join(root, "docs", "p.prototype.html");
  fs.mkdirSync(path.dirname(page), { recursive: true });
  fs.writeFileSync(page, "<!doctype html><p>prototype</p>");
  index = openIndex(path.join(tmp, "test.sqlite"), root);
  htmlId = index.register(page, {}).id;
  server = startServer(index, { port: 0, open: false, startDoc: null, toolRoot: tmp, writeState: false, boardDataRoot: tmp, token: TOKEN });
  await new Promise<void>((r) => server.on("listening", () => r()));
  port = (server.address() as AddressInfo).port;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  index.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("a foreign Host is refused with 421 (a DNS-rebound name)", async () => {
  assert.equal((await ask("GET", "/api/documents", { host: `evil.example:${port}` })).status, 421);
  assert.equal((await ask("GET", "/api/documents", { host: "127.0.0.1:1" })).status, 421, "another port is another host");
  assert.equal((await ask("GET", "/api/documents", { host: `localhost:${port}` })).status, 200);
});

test("a foreign Origin and Origin: null are refused with 403, on a POST and on the /events stream", async () => {
  const withToken = { ...JSON_TYPE, "x-aiview-token": TOKEN };
  for (const origin of ["http://evil.example", "null", `http://localhost:${port + 1}`]) {
    assert.equal((await postIndexChanged({ ...withToken, origin })).status, 403, `POST from ${origin}`);
    assert.equal((await ask("GET", "/events", { origin })).status, 403, `/events from ${origin}`);
    assert.equal((await ask("GET", "/api/documents", { origin })).status, 403, `a read from ${origin}`);
  }
  assert.equal((await postIndexChanged({ ...withToken, origin: `http://localhost:${port}` })).status, 200, "the viewer's own origin");
  assert.equal((await ask("GET", "/events", { origin: `http://127.0.0.1:${port}` })).status, 200);
  assert.equal((await ask("GET", "/events")).status, 200, "no Origin: a same-origin EventSource");
});

test("a POST that is not JSON is refused with 415, one without the token with 403", async () => {
  assert.equal((await postIndexChanged({ "content-type": "text/plain", "x-aiview-token": TOKEN })).status, 415);
  assert.equal((await postIndexChanged({ "x-aiview-token": TOKEN })).status, 415, "no content type at all");
  assert.equal((await postIndexChanged(JSON_TYPE)).status, 403);
  assert.equal((await postIndexChanged({ ...JSON_TYPE, "x-aiview-token": "b".repeat(64) })).status, 403, "a wrong token");
  assert.equal((await postIndexChanged({ ...JSON_TYPE, "x-aiview-token": "short" })).status, 403, "a token of another length");
});

test("the header token passes; so does the cookie the viewer's page sets", async () => {
  assert.equal((await postIndexChanged({ ...JSON_TYPE, "x-aiview-token": TOKEN })).status, 200);
  const page = await ask("GET", "/");
  assert.equal(page.status, 200);
  const [cookie] = page.headers["set-cookie"] ?? [];
  assert.match(cookie, /^aiview_token=a{64}; HttpOnly; SameSite=Strict; Path=\/$/);
  const fallback = await ask("GET", "/some/spa/route");
  assert.ok(fallback.headers["set-cookie"], "the SPA fallback is the viewer's page too");
  assert.equal((await ask("GET", "/api/documents")).headers["set-cookie"], undefined, "an API answer hands over no token");
  const pair = cookie.split(";")[0];
  assert.equal((await postIndexChanged({ ...JSON_TYPE, cookie: `other=1; ${pair}` })).status, 200);
});

test("/api/raw serves an HTML document sandboxed by its CSP", async () => {
  const raw = await ask("GET", `/api/raw/${htmlId}`);
  assert.equal(raw.status, 200);
  assert.equal(raw.headers["content-security-policy"], "sandbox allow-scripts allow-forms allow-modals allow-popups");
});

test("a dev origin is admitted only when named", () => {
  const req = (origin: string) => ({ method: "GET", headers: { host: "localhost:4321", origin } }) as unknown as http.IncomingMessage;
  assert.equal(makeGuard({ port: 4321, token: TOKEN }).check(req("http://localhost:5173"))?.status, 403);
  assert.equal(makeGuard({ port: 4321, token: TOKEN, devOrigins: ["http://localhost:5173"] }).check(req("http://localhost:5173")), null);
});
