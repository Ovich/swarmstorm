// A picked run's members, a closed run's as they ended, a column left of the conversation, the orchestrator first (D7, D20):
// each card its member (code, then nick), its state word, the seat, what it does. A card clicked
// follows the member and narrows the conversation; clicked again, released. Two layers (board-split#D35): the state
// word is the board's alone; what the agent runs now is the activity line (D32); trouble (stalled, gone, quiet) is a
// badge with its reason on hover, never the word.
import { useContext, useEffect, useState, type CSSProperties } from "react";
import type { Liveness, SnapshotMember } from "../../../../../swarm-board/src/client/reader.ts";
import { hhmm, ORCHESTRATOR } from "../../../lib/board/view.ts";
import { AgentLabel, AgentMark, NicksContext } from "./chips.tsx";

/** A member's activity as the server computes it (swarm-relay#D9, #D20), its two ages' instants included (swarm-relay#D38). */
type MemberActivity = Liveness;
const ACTIVITY_STATES: ReadonlySet<string> = new Set(["working", "busy", "waiting", "quiet", "gone"]);

/** Stalled is a member the board names a stall rule for (idea 1, rule 6), quiet or busy past its cap; the state stays
 *  one of D9's five. A board before the rules says it in the reason only: quiet with its link alive (swarm-relay#D36). */
const isStalled = (activity: MemberActivity): boolean =>
  !!activity.rule || (activity.state === "quiet" && /\blink alive\b/.test(activity.reason ?? ""));

/** The member's activity, or null when the reader sends none it knows (a server before swarm-relay#D20): the card draws as before. */
function activityOf(p: SnapshotMember): MemberActivity | null {
  const l = p.liveness;
  return l && ACTIVITY_STATES.has(l.state) ? l : null;
}

const minutesSince = (since: number, now: number): string => `${Math.max(1, Math.round((now - since) / 60000))} min`;

/** An age as a person reads it at a glance: seconds under a minute, minutes under an hour, then hours. */
function ageSince(at: number, now: number): string {
  const secs = Math.max(0, Math.round((now - at) / 1000));
  if (secs < 60) return `${secs} s`;
  if (secs < 3600) return `${Math.round(secs / 60)} min`;
  return `${Math.round(secs / 3600)} h`;
}

/** What the board may tell beyond today's reader type: a parked seat and the phase it is dormant until (D34), and the
 *  member's open calls (D31, D32). Absent from an older board: the card reads as without them. */
type MemberOnBoard = SnapshotMember & {
  parkedUntil?: string | null;
  activity?: {
    open: { name: string; target: string; since: number; boardWait: boolean } | null;
    background: { target: string; since: number; outputGrewAt: number | null } | null;
  };
};

/** The state word, the board's alone (D35): working on its task, merging, waiting on the board, parked or dormant until
 *  a phase, watching, ended. `className` is the board's state. */
export function stateWordOf(p: MemberOnBoard): { text: string; className: string } {
  const state = p.state as string;
  if (state === "ended" || state === "done") return { text: p.ended ? `ended ${hhmm(p.ended)}` : "ended", className: "ended" };
  if (state === "parked") return { text: p.parkedUntil ? `dormant until ${p.parkedUntil}` : "parked", className: "parked" };
  if (state === "waiting") return { text: "waiting on the board", className: "waiting" };
  if (state === "working") return { text: p.doing ? `working on ${p.doing}` : "working", className: "working" };
  return { text: state, className: state };
}

/** The trouble the board reads in the member's activity (D35): a badge, its reason on hover; null when none. */
export function troubleOf(p: MemberOnBoard, activity: MemberActivity | null, now: number): { kind: "stalled" | "gone" | "quiet"; reason: string } | null {
  if (activity) {
    const kind = isStalled(activity) ? "stalled" : activity.state === "gone" || activity.state === "quiet" ? activity.state : null;
    if (!kind) return null;
    const held = activity.since !== null ? ` for ${minutesSince(activity.since, now)}` : "";
    return { kind, reason: `${kind}${held}${activity.reason ? `: ${activity.reason}` : ""}` };
  }
  if (p.stale) return { kind: "quiet", reason: `quiet: no call for ${minutesSince(Date.parse(p.lastCall), now)}` };
  return null;
}

/** The trouble badge beside the state word (D35). */
function TroubleBadge({ trouble }: { trouble: { kind: string; reason: string } | null }) {
  if (!trouble) return null;
  return (
    <span className={`badge ${trouble.kind}`} title={trouble.reason} data-component="TroubleBadge">
      {trouble.kind}
    </span>
  );
}

/** A command as the card shows it (D32): no env prefix, the CLI's path dropped (a board call named by its verb), cut to the card. */
export function cleanCall(command: string): string {
  const words = command.trim().split(/\s+/);
  while (words.length > 1 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift();
  const board = words.findIndex((w) => /(^|[\\/])swarm(\.mjs)?$/.test(w));
  const shown = board >= 0 ? ["swarm", ...words.slice(board + 1)] : words;
  const line = shown.join(" ");
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
}

/** What the member runs now (D32), one line per open call, newest first: `running <command> · background|foreground ·
 *  <N> min`, `waiting on the board · <N> min`; nothing open, its last call. From the board's open calls when it sends
 *  them, else from its activity. */
export function activityLines(p: MemberOnBoard, activity: MemberActivity | null, now: number): string[] {
  const open = p.activity?.open ?? null;
  const background = p.activity?.background ?? null;
  if (p.activity) {
    const lines = [
      ...(open ? [{ since: open.since, text: open.boardWait ? `waiting on the board · ${minutesSince(open.since, now)}` : `running ${cleanCall(open.target)} · foreground · ${minutesSince(open.since, now)}` }] : []),
      ...(background ? [{ since: background.since, text: `running ${cleanCall(background.target)} · background · ${minutesSince(background.since, now)}` }] : []),
    ].sort((a, b) => b.since - a.since);
    if (lines.length) return lines.map((l) => l.text);
  }
  if (!activity?.doing) return [];
  if (activity.state === "busy") return [`running ${cleanCall(activity.doing)} · foreground${activity.since !== null ? ` · ${minutesSince(activity.since, now)}` : ""}`];
  return [`last: ${cleanCall(activity.doing)}`];
}

/** The activity line on the card face; its text also reads in the hover title. */
function ActivityLine({ lines, state }: { lines: string[]; state: string }) {
  if (!lines.length) return null;
  return (
    <span className="activity" data-component="MemberActivity" data-state={state}>
      {lines.join("\n")}
    </span>
  );
}

/** Since the member's last progress and since its last sign of life (swarm-relay#D38); nothing when the server sends neither. */
function agesText(activity: MemberActivity, now: number): string {
  return [
    typeof activity.progressAt === "number" ? `progress ${ageSince(activity.progressAt, now)}` : null,
    typeof activity.aliveAt === "number" ? `alive ${ageSince(activity.aliveAt, now)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The two ages on the card face; also in the hover title. */
function MemberAges({ activity, now }: { activity: MemberActivity; now: number }) {
  const ages = agesText(activity, now);
  if (!ages) return null;
  return (
    <span className="ages" data-component="MemberAges">
      {ages}
    </span>
  );
}

/** Now, every minute is enough: busy and quiet count in minutes between two snapshots. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function AgentCard({ p, hue, followed, onFollow, now }: { p: SnapshotMember; hue: number; followed: boolean; onFollow: () => void; now: number }) {
  const orch = p.seat === ORCHESTRATOR;
  const activity = p.state === "ended" || p.state === "done" ? null : activityOf(p);
  const status = stateWordOf(p);
  const trouble = troubleOf(p, activity, now);
  const lines = p.state === "ended" || p.state === "done" ? [] : activityLines(p, activity, now);
  // the face shows the ages and the activity line; the hover title repeats them, the trouble's reason with them
  const hoverTitle = [p.doing, trouble?.reason, activity && agesText(activity, now), ...lines].filter(Boolean).join("\n");
  return (
    <button
      title={hoverTitle || undefined}
      className={["card", orch && "orch", p.state, activity?.state === "gone" && "gone"].filter(Boolean).join(" ")}
      style={{ "--h": hue, "--s": 60 } as CSSProperties}
      aria-pressed={followed}
      onClick={onFollow}
      data-component="AgentCard"
    >
      <span className="top">
        <AgentMark name={p.member} />
        <AgentLabel name={p.member} role={false} />
        <span className={`state ${status.className}`}>
          <i />
          {status.text}
        </span>
        <TroubleBadge trouble={trouble} />
      </span>
      <span className="seat">{orch ? "orchestrator" : p.role ? `${p.seat} · ${p.role}` : p.seat}</span>
      {!!p.unread && <span className="unread" data-component="UnreadCount">{p.unread} unread</span>}
      {/* working carries its task in the word; any other live state keeps the doing line */}
      {p.state !== "working" && p.state !== "ended" && p.state !== "done" && !!p.doing && <span className="doing">{p.doing}</span>}
      {activity && <MemberAges activity={activity} now={now} />}
      <ActivityLine lines={lines} state={activity?.state ?? p.state} />
    </button>
  );
}

/** Up to this many members, every one a full card; past it, a row each, the followed one a card (a swarm of hundreds). */
export const CARDS_UP_TO = 12;

/** The roster's sections, in reading order: what needs the person first, the ended last and folded. */
const BUCKETS = [
  { id: "attention", label: "Needs attention" },
  { id: "active", label: "Working" },
  { id: "waiting", label: "Waiting" },
  { id: "ended", label: "Ended" },
] as const;
type Bucket = (typeof BUCKETS)[number]["id"];

/** The member's section: the ended by the board's word, the attention by its badge (D35), waiting by the board's word. */
function bucketOf(p: SnapshotMember): Bucket {
  if (p.state === "ended" || p.state === "done") return "ended";
  if (troubleOf(p, activityOf(p), Date.now())) return "attention";
  return p.state === "waiting" ? "waiting" : "active";
}

/** One member on one line: its stripe, name, seat and state; clicked, followed and drawn as its card. */
function AgentRow({ p, hue, onFollow, now }: { p: SnapshotMember; hue: number; onFollow: () => void; now: number }) {
  const activity = p.state === "ended" || p.state === "done" ? null : activityOf(p);
  const status = stateWordOf(p);
  const trouble = troubleOf(p, activity, now);
  return (
    <button
      className={["row", p.state, activity?.state === "gone" && "gone"].filter(Boolean).join(" ")}
      style={{ "--h": hue, "--s": 60 } as CSSProperties}
      aria-pressed={false}
      onClick={onFollow}
      title={p.doing}
      data-component="AgentRow"
    >
      <span className="rname">
        <AgentMark name={p.member} />
        <AgentLabel name={p.member} role={false} />
      </span>
      <span className="rseat">
        {!!p.unread && <span className="unread" data-component="UnreadCount">{p.unread} unread</span>}
        {p.role || p.seat}
      </span>
      <span className={`state ${status.className}`}>
        <i />
        {status.text}
      </span>
      <TroubleBadge trouble={trouble} />
    </button>
  );
}

const matches = (p: SnapshotMember, nick: string | undefined, q: string): boolean =>
  !q || [p.member, p.seat, p.role, p.doing, nick].some((t) => t?.toLowerCase().includes(q));

/** A picked run's members, a column left of the conversation, the orchestrator first. A card or row clicked follows its
 *  member and narrows the conversation; clicked again, released. Past CARDS_UP_TO members: a search, a chip per state,
 *  and a row each, by section. */
export function AgentStrip({
  agents,
  hue,
  follow,
  onFollow,
}: {
  agents: SnapshotMember[];
  /** The run's hue (D19): every member's stripe takes it. */
  hue: number;
  follow: string | null;
  onFollow: (member: string | null) => void;
}) {
  const now = useNow();
  const nicks = useContext(NicksContext);
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState<Bucket | null>(null);
  const [openEnded, setOpenEnded] = useState(false);
  if (agents.length === 0) return null;
  const toggle = (p: SnapshotMember) => () => onFollow(follow === p.member ? null : p.member);
  const card = (p: SnapshotMember) => <AgentCard key={p.member} p={p} hue={hue} followed={follow === p.member} onFollow={toggle(p)} now={now} />;
  const many = agents.length > CARDS_UP_TO;
  const cls = ["agent-strip", follow && "following", many && "many"].filter(Boolean).join(" ");
  const head = (
    <div className="label roster-head">
      Agents <span className="n">{agents.length}</span>
    </div>
  );
  if (!many) {
    return (
      <section className={cls} data-component="AgentStrip" aria-label="Agents">
        {head}
        <div className="cards">{agents.map(card)}</div>
      </section>
    );
  }
  const orch = agents.filter((p) => p.seat === ORCHESTRATOR);
  const rest = agents.filter((p) => p.seat !== ORCHESTRATOR);
  const q = query.trim().toLowerCase();
  const byBucket = new Map<Bucket, SnapshotMember[]>(BUCKETS.map((b) => [b.id, []]));
  for (const p of rest) byBucket.get(bucketOf(p))!.push(p);
  // under Needs attention, the stalled and quiet before the gone: they can still be steered
  byBucket.get("attention")!.sort((a, b) => Number(activityOf(a)?.state === "gone") - Number(activityOf(b)?.state === "gone"));
  const shown = (b: Bucket): SnapshotMember[] => (only && only !== b ? [] : byBucket.get(b)!.filter((p) => matches(p, nicks.get(p.member), q)));
  const groups = BUCKETS.map((b) => ({ ...b, list: shown(b.id) })).filter((g) => g.list.length > 0);
  return (
    <section className={cls} data-component="AgentStrip" aria-label="Agents">
      {head}
      <div className="cards">{orch.map(card)}</div>
      <input
        className="roster-search"
        type="search"
        placeholder={`Search ${rest.length} members`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search the members"
      />
      <div className="roster-chips" role="group" aria-label="By state">
        {BUCKETS.map((b) => {
          const n = byBucket.get(b.id)!.length;
          if (n === 0) return null;
          return (
            <button key={b.id} className={`chip ${b.id}`} aria-pressed={only === b.id} onClick={() => setOnly(only === b.id ? null : b.id)} data-component="StateChip">
              {b.label} <span className="n">{n}</span>
            </button>
          );
        })}
      </div>
      <div className="roster-list">
        {groups.map((g) => {
          const folded = g.id === "ended" && !openEnded && !q && only !== "ended";
          return (
            <div key={g.id} className={`roster-group ${g.id}`} data-component="RosterGroup">
              {g.id === "ended" ? (
                <button className="ghead" aria-expanded={!folded} onClick={() => setOpenEnded(!openEnded)}>
                  {folded ? "▸" : "▾"} {g.label} <span className="n">{g.list.length}</span>
                </button>
              ) : (
                <div className="ghead">
                  {g.label} <span className="n">{g.list.length}</span>
                </div>
              )}
              {!folded && g.list.map((p) => (follow === p.member ? card(p) : <AgentRow key={p.member} p={p} hue={hue} onFollow={toggle(p)} now={now} />))}
            </div>
          );
        })}
        {groups.length === 0 && <p className="none">No member matches.</p>}
      </div>
    </section>
  );
}

/** The folded strip (a thin rail): each member's mark and state dot; hovered or focused, a card with what the
 *  full strip shows of it, beside the rail; a click follows it. */
export function AgentRail({ agents, hue, follow, onFollow }: { agents: SnapshotMember[]; hue: number; follow: string | null; onFollow: (member: string | null) => void }) {
  const now = useNow();
  const [hover, setHover] = useState<{ member: string; top: number; left: number } | null>(null);
  const show = (member: string) => (e: { currentTarget: HTMLElement }) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover({ member, top: r.top, left: r.right + 8 });
  };
  const hovered = hover && agents.find((p) => p.member === hover.member);
  return (
    <div className="agent-rail" data-component="AgentRail" onMouseLeave={() => setHover(null)}>
      {agents.map((p) => {
        const activity = p.state === "ended" || p.state === "done" ? null : activityOf(p);
        const status = stateWordOf(p);
        const trouble = troubleOf(p, activity, now);
        return (
          <button
            key={p.member}
            className={["rail-agent", p.state, activity?.state === "gone" && "gone"].filter(Boolean).join(" ")}
            style={{ "--h": hue, "--s": 60 } as CSSProperties}
            aria-pressed={follow === p.member}
            aria-label={`${p.member}: ${status.text}${trouble ? ` · ${trouble.kind}` : ""}`}
            onMouseEnter={show(p.member)}
            onFocus={show(p.member)}
            onBlur={() => setHover(null)}
            onClick={() => onFollow(follow === p.member ? null : p.member)}
          >
            <AgentMark name={p.member} />
            <span className={`state ${status.className}`}><i /></span>
            {trouble && <span className={`badge-dot ${trouble.kind}`} title={trouble.reason} />}
            {!!p.unread && <span className="unread-dot" />}
          </button>
        );
      })}
      {hovered && hover && <AgentHoverCard p={hovered} hue={hue} now={now} top={hover.top} left={hover.left} />}
    </div>
  );
}

function AgentHoverCard({ p, hue, now, top, left }: { p: SnapshotMember; hue: number; now: number; top: number; left: number }) {
  const orch = p.seat === ORCHESTRATOR;
  const ended = p.state === "ended" || p.state === "done";
  const activity = ended ? null : activityOf(p);
  const status = stateWordOf(p);
  const trouble = troubleOf(p, activity, now);
  const lines = ended ? [] : activityLines(p, activity, now);
  return (
    <div
      className={["hovercard", "card", orch && "orch", p.state].filter(Boolean).join(" ")}
      role="tooltip"
      data-component="AgentHoverCard"
      style={{ "--h": hue, "--s": 60, top: Math.min(top, window.innerHeight - 220), left } as CSSProperties}
    >
      <span className="top">
        <AgentMark name={p.member} />
        <AgentLabel name={p.member} role={false} />
        <span className={`state ${status.className}`}>
          <i />
          {status.text}
        </span>
        <TroubleBadge trouble={trouble} />
      </span>
      <span className="seat">{orch ? "orchestrator" : p.role ? `${p.seat} · ${p.role}` : p.seat}</span>
      {!!p.unread && <span className="unread">{p.unread} unread</span>}
      {!ended && p.state !== "working" && p.doing && <span className="doing">{p.doing}</span>}
      {activity && <MemberAges activity={activity} now={now} />}
      <ActivityLine lines={lines} state={activity?.state ?? p.state} />
    </div>
  );
}
