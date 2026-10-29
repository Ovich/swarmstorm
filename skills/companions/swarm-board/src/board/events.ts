// The board's core events (D59): the one place an event name is listed. A member subscribes to
// the events that wake its `wait --mentions`; adding an event is a row in EVENTS and the call
// that posts it by its constant.
import type { Message, Participant } from "./board.ts";

export type EventName = "agreement" | "endorsement" | "merged" | "joined" | "ended" | "stale" | "opened" | "closed" | "urgent" | "flag" | "quiet" | "back" | "phase" | "pause" | "resume" | "done" | "all-done" | "idle" | "stalled" | "gone" | "liveness" | "recovered" | "unlocked" | "breach" | "composition" | "all-joined";
/** `run`: the member's own run; `any`: every run of the project. */
export type Scope = "run" | "any";
/** `carry`: the event never ends a wait by itself; it rides on the next wake, or wakes once due (idea 2). */
export type Subscription = { event: EventName; scope: Scope; carry?: true };

export interface EventDef {
  name: EventName;
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
export const EVENTS: Record<EventName, EventDef> = {
  // a seat backs another member's agreement (D36): the answer module tells a seat to back it
  agreement: { name: "agreement" },
  endorsement: { name: "endorsement" },
  merged: { name: "merged" },
  joined: { name: "joined" },
  ended: { name: "ended" },
  stale: { name: "stale" },
  // an orchestrator silent STALE_MS, posted once in its run (D15); "back" when it calls again
  quiet: { name: "quiet" },
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
  // a member finished the current phase (`done <name>`); mentions the orchestrator
  done: { name: "done" },
  // every member of the run is done with the current phase: one event to the orchestrator
  "all-done": { name: "all-done" },
  // every member but the orchestrator waiting (D31): at each whole IDLE_MS while it holds; wakes the orchestrator alone
  idle: { name: "idle", toAuthor: true },
  // `stalled <member>`: one member quiet past the run's threshold, to the orchestrator alone, again every
  // STALLED_AGAIN_MS while it lasts (swarm-relay D11); no other member is woken
  stalled: { name: "stalled", toAuthor: true },
  // a member told gone reads non-gone again (idea 1, rule 4): once, to the orchestrator alone
  recovered: { name: "recovered", toAuthor: true },
  // idea 4: a named lock released (unlock, end, gone, close); mentions each waiter across runs, who locks again
  unlocked: { name: "unlocked", toAuthor: true },
  // idea 4: a member killed by name or pattern, or by port without the port's lock; to the orchestrator alone
  breach: { name: "breach", toAuthor: true },
  // a member whose agent finished without end, or whose link is lost (D12); to the orchestrator alone
  gone: { name: "gone", toAuthor: true },
  // a member's transcript cannot be read, or its link is lost while it grows: mentions the orchestrator
  liveness: { name: "liveness", toAuthor: true },
  // a write outside the writer's claim on a path another holds (D10); mentions: the holder, then the writer
  flag: { name: "flag" },
  // the run's composition changed (D4): `+ w4 worker (the app)`, `- w2 gone`, `+ w2 back`; carried to every member, waking none
  composition: { name: "composition", ambient: true },
  // every declared seat has a member (D5): to the orchestrator, which opens the first phase or posts the tasks on it
  "all-joined": { name: "all-joined" },
};

const NAMES = Object.keys(EVENTS) as EventName[];
const isEvent = (s: string): s is EventName => Object.hasOwn(EVENTS, s);

/** The message's event: its stored name, else what its kind is (agreement, endorsement, urgent); null for a plain post. */
export function eventOf(m: Message): EventName | null {
  if (m.event && isEvent(m.event)) return m.event;
  return m.kind === "agreement" || m.kind === "endorsement" || m.kind === "urgent" ? m.kind : null;
}

/** "agreement,any:merged" (or a list of such; `main:` is read as `any:`); throws on an unknown name, listing the known ones. */
export function parseSubscriptions(spec: string | string[]): Subscription[] {
  const parts = (Array.isArray(spec) ? spec : [spec]).flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
  const out: Subscription[] = [];
  for (const p of parts) {
    const prefix = /^(any|main):/.exec(p)?.[0];
    const name = prefix ? p.slice(prefix.length) : p;
    if (!isEvent(name)) throw new Error(`unknown event ${name}: the events are ${NAMES.join(", ")}`);
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

/** A message that ends `me`'s `wait --mentions`: a mention, an always event, or a subscribed event in its scope. */
export function wakes(m: Message, me: Participant, subs: Subscription[]): boolean {
  if (m.from === me.name && !(m.event && isEvent(m.event) && EVENTS[m.event].toAuthor)) return false;
  if (mentions(m, me)) return true;
  const e = eventOf(m);
  if (!e) return false;
  if (EVENTS[e].always) return true;
  // G5: a join is a composition change too: a member subscribed to composition wakes on it
  return subs.some((s) => !s.carry && (s.event === e || (e === "joined" && s.event === "composition")) && (s.scope === "any" || m.run === me.run));
}

/** A message carried to `me` (idea 2): an event of a carry subscription in its scope, that does not wake it;
 *  the same own-message rule as `wakes`. It rides on the next wake, or wakes once due. */
export function carries(m: Message, me: Participant, subs: Subscription[]): boolean {
  if (m.from === me.name && !(m.event && isEvent(m.event) && EVENTS[m.event].toAuthor)) return false;
  if (wakes(m, me, subs)) return false;
  const e = eventOf(m);
  if (!e) return false;
  // G5: a join is the run's one composition line for a join, carried to every member of the run
  if ((EVENTS[e].ambient || e === "joined") && m.run === me.run) return true;
  return subs.some((s) => s.carry === true && s.event === e && (s.scope === "any" || m.run === me.run));
}
