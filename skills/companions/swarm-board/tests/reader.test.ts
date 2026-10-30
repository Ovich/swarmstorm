// The BoardReader at its seam (swarm-relay S23, D23): a client of the board server, its answers the
// server's board's, `changed` pushed after each commit, reconnecting when the server comes back.
// The board is seeded through the server, never a second writable store.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectBoard, type RemoteBoard } from "../src/client/remote.ts";
import { openBoardReader, type BoardReader } from "../src/client/reader.ts";
import { startBoardServer } from "../src/server/server.ts";
import { serverStateFile } from "../src/wire.ts";
import { stopServerOf } from "./fixtures/server.ts";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "cli", "index.ts");
// the in-process server versions as the CLI does, so a reader started from the CLI's entry speaks to it (D28)
process.argv[1] = CLI;

const REPO = "/repos/one/.git";
const SLICES = [
  { id: "S1", blockers: [] },
  { id: "S3", blockers: ["S1"] },
];

let dir: string;
let server: { close(): Promise<void> } | null;
let writer: RemoteBoard & { close(): void };
let reader: BoardReader | null;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-reader-"));
  server = await startBoardServer({ dataRoot: dir });
  writer = await connectBoard({ dataRoot: dir });
  reader = await openBoardReader({ dataRoot: dir, swarmEntry: CLI });
});

afterEach(async () => {
  reader?.close();
  writer.close();
  await server?.close();
  stopServerOf(dir); // a server the reader started, if any
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const aRunWithARunner = async () => {
  const run = await writer.openRun({ repo: REPO, group: "review-tool", title: "Review tool", seats: SLICES });
  const s1 = (await writer.join({ run: run.id, seat: "S1", doing: "the schema", files: [] })).member;
  return { run, s1 };
};

/** Every repository heard within `ms`. */
const heardWithin = (r: BoardReader, ms: number): Promise<string[]> =>
  new Promise((resolve) => {
    const heard: string[] = [];
    const stop = r.onChange((repo) => heard.push(repo));
    setTimeout(() => (stop(), resolve(heard)), ms);
  });

/** The first repository heard, or null within `ms`. */
const firstHeard = (r: BoardReader, ms: number): Promise<string | null> =>
  new Promise((resolve) => {
    const stop = r.onChange((repo) => (clearTimeout(timer), stop(), resolve(repo)));
    const timer = setTimeout(() => (stop(), resolve(null)), ms);
  });

test("repos and snapshot answer what the server's board answers", async () => {
  const { run, s1 } = await aRunWithARunner();
  await writer.post(s1, "@orchestrator the schema is in", { about: "src/schema.ts" });
  const repos = await reader!.repos();
  assert.deepEqual(repos, await writer.repos());
  assert.deepEqual(repos[0].runs.map((r) => r.run), [run.id]);
  assert.deepEqual(await reader!.snapshot(REPO), await writer.snapshot(REPO));
  await assert.rejects(reader!.snapshot("/repos/none/.git"), /no project \/repos\/none\/\.git/);
  const stats = await reader!.stats({ repo: REPO });
  assert.deepEqual(stats.scope, { repo: REPO });
  assert.deepEqual(stats.runs.map((r) => r.run), [run.id]);
});

test("a post committed on the server reaches the reader as changed within 1 s", async () => {
  const { s1 } = await aRunWithARunner();
  const listening = firstHeard(reader!, 1000);
  await writer.post(s1, "progress: half way");
  assert.equal(await listening, REPO);
});

test("the server restarted: the reader reconnects and tells each repository once", async () => {
  await aRunWithARunner();
  await server!.close();
  server = await startBoardServer({ dataRoot: dir });
  const heard = await heardWithin(reader!, 2000);
  assert.deepEqual(heard, [REPO]);
  assert.equal((await reader!.repos())[0].repo, REPO);
});

test("with no server running, the reader starts it", async () => {
  reader!.close();
  writer.close();
  await server!.close();
  server = null;
  assert.equal(fs.existsSync(serverStateFile(dir)), false);
  reader = await openBoardReader({ dataRoot: dir, swarmEntry: CLI });
  assert.deepEqual(await reader.repos(), []);
  assert.equal(fs.existsSync(serverStateFile(dir)), true);
  writer = await connectBoard({ dataRoot: dir }); // closed by afterEach
});

test("close stops the listening", async () => {
  const { s1 } = await aRunWithARunner();
  const repos: string[] = [];
  reader!.onChange((repo) => repos.push(repo));
  reader!.close();
  await writer.post(s1, "after the reader closed");
  await new Promise((r) => setTimeout(r, 500));
  assert.deepEqual(repos, []);
});
