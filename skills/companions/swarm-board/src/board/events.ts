// The board's core events (D59): the one place an event name is listed. An event wakes the members it is
// addressed to (its mentions); adding an event is a row in EVENTS and the call that posts it by its constant. A pack's events are its own (board-split D18), contributed by the registry.
import type { PackEventName } from "../packs/registry.ts";
import { registry } from "../packs/registry.ts";
import type { Message, Participant } from "./board.ts";

export type CoreEventName = "agreement" | "endorsement" | "joined" | "ended" | "opened" | "closed" | "urgent" | "phase" | "pause" | "resume" | "done" | "all-done" | "stopped" | "lost" | "unlocked" | "breach" | "composition" | "all-joined";
export type EventName = CoreEventName | PackEventName;

export interface EventDef<N extends string = EventName> {
  name: N;
  /** always wakes, whoever it mentions (urgent) */
  always?: boolean;
  /** posted by the board in a member's name, it reaches that member too (stopped, lost) */
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
  // a member finished the current phase (`done <name>`); mentions the orchestrator
  done: { name: "done" },
  // every member of the run is done with the current phase: one event to the orchestrator
  "all-done": { name: "all-done" },
  // simple-states: `stopped <group>`: no member's tokens moved for the run's stall window; to the orchestrator alone,
  // once per still spell, never while paused
  stopped: { name: "stopped", toAuthor: true },
  // the merge lock freed from a lost holder (D59); mentions each waiter
  unlocked: { name: "unlocked", toAuthor: true },
  // idea 4: a member killed by name, pattern or port; to the orchestrator alone
  breach: { name: "breach", toAuthor: true },
  // a member whose agent finished without end, or whose link is lost (D12, board-split D36); to the orchestrator alone
  lost: { name: "lost", toAuthor: true },
  // the run's composition changed (D4): `+ w4 worker (the app)`, `- w2 lost`, `+ w2 back`; on the thread, waking none
  composition: { name: "composition" },
  // every declared seat has a member (D5): to the orchestrator, which opens the first phase or posts the tasks on it
  "all-joined": { name: "all-joined" },
};

/** Core and pack events by name, read at first use: the registry loads after this module in some import orders. */
let all: Record<string, EventDef> | null = null;
const allEvents = (): Record<string, EventDef> => (all ??= { ...EVENTS, ...registry.events() });
export const isEvent = (s: string): s is EventName => Object.hasOwn(allEvents(), s);
/** board-split D36: the events renamed or folded into a badge's event, old name to new; a stored message under an old
 *  name reads as the new one. */
export const RENAMED_EVENTS: Readonly<Record<string, EventName>> = { gone: "lost", stale: "stopped", quiet: "stopped", stalled: "stopped", idle: "stopped" };
/** The name as the board knows it now: an old name renamed, else itself. */
export const currentEventName = (s: string): string => RENAMED_EVENTS[s] ?? s;
/** The definition of a known event. */
export const eventDef = (name: EventName): EventDef => allEvents()[name];

/** The message's event: its stored name, else what its kind is (agreement, endorsement, urgent); null for a plain post. */
export function eventOf(m: Message): EventName | null {
  const stored = m.event ? currentEventName(m.event) : null;
  if (stored && isEvent(stored)) return stored;
  return m.kind === "agreement" || m.kind === "endorsement" || m.kind === "urgent" ? m.kind : null;
}

/** Mentions `me` by name or its plan's @all. */
export function mentions(m: Message, me: Participant): boolean {
  return m.mentions.includes(me.name) || m.mentions.includes(`${me.plan}/*`);
}

/** A message that ends `me`'s wait: a message to it (a mention, its group's broadcast, an event addressed to it) or an
 *  always event (urgent); never its own, but an event the board posts in its name to it (toAuthor). */
export function wakes(m: Message, me: Participant): boolean {
  if (m.from === me.name && !(m.event && isEvent(m.event) && eventDef(m.event).toAuthor)) return false;
  if (mentions(m, me)) return true;
  const e = eventOf(m);
  return !!e && !!eventDef(e).always;
}
