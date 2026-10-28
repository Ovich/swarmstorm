// F11, D11: a member whose link did not answer is waited for once in full; a marker in the data home makes the
// member's later calls wait briefly while the link stays down, and the marker goes when the link answers.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { linkDownMarker, openLinkPipe } from "../src/client/remote.ts";
import { linkPipe } from "../src/link/link.ts";

const dirs: string[] = [];
const servers: net.Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const home = (): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-linkdown-"));
  dirs.push(d);
  return d;
};
const timed = async <T>(f: () => Promise<T>): Promise<[T, number]> => {
  const at = Date.now();
  const v = await f();
  return [v, Date.now() - at];
};

test("the first miss waits the full time and leaves a marker; later calls wait only the short time", async () => {
  const dataRoot = home();
  const member = { name: "g/w1", run: 7 };
  const [first, tFirst] = await timed(() => openLinkPipe(dataRoot, member, 800, 100));
  assert.equal(first, null);
  assert.ok(tFirst >= 700, `first call waited ${tFirst} ms`);
  assert.ok(fs.existsSync(linkDownMarker(dataRoot, member)), "marker written");
  const [second, tSecond] = await timed(() => openLinkPipe(dataRoot, member, 800, 100));
  assert.equal(second, null);
  assert.ok(tSecond < 500, `second call waited ${tSecond} ms`);
  // another member is not affected
  const [, tOther] = await timed(() => openLinkPipe(dataRoot, { name: "g/w2", run: 7 }, 800, 100));
  assert.ok(tOther >= 700, `other member waited ${tOther} ms`);
});

test("a link that answers clears the marker, and the next miss is a full wait again", async () => {
  const dataRoot = home();
  const member = { name: "g/w1", run: 7 };
  await openLinkPipe(dataRoot, member, 200, 50);
  assert.ok(fs.existsSync(linkDownMarker(dataRoot, member)));
  const server = net.createServer((s) => s.destroy());
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(linkPipe(dataRoot, member.run, member.name), resolve));
  const sock = await openLinkPipe(dataRoot, member, 800, 100);
  assert.ok(sock, "the link answered");
  sock.destroy();
  assert.equal(fs.existsSync(linkDownMarker(dataRoot, member)), false, "marker cleared");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  servers.pop();
  const [, t] = await timed(() => openLinkPipe(dataRoot, member, 600, 50));
  assert.ok(t >= 500, `waited ${t} ms`);
});
