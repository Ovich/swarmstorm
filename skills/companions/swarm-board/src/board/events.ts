// The board's core events (D59): the one place an event name is listed. A member subscribes to
// the events that wake its `wait --mentions`; adding an event is a row in EVENTS and the call
// that posts it by its constant.
import type { Message, Participant } from "./board.ts";
import { profileOf } from "./kinds.ts";

export type EventName = "agreement" | "endorsement" | "merged" | "joined" | "ended" | "stale" | "opened" | "closed" | "urgent" | "flag" | "quiet" | "back" | "phase" | "pause" | "resume" | "done" | "all-done" | "idle" | "stalled" | "gone" | "liveness" | "recovered" | "unlocked" | "breach";
/** `run`: the member's own run; `any`: every run of the project. */
export type Scope = "run" | "any";
/** `carry`: the event never ends a wait by itself; it rides on the next wake, or wakes once due (idea 2). */
export type Subscription = { event: EventName; scope: Scope; carry?: true };

export interface EventDef {
  name: EventName;
  /** always wakes, whatever the subscriptions (urgent) */
  always?: boolean;
  /** posted by the board in a member's name, it reaches that member too (stalled, liveness) */
  toAuthor?: boolean;
  /** the line a woken member runs next, or null; `cli` is the command prefix the CLI prints */
  next?(m: Message, me: Participant, cli: string): string | null;
}

/** A POSIX shell word, double-quoted when it holds anything else than plain characters. */
const word = (w: string): string => (/^[\w@%+=:,./-]+$/.test(w) ? w : `"${w.replace(/(["\\$`])/g, "\\$1")}"`);

/** A foreground wait holds under the shell tool's 600000 ms limit, 60 s spare (idea 2, B7; the CLI's waitCommand says the same). */
const FOREGROUND_WAIT_MS = 540_000;
/** The foreground wait a woken member runs next, with its hold: the bare command, runnable as printed (F6); the
 *  tool timeout to give it is said in the prose before it. */
const foregroundWait = (cli: string, me: Participant): string => `${cli} wait --mentions --as ${word(me.name)} --timeout ${FOREGROUND_WAIT_MS}`;

/** The move a `stalled` asks of the orchestrator, by the rule that made its member quiet (idea 1, rule 6); a
 *  stalled stored before the rules gives the general move. */
function stalledMove(m: Message, me: Participant, cli: string): string {
  const meta = m.meta && "rule" in m.meta ? m.meta : null;
  const id = meta?.member ?? "<member>";
  switch (meta?.rule) {
    case "ended":
      return "a post does not wake it: SendMessage it, or dispatch it again";
    case "in-turn":
      return "SendMessage it; if it does not answer, dispatch it again";
    case "background":
      return `ask it: ${cli} post ${word(`@${id} …`)} --as ${word(me.name)}, or SendMessage it if its turn ended`;
    case "call":
      return "SendMessage it to stop the call";
    case "owing":
      return `${cli} post ${word(`@${id} your part of ${meta.phase ?? "<phase>"}`)} --as ${word(me.name)}: its wait returns on it`;
    case "lock":
      return `ask ${meta.holder ?? "its holder"} to unlock ${meta.lock ?? "<lock>"}, or to stop what it holds: ${cli} post ${word(`@${meta.holder ?? "<holder>"} …`)} --as ${word(me.name)}`;
    default:
      return `read the thread, then address the member who owes a move (${cli} post "@<member> <what you need>" --as ${word(me.name)})`;
  }
}

export const EVENTS: Record<EventName, EventDef> = {
  // a seat backs another member's agreement (D36)
  agreement: {
    name: "agreement",
    next: (m, me, cli) =>
      profileOf(me.kind).member === "seat" && m.from !== me.name ? `back it: ${cli} endorse ${m.seq} --as ${word(me.name)}` : null,
  },
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
  phase: {
    name: "phase",
    next: (m, me, cli) => {
      const name = m.meta && "phase" in m.meta ? m.meta.phase : null;
      if (!name || me.seat === "orchestrator" || m.from === me.name) return null;
      return `when your part of ${name} is posted: ${cli} done ${word(name)} --as ${word(me.name)}`;
    },
  },
  // the orchestrator pauses its run (`pause [text]`): mentions `<group>/*`, every member stops and waits for the resume
  pause: {
    name: "pause",
    next: (m, me, cli) => {
      if (me.seat === "orchestrator" || m.from === me.name) return null;
      // idea 2 (B12): a pause waiting on the person says so, as the CLI's paused line does
      const pause = m.meta && "person" in m.meta ? m.meta : null;
      const why = pause?.person ? `waiting on the person: ${pause.text || "their decision"}; ` : "";
      return `${why}stop where you are: start nothing new, claim and merge nothing; wait in the foreground for the resume (give your shell tool a 600000 ms timeout): ${foregroundWait(cli, me)}`;
    },
  },
  // the orchestrator lifts the pause (`resume [text]`), its message in the body: every member continues
  resume: {
    name: "resume",
    next: (m, me) => (me.seat === "orchestrator" || m.from === me.name ? null : "the run resumed: continue where you stopped, as the resume's message says"),
  },
  // a member finished the current phase (`done <name>`); mentions the orchestrator
  done: { name: "done" },
  // every member of the run is done with the current phase: one event to the orchestrator
  "all-done": {
    name: "all-done",
    next: (m, me, cli) =>
      me.seat === "orchestrator" ? `open the next phase: ${cli} phase <name> "<text>" --as ${word(me.name)}; after the last, ${cli} close --run ${m.run}` : null,
  },
  // every member but the orchestrator waiting (D31): at each whole IDLE_MS while it holds; wakes the orchestrator alone
  idle: {
    name: "idle",
    toAuthor: true,
    next: (_m, me, cli) =>
      me.seat === "orchestrator" ? `the swarm is quiet: open the next phase if all are done (${cli} phase <name> "<text>" --as ${word(me.name)}), else wait again` : null,
  },
  // `stalled <member>`: one member quiet past the run's threshold, to the orchestrator alone, again every
  // STALLED_AGAIN_MS while it lasts (swarm-relay D11); no other member is woken
  stalled: {
    name: "stalled",
    toAuthor: true,
    next: (m, me, cli) => (me.seat === "orchestrator" ? stalledMove(m, me, cli) : null),
  },
  // a member told gone reads non-gone again (idea 1, rule 4): once, to the orchestrator alone
  recovered: { name: "recovered", toAuthor: true },
  // idea 4: a named lock released (unlock, end, gone, close); mentions each waiter across runs, who locks again
  unlocked: {
    toAuthor: true,
    name: "unlocked",
    next: (m, me, cli) => {
      const name = m.meta && "unlocked" in m.meta ? m.meta.unlocked : null;
      return name && m.mentions.includes(me.name) ? `it is free: lock it now: ${cli} lock ${word(name)} --as ${word(me.name)}` : null;
    },
  },
  // idea 4: a member killed by name or pattern, or by port without the port's lock; to the orchestrator alone
  breach: {
    name: "breach",
    toAuthor: true,
    next: (m, me) => {
      const member = m.meta && "breach" in m.meta ? m.meta.breach : null;
      return member && me.seat === "orchestrator" ? `SendMessage ${member} "stop only the PIDs you started, or lock the port first: machine.md"` : null;
    },
  },
  // a member whose agent finished without end, or whose link is lost (D12); to the orchestrator alone
  gone: {
    name: "gone",
    toAuthor: true,
    next: (_m, me) => (me.seat === "orchestrator" ? "its agent is not running: dispatch it again, or close its seat" : null),
  },
  // a member's transcript cannot be read: the stall check is blind for it; mentions the orchestrator
  liveness: {
    name: "liveness",
    toAuthor: true,
    // idea 1, rule 4 (v1-b): a link lost while the transcript grows; the member restarts it with the command its join printed
    next: (m, me, cli) => {
      const member = m.meta && "linkDown" in m.meta ? m.meta.linkDown : null;
      if (!member || me.seat !== "orchestrator") return null;
      return `SendMessage ${member} to restart its link, in the background: ${cli} link --run ${m.run} --as ${word(member)}`;
    },
  },
  // a write outside the writer's claim on a path another holds (D10); mentions: the holder, then the writer
  flag: {
    name: "flag",
    next: (m, me, cli) => {
      const [holder, writer] = m.mentions;
      if (!m.about || !holder || !writer) return null;
      if (me.name === holder) return `settle it: ${cli} agree ${word(`@${writer} <who changes what>`)} --about ${word(m.about)}`;
      if (me.name === writer) return `settle it: ${cli} post ${word(`@${holder} <what you change>`)} --about ${word(m.about)}`;
      return null;
    },
  },
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
  return subs.some((s) => !s.carry && s.event === e && (s.scope === "any" || m.run === me.run));
}

/** A message carried to `me` (idea 2): an event of a carry subscription in its scope, that does not wake it;
 *  the same own-message rule as `wakes`. It rides on the next wake, or wakes once due. */
export function carries(m: Message, me: Participant, subs: Subscription[]): boolean {
  if (m.from === me.name && !(m.event && isEvent(m.event) && EVENTS[m.event].toAuthor)) return false;
  if (wakes(m, me, subs)) return false;
  const e = eventOf(m);
  if (!e) return false;
  return subs.some((s) => s.carry === true && s.event === e && (s.scope === "any" || m.run === me.run));
}
