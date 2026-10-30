// What the page shows, as pure functions of the snapshot and the three selections App owns:
// the run it is scoped to, the member it follows, the filter. No child computes any of it.
import type { BoardSnapshot, SnapshotEvent, SnapshotMember, RunSummary, Kind } from "../../../../swarm-board/src/client/reader.ts";
import { nameHandle, parseMentions, planCode } from "../../../../swarm-board/src/client/reader.ts";

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

/**
 * A member's hue: the KindChip recipe, copied as memberColor. Hashed on "<code>·<seat>",
 * spread over twelve spokes so two members side by side rarely share one; orchestrators
 * neutral (saturation 0).
 */
export function memberColor(name: string): { h: number; s: number } {
  const { code, seat } = memberLabel(name);
  if (seat === ORCHESTRATOR) return { h: 0, s: 0 };
  let n = 0;
  for (const c of `${code}·${seat}`) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return { h: ((n % 12) * 30 + 12) % 360, s: 52 + (n % 4) * 8 };
}

/** 14:03, local time. */
export function hhmm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p;

// ── mentions and members ────────────────────────────────────────────────────────────

/** What resolving a mention needs: every run's group on the repository, and the active members'
 *  funny names as a mention writes them (D43). */
export type MentionCtx = { groups: string[]; names: ReadonlyMap<string, string> };

export const mentionCtx = (snap: BoardSnapshot): MentionCtx => ({
  groups: [...new Set(snap.runs.map((r) => r.group))],
  names: new Map(
    snap.roster.filter((r) => r.seat !== ORCHESTRATOR && r.state !== "ended" && (r.state as string) !== "done").map((r) => [nameHandle(r.nick), r.member]),
  ),
});

/** Each member's funny name (D43), by `<plan>/<seat>`, the orchestrators' included (plan D17). */
export const nicksOf = (snap: BoardSnapshot): Map<string, string> => new Map(snap.roster.map((r) => [r.member, r.nick]));

/** Whom a message names, resolved as the Board resolves it. */
export const targets = (e: SnapshotEvent, ctx: MentionCtx): string[] => parseMentions(e.body, splitMember(e.from).plan, ctx.groups, ctx.names);

/** Orchestrators first, then working, waiting, merging, then ended and done. */
const ORDER: Record<string, number> = { working: 1, waiting: 2, merging: 3, ended: 4, done: 4 };
export function orderRoster(roster: SnapshotMember[]): SnapshotMember[] {
  const rank = (r: SnapshotMember): number => (r.seat === ORCHESTRATOR ? 0 : (ORDER[r.state] ?? 1));
  return roster
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
    .map((x) => x.r);
}

/** A run's members: the roster entries of its group. */
// by run, never by group: runs of one group would otherwise show each other's members
const membersOf = (snap: BoardSnapshot, run: RunSummary): SnapshotMember[] => snap.roster.filter((r) => (r.run === undefined ? r.plan === run.group : r.run === run.run));

// ── following a member ──────────────────────────────────────────────────────────────

/** A message from the member, or naming it (by name, or its plan's `@all`). */
export function involves(e: SnapshotEvent, member: string | null, ctx: MentionCtx): boolean {
  if (!member) return true;
  if (e.from === member) return true;
  const { plan } = splitMember(member);
  return targets(e, ctx).some((t) => t === member || t === `${plan}/*`);
}

/** Lit with the accent stripe: another's message that names the followed member. */
export const lit = (e: SnapshotEvent, member: string | null, ctx: MentionCtx): boolean =>
  !!member && e.kind !== "event" && e.from !== member && involves(e, member, ctx);

// ── the filters ─────────────────────────────────────────────────────────────────────

/** `counts`: what the chip counts, when not what it shows (Flags counts its flags alone). */
export type Filter = { id: string; label: string; file: boolean; test: (e: SnapshotEvent) => boolean; counts?: (e: SnapshotEvent) => boolean };

// ── flags, and the talk they start (D10) ────────────────────────────────────────────

/** A flag's parts: who wrote the path outside a claim, and who holds it. */
export type FlagLine = { writer: string; path: string; holder: string };

const FLAG_BODY = /flag:\s*(\S+)\s+wrote\s+(\S+)\s+outside its claim;\s*(\S+)\s+holds? it/;

/** The flag a post raises, or null. Read from the body, which old rows (a plain message) and
 *  the `flag` event share. */
export function flagOf(e: SnapshotEvent): FlagLine | null {
  // the board's own name for it (D11): mentions are the holder, then the writer
  if (e.event === "flag" && e.about && e.mentions && e.mentions.length >= 2) return { writer: e.mentions[1], path: e.about, holder: e.mentions[0] };
  // a row from before D11: the body says it
  if (e.kind !== "event" && e.kind !== "msg") return null;
  const m = FLAG_BODY.exec(e.body);
  return m ? { writer: m[1], path: e.about ?? m[2], holder: m[3] } : null;
}

export const isFlag = (e: SnapshotEvent): boolean => flagOf(e) !== null;

/** The posts that answer a flag: after it, `--about` its path, an agreement by anyone or a post
 *  by one of its two members; never another flag or a board event. */
export function answersOf(flag: SnapshotEvent, events: SnapshotEvent[]): SnapshotEvent[] {
  const f = flagOf(flag);
  if (!f) return [];
  return events.filter(
    (e) => e.seq > flag.seq && e.about === f.path && e.kind !== "event" && !isFlag(e) && (e.kind === "agreement" || e.from === f.writer || e.from === f.holder),
  );
}

/** Settled by the first agreement that answers it, else answered by the first post, else open. */
export type FlagAnswer = { state: "settled" | "answered"; seq: number } | { state: "open" };

export function flagAnswer(flag: SnapshotEvent, events: SnapshotEvent[]): FlagAnswer {
  const answers = answersOf(flag, events);
  const agreed = answers.find((e) => e.kind === "agreement");
  if (agreed) return { state: "settled", seq: agreed.seq };
  return answers.length ? { state: "answered", seq: answers[0].seq } : { state: "open" };
}

// ── a merged event's recipients ─────────────────────────────────────────────────────

/** Whom a merged event told: `rebase`, the holders its body names; `tell`, those its author then
 *  told of a resolved conflict (`@<them> I resolved <file>`), before its next merge. */
export function mergedRecipients(e: SnapshotEvent, events: SnapshotEvent[], ctx: MentionCtx): { rebase: string[]; tell: string[] } {
  // stored with the event (D11); parsed from the thread only on a row from before
  if (e.meta && "rebase" in e.meta) return { rebase: [...e.meta.rebase], tell: [...e.meta.tell] };
  const plan = splitMember(e.from).plan;
  const holdersLine = e.body.split(/\r?\n/).find((l) => l.includes("you hold or declared a file it changed")) ?? "";
  const rebase = [...new Set(parseMentions(holdersLine, plan, ctx.groups, ctx.names))];
  const tell: string[] = [];
  for (const x of events) {
    if (x.seq <= e.seq || x.from !== e.from) continue;
    if (x.kind === "event" && eventLine(x.body).word === "merged") break;
    if (!/\bI resolved\b/.test(x.body)) continue;
    for (const t of parseMentions(x.body, plan, ctx.groups, ctx.names)) if (!tell.includes(t)) tell.push(t);
  }
  return { rebase, tell };
}

function flagsFilter(events: SnapshotEvent[]): Filter[] {
  const flags = events.filter(isFlag);
  if (!flags.length) return [];
  const shown = new Set<number>(flags.map((e) => e.seq));
  for (const f of flags) for (const a of answersOf(f, events)) shown.add(a.seq);
  return [{ id: "flags", label: "Flags", file: false, test: (e) => shown.has(e.seq), counts: isFlag }];
}

/** Everything, Messages only, Agreements, Flags while the channel has any (each flag and the posts
 *  answering it), then the three files most talked about. */
export function filters(events: SnapshotEvent[]): Filter[] {
  const counts = new Map<string, number>();
  for (const e of events) if (e.about) counts.set(e.about, (counts.get(e.about) ?? 0) + 1);
  const top = [...counts.entries()]
    .map(([f, n], i) => ({ f, n, i }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .slice(0, 3)
    .map((x) => x.f);
  return [
    { id: "all", label: "Everything", file: false, test: () => true },
    { id: "talk", label: "Messages only", file: false, test: (e) => e.kind !== "event" },
    { id: "agreements", label: "Agreements", file: false, test: (e) => e.kind === "agreement" },
    ...flagsFilter(events),
    ...top.map((f) => ({ id: `file:${f}`, label: basename(f), file: true, test: (e: SnapshotEvent) => e.about === f || e.body.includes(basename(f)) })),
  ];
}

/** The feed: scoped events through the filter, then through the member followed. */
export function feed(events: SnapshotEvent[], filter: string, member: string | null, ctx: MentionCtx): SnapshotEvent[] {
  const f = filters(events).find((x) => x.id === filter) ?? filters(events)[0];
  // a phase separator stays whatever the filter: it says where the talk is
  return events.filter((e) => isPhase(e) || f.test(e)).filter((e) => involves(e, member, ctx) || (isPhase(e) && !!member && splitMember(member).plan === splitMember(e.from).plan));
}


// ── a board event's line ────────────────────────────────────────────────────────────

const EVENT_WORDS = ["opened", "dispatched", "joined", "claimed", "refused", "waiting", "woken", "merge lock", "merged", "ended", "stopped", "resumed", "closed"];
const STRONG = new Set(["refused", "merge lock", "stopped"]);

/** How an event's word is coloured: done and joined go green, work under way blue, a refusal red, an end grey. */
export type EventTone = "ok" | "work" | "act" | "end";
const TONES: Record<string, EventTone> = {
  opened: "ok", joined: "ok", merged: "ok", resumed: "ok",
  doing: "work", dispatched: "work", claimed: "work", waiting: "work", woken: "work",
  refused: "act", "merge lock": "act", stopped: "act",
  ended: "end", closed: "end",
};

/** An event as its line reads: the one word that says what happened, its tone, and the rest.
 *  "run 76 opened: …" and "doing: …" have their word too. */
export function eventWord(body: string): { word: string | null; tone: EventTone; rest: string } {
  const flat = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(" · ");
  const run = /^run \d+(?: \([^)]*\))? (opened|closed|resumed|stopped)\b:?\s*/.exec(flat);
  if (run) return { word: run[1], tone: TONES[run[1]], rest: flat.slice(run[0].length) };
  if (/^doing\b:?/.test(flat)) return { word: "doing", tone: "work", rest: flat.replace(/^doing\b:?\s*/, "") };
  const { word, rest } = eventLine(flat);
  return { word, tone: (word && TONES[word]) || "end", rest };
}

/** "merged abc: rebase onto abc." → the tag word, whether it is strong, and the rest on one line. */
export function eventLine(body: string): { word: string | null; strong: boolean; rest: string } {
  const flat = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(" · ");
  for (const w of EVENT_WORDS) {
    if (flat === w || flat.startsWith(`${w} `) || flat.startsWith(`${w}:`)) {
      return { word: w, strong: STRONG.has(w), rest: flat.slice(w.length).replace(/^:\s*/, "").trim() };
    }
  }
  return { word: null, strong: false, rest: flat };
}

// ── a phase separator ───────────────────────────────────────────────────────────────

/** A `phase` event: the orchestrator opened a phase, the current one ending with it. */
export const isPhase = (e: SnapshotEvent): boolean => e.kind === "event" && e.event === "phase";

/** "phase diverge: every idea" → its name, from the stored meta else the body, and its text. */
export function phaseOf(e: SnapshotEvent): { name: string; text: string } {
  const m = /^phase\s+(\S+?):\s*([\s\S]*)$/.exec(e.body);
  const stored = e.meta && "phase" in e.meta ? e.meta.phase : null;
  return { name: stored ?? m?.[1] ?? "", text: (m?.[2] ?? e.body).trim() };
}

// ── the one conversation (D1, D8, D13-D16) ──────────────────────────────────────────

/** A brainstorm's or a task run's count, "3 seats" (rule 12: a seat is a place in a run): never slices to merge. The tab, the archive and a
 *  closed run's archived line read it alike. */
export const seatCount = (of: number): string => `${of} ${of === 1 ? "seat" : "seats"}`;

/** An open run as a tab: `quiet` while its orchestrator has a `quiet` event no `back` answered. */
export type RunTab = {
  run: RunId; code: string; title: string; kind: Kind; state: "live" | "quiet" | "closed"; done: number; of: number; /** the protocol the run follows, null when none */ protocol: string | null;
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
/** What the conversation shows: one run (null = All), or the member followed. */
export type Pick = { run: RunId | null; follow: string | null };
export type ItemKind = "message" | "flag" | "urgent" | "held" | "question" | "quiet" | "agreement" | "settled" | "stalled" | "liveness" | "recovered" | "gone";
export type Tier = "act" | "wait" | "decided" | "talk";
export type Item =
  | { kind: ItemKind; tier: Tier; seq: number; at: string; run: RunId; from: string; word: string | null; tip: string | null; text: string; joined: boolean; state: string | null; about: string | null }
  | { kind: "event"; seq: number; at: string; run: RunId; from: string; text: string; tip: string | null; about: string | null; word: string | null; tone: EventTone; rest: string }
  /** The orchestrator opened phase `name` (`swarm phase`), the current one ending with it: a separator across the conversation. */
  | { kind: "phase"; seq: number; at: string; run: RunId; from: string; name: string; text: string; about: null };

/** Every tip, verbatim from the prototype (D9). */
export const TIPS = {
  flag: "Flag: this member wrote a file it had not claimed, while another member holds it. The board found it when the member merged or ended. The two settle it here; the flag stays open until they agree.",
  settled: "Settled flag: the two members agreed on the file a flag was about.",
  urgent: "Urgent: an orchestrator interrupted this member to do this first. It wakes the member at once, whatever it was doing.",
  held: "Held file: this member wanted a file another member holds. It said what it needs and waits for the holder's answer here.",
  question: "Question: a seat asks its orchestrator something the debate cannot settle alone. It waits for the answer.",
  quiet: "Quiet: this member has not called the board for a while. Its session may be waiting on you, or gone; its claims stay held.",
  agreement: "Agreed: two members settled something between them, and it binds both. An endorsement is another member backing it.",
  merged: "Merged: this member's branch went into the plan's branch. Members holding the files it changed rebase onto it.",
  lock: "Waiting for the merge lock: one member merges at a time, across every run.",
  opened: "Opened: an orchestrator started a run on the board.",
  closed: "Closed: the run is over; its conversation is in the archive (☰).",
  joined: "Joined: a member arrived on the board and took its seat.",
  ended: "Ended: the member left the board and its claims were released.",
  stalled: "Idle: no member's token counter has moved for this long. The orchestrator is told: it opens the next phase or asks the member who owes a move. The row keeps only the latest count and leaves once anything happens.",
  liveness: "Liveness: the board cannot read this member's transcript, so the stall check cannot see whether it works.",
  stalledMember: "Stalled: this member owes a move it is not making. The rule says why (turn ended, in turn with no line, a background task, a long call, waiting while owing a phase), and the orchestrator is told the move that reaches it.",
  linkDown: "Link down: this member's link to the board is lost, but its transcript still grows, so it is working. The orchestrator asks it to restart its link.",
  recovered: "Recovered: a member the board had told lost reads alive again. Its seat needs no new agent.",
  gone: "Lost: this member's agent finished without ending, or its link is lost and its transcript has stopped growing. The orchestrator dispatches it again or closes its seat.",
} as const;

/** What a stall says, by its rule (idea 1, rule 6): the word on the row. */
const STALL_WORDS: Record<string, string> = {
  ended: "turn ended",
  "in-turn": "in turn, no line",
  background: "background task",
  call: "long call",
  owing: "waiting, owes its part",
};

/** The stall rule a `stalled` event stores in its data, null for one written before the rules. */
const stallRuleOf = (e: SnapshotEvent): string | null => (e.meta && "rule" in e.meta ? e.meta.rule : null);
/** The member a rule-bearing `stalled` names, null for one written before the rules. */
const stalledMemberOf = (e: SnapshotEvent): string | null => (e.meta && "rule" in e.meta ? e.meta.member : null);
/** A `liveness` that tells of a lost link while the transcript grows, not of a transcript that cannot be read. */
const isLinkDown = (e: SnapshotEvent): boolean => !!e.meta && "linkDown" in e.meta;

/** A board event's tip, by its word or its stored name. */
const EVENT_TIPS: Record<string, string> = {
  merged: TIPS.merged,
  waiting: TIPS.lock,
  "merge lock": TIPS.lock,
  opened: TIPS.opened,
  closed: TIPS.closed,
  joined: TIPS.joined,
  ended: TIPS.ended,
};

/** The run's hue, shared by every member of the run (D8): its two letters hashed onto twelve spokes. */
export function runHue(code: string): number {
  let n = 0;
  for (const c of code) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return ((n % 12) * 30 + 12) % 360;
}

/** A member as a word writes it: code first, nick second (D10). */
function memberText(snap: BoardSnapshot, member: string): string {
  const { code, seat } = memberLabel(member);
  const nick = snap.roster.find((r) => r.member === member)?.nick;
  return nick ? `${code}·${seat} ${nick}` : `${code}·${seat}`;
}

/** The run an item belongs to: its stored `run` once the board has one (SL1), else its author's
 *  run, the open one of that group or its newest, so an old Main row is labelled too (D13). */
function runOf(snap: BoardSnapshot, e: SnapshotEvent): RunSummary | null {
  const stored = (e as SnapshotEvent & { run?: RunId | null }).run;
  if (stored != null) return snap.runs.find((r) => r.run === stored) ?? null;
  const group = splitMember(e.from).plan;
  const ofGroup = snap.runs.filter((r) => r.group === group);
  return ofGroup.find((r) => r.open) ?? [...ofGroup].sort((a, b) => b.run - a.run)[0] ?? null;
}

const orchestratorOf = (run: RunSummary): string => `${run.group}/${ORCHESTRATOR}`;
const eventNamed = (e: SnapshotEvent, name: string): boolean => e.kind === "event" && ((e.event as string | null | undefined) === name || new RegExp(`^${name}\\b`).test(e.body));
const isQuiet = (e: SnapshotEvent): boolean => eventNamed(e, "quiet");
/** A quiet member came back: a `back` event, or any post of its own after the quiet. */
const quietAnswered = (quiet: SnapshotEvent, events: SnapshotEvent[]): boolean =>
  events.some((e) => e.seq > quiet.seq && e.from === quiet.from && (eventNamed(e, "back") || e.kind !== "event"));

function tabOf(snap: BoardSnapshot, run: RunSummary): RunTab {
  const orch = orchestratorOf(run);
  const quiet = snap.events.some((e) => e.from === orch && isQuiet(e) && !quietAnswered(e, snap.events));
  const state = !run.open ? "closed" : quiet ? "quiet" : "live";
  return { run: run.run, code: run.code, title: run.title, kind: run.kind, state, done: run.done, of: run.of, protocol: run.protocol ?? null, progress: run.progress ?? null };
}

/** The open runs, in opening order. */
export function runTabs(snap: BoardSnapshot): RunTab[] {
  return snap.runs
    .filter((r) => r.open)
    .sort((a, b) => a.run - b.run)
    .map((r) => tabOf(snap, r));
}

/** The closed runs, newest first, matched on title, code, orchestrator and kind. */
export function archive(snap: BoardSnapshot, query: string): ArchivedRun[] {
  const q = query.trim().toLowerCase();
  return snap.runs
    .filter((r) => !r.open)
    .map((r): ArchivedRun => {
      const closedAt = snap.events.find((e) => e.kind === "event" && e.body === `run ${r.run} closed`)?.at ?? "";
      const orch = orchestratorOf(r);
      const orchestrator = snap.roster.find((m) => m.member === orch)?.nick || orch;
      return { ...tabOf(snap, r), closed: closedAt, outcome: null, orchestrator };
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

/** A held file (D16): a post about a path that names one of its holders, by a member not holding it. */
function heldFileOf(snap: BoardSnapshot, e: SnapshotEvent, ctx: MentionCtx): { path: string; holders: string[] } | null {
  if (e.kind !== "msg" || !e.about) return null;
  const holders = snap.files.find((f) => f.path === e.about)?.holders ?? [];
  if (holders.includes(e.from)) return null;
  const named = targets(e, ctx).filter((t) => holders.includes(t));
  return named.length ? { path: e.about, holders: named } : null;
}

const QUESTION = /^@orchestrator new question:/;

/** The board server's liveness line as the audience reads it: `idle 35s · last active recruiter · phase polish 3/6 done`. */
function idleText(body: string): string {
  const secs = /^stalled (\d+)s/.exec(body)?.[1];
  const who = /last active (?:[\w.-]+\/)?([\w.-]+)/.exec(body)?.[1];
  const phase = /(phase .+ done|no phase open)\s*$/.exec(body)?.[1];
  return [secs ? `idle ${secs}s` : "idle", who ? `last active ${who}` : null, phase].filter(Boolean).join(" · ");
}

/** One event as an item: its tier, word, tip and state, read from the thread (D8, D9, D16). */
function itemOf(snap: BoardSnapshot, e: SnapshotEvent, run: RunSummary, ctx: MentionCtx): Item {
  const base = { seq: e.seq, at: e.at, run: run.run, from: e.from, about: e.about ?? null };
  const said = (kind: ItemKind, tier: Tier, word: string | null, tip: string | null, state: string | null = null): Item => ({
    ...base,
    kind,
    tier,
    word,
    tip,
    text: e.body,
    joined: false,
    state,
  });
  if (isPhase(e)) return { ...base, kind: "phase", about: null, ...phaseOf(e) };
  if (flagOf(e)) {
    const answer = flagAnswer(e, snap.events);
    if (answer.state === "settled") return said("settled", "decided", `⚑ flag settled by #${answer.seq}`, TIPS.settled, "settled");
    return said("flag", "act", "⚑ flag · open", TIPS.flag, answer.state);
  }
  // the board server's liveness events, told apart from the board's plain lines (`swarm` liveness)
  // board-split#D51: an alarm's header names the member it tells of, never its author's card
  const told = memberEventMember(e, run);
  const who = told ? `${splitMember(told).seat} ` : "";
  if (e.kind === "event" && e.event === "stalled") {
    const rule = stallRuleOf(e);
    if (rule) return said("stalled", "act", `◷ ${who}stalled · ${STALL_WORDS[rule] ?? rule}`, TIPS.stalledMember, rule);
    // D51: the board's alarm about the whole run (`stalled run <n> (<group>): every member silent; …`)
    const runSilent = /^stalled run \d+ \([^)]*\): ([^;]+)/.exec(e.body)?.[1];
    if (runSilent) return said("stalled", "act", `◷ run stalled · ${runSilent}`, TIPS.stalled);
    return { ...said("stalled", "wait", "◷ idle", TIPS.stalled), text: idleText(e.body) };
  }
  if (e.kind === "event" && e.event === "liveness") {
    return isLinkDown(e) ? said("liveness", "wait", `liveness · ${who}link down`, TIPS.linkDown, "link-down") : said("liveness", "wait", `liveness · ${who}blind`, TIPS.liveness);
  }
  if (e.kind === "event" && e.event === "recovered") return said("recovered", "decided", `↺ ${who}recovered`, TIPS.recovered);
  // board-split#D36: `lost` is the board's name for what an older board posted as `gone`
  if (e.kind === "event" && (e.event === "lost" || (e.event as string) === "gone")) return said("gone", "act", `✕ ${who}${e.event}`, TIPS.gone);
  if (isQuiet(e)) {
    const minutes = /(\d+)\s*min/.exec(e.body)?.[1];
    return said("quiet", "wait", minutes ? `◷ quiet ${minutes} min` : "◷ quiet", TIPS.quiet, quietAnswered(e, snap.events) ? "back" : null);
  }
  if (e.kind === "event") {
    const word = eventLine(e.body).word;
    const said = eventWord(e.body);
    return { ...base, kind: "event", text: e.body, ...said, tip: (word ? EVENT_TIPS[word] : undefined) ?? (e.event ? EVENT_TIPS[e.event] : undefined) ?? null };
  }
  if (e.kind === "urgent") return said("urgent", "act", "! urgent", TIPS.urgent);
  if (e.kind === "agreement") {
    const other = (e.mentions?.length ? e.mentions : targets(e, ctx)).find((t) => t !== e.from);
    const endorsed = snap.events.some((x) => x.kind === "endorsement" && x.seq > e.seq && x.body.includes(`#${e.seq}`));
    const word = `✔ agreed${other ? ` with ${memberText(snap, other)}` : ""}${endorsed ? ", endorsed" : ""}`;
    return said("agreement", "decided", word, TIPS.agreement, endorsed ? "endorsed" : null);
  }
  if (QUESTION.test(e.body)) {
    const orch = orchestratorOf(run);
    const answered = snap.events.some((x) => x.seq > e.seq && x.from === orch && ((e.about != null && x.about === e.about) || targets(x, ctx).includes(e.from)));
    return said("question", "wait", `? question for ${memberText(snap, orch)}`, TIPS.question, answered ? "answered" : null);
  }
  const held = heldFileOf(snap, e, ctx);
  if (held) {
    const answered = snap.events.some((x) => x.seq > e.seq && x.about === held.path && held.holders.includes(x.from));
    return said("held", "wait", answered ? "held file · answered" : "held file", TIPS.held, answered ? "answered" : null);
  }
  return said("message", e.kind === "endorsement" ? "decided" : "talk", null, null);
}

/** The one conversation, filtered to the pick (D1, D14): every open run's items (All); a run's
 *  items and those naming its members; or the followed member's items and those naming it.
 *  Consecutive messages of one member join. */
export function conversation(snap: BoardSnapshot, pick: Pick): Item[] {
  const ctx = mentionCtx(snap);
  const picked = pick.run == null ? null : (snap.runs.find((r) => r.run === pick.run) ?? null);
  const members = new Set(picked ? membersOf(snap, picked).map((m) => m.member) : []);
  // the board's stored mentions (a flag's holder and writer) or the body's
  const namesPicked = (e: SnapshotEvent): boolean => !!picked && [...(e.mentions ?? []), ...targets(e, ctx)].some((t) => members.has(t) || t === `${picked.group}/*`);
  const items: Item[] = [];
  /** A rule-bearing stall's seq, to the member it names. */
  const stalledMembers = new Map<number, string>();
  /** A member event's seq (liveness, gone, recovered), to the member `<group>/<id>` it tells of. */
  const toldOf = new Map<number, string>();
  for (const e of [...snap.events].sort((a, b) => a.seq - b.seq)) {
    const run = runOf(snap, e);
    if (!run) continue;
    if (pick.follow) {
      // a phase separator of the followed member's run stays: it mentions every member of it
      if (!involves(e, pick.follow, ctx) && !(isPhase(e) && run.group === splitMember(pick.follow).plan) && !isAboutMember(e, run, pick.follow)) continue;
    } else if (picked) {
      if (run.run !== picked.run && !namesPicked(e)) continue;
    } else if (!run.open) continue;
    const item = itemOf(snap, e, run, ctx);
    const stalledMember = item.kind === "stalled" ? stalledMemberOf(e) : null;
    if (stalledMember) stalledMembers.set(e.seq, stalledMember);
    const told = memberEventMember(e, run);
    if (told) toldOf.set(e.seq, told);
    const prev = items[items.length - 1];
    const joins = item.kind === "message" && prev?.kind === "message" && prev.from === item.from;
    items.push(joins ? { ...item, joined: true } : item);
  }
  // a stall is the orchestrator's alarm, not the conversation: only the live one shows, as one row, the
  // latest; a stall anything came after has passed and leaves the thread clean
  // a member's stall under a rule is its own alarm: the latest per member stays, until anything that member says
  const last = items[items.length - 1];
  // (the stall stores the member's id, `<id>`, in its run; a post is that member's when its run and id match)
  const memberKey = (run: RunId, member: string): string => `${run}\u0000${member}`;
  const latestStallOf = new Map<string, number>();
  for (const i of items) {
    const member = i.kind === "stalled" ? stalledMembers.get(i.seq) : undefined;
    if (member) latestStallOf.set(memberKey(i.run, member), i.seq);
  }
  const saidSince = (i: Item, member: string): boolean => items.some((x) => x.seq > i.seq && x.run === i.run && splitMember(x.from).seat === member);
  // V4, plan D55: a stall has passed once the board's badge for the member is no longer stalled; aiview derives none
  const groupOf = new Map(snap.runs.map((r) => [r.run, r.group]));
  const livenessOf = new Map(snap.roster.map((r) => [r.member, r.liveness]));
  const badgeOf = new Map(snap.roster.map((r) => [r.member, r.badge ?? null]));
  const stallPassed = (i: Item, member: string): boolean => badgeOf.get(`${groupOf.get(i.run)}/${member}`)?.name !== "stalled";
  // F9: a link-down row leaves once the member's link reads it again after the row; a gone row once a
  // `recovered` of the member follows, or its liveness reads anything but gone
  const linkBack = (i: Item, member: string): boolean => {
    const aliveAt = livenessOf.get(member)?.aliveAt;
    return typeof aliveAt === "number" && aliveAt > Date.parse(i.at);
  };
  const recoveredSince = (i: Item, member: string): boolean => items.some((x) => x.seq > i.seq && x.kind === "recovered" && toldOf.get(x.seq) === member);
  const goneHolds = (i: Item, member: string): boolean => !recoveredSince(i, member) && badgeOf.get(member)?.name === "lost";
  return items.filter((i) => {
    const member = toldOf.get(i.seq);
    if (i.kind === "liveness" && i.state === "link-down" && member) return !linkBack(i, member);
    if (i.kind === "gone" && member) return goneHolds(i, member);
    if (i.kind !== "stalled") return true;
    const stalled = stalledMembers.get(i.seq);
    if (!stalled) return i === last;
    return latestStallOf.get(memberKey(i.run, stalled)) === i.seq && !saidSince(i, stalled) && !stallPassed(i, stalled);
  });
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

/** The board's events that tell of one member (stalled, liveness, gone, recovered): its member in the event's data or
 *  at the head of its body (`gone <group>/<id>: …`), so following that member keeps them (V5). */
const MEMBER_EVENTS: ReadonlySet<string> = new Set(["stalled", "liveness", "lost", "gone", "recovered"]);
/** The member, `<group>/<id>`, one of those events tells of; null for any other event or a body naming none. */
function memberEventMember(e: SnapshotEvent, run: RunSummary): string | null {
  if (e.kind !== "event" || !e.event || !MEMBER_EVENTS.has(e.event)) return null;
  // board-split#D51: the board names it (an alarm served as the board's carries its subject)
  if (e.subject) return e.subject;
  if (e.meta && "rule" in e.meta) return `${run.group}/${e.meta.member}`;
  if (e.meta && "linkDown" in e.meta) return e.meta.linkDown;
  return new RegExp(`^${e.event} (\\S+?):? `).exec(e.body)?.[1] ?? null;
}
const isAboutMember = (e: SnapshotEvent, run: RunSummary, member: string): boolean => memberEventMember(e, run) === member;

// ── the conversation's filters (SL11) ───────────────────────────────────────────────

/** One kind at a time; `all` narrows nothing. */
export type KindFilter = "all" | "messages" | "agreements" | "flags";
/** The conversation's narrowing after the pick: a kind, and a file its items are about. */
export type Narrow = { kind: KindFilter; file: string | null };

const MESSAGE_KINDS = new Set<Item["kind"]>(["message", "urgent", "held", "question"]);
const isFlagItem = (i: Item): boolean => i.kind === "flag" || i.kind === "settled";

/** The items a kind keeps; Flags keeps each flag and the posts after it about its file. */
function kindTest(items: Item[], kind: KindFilter): (i: Item) => boolean {
  if (kind === "messages") return (i) => MESSAGE_KINDS.has(i.kind);
  if (kind === "agreements") return (i) => i.kind === "agreement";
  if (kind === "flags") {
    const flags = items.filter(isFlagItem);
    return (i) => isFlagItem(i) || (i.kind !== "event" && i.about != null && flags.some((f) => f.about === i.about && f.seq < i.seq));
  }
  return () => true;
}

/** The items through the kind, then the file; a phase separator always stays, it says where the talk is. */
export function narrow(items: Item[], n: Narrow): Item[] {
  const byKind = kindTest(items, n.kind);
  return items.filter((i) => i.kind === "phase" || (byKind(i) && (n.file == null || i.about === n.file)));
}

/** What each kind chip counts: Flags its flags alone, not their answers. */
export function filterCounts(items: Item[]): Record<Exclude<KindFilter, "all">, number> {
  return {
    messages: items.filter((i) => MESSAGE_KINDS.has(i.kind)).length,
    agreements: items.filter((i) => i.kind === "agreement").length,
    flags: items.filter(isFlagItem).length,
  };
}

/** Every file the items are about, with how many, sorted by path. */
export function conversationFiles(items: Item[]): { path: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const i of items) if (i.about) counts.set(i.about, (counts.get(i.about) ?? 0) + 1);
  return [...counts.entries()].map(([path, count]) => ({ path, count })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** A run's members, orchestrator first; a closed run's too, as they ended. */
export function agents(snap: BoardSnapshot, run: RunId): SnapshotMember[] {
  const r = snap.runs.find((x) => x.run === run);
  return r ? orderRoster(membersOf(snap, r)) : [];
}

/** The held files with their holders: those held by one run's members, or every one (null); null for a run that holds
 *  no files, so no claims row shows under it. */
export function claimRows(snap: BoardSnapshot, run: RunId | null): { path: string; holders: string[]; shared: boolean }[] | null {
  const r = run == null ? null : snap.runs.find((x) => x.run === run);
  if (run != null && !r) return [];
  // V-19 (D66): a brainswarm's seats hold no files: no claims row under it
  if (r?.kind === "brainstorm") return null;
  // by the run's members, as the strip: another run of the same group holds nothing here
  const members = r ? new Set(membersOf(snap, r).map((m) => m.member)) : null;
  const inRun = (holder: string): boolean => !members || members.has(holder);
  return snap.files.filter((f) => f.holders.some(inRun)).map((f) => ({ path: f.path, holders: f.holders, shared: f.holders.length > 1 }));
}

export type MergedFileRow = { path: string; mergers: string[] };

/** A run's merged files, from its merged events' `files:` line: each path once, in first-merged
 *  order, with every member that merged it, in order. A merge with no files (`-`) adds none. */
export function mergedFileRows(snap: BoardSnapshot, run: RunId): MergedFileRow[] {
  const rows = new Map<string, MergedFileRow>();
  for (const e of snap.events) {
    if (e.run !== run || e.kind !== "event" || eventLine(e.body).word !== "merged") continue;
    const filesLine = e.body.split(/\r?\n/).find((l) => l.startsWith("files: "));
    if (!filesLine) continue;
    for (const path of filesLine.slice("files: ".length).split(", ").map((p) => p.trim())) {
      if (!path || path === "-") continue;
      const row = rows.get(path) ?? { path, mergers: [] };
      if (!row.mergers.includes(e.from)) row.mergers.push(e.from);
      rows.set(path, row);
    }
  }
  return [...rows.values()];
}
