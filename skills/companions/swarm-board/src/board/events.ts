// The board's core events (D59): the one place an event name is listed. A member subscribes to
// the events that wake its `wait --mentions`; adding an event is a row in EVENTS and the call
// that posts it by its constant. A pack's events are its own (board-split D18), contributed by the registry.
import type { PackEventName } from "../packs/registry.ts";
import { registry } from "../packs/registry.ts";
import type { Message, Participant } from "./board.ts";

export type CoreEventName = "agreement" | "endorsement" | "joined" | "ended" | "opened" | "closed" | "urgent" | "back" | "phase" | "pause" | "resume" | "park" | "unpark" | "done" | "all-done" | "idle" | "stalled" | "lost" | "block" | "unblock" | "liveness" | "recovered" | "unlocked" | "breach" | "composition" | "all-joined";
export type EventName = CoreEventName | PackEventName;
/** `run`: the member's own run; `any`: every run of the project. */
export type Scope = "run" | "any";
/** `carry`: the event never ends a wait by itself; it rides on the next wake, or wakes once due (idea 2). */
export type Subscription = { event: EventName; scope: Scope; carry?: true };

export interface EventDef<N extends string = EventName> {
  name: N;
  /** always wakes, whatever the subscriptions (urgent) */
  always?: boolean;
  /** the event rides on every member's next wake, never waking and never due by itself (composition, D4) */
  ambient?: true;
  /** posted by the board in a member's name, it reaches that member too (stalled, liveness) */
  toAuthor?: boolean;
}

/** A foreground wait's hold, under the 180 s after which Claude Code moves a foreground command to the background (F22); the answer module words the wait from it. */
export const FOREGROUND_WAIT_MS = 170_000;
export const FOREGROUND_NOTE = "it holds 170 s, as Claude Code detaches a foreground command that runs past 180 s; run it again when it returns empty";
/** The core's events; `eventDef` and `isEvent` read these and every pack's. */
export const EVENTS: Record<CoreEventName, EventDef<CoreEventName>> = {
  // a seat backs another member's agreement (D36): the answer module tells a seat to back it
  agreement: { name: "agreement" },
  endorsement: { name: "endorsement" },
  joined: { name: "joined" },
  ended: { name: "ended" },
  // an orchestrator stalled (silent STALE_MS) calls again (D15); its silence and a run's are `stalled` (board-split D36)
  back: { name: "back" },
  // when a run opens: its kind, group and title (D69)
  opened: { name: "opened" },
  closed: { name: "closed" },
  urgent: { name: "urgent", always: true },
  // the orchestrator opens a phase (`phase <name> <text>`), the current one ending with it: a separator on the thread;
  // it mentions `<group>/*`, so its own run's members wake and no other's, whatever the run's kind; a member
  // runs `done <name>` when its part is in
  phase: { name: "phase" },
  // the orchestrator pauses its run (`pause [text]`): mentions `<group>/*`, every member stops and waits for the resume
  pause: { name: "pause" },
  // the orchestrator lifts the pause (`resume [text]`), its message in the body: every member continues
  resume: { name: "resume" },
  // board-split D30: the orchestrator parks a seat (`park <seat>`): mentions it, which ends its turn without `end`;
  // `unpark <seat>` lifts it (so does the member's own next call)
  park: { name: "park" },
  unpark: { name: "unpark" },
  // a member finished the current phase (`done <name>`); mentions the orchestrator
  done: { name: "done" },
  // every member of the run is done with the current phase: one event to the orchestrator
  "all-done": { name: "all-done" },
  // every member but the orchestrator waiting (D31): at each whole IDLE_MS while it holds; wakes the orchestrator alone
  idle: { name: "idle", toAuthor: true },
  // `stalled <member>`: one member with no progress past the run's threshold, to the orchestrator alone, once per
  // episode, never again on a timer (swarm-relay D11, board-split D54); no other member is woken. board-split D36: also an orchestrator
  // silent STALE_MS (once, in its run) and a run whose every member is silent (once, to its orchestrator)
  stalled: { name: "stalled", toAuthor: true },
  // board-split D44: the orchestrator marks a seat blocked on the person (`block <seat> <reason>`), `unblock` lifts it; mentions the seat
  block: { name: "block" },
  unblock: { name: "unblock" },
  // a member told lost reads present again (idea 1, rule 4): once, to the orchestrator alone
  recovered: { name: "recovered", toAuthor: true },
  // idea 4: a named lock released (unlock, end, gone, close); mentions each waiter across runs, who locks again
  unlocked: { name: "unlocked", toAuthor: true },
  // idea 4: a member killed by name or pattern, or by port without the port's lock; to the orchestrator alone
  breach: { name: "breach", toAuthor: true },
  // a member whose agent finished without end, or whose link is lost (D12, board-split D36); to the orchestrator alone
  lost: { name: "lost", toAuthor: true },
  // a member's transcript cannot be read, or its link is lost while it grows: mentions the orchestrator
  liveness: { name: "liveness", toAuthor: true },
  // the run's composition changed (D4): `+ w4 worker (the app)`, `- w2 lost`, `+ w2 back`; carried to every member, waking none
  composition: { name: "composition", ambient: true },
  // every declared seat has a member (D5): to the orchestrator, which opens the first phase or posts the tasks on it
  "all-joined": { name: "all-joined" },
};

/** Core and pack events by name, read at first use: the registry loads after this module in some import orders. */
let all: Record<string, EventDef> | null = null;
const allEvents = (): Record<string, EventDef> => (all ??= { ...EVENTS, ...registry.events() });
export const isEvent = (s: string): s is EventName => Object.hasOwn(allEvents(), s);
/** board-split D36: the events renamed or folded into a badge's event, old name to new; a subscription or a stored
 *  message under an old name reads as the new one (the CLI says so once, from the answer module). */
export const RENAMED_EVENTS: Readonly<Record<string, EventName>> = { gone: "lost", stale: "stalled", quiet: "stalled" };
/** The name as the board knows it now: an old name renamed, else itself. */
export const currentEventName = (s: string): string => RENAMED_EVENTS[s] ?? s;
/** The old names in a subscription spec, each with its new one. */
export function renamedIn(spec: string | string[]): { old: string; now: EventName }[] {
  const names = (Array.isArray(spec) ? spec : [spec]).flatMap((s) => s.split(",")).map((s) => s.trim().replace(/^(any|main):/, ""));
  return [...new Set(names)].flatMap((old) => (RENAMED_EVENTS[old] ? [{ old, now: RENAMED_EVENTS[old] }] : []));
}
/** Every event's name, the core's then each pack's. */
export const eventNames = (): EventName[] => Object.keys(allEvents()) as EventName[];
/** The definition of a known event. */
export const eventDef = (name: EventName): EventDef => allEvents()[name];

/** The message's event: its stored name, else what its kind is (agreement, endorsement, urgent); null for a plain post. */
export function eventOf(m: Message): EventName | null {
  const stored = m.event ? currentEventName(m.event) : null;
  if (stored && isEvent(stored)) return stored;
  return m.kind === "agreement" || m.kind === "endorsement" || m.kind === "urgent" ? m.kind : null;
}

/** "agreement,any:merged" (or a list of such; `main:` is read as `any:`); throws on an unknown name, listing the known ones. */
export function parseSubscriptions(spec: string | string[]): Subscription[] {
  const parts = (Array.isArray(spec) ? spec : [spec]).flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
  const out: Subscription[] = [];
  for (const p of parts) {
    const prefix = /^(any|main):/.exec(p)?.[0];
    const name = currentEventName(prefix ? p.slice(prefix.length) : p);
    if (!isEvent(name)) throw new Error(`unknown event ${name}: the events are ${Object.keys(allEvents()).join(", ")}`);
    const sub: Subscription = { event: name, scope: prefix ? "any" : "run" };
    if (!out.some((o) => o.event === sub.event && o.scope === sub.scope)) out.push(sub);
  }
  return out;
}

/** "agreement, any:merged" */
export function formatSubscriptions(subs: Subscription[]): string {
  return subs.map((s) => `${s.scope === "any" ? `any:${s.event}` : s.event}${s.carry ? " (carried)" : ""}`).join(", ");
}

/** Mentions `me` by name or its plan's @all. */
export function mentions(m: Message, me: Participant): boolean {
  return m.mentions.includes(me.name) || m.mentions.includes(`${me.plan}/*`);
}

/** The alarms about one member's liveness, whose body names their subject (`stalled <member>: …`, or one line
 *  naming several). */
const MEMBER_ALARMS = new Set<string>(["stalled", "lost", "recovered", "liveness"]);

/** u1 #1349: an alarm about `me` never reaches `me` through a subscription: its own stalled ending its wait would make
 *  it recover, re-arm and stall again. Alarms go to the orchestrator and to subscribers other than their subject. */
export function alarmAbout(m: Message, me: Participant): boolean {
  const e = eventOf(m);
  if (!e || !MEMBER_ALARMS.has(e)) return false;
  const body = ` ${m.body}`;
  return body.includes(` ${me.name}:`) || body.includes(` ${me.name} (`);
}

/** A message that ends `me`'s `wait --mentions`: a mention, an always event, or a subscribed event in its scope. */
export function wakes(m: Message, me: Participant, subs: Subscription[]): boolean {
  if (m.from === me.name && !(m.event && isEvent(m.event) && eventDef(m.event).toAuthor)) return false;
  if (mentions(m, me)) return true;
  const e = eventOf(m);
  if (!e) return false;
  if (eventDef(e).always) return true;
  if (alarmAbout(m, me)) return false;
  // G5: a join is a composition change too: a member subscribed to composition wakes on it; an end likewise (V-27)
  return subs.some((s) => !s.carry && (s.event === e || (isCompositionLine(e) && s.event === "composition")) && (s.scope === "any" || m.run === me.run));
}

/** A message carried to `me` (idea 2): an event of a carry subscription in its scope, that does not wake it;
 *  the same own-message rule as `wakes`. It rides on the next wake, or wakes once due. */
/** G5, break-flow V-27: the events that are their run's composition line themselves (a join, an end). */
const isCompositionLine = (e: string): boolean => e === "joined" || e === "ended";

export function carries(m: Message, me: Participant, subs: Subscription[]): boolean {
  if (m.from === me.name && !(m.event && isEvent(m.event) && eventDef(m.event).toAuthor)) return false;
  if (wakes(m, me, subs)) return false;
  const e = eventOf(m);
  if (!e) return false;
  if (alarmAbout(m, me)) return false;
  // G5: a join is the run's one composition line for a join, carried to every member of the run; an end its one
  // line for an end (break-flow V-27)
  if ((eventDef(e).ambient || isCompositionLine(e)) && m.run === me.run) return true;
  return subs.some((s) => s.carry === true && s.event === e && (s.scope === "any" || m.run === me.run));
}
