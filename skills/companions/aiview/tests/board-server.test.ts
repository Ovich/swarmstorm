// aiview's server answering swarm's board (SL2, swarm-relay D23): the board routes through HTTP on
// a test server, port 0, no pid files, read through the BoardReader from a board server on a temp
// data home, seeded through that server. Ported from swarm's page-server tests (the /api/board and
// /events cases); the static page is aiview's own.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { openIndex, type Index } from "../src/core/db.ts";
import { startServer } from "../src/server/index.ts";
import type { RemoteBoard } from "../../swarm-board/src/client/remote.ts";
import type { BoardSnapshot } from "../../swarm-board/src/client/reader.ts";
import { serverStateFile } from "../../swarm-board/src/wire.ts";
import { SWARM_CLI, startTestBoard, stopSpawnedBoard, type TestBoard } from "./fixtures/board-server.ts";

const REPO = "/repos/one/.git";
const OTHER = "/repos/two/.git";
const SLICES = [
  { id: "S3", title: "the page", blockers: [] },
  { id: "S5", title: "the skill", blockers: ["S3"] },
];
type BoardBody = { repos: { repo: string }[]; snapshot: BoardSnapshot };
type Event = { type: string; repo?: string; id?: number };

let tmp: string;
let index: Index;
let board: TestBoard; // swarm's board server, the board aiview reads
let writer: RemoteBoard; // a client of it, writing as members' verbs do
let server: http.Server;
let base: string;
let docId: number;
let docPath: string;

const listening = (s: http.Server): Promise<string> =>
  new Promise((r) => s.on("listening", () => r(`http://127.0.0.1:${(s.address() as AddressInfo).port}`)));
const closing = async (s: http.Server): Promise<void> => {
  s.closeAllConnections();
  await new Promise<void>((r) => s.close(() => r()));
};

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aiview-board-server-"));
  const root = path.join(tmp, "repo");
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  index = openIndex(path.join(tmp, "aiview.sqlite"), root);
  docPath = path.join(root, "docs", "x.brainstorm.md");
  fs.mkdirSync(path.dirname(docPath), { recursive: true });
  fs.writeFileSync(docPath, "# Board X\n");
  docId = index.register(docPath).id;

  board = await startTestBoard(tmp);
  writer = board.writer;
  await writer.openRun({ repo: REPO, group: "review-tool", title: "Review tool", seats: SLICES });
  server = startServer(index, { port: 0, open: false, startDoc: null, toolRoot: tmp, writeState: false, heartbeatMs: 200, boardDataRoot: tmp, swarmEntry: SWARM_CLI });
  base = await listening(server);
});

after(async () => {
  await closing(server);
  await board.close();
  stopSpawnedBoard(tmp); // a server the reader started while the test's was away, if any
  await new Promise((r) => setTimeout(r, 250)); // a watcher debounce in flight lands on an open index
  index.close();
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

/** Reads the SSE stream until `until` holds over the events seen, or the time runs out. */
function listen(until: (events: Event[]) => boolean, ms: number): Promise<Event[]> {
  return new Promise((resolve, reject) => {
    const events: Event[] = [];
    const req = http.get(`${base}/events`, (res) => {
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buf += chunk;
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (frame.startsWith("data: ")) events.push(JSON.parse(frame.slice(6)));
        }
        if (until(events)) {
          clearTimeout(timer);
          req.destroy();
          resolve(events);
        }
      });
    });
    req.on("error", () => {});
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error(`timed out; saw ${JSON.stringify(events)}`));
    }, ms);
  });
}

test("answers only the repository asked: no fallback, and no run of another repository (board-split D41, Q1)", async () => {
  await writer.openRun({ repo: OTHER, group: "other", title: "Other", seats: [] });
  const unasked = await fetch(`${base}/api/board`);
  assert.equal(unasked.status, 404);
  assert.deepEqual(await unasked.json(), { error: "no project named: ask ?project=<project> or ?run=<id>" });
  const byKey = (await (await fetch(`${base}/api/board?project=${encodeURIComponent(REPO)}`)).json()) as BoardBody;
  assert.equal(byKey.snapshot.repo, REPO);
  assert.deepEqual(byKey.repos.map((x) => x.repo), [REPO]);
  const otherRuns = (await writer.runs()).filter((x) => x.repo === OTHER).map((x) => x.id);
  assert.ok(otherRuns.length > 0);
  assert.ok(!byKey.snapshot.runs.some((r) => otherRuns.includes(r.run)), "repo A's answer carries no run of repo B");
  // D47: an older `?repo=` still answers, as `?project=` does
  const other = (await (await fetch(`${base}/api/board?repo=${encodeURIComponent(OTHER)}`)).json()) as BoardBody;
  assert.deepEqual(other.repos.map((x) => x.repo), [OTHER]);
  assert.deepEqual(other.snapshot, await writer.snapshot(OTHER));
});

test("answers a run's repository", async () => {
  const run = (await writer.runs()).find((x) => x.repo === REPO)!;
  const byRun = (await (await fetch(`${base}/api/board?run=${run.id}`)).json()) as BoardBody;
  assert.equal(byRun.snapshot.repo, REPO);
  assert.deepEqual(byRun.repos.map((x) => x.repo), [REPO]);
  // /api/run?id= is kept as an alias of ?run=
  const alias = await fetch(`${base}/api/run?id=${run.id}`);
  assert.equal(alias.status, 200);
  assert.deepEqual(await alias.json(), byRun);
});

test("404 for an unknown run", async () => {
  for (const route of ["/api/board?run=999", "/api/run?id=999"]) {
    const r = await fetch(`${base}${route}`);
    assert.equal(r.status, 404, route);
    assert.deepEqual(await r.json(), { error: "no run 999" });
  }
});

test("a repository asked in another spelling (/ for \\, aiview's stored form) answers the board's own", async () => {
  const other = process.platform === "win32" ? REPO.split("\\").join("/").toUpperCase() : REPO.split("/").join("//");
  const r = await fetch(`${base}/api/board?repo=${encodeURIComponent(other)}`);
  assert.equal(r.status, 200);
  assert.equal(((await r.json()) as BoardBody).snapshot.repo, REPO);
});

test("404 for an unknown repository", async () => {
  const r = await fetch(`${base}/api/board?project=${encodeURIComponent("/nowhere/.git")}`);
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { error: "no project /nowhere/.git" });
});

test("with no server running, the reader starts it: 404 with no repository named, and the server stays up", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "aiview-board-empty-"));
  const bare = startServer(index, { port: 0, open: false, startDoc: null, toolRoot: home, writeState: false, boardDataRoot: home, swarmEntry: SWARM_CLI });
  const at = await listening(bare);
  try {
    assert.equal(fs.existsSync(serverStateFile(home)), false, "no board server before the request");
    const r = await fetch(`${at}/api/board`);
    assert.equal(r.status, 404);
    assert.deepEqual(await r.json(), { error: "no project named: ask ?project=<project> or ?run=<id>" });
    assert.equal(fs.existsSync(serverStateFile(home)), true, "the reader started the board server");
    assert.equal((await fetch(`${at}/api/documents`)).status, 200, "the server is still up");
  } finally {
    await closing(bare);
    stopSpawnedBoard(home);
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test("a post is heard as board-changed", async () => {
  const run = (await writer.runs()).find((x) => x.repo === REPO)!;
  const s3 = (await writer.join({ run: run.id, seat: "S3", doing: "page", files: [] })).member;
  await new Promise((r) => setTimeout(r, 300)); // let that join's change go by before listening
  let posted = 0;
  const seen = listen((ev) => ev.some((e) => e.type === "board-changed") && ev.some((e) => e.type === "ping"), 5000);
  setTimeout(() => {
    posted = Date.now();
    void writer.post(s3, "@S5 committed on the server");
  }, 300);
  const events = await seen;
  const latency = Date.now() - posted;
  assert.equal(events[0].type, "hello");
  assert.deepEqual(events.find((e) => e.type === "board-changed"), { type: "board-changed", repo: REPO });
  assert.ok(!events.some((e) => e.type === "changed"), "a board write is never a document's changed");
  assert.ok(latency < 1000, `board-changed after ${latency} ms`);
});

test("the board server restarted: the reader reconnects and each repository is told once", async () => {
  const seen = listen(() => false, 2500).catch((e: Error) => JSON.parse(e.message.replace(/^timed out; saw /, "")) as Event[]);
  await new Promise((r) => setTimeout(r, 200)); // the stream is open
  await board.close();
  board = await startTestBoard(tmp);
  writer = board.writer;
  const changed = (await seen).filter((e) => e.type === "board-changed").map((e) => e.repo);
  assert.deepEqual(changed.sort(), [REPO, OTHER].sort());
  assert.equal(((await (await fetch(`${base}/api/board?repo=${encodeURIComponent(REPO)}`)).json()) as BoardBody).snapshot.repo, REPO);
});

test("document events unchanged", async () => {
  await fetch(`${base}/api/document/${docId}`); // the server watches a document once it is read
  const seen = listen((ev) => ev.some((e) => e.type === "changed"), 5000);
  setTimeout(() => fs.writeFileSync(docPath, "# Board X\n\nedited\n"), 300);
  const events = await seen;
  assert.deepEqual(events.find((e) => e.type === "changed"), { type: "changed", id: docId });
  assert.ok(!events.some((e) => e.type === "board-changed"), "a document edit is never board-changed");
});

test("?project= takes the project's name, as /api/project-board resolves it; the git dir still read (verify-3 F16)", async () => {
  const named = path.join(tmp, "named", ".git");
  fs.mkdirSync(named, { recursive: true });
  await writer.openRun({ repo: named, group: "named", title: "Named", seats: [] });
  index.upsertProject("one-proj", { addPaths: [path.dirname(named)] });
  index.addBoardRepo("one-proj", named);
  const byName = (await (await fetch(`${base}/api/board?project=one-proj`)).json()) as BoardBody;
  assert.equal(byName.snapshot.repo, (await writer.runs()).find((r) => r.group === "named")!.repo);
  const unknown = await fetch(`${base}/api/board?project=no-such-proj`);
  assert.equal(unknown.status, 404);
  assert.deepEqual(await unknown.json(), { error: "no project no-such-proj" });
});
