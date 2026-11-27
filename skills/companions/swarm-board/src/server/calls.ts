// The calls the server runs on the Board for its connections (plan 2026-11-27-codebase-rework#D14): judged, run,
// answered once and cached for a resend (D4), a wait cancellable (D16); then each method's `after` effect.
import type { WebSocket } from "ws";
import { trace } from "../host/trace.ts";
import type { Board } from "../board/board.ts";
import type { Authority, Bound } from "./authority.ts";
import { RPC_METHODS, encode, type Call, type Frame, type RpcMethod } from "../contract/wire.ts";

/** A resent call is answered from this cache for this long (D4). */
const RESULT_CACHE_MS = 10 * 60 * 1000;
/** A call answered this long after it came in is logged as slow (board-fixes#D1); a wait holds by design and is not. */
const SLOW_CALL_MS = 10 * 1000;

const CALLABLE: ReadonlySet<string> = new Set(RPC_METHODS);

/** The connection a call came on: `bound`, the member its calls are judged for (trust-adaptations#D5), rebound by an
 *  openRun or join; `anonymousScope`, its calls' id scope while bound to none; `readAt`, when its last bytes came in. */
export type Caller = { socket: WebSocket; member: { name: string } | null; bound: Bound; anonymousScope: string; readAt: number };

/** A call running or answered, keyed by its scope and its id (callKey): a resend reaches it only from the same member. */
type CallRecord = { caller: Caller; method: string; startedAt: number; answer: string | null; answeredAt: number; cancelWait: AbortController | null };

/** What a method's success does beyond its answer, after it: its args and the value answered. */
export type AfterTable = Partial<Record<RpcMethod, (args: unknown[], value: unknown) => void>>;

export type CallTable = {
  /** Runs one call frame: a refusal answered at once and never cached; a resend answered once (D4). */
  run(caller: Caller, call: Call): void;
  /** The caller's `cancel` frame: its wait dropped, never cached. */
  cancel(caller: Caller, id: string): void;
  /** How many of the caller's calls are still unanswered. */
  openCount(caller: Caller): number;
  /** Whether the caller has a call unanswered, or answered less than `quietMs` ago. */
  busy(caller: Caller, quietMs: number): boolean;
  /** D16: the caller's open waits cancelled, its link gone; resent after a reconnect, they run again. */
  dropWaits(caller: Caller): void;
  /** Every open wait cancelled: the server is closing. */
  dropAll(): void;
  /** The cached answers older than RESULT_CACHE_MS forgotten. */
  forgetOld(): void;
};

export const callerName = (c: Caller): string => c.member?.name ?? c.anonymousScope;

export function makeCallTable(d: { board: Board; authority: Authority; log(l: string): void; after: AfterTable }): CallTable {
  const calls = new Map<string, CallRecord>();
  /** v1-F4: a call id is the caller's own: scoped by the bound member (its link and its direct connections share it, so a
   *  resend after a reconnect finds its call), else by the connection; never shared across callers. */
  const callKey = (c: Caller, id: string): string => `${c.bound ? `member ${c.bound.id}` : c.anonymousScope} ${id}`;
  const send = (c: Caller, f: Frame): void => {
    if (c.socket.readyState === c.socket.OPEN) c.socket.send(encode(f));
  };

  const answer = (rec: CallRecord, text: string): void => {
    rec.answer = text;
    rec.answeredAt = Date.now();
    const took = rec.answeredAt - rec.startedAt;
    trace().event("call", { member: callerName(rec.caller), method: rec.method, startedAt: new Date(rec.startedAt).toISOString(), ms: took, ok: text.includes('"ok":true') });
    // board-fixes#D1: one line per call answered SLOW_CALL_MS or more after it came in
    if (took >= SLOW_CALL_MS && rec.method !== "wait") d.log(`slow: ${callerName(rec.caller)}, ${rec.method} answered in ${took} ms`);
    rec.cancelWait = null;
    if (rec.caller.socket.readyState === rec.caller.socket.OPEN) rec.caller.socket.send(text);
  };

  const dropWait = (key: string): void => {
    const rec = calls.get(key);
    if (!rec || rec.answer !== null) return;
    // a cancelled wait is never cached: resent, it runs again
    calls.delete(key);
    rec.cancelWait?.abort();
  };

  const run = (c: Caller, call: Call): void => {
    const args = Array.isArray(call.args) ? [...call.args] : [];
    // D5: judged for this connection's member before anything, a resent call included; a refusal is never cached
    const refusal = CALLABLE.has(call.method) ? d.authority.check(c.bound, call.method, args) : null;
    if (refusal) return send(c, { type: "result", id: call.id, ok: false, error: refusal });
    const key = callKey(c, call.id);
    const known = calls.get(key);
    if (known) {
      // resent after a reconnect: answered once, from the cache or when the running call ends (D4)
      known.caller = c;
      if (known.answer !== null) c.socket.send(known.answer);
      return;
    }
    const rec: CallRecord = { caller: c, method: String(call.method), startedAt: c.readAt, answer: null, answeredAt: 0, cancelWait: null };
    calls.set(key, rec);
    const fail = (error: string): void => answer(rec, encode({ type: "result", id: call.id, ok: false, error }));
    if (!CALLABLE.has(call.method)) return fail(`unknown method ${String(call.method)}`);
    if (call.method === "wait") {
      rec.cancelWait = new AbortController();
      args[1] = { ...((args[1] as object | undefined) ?? {}), signal: rec.cancelWait.signal };
    }
    let out: unknown;
    try {
      out = (d.board[call.method as RpcMethod] as (...a: unknown[]) => unknown)(...args);
    } catch (e) {
      return fail((e as Error).message);
    }
    const settle = (value: unknown): void => {
      if (calls.get(key) !== rec) return; // cancelled meanwhile
      // D5: a successful openRun or join binds the unbound connection that made it, without presence
      c.bound = d.authority.boundAfter(c.bound, call.method, value);
      answer(rec, encode({ type: "result", id: call.id, ok: true, value: value === undefined ? null : value }));
      d.after[call.method]?.(args, value);
    };
    if (out instanceof Promise) out.then(settle, (e: Error) => calls.get(key) === rec && fail(e.message));
    else settle(out);
  };

  const unanswered = (c: Caller): CallRecord[] => [...calls.values()].filter((r) => r.caller === c && r.answer === null);
  return {
    run,
    cancel: (c, id) => dropWait(callKey(c, id)),
    openCount: (c) => unanswered(c).length,
    busy: (c, quietMs) => [...calls.values()].some((r) => r.caller === c && (r.answer === null || Date.now() - r.answeredAt < quietMs)),
    dropWaits(c) {
      for (const [key, rec] of calls) if (rec.caller === c && rec.answer === null && rec.cancelWait) dropWait(key);
    },
    dropAll() {
      for (const key of [...calls.keys()]) dropWait(key);
    },
    forgetOld() {
      const t = Date.now();
      for (const [key, rec] of calls) if (rec.answer !== null && t - rec.answeredAt > RESULT_CACHE_MS) calls.delete(key);
    },
  };
}
