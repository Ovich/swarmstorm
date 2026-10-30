// A picked run's members, a closed run's as they ended, a column left of the conversation, the orchestrator first (D7, D20):
// each card its member (code, then nick), its state word, the seat, what it does. A card clicked
// follows the member and narrows the conversation; clicked again, released. Two layers (board-split#D35): the state
// word is the board's alone; what the agent runs now is the activity line (D32); trouble (stalled, lost, blocked) is a
// badge with its reason on hover, never the word.
import { useContext, useEffect, useState, type CSSProperties } from "react";
import type { Liveness, SnapshotMember } from "../../../../../swarm-board/src/client/reader.ts";
import { hhmm, ORCHESTRATOR } from "../../../lib/board/view.ts";
import { AgentLabel, AgentMark, NicksContext } from "./chips.tsx";

/** A member's activity as the server computes it (swarm-relay#D9, #D20), its two ages' instants included (swarm-relay#D38);
 *  an older board's also says quiet or gone, with its reason. */
type MemberActivity = Omit<Liveness, "state"> & { state: string; reason?: string };
/** The activity words, today's (board-split#D36: working, busy, waiting) and an older board's (quiet, gone). */
const ACTIVITY_STATES: ReadonlySet<string> = new Set(["working", "busy", "waiting", "quiet", "gone"]);

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

/** board-split#D36: trouble beside the state, never a state, as the board sends it. */
type BoardBadge = NonNullable<SnapshotMember["badge"]>;
export type BadgeName = BoardBadge["name"];

/** The member as any board sends it: an older one's state words (watching, done) and no badge (D36), a parked seat's
 *  phase (D34), the open calls (D31, D32). The card reads an older board's words as the new ones. */
type MemberOnBoard = Omit<SnapshotMember, "state" | "badge"> & {
  state: string;
  badge?: BoardBadge | null;
  parkedUntil?: string | null;
  activity?: {
    open: { name: string; target: string; since: number; boardWait: boolean; label?: string | null; command?: string | null } | null;
    background: { target: string; since: number; outputGrewAt: number | null; label?: string | null; command?: string | null } | null;
  };
};

/** The board's state, an older board's words read as D36's: done is ended, the orchestrator's watching is waiting. */
export function boardStateOf(p: { state: string }): "working" | "waiting" | "parked" | "ended" | "merging" | string {
  if (p.state === "done") return "ended";
  if (p.state === "watching") return "waiting";
  return p.state;
}
const isEnded = (p: { state: string }): boolean => boardStateOf(p) === "ended";

/** The state word, the board's alone (D35, D36, D49): working (on the task posted to it), merging, waiting on the board,
 *  parked (until a phase), ended; the member's `doing` never in it. `className` is the board's state. */
export function stateWordOf(p: MemberOnBoard): { text: string; className: string } {
  const state = boardStateOf(p);
  if (state === "ended") return { text: p.ended ? `ended ${hhmm(p.ended)}` : "ended", className: "ended" };
  if (state === "parked") return { text: p.parkedUntil ? `parked until ${p.parkedUntil}` : "parked", className: "parked" };
  if (state === "waiting") return { text: "waiting on the board", className: "waiting" };
  if (state === "working") return { text: p.owes?.task != null ? `working on #${p.owes.task}` : "working", className: "working" };
  return { text: state, className: state };
}

/** Unread on a parked seat is held for it, never an alarm (D48, D49). */
const unreadHeld = (p: { state: string }): boolean => boardStateOf(p) === "parked";

/** The unread count beside the seat: `N unread`, or `N held` on a parked seat, drawn quiet. */
function UnreadCount({ p }: { p: SnapshotMember }) {
  if (!p.unread) return null;
  return unreadHeld(p) ? (
    <span className="unread held" data-component="UnreadCount">{p.unread} held</span>
  ) : (
    <span className="unread" data-component="UnreadCount">{p.unread} unread</span>
  );
}

/** The member's badge (D35, D36): the board's, its reason on hover; from an older board, read off its activity
 *  (a stall rule or quiet: stalled; gone: lost). Null when none, and always for a parked or ended member (D30). */
export function troubleOf(p: MemberOnBoard, activity: MemberActivity | null, now: number): { kind: BadgeName; reason: string } | null {
  const state = boardStateOf(p);
  if (state === "ended" || state === "parked") return null;
  const held = (since: number | null) => (since !== null ? ` for ${minutesSince(since, now)}` : "");
  if (p.badge !== undefined) return p.badge ? { kind: p.badge.name, reason: `${p.badge.name}${held(p.badge.since)}${p.badge.reason ? `: ${p.badge.reason}` : ""}` } : null;
  if (activity) {
    const kind: BadgeName | null = activity.rule || activity.state === "quiet" ? "stalled" : activity.state === "gone" ? "lost" : null;
    if (!kind) return null;
    return { kind, reason: `${kind}${held(activity.since)}${activity.reason ? `: ${activity.reason}` : ""}` };
  }
  if (p.stale) return { kind: "stalled", reason: `stalled: no call for ${minutesSince(Date.parse(p.lastCall), now)}` };
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

/** The card's line, ~32 characters (board-split#D45). */
const LINE_CHARS = 32;
const cut = (text: string, n = LINE_CHARS): string => (text.length > n ? `${text.slice(0, n - 1)}…` : text);
const fileName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/** A command's short form (D45), when the call gave no description: no `VAR=…` prefix and no `cd … &&`, a board
 *  call `board <verb>`, a script its file name, else the program and its first two arguments. */
export function shortCommand(command: string): string {
  let line = command.trim().replace(/^cd\s+\S+\s*(&&|;)\s*/, "");
  const words = line.split(/\s+/).filter(Boolean);
  while (words.length > 1 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift();
  const board = words.findIndex((w) => /(^|[\\/])swarm(\.mjs)?$/.test(w));
  if (board >= 0) return `board ${words[board + 1] ?? ""}`.trim();
  const script = words.findIndex((w, i) => i > 0 && /\.(m?[jt]s|py|sh|ps1|cjs)$/.test(w));
  if (script >= 0 && /^(node|python3?|bash|sh|pwsh|powershell|tsx|deno|bun)(\.exe)?$/i.test(fileName(words[0]))) return fileName(words[script]);
  line = [fileName(words[0] ?? ""), ...words.slice(1, 3)].join(" ");
  return line;
}

/** A call as the card names it (D45): its own description, else a shell command's short form, else `<Tool> · <file>`. */
export function callLabel(call: { name?: string; target: string; label?: string | null; command?: string | null }): string {
  if (call.label) return call.label;
  const command = call.command ?? call.target;
  if (!call.name || call.name === "Bash" || call.name === "PowerShell" || /\s/.test(command.trim())) return shortCommand(command);
  return `${call.name} · ${fileName(command)}`;
}

/** Whole minutes since `since`, as the card's line counts them. */
const minutesShort = (since: number, now: number): string => `${Math.max(0, Math.floor((now - since) / 60000))}m`;

/** What the member runs now (D45), one line: `▸ <label>  <N>m` for a call in the foreground, `◌` for a background one;
 *  the board's own wait is no line (the state word says waiting); nothing open, no line. `hover`: the whole command,
 *  foreground or background, since when, and the last call. */
export function activityLine(p: MemberOnBoard, activity: MemberActivity | null, now: number): { text: string; hover: string } | null {
  const open = p.activity?.open && !p.activity.open.boardWait ? p.activity.open : null;
  const background = p.activity?.background ?? null;
  const last = activity?.doing ? `last call: ${activity.doing}` : null;
  const shown = (mark: string, how: string, call: { name?: string; target: string; since: number; label?: string | null; command?: string | null }) => {
    const minutes = minutesShort(call.since, now);
    return {
      text: `${mark} ${cut(callLabel(call), LINE_CHARS - minutes.length - 4)}  ${minutes}`,
      hover: [call.command ?? call.target, `${how} since ${hhmm(new Date(call.since).toISOString())}`, last].filter(Boolean).join("\n"),
    };
  };
  if (open) return shown("▸", "foreground", open);
  if (background) return shown("◌", "background", background);
  // an older board with no open calls: its busy activity is the call it runs
  if (!p.activity && activity?.state === "busy" && activity.doing && activity.since !== null) return shown("▸", "foreground", { target: activity.doing, since: activity.since });
  return null;
}

/** The activity line on the card face; the whole command on its own hover. */
function ActivityLine({ line, state }: { line: { text: string; hover: string } | null; state: string }) {
  if (!line) return null;
  return (
    <span className="activity" data-component="MemberActivity" data-state={state} title={line.hover}>
      {line.text}
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
  const activity = isEnded(p) ? null : activityOf(p);
  const status = stateWordOf(p);
  const trouble = troubleOf(p, activity, now);
  const line = isEnded(p) ? null : activityLine(p, activity, now);
  // the face shows the ages and the activity line; the hover title repeats them, the trouble's reason with them
  const hoverTitle = [p.doing, trouble?.reason, activity && agesText(activity, now), line?.text].filter(Boolean).join("\n");
  return (
    <button
      title={hoverTitle || undefined}
      className={["card", orch && "orch", boardStateOf(p), trouble?.kind === "lost" && "lost"].filter(Boolean).join(" ")}
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
      <UnreadCount p={p} />
      {/* the doing line, never the word (D49); a parked seat's is the park itself */}
      {boardStateOf(p) !== "working" && boardStateOf(p) !== "parked" && !isEnded(p) && !!p.doing && <span className="doing">{p.doing}</span>}
      {activity && <MemberAges activity={activity} now={now} />}
      <ActivityLine line={line} state={activity?.state ?? boardStateOf(p)} />
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
  if (isEnded(p)) return "ended";
  if (troubleOf(p, activityOf(p), Date.now())) return "attention";
  return boardStateOf(p) === "waiting" ? "waiting" : "active";
}

/** One member on one line: its stripe, name, seat and state; clicked, followed and drawn as its card. */
function AgentRow({ p, hue, onFollow, now }: { p: SnapshotMember; hue: number; onFollow: () => void; now: number }) {
  const activity = isEnded(p) ? null : activityOf(p);
  const status = stateWordOf(p);
  const trouble = troubleOf(p, activity, now);
  return (
    <button
      className={["row", boardStateOf(p), trouble?.kind === "lost" && "lost"].filter(Boolean).join(" ")}
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
        <UnreadCount p={p} />
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
  // under Needs attention, the stalled and blocked before the lost: they can still be steered
  const lost = (p: SnapshotMember) => Number(troubleOf(p, activityOf(p), now)?.kind === "lost");
  byBucket.get("attention")!.sort((a, b) => lost(a) - lost(b));
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
        const activity = isEnded(p) ? null : activityOf(p);
        const status = stateWordOf(p);
        const trouble = troubleOf(p, activity, now);
        return (
          <button
            key={p.member}
            className={["rail-agent", boardStateOf(p), trouble?.kind === "lost" && "lost"].filter(Boolean).join(" ")}
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
            {!!p.unread && !unreadHeld(p) && <span className="unread-dot" />}
          </button>
        );
      })}
      {hovered && hover && <AgentHoverCard p={hovered} hue={hue} now={now} top={hover.top} left={hover.left} />}
    </div>
  );
}

function AgentHoverCard({ p, hue, now, top, left }: { p: SnapshotMember; hue: number; now: number; top: number; left: number }) {
  const orch = p.seat === ORCHESTRATOR;
  const ended = isEnded(p);
  const activity = ended ? null : activityOf(p);
  const status = stateWordOf(p);
  const trouble = troubleOf(p, activity, now);
  const line = ended ? null : activityLine(p, activity, now);
  return (
    <div
      className={["hovercard", "card", orch && "orch", boardStateOf(p)].filter(Boolean).join(" ")}
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
      <UnreadCount p={p} />
      {!ended && boardStateOf(p) !== "working" && boardStateOf(p) !== "parked" && p.doing && <span className="doing">{p.doing}</span>}
      {activity && <MemberAges activity={activity} now={now} />}
      <ActivityLine line={line} state={activity?.state ?? boardStateOf(p)} />
    </div>
  );
}
