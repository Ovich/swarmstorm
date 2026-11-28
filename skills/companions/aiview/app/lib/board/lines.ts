// The one reader of the board's line formats (plan 2026-11-27-codebase-rework#D16): what a board
// row says, read from its stored meta first, from its body's text on a row from before the meta.
// Read by runs.ts and conversation.ts only; the page's components read their results.
import type { SnapshotEvent } from "../../../../swarm-board/src/client/reader.ts";

/** How an event's word is coloured: done and joined go green, work under way blue, a refusal red, an end grey. */
export type EventTone = "ok" | "work" | "act" | "end";

/** A flag's parts: who wrote the path outside a claim, and who holds it. */
type FlagLine = { writer: string; path: string; holder: string };

/** A board event's line: the word that says what happened, its tone and the rest (`word`); the
 *  tag word it opens on (`tag`, a tip's key); the run it closes; the files a merge carried. */
type EventLine = { word: string | null; tone: EventTone; rest: string; tag: string | null; closesRun: number | null; mergedFiles: string[] };

/** What one row of the board says, by kind. */
export type Reading =
  | { kind: "phase"; name: string; text: string }
  | ({ kind: "flag" } & FlagLine)
  | { kind: "stopped" }
  /** `member`: the `<group>/<id>` the alarm tells of, null when the row names none */
  | { kind: "lost"; member: string | null }
  | ({ kind: "event" } & EventLine)
  | { kind: "urgent" }
  | { kind: "agreement" }
  | { kind: "question" }
  | { kind: "endorsement" }
  | { kind: "message" };

/** The row read: a phase, a flag, a board event, else a post. */
export function readEvent(e: SnapshotEvent): Reading {
  if (e.kind === "event" && e.event === "phase") return { kind: "phase", ...phaseOf(e) };
  const flag = flagOf(e);
  if (flag) return { kind: "flag", ...flag };
  if (e.kind === "event") return BOARD_ALARMS.get(e.event ?? "")?.(e) ?? { kind: "event", ...eventLine(e.body) };
  return readPost(e);
}

// ── a phase ─────────────────────────────────────────────────────────────────────────

/** "phase diverge: every idea" → its name, from the stored meta else the body, and its text. */
function phaseOf(e: SnapshotEvent): { name: string; text: string } {
  const m = /^phase\s+(\S+?):\s*([\s\S]*)$/.exec(e.body);
  const stored = e.meta && "phase" in e.meta ? e.meta.phase : null;
  return { name: stored ?? m?.[1] ?? "", text: (m?.[2] ?? e.body).trim() };
}

// ── a flag (D10) ────────────────────────────────────────────────────────────────────

const FLAG_BODY = /flag:\s*(\S+)\s+wrote\s+(\S+)\s+outside its claim;\s*(\S+)\s+holds? it/;

/** The flag a row raises, or null. Read from the body, which old rows (a plain message) and
 *  the `flag` event share. */
function flagOf(e: SnapshotEvent): FlagLine | null {
  // the board's own name for it (D11): its meta names the two; a row from before the meta: mentions, the holder then the writer
  if (e.event === "flag" && e.about && e.meta && "holder" in e.meta) return { writer: e.meta.writer, path: e.about, holder: e.meta.holder };
  if (e.event === "flag" && e.about && e.mentions && e.mentions.length >= 2) return { writer: e.mentions[1], path: e.about, holder: e.mentions[0] };
  // a row from before D11: the body says it
  if (e.kind !== "event" && e.kind !== "msg") return null;
  const m = FLAG_BODY.exec(e.body);
  return m ? { writer: m[1], path: e.about ?? m[2], holder: m[3] } : null;
}

// ── the board server's alarms ───────────────────────────────────────────────────────

/** The board server's liveness events, told apart from its plain lines, by stored name. */
const BOARD_ALARMS = new Map<string, (e: SnapshotEvent) => Reading>([
  // simple-states: no member's tokens moved for the run's window
  ["stopped", () => ({ kind: "stopped" })],
  // board-split#D36: a member's link lost while it owed work; D51: the board names it (an alarm
  // served as the board's carries its subject), else the head of its body, `lost <group>/<id>: …`
  ["lost", (e) => ({ kind: "lost", member: e.subject || (/^lost (\S+?):? /.exec(e.body)?.[1] ?? null) })],
]);

// ── a board event's line ────────────────────────────────────────────────────────────

const EVENT_WORDS = ["opened", "dispatched", "joined", "claimed", "refused", "waiting", "woken", "merge lock", "merged", "ended", "stopped", "resumed", "closed"];
const TONES: Record<string, EventTone> = {
  opened: "ok", joined: "ok", merged: "ok", resumed: "ok",
  doing: "work", dispatched: "work", claimed: "work", waiting: "work", woken: "work",
  refused: "act", "merge lock": "act", stopped: "act",
  ended: "end", closed: "end",
};

const flatten = (body: string): string => body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(" · ");

function eventLine(body: string): EventLine {
  const flat = flatten(body);
  const tagged = tagOf(flat);
  const filesLine = tagged.tag === "merged" ? body.split(/\r?\n/).find((l) => l.startsWith("files: ")) : undefined;
  const closed = /^run (\d+) closed$/.exec(body);
  return {
    ...wordOf(flat, tagged),
    tag: tagged.tag,
    closesRun: closed ? Number(closed[1]) : null,
    // a merge with no files (`-`) carries none
    mergedFiles: filesLine ? filesLine.slice("files: ".length).split(", ").map((p) => p.trim()).filter((p) => p && p !== "-") : [],
  };
}

/** "merged abc: rebase onto abc." → the tag word and the rest on one line. */
function tagOf(flat: string): { tag: string | null; rest: string } {
  const tag = EVENT_WORDS.find((w) => flat === w || flat.startsWith(`${w} `) || flat.startsWith(`${w}:`));
  return tag ? { tag, rest: flat.slice(tag.length).replace(/^:\s*/, "").trim() } : { tag: null, rest: flat };
}

/** An event as its line reads: the one word, its tone, and the rest. "run 76 opened: …" and "doing: …" have their word too. */
function wordOf(flat: string, tagged: { tag: string | null; rest: string }): { word: string | null; tone: EventTone; rest: string } {
  const run = /^run \d+(?: \([^)]*\))? (opened|closed|resumed|stopped)\b:?\s*/.exec(flat);
  if (run) return { word: run[1], tone: TONES[run[1]], rest: flat.slice(run[0].length) };
  if (/^doing\b:?/.test(flat)) return { word: "doing", tone: "work", rest: flat.replace(/^doing\b:?\s*/, "") };
  return { word: tagged.tag, tone: (tagged.tag && TONES[tagged.tag]) || "end", rest: tagged.rest };
}

// ── a post ──────────────────────────────────────────────────────────────────────────

/** A post whose kind says what it is. */
const POST_KINDS = new Map<string, Reading>([["urgent", { kind: "urgent" }], ["agreement", { kind: "agreement" }]]);
const QUESTION = /^@orchestrator new question:/;

function readPost(e: SnapshotEvent): Reading {
  const stated = POST_KINDS.get(e.kind);
  if (stated) return stated;
  if (QUESTION.test(e.body)) return { kind: "question" };
  return e.kind === "endorsement" ? { kind: "endorsement" } : { kind: "message" };
}
