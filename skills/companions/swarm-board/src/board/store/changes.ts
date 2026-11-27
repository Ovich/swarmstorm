// Waking and watching (swarm-relay D14, D39): every write moves its project's version in `changes`; once committed, the
// waits and watchers of this process are woken at once: the server is the one process that writes, so no file carries
// the wake to another (no `.signal`, D14). The poll stays as the floor.
import type { DatabaseSync } from "node:sqlite";

type Row = Record<string, unknown>;

/** A watch event can be missed (a coalesced write, a platform quirk); the store is re-read
 *  this often regardless, so a missed event costs at most this much. */
export const WAIT_POLL_MS = 1000;

export type Changes = {
  /** A write to `repo`: its version moves, and the wakers are woken after the commit. */
  bump(repo: string): void;
  /** `fn` woken after every commit of this process; returns the removal. */
  onLocal(fn: () => void): () => void;
  /** Called with the project of every write, from this process or any other. Returns the unsubscribe. */
  onChange(l: (repo: string) => void): () => void;
};

/** The store's side of Changes: its transaction tells it each outermost commit, its close stops the watcher. */
export type StoreChanges = Changes & { committed(ok: boolean): void; close(): void };

/** `inTransaction`: whether a transaction is open, so a bump inside it wakes only after the outermost commit. */
export function makeChanges(db: DatabaseSync, inTransaction: () => boolean): StoreChanges {
  const localWakers = new Set<() => void>();
  const touch = (): void => {
    for (const wake of [...localWakers]) queueMicrotask(wake);
  };
  let dirty = false;

  // onChange: one watcher per open Board, shared by its listeners.
  const listeners = new Set<(repo: string) => void>();
  let watching: { close(): void } | null = null;
  let versions = new Map<string, number>();
  const readVersions = (): Map<string, number> =>
    new Map((db.prepare("SELECT repo, version FROM changes").all() as Row[]).map((r) => [String(r.repo), Number(r.version)]));

  return {
    bump(repo) {
      db.prepare("INSERT INTO changes (repo, version) VALUES (?, 1) ON CONFLICT (repo) DO UPDATE SET version = version + 1").run(repo);
      if (inTransaction()) dirty = true;
      else touch();
    },
    onLocal(fn) {
      localWakers.add(fn);
      return () => {
        localWakers.delete(fn);
      };
    },
    committed(ok) {
      if (dirty) {
        dirty = false;
        if (ok) touch();
      }
    },
    onChange(listener) {
      listeners.add(listener);
      if (!watching) {
        versions = readVersions();
        const check = (): void => {
          let next: Map<string, number>;
          try {
            next = readVersions();
          } catch {
            return; // the store is busy or closing: the next look catches up
          }
          const moved = [...next].filter(([repo, v]) => versions.get(repo) !== v).map(([repo]) => repo);
          versions = next;
          for (const repo of moved) for (const l of [...listeners]) l(repo);
        };
        localWakers.add(check);
        const poll = setInterval(check, WAIT_POLL_MS);
        // watching must never be what keeps a process alive
        poll.unref?.();
        watching = { close: () => (localWakers.delete(check), clearInterval(poll)) };
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size && watching) {
          watching.close();
          watching = null;
        }
      };
    },
    close() {
      watching?.close();
      watching = null;
      listeners.clear();
    },
  };
}
