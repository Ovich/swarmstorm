// The one conversation (D1, D8, D13-D16) as the page shows it, a pure function of the snapshot and
// the pick App owns: the run it is scoped to, or the member it follows; then its narrowing by kind
// and file (plan 2026-11-27-codebase-rework#D16). No child computes any of it.
import type { BoardSnapshot, SnapshotEvent, RunSummary } from "../../../../swarm-board/src/client/reader.ts";
import { nameHandle, parseMentions } from "../../../../swarm-board/src/client/reader.ts";
import { memberLabel, ORCHESTRATOR, orchestratorOf, splitMember, type RunId } from "./names.ts";
import { readEvent, type EventTone, type Reading } from "./lines.ts";
import { membersOf } from "./runs.ts";

// ── mentions ────────────────────────────────────────────────────────────────────────

/** What resolving a mention needs: every run's group on the repository, and the active members'
 *  funny names as a mention writes them (D43). */
type MentionCtx = { groups: string[]; names: ReadonlyMap<string, string> };

const mentionCtx = (snap: BoardSnapshot): MentionCtx => ({
  groups: [...new Set(snap.runs.map((r) => r.group))],
  names: new Map(
    snap.roster.filter((r) => r.seat !== ORCHESTRATOR && r.state !== "ended" && (r.state as string) !== "done").map((r) => [nameHandle(r.nick), r.member]),
  ),
});

/** Whom a message names, resolved as the Board resolves it. */
const targets = (e: SnapshotEvent, ctx: MentionCtx): string[] => parseMentions(e.body, splitMember(e.from).plan, ctx.groups, ctx.names);

/** A message from the member, or naming it (by name, or its plan's `@all`). */
function involves(e: SnapshotEvent, member: string, ctx: MentionCtx): boolean {
  if (e.from === member) return true;
  const { plan } = splitMember(member);
  return targets(e, ctx).some((t) => t === member || t === `${plan}/*`);
}

/** A member as a word writes it: code first, nick second (D10). */
function memberText(snap: BoardSnapshot, member: string): string {
  const { code, seat } = memberLabel(member);
  const nick = snap.roster.find((r) => r.member === member)?.nick;
  return nick ? `${code}·${seat} ${nick}` : `${code}·${seat}`;
}

// ── flags, and the talk they start (D10) ────────────────────────────────────────────

/** The posts that answer a flag: after it, `--about` its path, an agreement by anyone or a post
 *  by one of its two members; never another flag or a board event. */
function answersOf(flag: SnapshotEvent, events: SnapshotEvent[]): SnapshotEvent[] {
  const f = readEvent(flag);
  if (f.kind !== "flag") return [];
  return events.filter(
    (e) => e.seq > flag.seq && e.about === f.path && e.kind !== "event" && readEvent(e).kind !== "flag" && (e.kind === "agreement" || e.from === f.writer || e.from === f.holder),
  );
}

/** Settled by the first agreement that answers it, else answered by the first post, else open. */
type FlagAnswer = { state: "settled" | "answered"; seq: number } | { state: "open" };

export function flagAnswer(flag: SnapshotEvent, events: SnapshotEvent[]): FlagAnswer {
  const answers = answersOf(flag, events);
  const agreed = answers.find((e) => e.kind === "agreement");
  if (agreed) return { state: "settled", seq: agreed.seq };
  return answers.length ? { state: "answered", seq: answers[0].seq } : { state: "open" };
}

// ── an item ─────────────────────────────────────────────────────────────────────────

/** What the conversation shows: one run (null = All), or the member followed. */
export type Pick = { run: RunId | null; follow: string | null };
type ItemKind = "message" | "flag" | "urgent" | "question" | "agreement" | "settled" | "stalled" | "gone";
type Tier = "act" | "wait" | "decided" | "talk";
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
  question: "Question: a seat asks its orchestrator something the debate cannot settle alone. It waits for the answer.",
  agreement: "Agreed: two members settled something between them, and it binds both. An endorsement is another member backing it.",
  merged: "Merged: this member's branch went into the plan's branch. Members changing the files it merged get it with their own delivery.",
  lock: "Waiting for the merge lock: one member merges at a time, across every run.",
  opened: "Opened: an orchestrator started a run on the board.",
  closed: "Closed: the run is over; its conversation is in the archive (☰).",
  joined: "Joined: a member arrived on the board and took its seat.",
  ended: "Ended: the member left the board; the files it was changing are no longer listed.",
  stalled: "Stopped: no member's tokens have moved for the run's window. The orchestrator is told: it posts the next task, opens the next phase or resumes the members. The row keeps only the latest and leaves once anything happens.",
  gone: "Lost: this member's link is down while it still owes work (a member owing nothing whose link is down is away, resumable); the orchestrator dispatches a fresh agent into its seat or ends it.",
} as const;

/** A board event's tip, by its word or its stored name. */
const EVENT_TIPS = new Map<string, string>([
  ["merged", TIPS.merged],
  ["waiting", TIPS.lock],
  ["merge lock", TIPS.lock],
  ["opened", TIPS.opened],
  ["closed", TIPS.closed],
  ["joined", TIPS.joined],
  ["ended", TIPS.ended],
]);

/** What turning one row into its item needs beside its reading. */
type ItemSite = { snap: BoardSnapshot; e: SnapshotEvent; run: RunSummary; ctx: MentionCtx };

const baseOf = ({ e, run }: ItemSite) => ({ seq: e.seq, at: e.at, run: run.run, from: e.from, about: e.about ?? null });
const said = (site: ItemSite, kind: ItemKind, tier: Tier, word: string | null, tip: string | null, state: string | null = null): Item => ({
  ...baseOf(site), kind, tier, word, tip, text: site.e.body, joined: false, state,
});

/** One row as an item, by its reading's kind: its tier, word, tip and state, read from the thread (D8, D9, D16). */
const ITEM_OF: { [K in Reading["kind"]]: (reading: Extract<Reading, { kind: K }>, site: ItemSite) => Item } = {
  phase: (r, site) => ({ ...baseOf(site), kind: "phase", about: null, name: r.name, text: r.text }),
  flag: (r, site) => {
    // the body mentions the member told and names the other bare: both read as mentions on the page, which wakes no one
    const bare = (name: string): RegExp => new RegExp(`(^|[^@\\w/-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w/-])`, "g");
    const text = [r.writer, r.holder].reduce((t, name) => t.replace(bare(name), (_m, pre: string) => `${pre}@${name}`), site.e.body);
    const answer = flagAnswer(site.e, site.snap.events);
    if (answer.state === "settled") return { ...said(site, "settled", "decided", `⚑ flag settled by #${answer.seq}`, TIPS.settled, "settled"), text };
    return { ...said(site, "flag", "act", "⚑ flag · open", TIPS.flag, answer.state), text };
  },
  stopped: (_r, site) => said(site, "stalled", "act", "◷ swarm stopped", TIPS.stalled),
  // board-split#D51: an alarm's header names the member it tells of, never its author's card
  lost: (r, site) => said(site, "gone", "act", `✕ ${r.member ? `${splitMember(r.member).seat} ` : ""}lost`, TIPS.gone),
  event: (r, site) => ({
    ...baseOf(site), kind: "event", text: site.e.body, word: r.word, tone: r.tone, rest: r.rest,
    tip: (r.tag ? EVENT_TIPS.get(r.tag) : undefined) ?? (site.e.event ? EVENT_TIPS.get(site.e.event) : undefined) ?? null,
  }),
  urgent: (_r, site) => said(site, "urgent", "act", "! urgent", TIPS.urgent),
  agreement: (_r, site) => {
    const { snap, e, ctx } = site;
    const other = (e.mentions?.length ? e.mentions : targets(e, ctx)).find((t) => t !== e.from);
    const endorsed = snap.events.some((x) => x.kind === "endorsement" && x.seq > e.seq && x.body.includes(`#${e.seq}`));
    const word = `✔ agreed${other ? ` with ${memberText(snap, other)}` : ""}${endorsed ? ", endorsed" : ""}`;
    return said(site, "agreement", "decided", word, TIPS.agreement, endorsed ? "endorsed" : null);
  },
  question: (_r, site) => {
    const { snap, e, run, ctx } = site;
    const orch = orchestratorOf(run);
    const answered = snap.events.some((x) => x.seq > e.seq && x.from === orch && ((e.about != null && x.about === e.about) || targets(x, ctx).includes(e.from)));
    return said(site, "question", "wait", `? question for ${memberText(snap, orch)}`, TIPS.question, answered ? "answered" : null);
  },
  endorsement: (_r, site) => said(site, "message", "decided", null, null),
  message: (_r, site) => said(site, "message", "talk", null, null),
};

const itemOf = (reading: Reading, site: ItemSite): Item => (ITEM_OF[reading.kind] as (r: Reading, s: ItemSite) => Item)(reading, site);

// ── the conversation ────────────────────────────────────────────────────────────────

/** The run an item belongs to: its stored `run` once the board has one (SL1), else its author's
 *  run, the open one of that group or its newest, so an old Main row is labelled too (D13). */
function runOf(snap: BoardSnapshot, e: SnapshotEvent): RunSummary | null {
  const stored = (e as SnapshotEvent & { run?: RunId | null }).run;
  if (stored != null) return snap.runs.find((r) => r.run === stored) ?? null;
  const group = splitMember(e.from).plan;
  const ofGroup = snap.runs.filter((r) => r.group === group);
  return ofGroup.find((r) => r.open) ?? [...ofGroup].sort((a, b) => b.run - a.run)[0] ?? null;
}

type Shown = (e: SnapshotEvent, run: RunSummary, reading: Reading) => boolean;

/** Which rows the pick keeps: the followed member's and those naming it; a run's and those naming
 *  its members; else every open run's (All). */
function shownBy(snap: BoardSnapshot, pick: Pick, ctx: MentionCtx): Shown {
  const follow = pick.follow;
  if (follow) {
    const group = splitMember(follow).plan;
    // a phase separator of the followed member's run stays: it mentions every member of it
    return (e, run, r) => involves(e, follow, ctx) || (r.kind === "phase" && run.group === group) || (r.kind === "lost" && r.member === follow);
  }
  const picked = pick.run == null ? null : (snap.runs.find((r) => r.run === pick.run) ?? null);
  if (!picked) return (_e, run) => run.open;
  const members = new Set(membersOf(snap, picked).map((m) => m.member));
  // the board's stored mentions (a flag's holder and writer) or the body's
  const namesPicked = (e: SnapshotEvent): boolean => [...(e.mentions ?? []), ...targets(e, ctx)].some((t) => members.has(t) || t === `${picked.group}/*`);
  return (e, run) => run.run === picked.run || namesPicked(e);
}

/** The one conversation, filtered to the pick (D1, D14): every open run's items (All); a run's
 *  items and those naming its members; or the followed member's items and those naming it.
 *  Consecutive messages of one member join. */
export function conversation(snap: BoardSnapshot, pick: Pick): Item[] {
  const ctx = mentionCtx(snap);
  const shown = shownBy(snap, pick, ctx);
  const items: Item[] = [];
  /** A lost event's seq, to the member `<group>/<id>` it tells of. */
  const toldOf = new Map<number, string>();
  for (const e of [...snap.events].sort((a, b) => a.seq - b.seq)) {
    const run = runOf(snap, e);
    if (!run) continue;
    const reading = readEvent(e);
    if (!shown(e, run, reading)) continue;
    const item = itemOf(reading, { snap, e, run, ctx });
    if (reading.kind === "lost" && reading.member) toldOf.set(e.seq, reading.member);
    const prev = items[items.length - 1];
    const joins = item.kind === "message" && prev?.kind === "message" && prev.from === item.from;
    items.push(joins ? { ...item, joined: true } : item);
  }
  return pruneAlarms(items, snap, toldOf);
}

/** A swarm stopped is the orchestrator's alarm, not the conversation: only the live one shows, the
 *  latest; a lost row stays while the board's badge for the member says lost. */
function pruneAlarms(items: Item[], snap: BoardSnapshot, toldOf: ReadonlyMap<number, string>): Item[] {
  const last = items[items.length - 1];
  const badgeOf = new Map(snap.roster.map((r) => [r.member, r.badge ?? null]));
  return items.filter((i) => {
    const member = toldOf.get(i.seq);
    if (i.kind === "gone" && member) return badgeOf.get(member)?.name === "lost";
    return i.kind !== "stalled" || i === last;
  });
}

// ── the conversation's filters (SL11) ───────────────────────────────────────────────

/** One kind at a time; `all` narrows nothing. */
export type KindFilter = "all" | "messages" | "agreements" | "flags";
/** The conversation's narrowing after the pick: a kind, and a file its items are about. */
export type Narrow = { kind: KindFilter; file: string | null };

const MESSAGE_KINDS = new Set<Item["kind"]>(["message", "urgent", "question"]);
const isFlagItem = (i: Item): boolean => i.kind === "flag" || i.kind === "settled";

/** The items a kind keeps; Flags keeps each flag and the posts after it about its file. */
const KIND_TESTS: Record<KindFilter, (items: Item[]) => (i: Item) => boolean> = {
  all: () => () => true,
  messages: () => (i) => MESSAGE_KINDS.has(i.kind),
  agreements: () => (i) => i.kind === "agreement",
  flags: (items) => {
    const flags = items.filter(isFlagItem);
    return (i) => isFlagItem(i) || (i.kind !== "event" && i.about != null && flags.some((f) => f.about === i.about && f.seq < i.seq));
  },
};

/** The items through the kind, then the file; a phase separator always stays, it says where the talk is. */
export function narrow(items: Item[], n: Narrow): Item[] {
  const byKind = (KIND_TESTS[n.kind] ?? KIND_TESTS.all)(items);
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
