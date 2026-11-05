// A board server in its own process and members' WebSockets to it, as the load tools drive them
// (`tests/load.bench.ts`, `scripts/board-replay.mjs`): one copy of the hello, the pending calls and the give-up timer.
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { decode, encode, serverStateFile, type Frame, type RpcMethod, type ServerState } from "../../src/wire.ts";

export const BOARD_CLI = fileURLToPath(new URL("../../src/cli/index.ts", import.meta.url));

/** What a call came to: answered (`ok`, with `value` or `error`) or `dropped` with why; `ms` its time. */
export type CallOutcome = { ms: number; ok: boolean; value?: any; error?: string; dropped?: string };
export type WireLink = { call(method: RpcMethod, ...args: unknown[]): Promise<CallOutcome>; close(): void };
export type ServedBoard = { child: ChildProcess; url: string; state: ServerState };

/** `serve` on the store in `home`, in its own process: the members' clients never share its loop. */
export async function serveBoard(home: string, cli = BOARD_CLI): Promise<ServedBoard> {
  const child = spawn(process.execPath, [cli, "serve"], { env: { ...process.env, SWARMSTORM_HOME: home }, stdio: ["ignore", "pipe", "inherit"], windowsHide: true });
  const url = await new Promise<string>((resolve, reject) => {
    child.stdout!.on("data", (chunk) => {
      const found = String(chunk).match(/ws:\/\/\S+/);
      if (found) resolve(found[0]);
    });
    child.on("exit", (code) => reject(new Error(`server exited ${code}`)));
  });
  return { child, url, state: JSON.parse(fs.readFileSync(serverStateFile(home), "utf8")) as ServerState };
}

/** One WebSocket to the server, welcomed (as `member` when given); a call not answered in `giveUpMs` is dropped. */
export async function connectMember(served: ServedBoard, member: { name: string; run: number } | null, giveUpMs: number): Promise<WireLink> {
  const socket = new WebSocket(served.url);
  const pending = new Map<string, (f: Frame | null) => void>();
  let ids = 0;
  let welcomed!: (f: Frame) => void;
  const welcome = new Promise<Frame>((r) => (welcomed = r));
  socket.addEventListener("message", (e) => {
    const f = decode(String(e.data));
    if (f.type === "welcome" || f.type === "refused") return welcomed(f);
    if (f.type !== "result") return;
    pending.get(f.id)?.(f);
    pending.delete(f.id);
  });
  socket.addEventListener("close", () => {
    for (const settle of pending.values()) settle(null);
    pending.clear();
  });
  await new Promise<void>((r, j) => {
    socket.addEventListener("open", () => r());
    socket.addEventListener("error", () => j(new Error("no connection")));
  });
  socket.send(encode({ type: "hello", version: served.state.version, secret: served.state.secret, ...(member ? { member, supersede: true } : {}) }));
  const greeting = await welcome;
  if (greeting.type !== "welcome") throw new Error(`refused: ${greeting.type === "refused" ? greeting.reason : greeting.type}`);
  return {
    call: (method, ...args) => {
      const id = `l${++ids}`;
      const started = Date.now();
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve({ ms: giveUpMs, ok: false, dropped: "no answer" });
        }, giveUpMs);
        pending.set(id, (f) => {
          clearTimeout(timer);
          const ms = Date.now() - started;
          if (f?.type !== "result") return resolve({ ms, ok: false, dropped: "socket closed" });
          resolve(f.ok ? { ms, ok: true, value: f.value } : { ms, ok: false, error: f.error });
        });
        socket.send(encode({ type: "call", id, method, args }));
      });
    },
    close: () => socket.close(),
  };
}
