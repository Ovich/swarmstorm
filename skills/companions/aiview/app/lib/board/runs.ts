// The board page's runs and who is in them (plan 2026-11-27-codebase-rework#D16): the run tabs,
// the archive, a run's roster, and the files its members change or merged. Pure functions of the snapshot.
import type { BoardSnapshot, SnapshotMember, RunSummary, Kind } from "../../../../swarm-board/src/client/reader.ts";
import { ORCHESTRATOR, orchestratorOf, type RunId } from "./names.ts";
import { readEvent } from "./lines.ts";

/** An open run as a tab. */
export type RunTab = {
  run: RunId; code: string; title: string; kind: Kind; state: "live" | "closed"; done: number; of: number; /** the protocol the run follows, null when none */ protocol: string | null;
  /** the open phase's one done count (board-split D62), null before the first phase */
  progress: PhaseCount | null;
};
/** The open phase's done count as the board gives it: `gone` names the lost members, out of the count (D41). */
export type PhaseCount = { phase: string; done: number; of: number; gone?: string[] };
/** The count as the CLI prints it: `2/7 done`, `, 1 lost: w2` naming each lost member (D62). */
export function phaseCountText(p: PhaseCount): string {
  const gone = p.gone ?? [];
  return `${p.done}/${p.of} done${gone.length ? `, ${gone.length} lost: ${gone.map((m) => m.slice(m.lastIndexOf("/") + 1)).join(", ")}` : ""}`;
}
/** A closed run in the archive; `outcome` null while the snapshot holds none (D18). */
export type ArchivedRun = RunTab & { closed: string; outcome: string | null; orchestrator: string };

function tabOf(run: RunSummary): RunTab {
  const state = !run.open ? "closed" : "live";
  return { run: run.run, code: run.code, title: run.title, kind: run.kind, state, done: run.done, of: run.of, protocol: run.protocol ?? null, progress: run.progress ?? null };
}

/** The open runs, the newest first: the run just opened sits leftmost. */
export function runTabs(snap: BoardSnapshot): RunTab[] {
  return snap.runs
    .filter((r) => r.open)
    .sort((a, b) => b.run - a.run)
    .map(tabOf);
}

/** The closed runs, newest first, matched on title, code, orchestrator and kind. */
export function archive(snap: BoardSnapshot, query: string): ArchivedRun[] {
  const q = query.trim().toLowerCase();
  return snap.runs
    .filter((r) => !r.open)
    .map((r): ArchivedRun => {
      const closedAt = snap.events.find((e) => { const read = readEvent(e); return read.kind === "event" && read.closesRun === r.run; })?.at ?? "";
      const orch = orchestratorOf(r);
      const orchestrator = snap.roster.find((m) => m.member === orch)?.nick || orch;
      return { ...tabOf(r), closed: closedAt, outcome: null, orchestrator };
    })
    .filter((a) => !q || [a.title, a.code, a.orchestrator, a.kind].some((s) => s.toLowerCase().includes(q)))
    .sort((a, b) => b.closed.localeCompare(a.closed) || b.run - a.run);
}

/** The tab the board opens on by itself (D17): the one open run; with none open, the most recently
 *  closed, as its archived tab; with two or more open, the newest; null with no run at all. */
export function openingRun(snap: BoardSnapshot): RunId | null {
  const open = snap.runs.filter((r) => r.open);
  if (open.length === 1) return open[0].run;
  if (open.length === 0) return archive(snap, "")[0]?.run ?? null;
  return Math.max(...open.map((r) => r.run));
}

/** The run header's pause chip (board-split#D57): `On you` for `pause --person`, `Paused` for the orchestrator's
 *  pause, its reason for the tooltip; null when the run is not paused. */
export interface PauseChip {
  label: "On you" | "Paused";
  reason: string | null;
}

export function pauseChip(run: RunSummary): PauseChip | null {
  const pause = run.paused;
  if (!pause) return null;
  return { label: pause.person ? "On you" : "Paused", reason: pause.text || null };
}

// ── a run's members ─────────────────────────────────────────────────────────────────

/** Each member's funny name (D43), by `<plan>/<seat>`, the orchestrators' included (plan D17). */
export const nicksOf = (snap: BoardSnapshot): Map<string, string> => new Map(snap.roster.map((r) => [r.member, r.nick]));

/** A run's members: the roster entries of its group. */
// by run, never by group: runs of one group would otherwise show each other's members
export const membersOf = (snap: BoardSnapshot, run: RunSummary): SnapshotMember[] => snap.roster.filter((r) => (r.run === undefined ? r.plan === run.group : r.run === run.run));

/** Orchestrators first, then working, waiting, merging, then ended and done. */
const ORDER: Record<string, number> = { working: 1, waiting: 2, merging: 3, ended: 4, done: 4 };
function orderRoster(roster: SnapshotMember[]): SnapshotMember[] {
  const rank = (r: SnapshotMember): number => (r.seat === ORCHESTRATOR ? 0 : (ORDER[r.state] ?? 1));
  return roster
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
    .map((x) => x.r);
}

/** A run's members, orchestrator first; a closed run's too, as they ended. */
export function agents(snap: BoardSnapshot, run: RunId): SnapshotMember[] {
  const r = snap.runs.find((x) => x.run === run);
  return r ? orderRoster(membersOf(snap, r)) : [];
}

// ── the files ───────────────────────────────────────────────────────────────────────

/** A file a member's worktree changes now, with who changes it; `shared`: two of them or more. */
export type ClaimRow = { path: string; holders: string[]; shared: boolean };

/** The files members change now, with their holders: those of one run's members, or every one (null);
 *  null for a run that holds no files, so no claims row shows under it. */
export function claimRows(snap: BoardSnapshot, run: RunId | null): ClaimRow[] | null {
  const r = run == null ? null : snap.runs.find((x) => x.run === run);
  if (run != null && !r) return [];
  // V-19 (D66): a brainswarm's seats hold no files: no claims row under it
  if (r?.kind === "brainstorm") return null;
  // by the run's members, as the strip: another run of the same group holds nothing here
  const members = r ? new Set(membersOf(snap, r).map((m) => m.member)) : null;
  const inRun = (holder: string): boolean => !members || members.has(holder);
  return snap.files
    .map((f) => ({ path: f.path, holders: f.holders, shared: f.holders.length > 1 }))
    .filter((f) => f.holders.some(inRun));
}

export type MergedFileRow = { path: string; mergers: string[] };

/** A run's merged files, from its merged events' `files:` line: each path once, in first-merged
 *  order, with every member that merged it, in order. */
export function mergedFileRows(snap: BoardSnapshot, run: RunId): MergedFileRow[] {
  const rows = new Map<string, MergedFileRow>();
  for (const e of snap.events) {
    if (e.run !== run) continue;
    const read = readEvent(e);
    if (read.kind !== "event") continue;
    for (const path of read.mergedFiles) {
      const row = rows.get(path) ?? { path, mergers: [] };
      if (!row.mergers.includes(e.from)) row.mergers.push(e.from);
      rows.set(path, row);
    }
  }
  return [...rows.values()];
}
