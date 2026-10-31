// A picked run's members, a closed run's as they ended, a column left of the conversation, the orchestrator first (D7, D20):
// each card its member (code, then nick), its state word, the seat, what it does. A card clicked
// follows the member and narrows the conversation; clicked again, released. Two layers (board-split#D35): the state
// word is the board's alone; what the agent runs now is the activity line (D32); trouble (lost, blocked) is a
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

const isEnded = (p: { state: string }): boolean => p.state === "ended";
/** Not running on the board now: away (finished, handed back or parked), lost, or ended. */
const isOff = (p: { state: string }): boolean => p.state === "away" || p.state === "lost" || p.state === "ended";

/** The state word, the board's alone: working, stopped, away (parked until a phase), lost, ended; a pack's
 *  fact (merging) replaces working or stopped. `className` is the word's state. */
export function stateWordOf(p: MemberOnBoard & { parked?: boolean; fact?: string }): { text: string; className: string } {
  const state = p.state;
  if (state === "ended") return { text: p.ended ? `ended ${hhmm(p.ended)}` : "ended", className: "ended" };
  if (state === "away") return { text: p.parkedUntil ? `away until ${p.parkedUntil}` : "away", className: "away" };
  if (p.fact) return { text: p.fact, className: p.fact };
  return { text: state, className: state };
}

/** Unread on a parked seat is kept for its return, never an alarm (D48, D49). */
const unreadKept = (p: { state: string }): boolean => p.state === "away";

/** The unread count beside the seat: `N unread`; on a parked seat drawn quiet, kept for its return ("held" is the files' word, rule 12). */
function UnreadCount({ p }: { p: SnapshotMember }) {
  if (!p.unread) return null;
  return unreadKept(p) ? (
    <span className="unread kept" data-component="UnreadCount" title="kept for its return">{p.unread} unread</span>
  ) : (
    <span className="unread" data-component="UnreadCount">{p.unread} unread</span>
  );
}

/** The member's badge, the board's alone (plan D55): its name, and on hover the board's reason (state word, the fact
 *  and its age, as the board's formatter writes it). Null when the snapshot carries none: aiview derives no badge. */
export function troubleOf(p: MemberOnBoard): { kind: BadgeName; reason: string } | null {
  if (isOff(p) && p.state !== "lost") return null;
  return p.badge ? { kind: p.badge.name, reason: p.badge.reason ? `${p.badge.name}: ${p.badge.reason}` : p.badge.name } : null;
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
  // U-F13 (D49): a parked or ended seat has no activity line, whatever an older snapshot still carries
  if (isOff(p)) return null;
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
  const trouble = troubleOf(p);
  const line = isEnded(p) ? null : activityLine(p, activity, now);
  // the face shows the ages and the activity line; the hover title repeats them, the trouble's reason with them
  const hoverTitle = [p.doing, trouble?.reason, activity && agesText(activity, now), line?.text].filter(Boolean).join("\n");
  return (
    <button
      title={hoverTitle || undefined}
      className={["card", orch && "orch", p.state, trouble?.kind === "lost" && "lost"].filter(Boolean).join(" ")}
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
      {p.state === "stopped" && !!p.doing && <span className="doing">{p.doing}</span>}
      {activity && <MemberAges activity={activity} now={now} />}
      <ActivityLine line={line} state={activity?.state ?? p.state} />
    </button>
  );
}

/** Up to this many members, every one a full card; past it, a row each, the followed one a card (a swarm of hundreds). */
export const CARDS_UP_TO = 12;

/** The roster's sections, in reading order: what needs the person first, the ended last and folded. */
const BUCKETS = [
  { id: "attention", label: "Needs attention" },
  { id: "active", label: "Working" },
  { id: "idle", label: "Stopped or away" },
  { id: "ended", label: "Ended" },
] as const;
type Bucket = (typeof BUCKETS)[number]["id"];

/** The member's section, by its state; lost or a badge needs attention. */
function bucketOf(p: SnapshotMember): Bucket {
  if (isEnded(p)) return "ended";
  if (p.state === "lost" || troubleOf(p)) return "attention";
  return p.state === "working" ? "active" : "idle";
}

/** One member on one line: its stripe, name, seat and state; clicked, followed and drawn as its card. */
function AgentRow({ p, hue, onFollow, now }: { p: SnapshotMember; hue: number; onFollow: () => void; now: number }) {
  const activity = isEnded(p) ? null : activityOf(p);
  const status = stateWordOf(p);
  const trouble = troubleOf(p);
  return (
    <button
      className={["row", p.state, trouble?.kind === "lost" && "lost"].filter(Boolean).join(" ")}
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
  // under Needs attention, the blocked before the lost: they can still be steered
  const lost = (p: SnapshotMember) => Number(troubleOf(p)?.kind === "lost");
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
        const trouble = troubleOf(p);
        return (
          <button
            key={p.member}
            className={["rail-agent", p.state, trouble?.kind === "lost" && "lost"].filter(Boolean).join(" ")}
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
            {!!p.unread && !unreadKept(p) && <span className="unread-dot" />}
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
  const trouble = troubleOf(p);
  const line = ended ? null : activityLine(p, activity, now);
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
      <UnreadCount p={p} />
      {p.state === "stopped" && p.doing && <span className="doing">{p.doing}</span>}
      {activity && <MemberAges activity={activity} now={now} />}
      <ActivityLine line={line} state={activity?.state ?? p.state} />
    </div>
  );
}
