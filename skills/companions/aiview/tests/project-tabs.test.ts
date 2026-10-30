// board-split#D41: each tab belongs to one project; an agent's open or pointer moves only the tabs on its own
// project, and opens a new tab when none shows it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type http from "node:http";
import { openIndex, type Index } from "../src/core/db.ts";
import { startServer } from "../src/server/index.ts";
import { boardHash, hashWithBoardProject, readBoardHash } from "../src/core/boardhash.ts";
import type { ShowResponse } from "../src/core/api.ts";

let tmp: string;
let index: Index;
let server: http.Server;
let base: string;
let docId: number;
const tabsOpened: string[] = [];

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aiview-tabs-"));
  const root = path.join(tmp, "repo");
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  index = openIndex(path.join(tmp, "test.sqlite"), root);
  for (const slug of ["alpha", "beta", "gamma"]) index.upsertProject(slug, { addPaths: [path.join(tmp, slug)] });
  fs.mkdirSync(path.join(tmp, "beta", "shop", ".git"), { recursive: true });
  index.addBoardRepo("beta", path.join(tmp, "beta", "shop", ".git"));
  const file = path.join(root, "docs", "x.brainstorm.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "# X\n");
  docId = index.register(file, {}).id;
  server = startServer(index, { port: 0, open: false, startDoc: null, toolRoot: tmp, writeState: false, boardDataRoot: tmp, openTab: (url) => tabsOpened.push(url) });
  await new Promise<void>((r) => server.on("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  index.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** A tab on `project`: its stream, past the hello; `next` reads its next frame, or "none" within `ms`. */
async function tabOn(project: string) {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/events?project=${project}`, { signal: ctrl.signal });
  const reader = res.body!.getReader();
  await reader.read(); // hello
  const next = (ms = 400): Promise<string> =>
    Promise.race([reader.read().then((r) => new TextDecoder().decode(r.value)), new Promise<string>((r) => setTimeout(() => r("none"), ms))]);
  return { next, close: () => ctrl.abort() };
}

const post = async (route: string, body: unknown): Promise<ShowResponse> =>
  (await (await fetch(`${base}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json()) as ShowResponse;

test("two tabs on two projects: an open from alpha moves only alpha's tab; an open from gamma, none open there, opens a new one", async () => {
  const alpha = await tabOn("alpha");
  const beta = await tabOn("beta");
  try {
    const fromAlpha = await post("/api/open", { id: docId, project: "alpha" });
    assert.deepEqual(fromAlpha, { tabs: 1, opened: false });
    assert.match(await alpha.next(), /"type":"open","id":\d+/);
    assert.equal(await beta.next(), "none", "a tab on another project is never moved");

    const fromGamma = await post("/api/open", { id: docId, project: "gamma" });
    assert.deepEqual(fromGamma, { tabs: 0, opened: true });
    assert.deepEqual(tabsOpened, [`http://localhost:${(server.address() as AddressInfo).port}/#doc=${docId}`]);
    assert.equal(await alpha.next(), "none");
    assert.equal(await beta.next(), "none");
  } finally {
    alpha.close();
    beta.close();
  }
});

test("a pointer from alpha reaches only alpha's tabs", async () => {
  const alpha = await tabOn("alpha");
  const beta = await tabOn("beta");
  try {
    assert.equal((await post("/api/show", { id: docId, components: ["Pill"], project: "alpha" })).tabs, 1);
    assert.match(await alpha.next(), /"type":"show"/);
    assert.equal(await beta.next(), "none");
  } finally {
    alpha.close();
    beta.close();
  }
});

test("a board key names its project: a slug as itself, a repository on a board by its name", async () => {
  const of = async (repo: string) => (await fetch(`${base}/api/project-board?project=${repo}`)).json() as Promise<{ project?: string }>;
  assert.equal((await of("alpha")).project, "alpha");
  assert.equal((await of("shop")).project, "beta");
  assert.equal((await fetch(`${base}/api/project-board?project=nowhere`)).status, 404);
  // D47: an older `?repo=` link still answers, as `?project=`
  assert.equal(((await (await fetch(`${base}/api/project-board?repo=shop`)).json()) as { project?: string }).project, "beta");
});

test("the board hash: written, read, and given its project once", () => {
  assert.equal(boardHash("shop", 7), "#board&project=shop&run=7");
  assert.deepEqual(readBoardHash("#board&project=shop&run=7"), { project: "shop" });
  assert.deepEqual(readBoardHash("#board&run=7"), { project: null });
  assert.equal(readBoardHash("#doc=3"), null);
  assert.equal(hashWithBoardProject("#board&run=7", "alpha"), "#board&project=alpha&run=7");
  // D47: a kept `repo=` link still reads as the project, and is rewritten as `project=`, never written back
  assert.deepEqual(readBoardHash("#board&repo=shop&run=7"), { project: "shop" });
  assert.equal(hashWithBoardProject("#board&repo=shop&run=7", "shop"), "#board&project=shop&run=7");
});
