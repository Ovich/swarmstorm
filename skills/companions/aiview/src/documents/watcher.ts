// One fs.watch per document directory, debounced per doc, emitting "changed".
// Who touches the index or broadcasts SSE is the caller's business.
//
// A document can depend on sibling files it binds components from (prototype/bind.ts). The
// caller tells the watcher which files a host was composed from, and a change on any of
// them emits "changed" for the host too. Sources need not be registered documents: the
// directory watch already covers the folder, and their names are matched here.
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { sidecarOf } from "./paths.ts";

interface WatchableDoc {
  id: number;
  abs_path: string;
}

export interface ChangedEvent {
  id: number;
}

/** A workbench's sidecar (`<stem>/manifest.json`) was committed. */
export interface DataChangedEvent {
  id: number;
}

/** The only file of a sidecar whose change is news; a feed writes `.tmp` and renames over it. */
const SIDECAR_MANIFEST = "manifest.json";


/** resolve(dir, filename) -> the watched doc that file belongs to, if any. */
type DocResolver = (dir: string, filename: string) => WatchableDoc | undefined;

export class DocWatcher extends EventEmitter {
  private watched = new Map<string, fs.FSWatcher>();
  private timers = new Map<number, NodeJS.Timeout>();
  /** sidecar dir -> its watch; dropped on error, re-armed on the next `<stem>` event. */
  private sidecars = new Map<string, fs.FSWatcher>();
  private dataTimers = new Map<number, NodeJS.Timeout>();
  /** page dir -> stem -> the workbench doc, so a `<stem>` event there arms its sidecar. */
  private benches = new Map<string, Map<string, WatchableDoc>>();
  /** host id -> absolute paths of the files it was composed from, replaced on each resolve. */
  private sources = new Map<number, Set<string>>();
  private resolve: DocResolver;
  private debounceMs: number;

  constructor(resolve: DocResolver, debounceMs = 150) {
    super();
    this.resolve = resolve;
    this.debounceMs = debounceMs;
  }

  ensureWatch(doc: WatchableDoc): void {
    const dir = path.dirname(doc.abs_path);
    const sidecar = sidecarOf(doc.abs_path);
    if (sidecar) {
      let inDir = this.benches.get(dir);
      if (!inDir) this.benches.set(dir, (inDir = new Map()));
      inDir.set(path.basename(sidecar), doc);
      this.ensureSidecarWatch(doc);
    }
    if (this.watched.has(dir)) return;
    try {
      const w = fs.watch(dir, (_event, name) => {
        if (!name) return;
        // `<stem>`, the page name less `.html`, is the sidecar folder: arm its watch, never a page change.
        const bench = this.benches.get(dir)?.get(String(name));
        if (bench) {
          this.ensureSidecarWatch(bench);
          return;
        }
        const hit = this.resolve(dir, String(name));
        if (hit) this.schedule(hit.id);
        for (const id of this.hostsOf(path.resolve(dir, String(name)))) this.schedule(id);
      });
      this.watched.set(dir, w);
    } catch (e) {
      console.error(`watch failed for ${dir}: ${(e as Error).message}`);
    }
  }

  /** Watch `<stem>/` of a `.workbench.html` when it exists; emits "data-changed" on manifest.json only. */
  ensureSidecarWatch(doc: WatchableDoc): void {
    const dir = sidecarOf(doc.abs_path);
    if (!dir || this.sidecars.has(dir)) return;
    try {
      if (!fs.statSync(dir).isDirectory()) return;
    } catch {
      return;
    }
    try {
      const w = fs.watch(dir, (_event, name) => {
        if (name && String(name) === SIDECAR_MANIFEST) this.scheduleData(doc.id);
      });
      // A sidecar deleted under its watch: drop it; the next `<stem>` event re-arms it.
      w.on("error", () => {
        w.close();
        this.sidecars.delete(dir);
      });
      this.sidecars.set(dir, w);
    } catch (e) {
      console.error(`watch failed for ${dir}: ${(e as Error).message}`);
    }
  }

  /** Replace (never merge) the set of files `hostId` depends on. An empty list clears it. */
  setSources(hostId: number, absPaths: string[]): void {
    if (absPaths.length === 0) this.sources.delete(hostId);
    else this.sources.set(hostId, new Set(absPaths.map((p) => path.resolve(p))));
  }

  /** The hosts composed from `absPath`. */
  hostsOf(absPath: string): number[] {
    const key = path.resolve(absPath);
    const ids: number[] = [];
    for (const [id, set] of this.sources) if (set.has(key)) ids.push(id);
    return ids;
  }

  private schedule(id: number): void {
    clearTimeout(this.timers.get(id));
    this.timers.set(
      id,
      setTimeout(() => this.emit("changed", { id } satisfies ChangedEvent), this.debounceMs),
    );
  }

  private scheduleData(id: number): void {
    clearTimeout(this.dataTimers.get(id));
    this.dataTimers.set(
      id,
      setTimeout(() => this.emit("data-changed", { id } satisfies DataChangedEvent), this.debounceMs),
    );
  }

  close(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    for (const t of this.dataTimers.values()) clearTimeout(t);
    this.dataTimers.clear();
    for (const w of this.sidecars.values()) w.close();
    this.sidecars.clear();
    this.benches.clear();
    for (const w of this.watched.values()) w.close();
    this.watched.clear();
    this.sources.clear();
  }
}
