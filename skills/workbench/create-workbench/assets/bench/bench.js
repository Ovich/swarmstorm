// The bench loader, inlined into every workbench page by page.mjs. It reads the page's sidecar
// through aiview's bridge (a relative fetch the frame relays), caches what it parsed, and draws
// each view with `loading …`, a named error or the view's node, never a blank.
//   bench.view(el, "Output", async () => draw(await bench.run(tab, run)));
//   bench.onFed(() => bench.redraw());
(function () {
  "use strict";
  const FOLD_TEXT_BYTES = 256 * 1024;
  const ONE_VIEW_RUN_BYTES = 5 * 1024 * 1024;
  const NO_BRIDGE = "this aiview predates sidecar benches, update the plugin";

  class BenchLoadError extends Error {
    constructor(path, status, message) {
      super(message || `${path}: ${status}`);
      this.path = path;
      this.status = status;
    }
  }

  const hasBridge = () => !!(window.aiview && window.aiview.bridge);

  async function fetchJson(path) {
    if (!hasBridge()) throw new BenchLoadError(path, "no bridge", NO_BRIDGE);
    const response = await fetch(path);
    if (!response.ok) throw new BenchLoadError(path, response.status);
    return JSON.parse(await response.text());
  }

  // ---- the manifest ----
  let manifestPromise = null;
  function manifest() {
    if (!manifestPromise) {
      manifestPromise = fetchJson("manifest.json").catch((err) => {
        manifestPromise = null;
        if (err.status === 404) {
          throw new BenchLoadError("manifest.json", 404, "no data yet: run the feed (manifest.json missing in the sidecar)");
        }
        throw err;
      });
    }
    return manifestPromise;
  }
  function rereadManifest() {
    manifestPromise = null;
    return manifest();
  }

  // ---- the cache: run and shared files by file name, side files by path ----
  const filesByName = new Map(); // file name -> Promise<parsed>
  const sideFiles = new Map(); // side path -> { runFile, value: Promise }
  const bigRuns = new Set(); // run files over 5 MB held in the cache, at most one

  function cached(file, bytes) {
    if (!filesByName.has(file)) {
      if (bytes > ONE_VIEW_RUN_BYTES) {
        for (const other of bigRuns) filesByName.delete(other);
        bigRuns.clear();
        bigRuns.add(file);
      }
      const value = fetchJson(file).catch((err) => {
        filesByName.delete(file);
        throw err;
      });
      filesByName.set(file, value);
    }
    return filesByName.get(file);
  }

  // A file named by the manifest: on a 404 (pruned under an open page) the manifest is re-read
  // and the lookup retried once.
  async function viaManifest(lookup) {
    const first = lookup(await manifest());
    try {
      return await cached(first.file, first.bytes);
    } catch (err) {
      if (err.status !== 404) throw err;
      const second = lookup(await rereadManifest());
      return cached(second.file, second.bytes);
    }
  }

  function runEntry(m, tab, run) {
    const t = m.tabs && m.tabs[tab];
    if (!t) throw new BenchLoadError("manifest.json", "no tab", `manifest.json has no tab "${tab}"`);
    const r = t.runs.find((x) => x.name === run);
    if (!r) throw new BenchLoadError("manifest.json", "no run", `manifest.json has no run "${run}" in tab "${tab}"`);
    return r;
  }

  const run = (tab, name) => viaManifest((m) => runEntry(m, tab, name));

  async function file(tab, name, path) {
    const r = runEntry(await manifest(), tab, name);
    const full = r.file.slice(0, r.file.lastIndexOf("/") + 1) + path;
    const held = sideFiles.get(full);
    if (held && held.runFile === r.file) return held.value;
    const value = fetchJson(full).catch((err) => {
      sideFiles.delete(full);
      throw err;
    });
    sideFiles.set(full, { runFile: r.file, value });
    return value;
  }

  const shared = (key) =>
    viaManifest((m) => {
      const s = m.shared && m.shared[key];
      if (!s) throw new BenchLoadError("manifest.json", "no shared", `manifest.json has no shared file "${key}"`);
      return s;
    });

  // ---- log benches: entries and notes numbered from 1 ----
  const pad = (n) => String(n).padStart(6, "0");
  async function entry(n) {
    const m = await manifest();
    if (!(n >= 1 && n <= m.count)) {
      throw new BenchLoadError(`data/entries/${pad(n)}.json`, "no entry", `entry ${n} is not in the log (count ${m.count})`);
    }
    return fetchJson(`data/entries/${pad(n)}.json`);
  }
  async function notes(n) {
    const m = await manifest();
    if (!(m.notes || []).includes(n)) return null;
    return fetchJson(`data/notes/${pad(n)}.json`);
  }

  // ---- views ----
  const views = new Map(); // element -> { name, draw, token }

  function show(el, node) {
    el.replaceChildren(node);
  }

  async function view(el, name, draw) {
    const token = {};
    views.set(el, { name, draw, token });
    el.removeAttribute("data-ready");
    el.removeAttribute("data-error");
    el.setAttribute("aria-busy", "true");
    const loading = document.createElement("p");
    loading.className = "bench-loading";
    loading.textContent = `loading ${name} …`;
    show(el, loading);
    try {
      if (!hasBridge()) throw new BenchLoadError("", "no bridge", NO_BRIDGE);
      const node = await draw();
      if (views.get(el)?.token !== token) return;
      show(el, node);
      el.setAttribute("data-ready", "");
    } catch (err) {
      if (views.get(el)?.token !== token) return;
      const box = document.createElement("div");
      box.className = "bench-error alert-destructive";
      box.setAttribute("role", "alert");
      const message = err && err.message ? err.message : String(err);
      const where = err && err.path && !message.startsWith(err.path) ? ` (${err.path}, ${err.status})` : "";
      box.textContent = `${name}: ${message}${where}`;
      show(el, box);
      el.setAttribute("data-error", err && err.status !== undefined ? String(err.status) : "error");
    } finally {
      if (views.get(el)?.token === token) el.removeAttribute("aria-busy");
    }
  }

  const redraw = () => Promise.all([...views].map(([el, v]) => view(el, v.name, v.draw))).then(() => {});

  // ---- fed: the manifest re-read, side files of changed runs dropped ----
  const fedListeners = [];
  function onFed(cb) {
    fedListeners.push(cb);
  }
  async function fed() {
    let m;
    try {
      m = await rereadManifest();
    } catch {
      m = null;
    }
    const liveFiles = new Set();
    if (m && m.tabs) for (const t of Object.values(m.tabs)) for (const r of t.runs) liveFiles.add(r.file);
    for (const [path, held] of sideFiles) if (!liveFiles.has(held.runFile)) sideFiles.delete(path);
    for (const cb of fedListeners) cb();
  }
  // The bridge turns the app's `aiview:data-changed` message into this window event.
  window.addEventListener("aiview:data-changed", () => fed());

  // ---- the person's place, kept by aiview per document ----
  const state = {
    get(key) {
      const s = window.aiview && window.aiview.state;
      return s && Object.prototype.hasOwnProperty.call(s, key) ? String(s[key]) : null;
    },
    // The bridge's state posts each set up as `aiview:state`; aiview keeps it per document.
    set(key, value) {
      if (window.aiview && window.aiview.state) window.aiview.state[key] = String(value);
    },
  };

  // ---- text, folded with its size above 256 KB ----
  function text(s) {
    const bytes = new Blob([s]).size;
    const pre = document.createElement("pre");
    pre.className = "bench-text";
    if (bytes <= FOLD_TEXT_BYTES) {
      pre.textContent = s;
      return pre;
    }
    const fold = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = `show text (${Math.round(bytes / 1024)} KB)`;
    fold.append(summary, pre);
    fold.addEventListener("toggle", () => {
      if (fold.open && !pre.textContent) pre.textContent = s;
    });
    return fold;
  }

  window.bench = { manifest, run, file, shared, entry, notes, view, redraw, onFed, state, text };
})();
