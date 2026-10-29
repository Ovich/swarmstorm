// SSE client registry for /events, with a heartbeat.
//
// A silent stream cannot be told from a dead one. A socket can break without a FIN — a
// machine that slept, an embedded browser (the viewer runs in VS Code's Simple Browser
// as often as in a real tab) — and then nobody notices: the server keeps writing into a
// client no one reads, and the tab's EventSource fires no error, so it never reconnects.
// The sidebar says "live" while the document on screen is hours old, until a manual
// refresh (2026-09-18). The heartbeat is what makes both ends notice: a write that fails
// prunes the client here, and a tab that hears nothing for several beats reconnects
// there (app/hooks/useDocuments.ts). It is a `ping` event rather than an SSE comment so
// the tab's watchdog can see it — a comment frame never reaches `onmessage`.
import type { ServerResponse } from "node:http";
import type { PingEventPayload } from "../core/api.ts";

/** How often every client is pinged. The client's watchdog allows several of these. */
export const HEARTBEAT_MS = 15_000;

export interface SseHub {
  /** `project`: the project the tab shows (board-split#D41), the slug it declared on `/events`; null when none. */
  add(res: ServerResponse, project?: string | null): void;
  broadcast(event: unknown): void;
  /** Sends to the tabs on `project` alone (D41: an agent's open or pointer never moves a tab on another project);
   *  returns how many heard it. */
  broadcastTo(project: string, event: unknown): number;
  /** Open clients. The heartbeat prunes the dead, so this is the live count. */
  size(): number;
  close(): void;
}

/** `hello`: what the first frame carries besides its type, read at each connection (the served build). */
export function createSseHub(heartbeatMs = HEARTBEAT_MS, hello: () => Record<string, unknown> = () => ({})): SseHub {
  /** Each open tab and the project it declared. */
  const clients = new Map<ServerResponse, string | null>();

  const drop = (res: ServerResponse): void => {
    if (clients.delete(res)) res.destroy();
  };
  const send = (res: ServerResponse, event: unknown): void => {
    if (res.writableEnded || res.destroyed) return drop(res);
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`, (err) => {
        if (err) drop(res);
      });
    } catch {
      drop(res);
    }
  };

  const beat = setInterval(() => {
    for (const res of [...clients.keys()]) send(res, { type: "ping" } satisfies PingEventPayload);
  }, heartbeatMs);
  // A heartbeat must never be the reason the process stays up.
  beat.unref?.();

  return {
    add(res, project = null) {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      clients.set(res, project);
      res.on("close", () => clients.delete(res));
      res.on("error", () => drop(res));
      send(res, { type: "hello", ...hello() });
    },
    // The set is copied: a write that fails drops its client from it.
    broadcast(event) {
      for (const res of [...clients.keys()]) send(res, event);
    },
    broadcastTo(project, event) {
      const onProject = [...clients].filter(([, p]) => p === project).map(([res]) => res);
      for (const res of onProject) send(res, event);
      return onProject.length;
    },
    size: () => clients.size,
    close() {
      clearInterval(beat);
      for (const res of [...clients.keys()]) drop(res);
    },
  };
}
