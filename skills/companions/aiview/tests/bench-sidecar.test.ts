// A workbench's sidecar through the server: /api/asset's bounds, and the sidecar watch.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type http from "node:http";
import { openIndex, type Index } from "../src/store/index-db.ts";
import { startServer } from "../src/server/index.ts";

let tmp: string;
let root: string;
let index: Index;
let server: http.Server;
let base: string;
let benchId: number;
let boardId: number;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const write = (rel: string, content: string): string => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
};

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aiview-bench-"));
  root = path.join(tmp, "repo");
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  write("outside/secret.txt", "secret");
  write("docs/ok.txt", "ok");
  fs.symlinkSync(path.join(root, "outside"), path.join(root, "docs", "j"), "junction");
  index = openIndex(path.join(tmp, "test.sqlite"), root);
  benchId = index.register(write("docs/b.workbench.html", "<html></html>"), { kind: "workbench" }).id;
  boardId = index.register(write("docs/n.brainstorm.md", "# n"), {}).id;
  server = startServer(index, { port: 0, open: false, startDoc: null, toolRoot: tmp, writeState: false, boardDataRoot: tmp });
  await new Promise<void>((r) => server.on("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  await sleep(250);
  index.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

for (const [kind, id] of [["a workbench", () => benchId], ["another kind", () => boardId]] as const) {
  test(`/api/asset for ${kind}: junction escape 403, written escape 403, missing 404`, async () => {
    const status = async (rel: string) => (await fetch(`${base}/api/asset/${id()}/${rel}`)).status;
    assert.equal(await status("ok.txt"), 200);
    assert.equal(await status("j/secret.txt"), 403);
    assert.equal(await status(encodeURIComponent("../outside/secret.txt")), 403);
    assert.equal(await status("missing.txt"), 404);
  });
}

test("the sidecar watch: one data-changed per manifest rename, none for the tmp, none changed for the page", async () => {
  const events: { type: string; id?: number }[] = [];
  const ctrl = new AbortController();
  const res = await fetch(`${base}/events`, { signal: ctrl.signal });
  const reader = res.body!.getReader();
  const reading = (async () => {
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (done) return;
      buf += new TextDecoder().decode(value);
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const m = buf.slice(0, i).match(/^data: (.*)$/m);
        buf = buf.slice(i + 2);
        if (m) {
          const e = JSON.parse(m[1]);
          if (e.type !== "hello" && e.type !== "ping") events.push(e);
        }
      }
    }
  })();
  await sleep(300);

  // the sidecar created after the server started
  const side = path.join(root, "docs", "b.workbench");
  fs.mkdirSync(side);
  await sleep(500);
  assert.deepEqual(events.filter((e) => e.id === benchId), [], "no changed for the page when <stem>/ appears");

  const commit = () => {
    const tmpFile = path.join(side, "manifest.json.tmp");
    fs.writeFileSync(tmpFile, JSON.stringify({ at: Date.now() }));
    fs.renameSync(tmpFile, path.join(side, "manifest.json"));
  };
  commit();
  await sleep(600);
  assert.deepEqual(events, [{ type: "data-changed", id: benchId }]);
  events.length = 0;
  commit();
  await sleep(600);
  assert.deepEqual(events, [{ type: "data-changed", id: benchId }]);
  events.length = 0;

  fs.writeFileSync(path.join(side, "manifest.json.tmp"), "x");
  await sleep(600);
  assert.deepEqual(events, []);

  ctrl.abort();
  await reading;
});
