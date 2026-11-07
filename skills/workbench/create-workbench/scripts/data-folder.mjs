// The one writer of a workbench page's data folder, the sidecar `<stem>/` beside `<stem>.html`.
// Copied into the bench's own skill, `scripts/data-folder.mjs`, and imported by its feed.
//
//   derived feed  writeDerived(page, feed) -> { written, kept, pruned }
//   log feed      appendEntry(page, entry) -> n (1-based), annotate(page, n, notes)
//   any reader    readManifest(page) -> the committed manifest, or null
//
// `manifest.json` is the one commit point: data files are written first, content-hashed and
// never overwritten, the manifest renamed in last, and only then is anything pruned. A feed
// killed midway leaves the previous manifest and every file it names readable.
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync,
  rmdirSync, statSync, unlinkSync, utimesSync, writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

const SCHEMA = 1;
const DEFAULT_KEEP_RUNS = 5;
const LOCK_HEARTBEAT_MS = 5_000;
const LOCK_STALE_MS = 60_000;
const LOCK_POLL_MS = 100;
const RENAME_RETRIES = 5;
const RENAME_RETRY_MS = 50;

const NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;
const DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

const fail = (path, message) => {
  throw new Error(`data folder, ${path}: ${message}`);
};

const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** The sidecar folder of a page: `<stem>/` beside `<stem>.html`. */
export function sidecarOf(page) {
  return join(dirname(page), basename(page).replace(/\.html?$/i, ""));
}

/** Throws unless `name` fits the D2 grammar: safe as a path on every OS. */
export function checkName(name, where) {
  const bad = (why) => fail(where, `bad name ${JSON.stringify(name)}: ${why}`);
  if (typeof name !== "string" || !NAME.test(name)) bad("outside [A-Za-z0-9._-] segments joined by /");
  for (const segment of name.split("/")) {
    if (segment.endsWith(".")) bad("a segment ends in a dot");
    if (DEVICE.test(segment.split(".")[0])) bad("a Windows device name");
  }
}

/** Renames over `to`, retrying EPERM/EBUSY (a reader holding the file open on Windows). */
export function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      return renameSync(from, to);
    } catch (e) {
      if (!["EPERM", "EBUSY", "EACCES"].includes(e.code) || attempt >= RENAME_RETRIES) {
        fail(to, `rename failed after ${attempt + 1} attempts: ${e.message}`);
      }
      sleepMs(RENAME_RETRY_MS * (attempt + 1));
    }
  }
}

const writeAtomically = (path, bytes) => {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, bytes);
  renameWithRetry(tmp, path);
};

/**
 * Runs `work` holding `<stem>/.lock`, created exclusively with pid and time. Waits on a live
 * lock; takes over one untouched for 60 s whatever its pid. `work` receives `touch`, to call
 * between steps: it refreshes the lock's mtime at most every 5 s, so a long commit stays live.
 */
export function withSidecarLock(page, work) {
  const folder = sidecarOf(page);
  mkdirSync(folder, { recursive: true });
  const lock = join(folder, ".lock");
  for (;;) {
    try {
      const fd = openSync(lock, "wx");
      writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      closeSync(fd);
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      let age = 0;
      try {
        age = Date.now() - statSync(lock).mtimeMs;
      } catch {
        continue; // released between open and stat
      }
      if (age > LOCK_STALE_MS) {
        try {
          unlinkSync(lock);
        } catch {}
        continue;
      }
      sleepMs(LOCK_POLL_MS);
    }
  }
  let touchedAt = Date.now();
  const touch = () => {
    if (Date.now() - touchedAt < LOCK_HEARTBEAT_MS) return;
    touchedAt = Date.now();
    const now = new Date();
    utimesSync(lock, now, now);
  };
  try {
    return work(touch);
  } finally {
    try {
      unlinkSync(lock);
    } catch {}
  }
}

export function readManifest(page) {
  const path = join(sidecarOf(page), "manifest.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

const hash8 = (bytes) => createHash("sha256").update(bytes).digest("hex").slice(0, 8);
const toBytes = (value) => Buffer.from(JSON.stringify(value), "utf8");

const checkFeed = (page, feed) => {
  const shared = feed.shared ?? {};
  for (const name of Object.keys(shared)) checkName(name, `${page} shared`);
  for (const [tab, runs] of Object.entries(feed.tabs ?? {})) {
    checkName(tab, `${page} tab`);
    if (!Array.isArray(runs)) fail(page, `tab ${tab}: runs must be an array`);
    for (const run of runs) {
      checkName(run.name, `${page} tab ${tab} run`);
      for (const file of Object.keys(run.files ?? {})) checkName(file, `${page} run ${tab}/${run.name} file`);
    }
  }
};

/** Every repository-relative path a manifest names, `/`-separated. */
const namedBy = (manifest) => {
  const names = new Set();
  if (!manifest) return names;
  for (const entry of Object.values(manifest.shared ?? {})) names.add(entry.file);
  for (const [tab, { runs }] of Object.entries(manifest.tabs ?? {})) {
    for (const run of runs) {
      names.add(run.file);
      for (const file of run.files ?? []) names.add(`data/${tab}/${run.name}/${file}`);
    }
  }
  return names;
};

const listFiles = (root, under) => {
  const found = [];
  const walk = (rel) => {
    const abs = join(root, rel);
    if (!existsSync(abs)) return;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else found.push(child);
    }
  };
  walk(under);
  return found;
};

const removeEmptyDirs = (abs) => {
  if (!existsSync(abs)) return;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (entry.isDirectory()) removeEmptyDirs(join(abs, entry.name));
  }
  if (readdirSync(abs).length === 0) rmdirSync(abs);
};

export function writeDerived(page, feed) {
  checkFeed(page, feed);
  const keepRuns = feed.keepRuns ?? DEFAULT_KEEP_RUNS;
  const folder = sidecarOf(page);
  return withSidecarLock(page, (touch) => {
    const previous = readManifest(page);
    if (previous && previous.kind !== "derived") fail(folder, `a ${previous.kind} sidecar is appended to, never rewritten`);
    let written = 0;
    let kept = 0;

    const writeHashed = (prefix, value) => {
      const bytes = toBytes(value);
      const file = `${prefix}.${hash8(bytes)}.json`;
      if (existsSync(join(folder, file))) kept++;
      else {
        writeAtomically(join(folder, file), bytes);
        written++;
      }
      touch();
      return { file, bytes: bytes.length };
    };

    const manifest = { schema: SCHEMA, kind: "derived", fedAt: new Date().toISOString(), shared: {}, tabs: {} };
    for (const [name, value] of Object.entries(feed.shared ?? {})) {
      manifest.shared[name] = writeHashed(`shared/${name}`, value);
    }
    const dropped = new Set(); // run folders past keepRuns: gone now, whatever the previous manifest said
    for (const [tab, runs] of Object.entries(feed.tabs ?? {})) {
      // A tab's runs come newest first (D3): the first keepRuns are kept, the rest pruned.
      const live = runs.slice(0, keepRuns);
      for (const run of runs.slice(keepRuns)) dropped.add(`data/${tab}/${run.name}/`);
      manifest.tabs[tab] = {
        runs: live.map((run) => {
          const dir = `data/${tab}/${run.name}`;
          const files = Object.entries(run.files ?? {});
          for (const [file, value] of files) {
            const path = join(folder, dir, file);
            const bytes = toBytes(value);
            if (existsSync(path) && readFileSync(path).equals(bytes)) kept++;
            else {
              writeAtomically(path, bytes);
              written++;
            }
            touch();
          }
          const entry = { name: run.name, ...(run.stopped !== undefined && { stopped: run.stopped }), ...writeHashed(`${dir}/run`, run.run) };
          return { ...entry, files: files.map(([file]) => file) };
        }),
      };
    }

    writeAtomically(join(folder, "manifest.json"), Buffer.from(JSON.stringify(manifest, null, 1), "utf8"));
    written++;
    touch();

    const keep = namedBy(manifest);
    for (const name of namedBy(previous)) {
      if (![...dropped].some((dir) => name.startsWith(dir))) keep.add(name);
    }
    let pruned = 0;
    for (const file of [...listFiles(folder, "data"), ...listFiles(folder, "shared")]) {
      if (keep.has(file)) continue;
      unlinkSync(join(folder, file));
      pruned++;
      touch();
    }
    removeEmptyDirs(join(folder, "data"));
    removeEmptyDirs(join(folder, "shared"));
    return { written, kept, pruned };
  });
}

const logFile = (dir, n) => `data/${dir}/${String(n).padStart(6, "0")}.json`;
const writeManifest = (folder, manifest) =>
  writeAtomically(join(folder, "manifest.json"), Buffer.from(JSON.stringify(manifest, null, 1), "utf8"));

const readLogManifest = (page, folder) => {
  const manifest = readManifest(page) ?? { schema: SCHEMA, kind: "log", count: 0, notes: [] };
  if (manifest.kind !== "log") fail(folder, `a ${manifest.kind} sidecar is written whole, never appended to`);
  return manifest;
};

/**
 * Appends `entry` as entry count + 1 and returns that 1-based number. The entry is renamed in
 * first (over any leftover of a dead writer past count), the manifest's count bumped last.
 */
export function appendEntry(page, entry) {
  const folder = sidecarOf(page);
  return withSidecarLock(page, (touch) => {
    const manifest = readLogManifest(page, folder);
    const n = manifest.count + 1;
    writeAtomically(join(folder, logFile("entries", n)), toBytes(entry));
    touch();
    writeManifest(folder, { ...manifest, count: n });
    return n;
  });
}

/** Merges `notes` into entry `n`'s notes; throws when the log has no entry `n`. */
export function annotate(page, n, notes) {
  const folder = sidecarOf(page);
  withSidecarLock(page, (touch) => {
    const manifest = readLogManifest(page, folder);
    if (!Number.isInteger(n) || n < 1 || n > manifest.count) fail(folder, `no entry ${n} to annotate (count ${manifest.count})`);
    const path = join(folder, logFile("notes", n));
    const merged = { ...(existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {}), ...notes };
    writeAtomically(path, toBytes(merged));
    touch();
    if (!manifest.notes.includes(n)) writeManifest(folder, { ...manifest, notes: [...manifest.notes, n].sort((a, b) => a - b) });
  });
}
