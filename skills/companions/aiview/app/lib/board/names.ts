// The board page's formatting primitives: a member's parts, a time, a path, a run's hue and count
// (plan 2026-11-27-codebase-rework#D16). Pure, of the snapshot's strings alone.
import type { RunSummary } from "../../../../swarm-board/src/client/reader.ts";
import { planCode } from "../../../../swarm-board/src/client/reader.ts";

/** A run's id, as the BoardReader's summaries carry it. */
export type RunId = RunSummary["run"];

export const ORCHESTRATOR = "orchestrator";

/** "<plan>/<seat>" → its plan and seat. */
export function splitMember(name: string): { plan: string; seat: string } {
  const i = name.lastIndexOf("/");
  return i < 0 ? { plan: "", seat: name } : { plan: name.slice(0, i), seat: name.slice(i + 1) };
}

/** The MemberTag's text: `RT·S3`. */
export const memberLabel = (name: string): { code: string; seat: string } => {
  const { plan, seat } = splitMember(name);
  return { code: planCode(plan), seat };
};

/** A run's orchestrator, `<group>/orchestrator`. */
export const orchestratorOf = (run: RunSummary): string => `${run.group}/${ORCHESTRATOR}`;

/** 14:03, local time. */
export function hhmm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p;

/** A brainstorm's or a task run's count, "3 seats" (rule 12: a seat is a place in a run): never slices to merge. The tab, the archive and a
 *  closed run's archived line read it alike. */
export const seatCount = (of: number): string => `${of} ${of === 1 ? "seat" : "seats"}`;

/** The run's hue, shared by every member of the run (D8): its two letters hashed onto twelve spokes. */
export function runHue(code: string): number {
  let n = 0;
  for (const c of code) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return ((n % 12) * 30 + 12) % 360;
}
