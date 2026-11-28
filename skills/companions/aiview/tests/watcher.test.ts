import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DocWatcher, type ChangedEvent } from "../src/documents/watcher.ts";

const waitFor = <T>(check: () => T | undefined, timeoutMs = 3000): Promise<T> =>
  new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      const v = check();
      if (v !== undefined) return resolve(v);
      if (Date.now() - t0 > timeoutMs) return reject(new Error("timed out"));
      setTimeout(tick, 25);
    };
    tick();
  });

test("emits one debounced changed event for a watched doc", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aiview-watch-"));
  const file = path.join(tmp, "doc.spec.md");
  fs.writeFileSync(file, "# v1\n");
  const doc = { id: 7, abs_path: file };
  const events: ChangedEvent[] = [];
  const watcher = new DocWatcher((dir, name) =>
    path.join(dir, name) === file ? doc : undefined,
  );
  watcher.on("changed", (e: ChangedEvent) => events.push(e));
  try {
    watcher.ensureWatch(doc);
    // burst of writes -> debounced to (at least) one event, all for id 7
    fs.writeFileSync(file, "# v2\n");
    fs.writeFileSync(file, "# v3\n");
    const first = await waitFor(() => events[0]);
    assert.equal(first.id, 7);
    assert.ok(events.every((e) => e.id === 7));
  } finally {
    watcher.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("unrelated files in the same dir emit nothing", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aiview-watch2-"));
  const file = path.join(tmp, "doc.spec.md");
  fs.writeFileSync(file, "# v1\n");
  const doc = { id: 1, abs_path: file };
  const events: ChangedEvent[] = [];
  const watcher = new DocWatcher((dir, name) =>
    path.join(dir, name) === file ? doc : undefined,
  );
  watcher.on("changed", (e: ChangedEvent) => events.push(e));
  try {
    watcher.ensureWatch(doc);
    fs.writeFileSync(path.join(tmp, "other.txt"), "x");
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(events.length, 0);
  } finally {
    watcher.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("a change on a source emits changed for every host composed from it", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aiview-watch3-"));
  const hostA = { id: 11, abs_path: path.join(tmp, "a.prototype.html") };
  const hostB = { id: 12, abs_path: path.join(tmp, "b.prototype.html") };
  const source = path.join(tmp, "tools.prototype.html"); // not a registered document
  for (const f of [hostA.abs_path, hostB.abs_path, source]) fs.writeFileSync(f, "<html></html>");
  const events: ChangedEvent[] = [];
  const watcher = new DocWatcher((dir, name) =>
    [hostA, hostB].find((d) => path.join(dir, name) === d.abs_path),
  );
  watcher.on("changed", (e: ChangedEvent) => events.push(e));
  try {
    watcher.ensureWatch(hostA);
    watcher.setSources(hostA.id, [source]);
    watcher.setSources(hostB.id, [source]);
    fs.writeFileSync(source, "<html><b data-component='X'>x</b></html>");
    await waitFor(() => (events.length >= 2 ? events : undefined));
    const ids = events.map((e) => e.id).sort();
    assert.deepEqual(ids, [11, 12]);
    // the map is replaced, not merged: host B no longer depends on the source
    events.length = 0;
    watcher.setSources(hostB.id, [path.join(tmp, "other.html")]);
    fs.writeFileSync(source, "<html>v3</html>");
    await waitFor(() => events[0]);
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(events.map((e) => e.id), [11]);
    assert.deepEqual(watcher.hostsOf(source), [11]);
    watcher.setSources(hostA.id, []);
    assert.deepEqual(watcher.hostsOf(source), []);
  } finally {
    watcher.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("a registered source emits for itself and for its hosts", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aiview-watch4-"));
  const host = { id: 21, abs_path: path.join(tmp, "host.prototype.html") };
  const source = { id: 22, abs_path: path.join(tmp, "tools.prototype.html") };
  for (const d of [host, source]) fs.writeFileSync(d.abs_path, "<html></html>");
  const events: ChangedEvent[] = [];
  const watcher = new DocWatcher((dir, name) =>
    [host, source].find((d) => path.join(dir, name) === d.abs_path),
  );
  watcher.on("changed", (e: ChangedEvent) => events.push(e));
  try {
    watcher.ensureWatch(host);
    watcher.setSources(host.id, [source.abs_path]);
    fs.writeFileSync(source.abs_path, "<html>v2</html>");
    await waitFor(() => (events.length >= 2 ? events : undefined));
    assert.deepEqual(events.map((e) => e.id).sort(), [21, 22]);
  } finally {
    watcher.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
