import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type http from "node:http";
import { openIndex, type Index } from "../src/store/index-db.ts";
import { startServer } from "../src/server/index.ts";

// After a plugin update the page must load the new hashed bundle: index.html is
// revalidated on every load, the hashed assets are cached for good.
let tmp: string;
let index: Index;
let server: http.Server;
let base: string;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aiview-static-"));
  const root = path.join(tmp, "repo");
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "dist", "assets"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "dist", "index.html"), '<script src="/assets/index-abc123.js"></script>');
  fs.writeFileSync(path.join(tmp, "dist", "assets", "index-abc123.js"), "console.log(1)");
  fs.writeFileSync(path.join(tmp, "dist", "favicon.svg"), "<svg/>");
  index = openIndex(path.join(tmp, "test.sqlite"), root);
  server = startServer(index, { port: 0, open: false, startDoc: null, toolRoot: tmp, writeState: false, boardDataRoot: tmp });
  await new Promise<void>((r) => server.on("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  index.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("index.html, by / or by name, is revalidated on every load", async () => {
  for (const p of ["/", "/index.html"]) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-cache", p);
    assert.match(await r.text(), /index-abc123/);
  }
});

test("the SPA fallback route is revalidated on every load", async () => {
  const r = await fetch(`${base}/some/route`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-cache");
  assert.match(r.headers.get("content-type")!, /text\/html/);
});

test("a hashed asset is cached as immutable", async () => {
  const r = await fetch(`${base}/assets/index-abc123.js`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "public, max-age=31536000, immutable");
});

test("an unhashed file at the dist root is revalidated", async () => {
  const r = await fetch(`${base}/favicon.svg`);
  assert.equal(r.headers.get("cache-control"), "no-cache");
});

test("the API stays no-store", async () => {
  const r = await fetch(`${base}/api/documents`);
  assert.equal(r.headers.get("cache-control"), "no-store");
});
