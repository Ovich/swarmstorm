import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type http from "node:http";
import { openIndex, type Index } from "../src/core/db.ts";
import { startServer } from "../src/server/index.ts";
import { collectionVersion } from "../src/core/collectionversion.ts";
import type { DocumentsResponse, DocumentResponse, ShowResponse } from "../src/core/api.ts";

let tmp: string;
let root: string;
let index: Index;
let server: http.Server;
let base: string;
let boardId: number;
let pdfId: number;

const write = (rel: string, content: string): string => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
};

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aiview-server-"));
  root = path.join(tmp, "repo");
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  index = openIndex(path.join(tmp, "test.sqlite"), root);

  const board = write("docs/x.brainstorm.md", "# Board X\n\n![img](assets/pic.svg)\n");
  write("docs/assets/pic.svg", "<svg/>");
  write("secret.txt", "outside the doc folder");
  boardId = index.register(board, { tags: ["t1"] }).id;
  pdfId = index.register(write("out/cv.pdf", "%PDF-1.4"), { kind: "pdf" }).id;

  server = startServer(index, { port: 0, open: false, startDoc: null, toolRoot: tmp, writeState: false, boardDataRoot: tmp });
  await new Promise<void>((r) => server.on("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  // let any in-flight watcher debounce fire against the still-open index
  await new Promise((r) => setTimeout(r, 250));
  index.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("GET /api/documents matches the shared shape, groups present", async () => {
  const r = await fetch(`${base}/api/documents`);
  assert.equal(r.status, 200);
  const body = (await r.json()) as DocumentsResponse;
  assert.equal(body.documents.length, 2);
  assert.deepEqual(body.groups, {});
  assert.equal(body.start, null);
  // every document's project has a record, so the selector can always place it
  for (const d of body.documents) assert.ok(d.project in body.projects, `${d.project} missing from projects`);
  assert.equal(body.recentProject, null);
  assert.equal("activeProject" in body, false);
  const board = body.documents.find((d) => d.id === boardId)!;
  assert.equal(board.kind, "brainstorm");
  assert.equal(board.format, "markdown");
  assert.equal(board.exists, true);
  assert.deepEqual(board.tags, ["t1"]);
  assert.ok(path.isAbsolute(board.abs_path));
});

test("GET /api/document/:id returns fresh content; pdf returns metadata only", async () => {
  const md = (await (await fetch(`${base}/api/document/${boardId}`)).json()) as DocumentResponse;
  assert.equal(md.format, "markdown");
  assert.match(md.content!, /# Board X/);
  const pdf = (await (await fetch(`${base}/api/document/${pdfId}`)).json()) as DocumentResponse;
  assert.equal(pdf.format, "pdf");
  assert.equal(pdf.content, null);
  const missing = await fetch(`${base}/api/document/999`);
  assert.equal(missing.status, 404);
});

test("GET /api/raw/:id serves bytes with the right type", async () => {
  const r = await fetch(`${base}/api/raw/${pdfId}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "application/pdf");
  assert.equal(await r.text(), "%PDF-1.4");
});

test("GET /api/asset: doc-relative ok, escape forbidden", async () => {
  const ok = await fetch(`${base}/api/asset/${boardId}/assets/pic.svg`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/svg+xml");
  const escape = await fetch(`${base}/api/asset/${boardId}/..%2F..%2Fsecret.txt`);
  assert.equal(escape.status, 403);
  const nope = await fetch(`${base}/api/asset/${boardId}/assets/nope.svg`);
  assert.equal(nope.status, 404);
});

test("static: missing dist/ yields the build instruction, unknown api path is 404", async () => {
  const ui = await fetch(`${base}/`);
  assert.equal(ui.status, 404);
  assert.match(await ui.text(), /npm run build/);
  const api = await fetch(`${base}/api/nope`);
  assert.equal(api.status, 404);
});

test("dist/ takes over static serving with SPA fallback", async () => {
  fs.mkdirSync(path.join(tmp, "dist", "assets"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "dist", "index.html"), "<title>new app</title>");
  fs.writeFileSync(path.join(tmp, "dist", "assets", "app.js"), "console.log(1)");
  // new server instance: dist presence is read at startup
  const s2 = startServer(index, { port: 0, open: false, startDoc: null, toolRoot: tmp, writeState: false, boardDataRoot: tmp });
  await new Promise<void>((r) => s2.on("listening", () => r()));
  const b2 = `http://127.0.0.1:${(s2.address() as AddressInfo).port}`;
  try {
    assert.match(await (await fetch(`${b2}/`)).text(), /new app/);
    const js = await fetch(`${b2}/assets/app.js`);
    assert.match(js.headers.get("content-type")!, /javascript/);
    assert.match(await (await fetch(`${b2}/some/spa/route`)).text(), /new app/); // fallback
  } finally {
    s2.closeAllConnections();
    await new Promise<void>((r) => s2.close(() => r()));
  }
});

test("SSE /events pushes changed on file edit", async () => {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/events`, { signal: ctrl.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const readUntil = async (match: string, timeoutMs = 5000): Promise<string> => {
    const t0 = Date.now();
    while (!buf.includes(match)) {
      if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${match}; got: ${buf}`);
      let timer!: NodeJS.Timeout;
      const timeout = new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error("read timeout")), timeoutMs);
      });
      try {
        const { value, done } = await Promise.race([reader.read(), timeout]);
        if (done) throw new Error(`stream ended waiting for ${match}; got: ${buf}`);
        buf += decoder.decode(value, { stream: true });
      } finally {
        clearTimeout(timer);
      }
    }
    return buf;
  };
  await readUntil('"hello"');
  fs.appendFileSync(path.join(root, "docs", "x.brainstorm.md"), "\nmore\n");
  await readUntil('"changed"');
  assert.match(buf, new RegExp(`"id":${boardId}`));
  ctrl.abort();
});

test("POST /api/recent-project records the project for the next new tab and moves no open tab (D41)", async () => {
  index.upsertProject("CIIP");
  const es = await fetch(`${base}/events`);
  const reader = es.body!.getReader();
  await reader.read(); // the hello frame

  const post = await fetch(`${base}/api/recent-project`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ project: "CIIP" }),
  });
  assert.equal(post.status, 200);
  assert.deepEqual(await post.json(), { project: "CIIP" });
  // nothing is broadcast: the next frame is a later event, never a project switch
  void fetch(`${base}/api/index-changed`, { method: "POST" });
  const frame = new TextDecoder().decode((await reader.read()).value);
  assert.doesNotMatch(frame, /"type":"project"/);
  await reader.cancel();

  assert.equal(index.recentProject(), "CIIP");
  const docs = (await (await fetch(`${base}/api/documents`)).json()) as DocumentsResponse;
  assert.equal(docs.recentProject, "CIIP");
});

test("POST /api/recent-project rejects an unknown project, All projects and bad input; /api/active is gone", async () => {
  const post = (body: string, route = "/api/recent-project") =>
    fetch(`${base}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body });
  assert.equal((await post(JSON.stringify({ project: "Ghost" }))).status, 404);
  assert.equal((await post(JSON.stringify({ project: "*" }))).status, 404);
  assert.equal((await post(JSON.stringify({}))).status, 400);
  assert.equal((await post("not json")).status, 400);
  assert.notEqual((await post(JSON.stringify({ project: "CIIP" }), "/api/active")).headers.get("content-type")?.startsWith("application/json"), true);
});

test("GET /api/project-board names no default project (D41)", async () => {
  const r = await fetch(`${base}/api/project-board`);
  assert.equal(r.status, 400);
});

test("POST /api/index-changed tells open tabs the document list moved", async () => {
  const es = await fetch(`${base}/events`);
  const reader = es.body!.getReader();
  await reader.read(); // hello

  const post = await fetch(`${base}/api/index-changed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(post.status, 200);

  const frame = new TextDecoder().decode((await reader.read()).value);
  assert.match(frame, /"type":"index"/);
  await reader.cancel();
});

test("POST /api/show moves every open tab to the components, and says how many heard", async () => {
  const es = await fetch(`${base}/events`);
  const reader = es.body!.getReader();
  await reader.read(); // hello

  const post = (body: unknown) =>
    fetch(`${base}/api/show`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  const ok = await post({ id: boardId, components: ["Pill", "Dock"], variant: "step-2" });
  assert.equal(ok.status, 200);
  assert.ok(((await ok.json()) as ShowResponse).tabs >= 1, "the tab listening is counted");
  const frame = new TextDecoder().decode((await reader.read()).value);
  assert.match(frame, /"type":"show"/);
  assert.match(frame, /"components":\["Pill","Dock"\],"variant":"step-2"/);
  const done = await fetch(`${base}/api/show-done`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(done.status, 200);
  assert.match(new TextDecoder().decode((await reader.read()).value), /"type":"show-done"/, "the tabs are told the question is answered");
  await reader.cancel();

  assert.equal((await post({ id: 99999, components: [] })).status, 404, "a document that is not registered");
  assert.equal((await post({ id: boardId, components: ['x"]y'] })).status, 400, "a name that would not survive a selector");
  assert.equal((await post({ id: boardId, components: [], variant: "a b" })).status, 400);
});

test("an html document is served composed: bindings resolved, summary carried, title from the raw file", async () => {
  write(
    "docs/tools.prototype.html",
    `<!doctype html><html><head><title>Tools</title><style>[data-component="Pill"]{color:red}</style></head>` +
      `<body><span data-component="Pill">v1</span><script>window.x=1</script></body></html>`,
  );
  const hostAbs = write(
    "docs/host.prototype.html",
    `<!doctype html><html><head><title>Host</title></head><body><div data-bind="tools.prototype.html#Pill" class="here"></div><div data-bind="tools.prototype.html#Nope"></div></body></html>`,
  );
  const hostId = index.register(hostAbs, { kind: "prototype" }).id;
  assert.equal(index.get(hostId)!.title, "Host", "the indexer read the raw file");

  const r = (await (await fetch(`${base}/api/document/${hostId}`)).json()) as DocumentResponse;
  assert.equal(r.format, "html");
  assert.ok(r.content!.includes('<span data-component="Pill" class="here" data-bound="tools.prototype.html#Pill">v1</span>'), r.content!);
  assert.ok(r.content!.includes('<style data-bound-style="tools.prototype.html">'), "source styles injected");
  assert.ok(!r.content!.includes("window.x"), "source scripts ignored");
  assert.deepEqual(r.bindings!.sources, ["tools.prototype.html"]);
  assert.equal(r.bindings!.errors.length, 1);
  assert.match(r.bindings!.errors[0].message, /Component Nope not in/);

  // markdown is untouched by resolution
  const md = (await (await fetch(`${base}/api/document/${boardId}`)).json()) as DocumentResponse;
  assert.equal(md.bindings, undefined);

  // saving the unregistered source reloads the host: changed carries the host's id
  const ctrl = new AbortController();
  const res = await fetch(`${base}/events`, { signal: ctrl.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const readUntil = async (match: string): Promise<void> => {
    const t0 = Date.now();
    while (!buf.includes(match)) {
      if (Date.now() - t0 > 5000) throw new Error(`timed out waiting for ${match}; got: ${buf}`);
      const { value, done } = await reader.read();
      if (done) throw new Error("stream ended");
      buf += decoder.decode(value, { stream: true });
    }
  };
  await readUntil('"hello"');
  fs.appendFileSync(path.join(root, "docs", "tools.prototype.html"), "\n");
  await readUntil(`"id":${hostId}`);
  ctrl.abort();

  const again = (await (await fetch(`${base}/api/document/${hostId}`)).json()) as DocumentResponse;
  assert.ok(again.content!.includes('data-bound="tools.prototype.html#Pill"'));
});

test("the version is the nearest plugin manifest's above the skill, at any depth, and null without one", async () => {
  const skill = path.join(tmp, "plugin", "skills", "aiview");
  fs.mkdirSync(skill, { recursive: true });
  assert.equal(collectionVersion(skill), null);
  fs.mkdirSync(path.join(tmp, "plugin", ".claude-plugin"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "plugin", ".claude-plugin", "plugin.json"), JSON.stringify({ version: "9.8.7" }));
  assert.equal(collectionVersion(skill), "9.8.7");
  const grouped = path.join(tmp, "plugin", "skills", "companions", "aiview");
  fs.mkdirSync(grouped, { recursive: true });
  assert.equal(collectionVersion(grouped), "9.8.7", "a skill inside a group folder finds the same manifest");
  fs.writeFileSync(path.join(tmp, "plugin", ".claude-plugin", "plugin.json"), "not json");
  assert.equal(collectionVersion(skill), null);

  const body = (await (await fetch(`${base}/api/documents`)).json()) as DocumentsResponse;
  assert.ok("version" in body, "GET /api/documents carries the version field");
});
