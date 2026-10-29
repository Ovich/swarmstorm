// The in-process board the stats cases run on: a scratch store under a fake Date, so spans, the silent rule and the
// retention are arranged without waiting. The store is written directly only by setup (D41): the board's settings
// `records-since` and `shares-since`, a deleted or corrupt row; no case reads a table.
import { mock } from "node:test";
import { stopServerOf } from "./server.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBoard, type Board, type Participant, type RunId, type SeatSpec } from "../../src/board/board.ts";
import { codeVerbs } from "../../src/packs/code/calls.ts";

export const MIN = 60 * 1000;
export const DAY = 24 * 60 * MIN;
/** The moment the scratch store is created, minute 0 of every case. */
export const T0 = Date.parse("2026-10-01T09:00:00.000Z");
export const REPO = "/repos/app/.git";

/** Minute `min` of the case, ISO. */
export const at = (min: number): string => new Date(T0 + min * MIN).toISOString();
/** The fake clock to minute `min`. */
export const clockTo = (min: number): void => mock.timers.setTime(T0 + min * MIN);

export type ScratchBoard = { board: Board; file: string; done(): void };

/** A scratch store created at minute 0 under the fake clock. */
export async function scratchBoard(prefix: string): Promise<ScratchBoard> {
  mock.timers.enable({ apis: ["Date"], now: T0 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const file = path.join(dir, "swarm.sqlite");
  const board = await openBoard(file);
  return {
    board,
    file,
    done() {
      stopServerOf(dir);
      board.close();
      mock.timers.reset();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

const seats = (ids: string[], on: Record<string, string[]> = {}): SeatSpec[] =>
  ids.map((id) => ({ id, title: id, blockers: [], ...(on[id] ? { on: on[id] } : {}) }));

/** A plan run of `group` with one member per seat, joined now, in order. */
export function planRun(board: Board, group: string, slices: string[], files: Record<string, { path: string; interface: boolean }[]> = {}): { run: RunId; m: Participant[] } {
  const run = board.openRun({ repo: REPO, group, title: group, seats: seats(slices) }).id;
  const m = slices.map((seat) => board.join({ run, seat, doing: seat, files: files[seat] ?? [] }).member);
  return { run, m };
}

/** A brainstorm run of `group` with one seat per id, joined now, in order; `on`: a seat row's subscriptions. */
export function brainstormRun(board: Board, group: string, ids: string[], on: Record<string, string[]> = {}): { run: RunId; m: Participant[] } {
  const run = board.openRun({ repo: REPO, kind: "brainstorm", group, title: group, seats: seats(ids, on) }).id;
  const m = ids.map((seat) => board.join({ run, seat, doing: seat, files: [] }).member);
  return { run, m };
}

/** `p` shares `path` with its holder `holder`: refused, posts naming it to the holder, claims (D7, D41). */
export function share(board: Board, p: Participant, holder: Participant | Participant[], file: string): void {
  const holders = Array.isArray(holder) ? holder : [holder];
  codeVerbs(board).checkEdit(p, file);
  board.post(p, `${holders.map((h) => `@${h.name}`).join(" ")} I change one function in ${file}`, { about: file });
}

/** Setup only: the store opened raw, `fn` run on it, closed. */
export async function setup(file: string, fn: (db: import("node:sqlite").DatabaseSync) => void): Promise<void> {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(file);
  try {
    fn(db);
  } finally {
    db.close();
  }
}

/** Setup only: the analytics records (and the shares record) begin at `iso`, as on a store upgraded then (D33, D39). */
export const recordsBeginAt = (file: string, iso: string): Promise<void> =>
  setup(file, (db) => {
    for (const name of ["records-since", "shares-since"]) db.prepare("UPDATE settings SET value = ? WHERE name = ?").run(iso, name);
  });

/** Setup only: the closed run's summary removed, as on a run whose summary was never written (D21). */
export const dropSummary = (file: string, run: RunId): Promise<void> => setup(file, (db) => void db.prepare("DELETE FROM run_stats WHERE run = ?").run(run));
