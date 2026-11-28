// How the board's members, runs and posts read on one line of an answer: roster, status, join and wait.
import { progressText, type PhaseProgress, type RosterEntry } from "../board/board.ts";
import type { Message } from "../contract/board.ts";
import { eventOf } from "../contract/events.ts";
import { CODE_WORDING, WORDING } from "./answer/index.ts";
import { fullText } from "./format.ts";

/** How long ago an ms epoch was, short: `12s`, `4m`, `2h`; `never` for null. */
const ago = (at: number | null): string => {
  if (at == null) return "never";
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  return s < 120 ? `${s}s` : s < 7200 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
};
/** A member's state (swarm-relay D9) and the tool it is in or last ran: `busy (Bash npm test)`; with `ages`, its two
 *  ages after it (D38): `busy (Bash npm test)  progress 12s ago, link 0s ago`. */
export const stateLine = (r: Pick<RosterEntry, "state" | "activity" | "progressAt" | "aliveAt">, ages = false): string =>
  `${r.state}${r.activity ? ` (${r.activity})` : ""}` +
  (ages ? `  progress ${ago(r.progressAt)}${r.progressAt == null ? "" : " ago"}, link ${ago(r.aliveAt)}${r.aliveAt == null ? "" : " ago"}` : "");

/** product-shape#D1: a member's state line and its context size after it, for roster and status:
 *  `busy (Bash npm test)  context 85k (4m ago)`. */
export const stateAndContextLine = (r: Pick<RosterEntry, "state" | "activity" | "progressAt" | "aliveAt" | "context">, ages = false): string =>
  `${stateLine(r, ages)}${WORDING.contextShown(r.context, ago)}`;

/** F27: a member's held files, the first few and how many more. */
const HELD_SHOWN = 3;
export const heldLine = (files: { path: string }[]): string => {
  const shown = files.slice(0, HELD_SHOWN).map((f) => f.path).join(", ");
  return files.length > HELD_SHOWN ? `${shown} +${files.length - HELD_SHOWN} more (${files.length})` : shown;
};

/** `roster`: every member of the project, for whom holds a file `r` declared. */
export const rosterLine = (r: RosterEntry, roster: RosterEntry[], ages = false): string => {
  const files = heldLine(r.held);
  // D19 (F9): a declared file another member held at the join is not claimed; the roster names it and its holder
  const holderOf = (file: string): string | undefined =>
    roster.find((o) => o.name !== r.name && o.held.some((h) => h.path.toLowerCase() === file.toLowerCase()))?.name;
  const mine = new Set(r.held.map((h) => h.path).map((p) => p.split("\\").join("/").toLowerCase()));
  const unclaimed = r.files
    .map((f) => f.path.split("\\").join("/"))
    .filter((f) => !mine.has(f.toLowerCase()))
    .flatMap((f) => (holderOf(f) ? [`${f} (${holderOf(f)})`] : []));
  const declared = unclaimed.length ? CODE_WORDING.declaredNotClaimed(unclaimed) : "";
  const who = r.seat === "orchestrator" ? r.name : `${r.nick} · ${r.name}`;
  const fact = r.fact ? `  ${CODE_WORDING.memberFact[r.fact]}` : "";
  return `${who}  run ${r.run}  ${stateAndContextLine(r, ages)}${fact}${r.badge ? WORDING.badgeShown(r.badge) : ""}${r.unread ? `  ${r.unread} unread` : ""}  doing: ${r.doing || "-"}${WORDING.doingAge(Date.now() - r.doingAt, r.doingStale)}${files ? `  files: ${files}` : ""}${declared}`;
};

/** `phase <name>: <text>  <n>/<m> done[, <k> lost]` beside a run's title, or nothing before its first phase. */
export const phaseSuffix = (phase: { name: string; text: string } | null, progress: PhaseProgress | null): string =>
  phase ? `  phase ${phase.name}: ${phase.text}${progress ? `  ${progressText(progress)}` : ""}` : "";

/** A post's time, short: `11-26 10:32` (UTC, as stored). */
export const shortAt = (at: string): string => at.slice(5, 16).replace("T", " ");

/** A delivery's messages as the answer shows them: each with the line its event registry row gives. */
export const shownOf = (d: { full: (Message & { endorse?: string })[] }) => d.full.map((m) => ({ text: fullText(m), next: m.endorse ?? null, event: eventOf(m) }));
