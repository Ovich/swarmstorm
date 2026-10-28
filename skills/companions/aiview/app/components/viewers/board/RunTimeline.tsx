import { useState, type CSSProperties, type ReactNode } from "react";
import type { Interval, Mark } from "../../../../../swarm-board/src/client/reader.ts";
import { ESTIMATED_EVENTS_TIP, formatDuration } from "../../../lib/board/analytics.ts";
import { hhmm, splitMember } from "../../../lib/board/view.ts";
import { MemberTag } from "./chips.tsx";

/** One member's row: its spans (none for a seat), its post times and its marks. */
export type Lane = { member: string; nick: string; spans: Interval[]; posts: string[]; marks: Mark[] };
/** A turn at the merge lock: a member's merging span. */
export type LockTurn = { member: string; from: string; to: string };
export type LegendKey = Interval["what"] | Mark["what"] | "post";

const SPAN_WORD: Record<Interval["what"], string> = { working: "working", waiting: "waiting for the lock", merging: "merging", silent: "silent" };
const MARK_WORD: Record<Mark["what"], string> = { agreement: "agreement", race: "lost the lock", flag: "flag", conflict: "conflict", endorsed: "endorsed", objected: "objected" };
const GLYPH: Record<Mark["what"], string> = { agreement: "", race: "↺", flag: "!", conflict: "✕", endorsed: "✓", objected: "✕" };
/** The inferred rule an objection is drawn by (plan D23). */
const OBJECTED_RULE = "Inferred: the skeptic posted about this question after an agreement it did not endorse.";
const NOT_RECORDED_LINE = "Not recorded: this run closed before analytics recorded member activity.";

const isSpan = (k: LegendKey): k is Interval["what"] => k in SPAN_WORD;
const isMark = (k: LegendKey): k is Mark["what"] => k in MARK_WORD;

function legendWord(key: LegendKey, silentAfterMs: number): string {
  // the rule's own words, as the prototype gives them: whole minutes read "N min"
  if (key === "silent") return `silent: no command for ${silentAfterMs % 60_000 === 0 ? `${silentAfterMs / 60_000} min` : formatDuration(silentAfterMs)}`;
  if (key === "post") return "post";
  return isSpan(key) ? SPAN_WORD[key] : MARK_WORD[key];
}

function Swatch({ of }: { of: LegendKey }) {
  if (of === "post") return <span className="sw-post">|</span>;
  if (isSpan(of)) return <span className={`sw s-${of}`} />;
  return of === "agreement" ? <span className="sw-mark m-agreement">◆</span> : <span className={`sw-mark m-${of}`}>{GLYPH[of]}</span>;
}

const MINUTE_MS = 60_000;
const STEPS_MIN = [1, 2, 5, 10, 15, 30, 60, 120, 240, 480];
/** At most this many ticks on the axis. */
const MAX_TICKS = 7;

/** The axis's ticks: local clock times on round minutes, or minutes from the run's open. */
function ticksOf(from: number, to: number, clock: boolean): { at: number; label: string }[] {
  const stepMin = STEPS_MIN.find((s) => (to - from) / (s * MINUTE_MS) < MAX_TICKS) ?? STEPS_MIN[STEPS_MIN.length - 1];
  const step = stepMin * MINUTE_MS;
  const out: { at: number; label: string }[] = [];
  if (clock) {
    const offset = new Date(from).getTimezoneOffset() * MINUTE_MS;
    for (let at = Math.ceil((from - offset) / step) * step + offset; at <= to; at += step) out.push({ at, label: hhmm(new Date(at).toISOString()) });
  } else {
    for (let k = 0; from + k * step <= to; k++) out.push({ at: from + k * step, label: `${k * stepMin}m` });
  }
  return out;
}

/** A run's members over time (board D9, D33; prototype #677 RunTimeline): for a plan run a lane per member,
 *  the orchestrator first like any member, under the merge lock band, the axis in clock time; for a
 *  brainstorm run a lane per seat, its posts and marks, the axis in minutes from the run's open. Exact
 *  spans solid, inferred ones (`Interval.inferred`) at reduced opacity with a dashed edge. Both legends
 *  toggle. `to` is now while the run is open (D32). `estimated`: a run before the records whose spans were read from
 *  its board events (D45), its lanes drawn with the panel dashed and the estimate's tip; else such a run reads the
 *  Not recorded line. */
export function RunTimeline({
  title,
  clock,
  lanes,
  band,
  legend,
  from,
  to,
  recorded,
  estimated = false,
  silentAfterMs,
  focus,
  onFocus,
  onOpenPost,
}: {
  title: string;
  /** The axis in clock time; else minutes from `from`. */
  clock: boolean;
  lanes: Lane[];
  band: LockTurn[] | null;
  legend: LegendKey[];
  from: string;
  to: string;
  recorded: boolean;
  estimated?: boolean;
  silentAfterMs: number;
  focus: string | null;
  onFocus?: (member: string | null) => void;
  onOpenPost: (seq: number) => void;
}) {
  const [hidden, setHidden] = useState<ReadonlySet<LegendKey>>(new Set());
  const start = Date.parse(from);
  const end = Math.max(Date.parse(to), start + 1);
  const pct = (iso: string | number): number => {
    const t = typeof iso === "number" ? iso : Date.parse(iso);
    return Math.min(100, Math.max(0, ((t - start) / (end - start)) * 100));
  };
  const place = (a: string, b: string): CSSProperties => ({ left: `${pct(a)}%`, width: `${Math.max(0.3, pct(b) - pct(a))}%` });
  const when = (iso: string): string => (clock ? hhmm(iso) : `${Math.round((Date.parse(iso) - start) / MINUTE_MS)}m`);
  const span = (a: string, b: string): string => `${hhmm(a)}–${hhmm(b)} · ${formatDuration(Date.parse(b) - Date.parse(a))}`;
  const shown = (k: LegendKey): boolean => !hidden.has(k);
  const toggle = (k: LegendKey): void =>
    setHidden((h) => {
      const next = new Set(h);
      if (!next.delete(k)) next.add(k);
      return next;
    });
  const ticks = ticksOf(start, end, clock);

  const markOf = (lane: Lane, m: Mark, i: number): ReactNode => {
    const id = splitMember(lane.member).seat;
    const tip = [`${when(m.at)} · ${id}`, m.note, ...(m.what === "objected" ? [OBJECTED_RULE] : []), ...(clock && m.seq !== undefined ? ["click: open the post"] : [])].join(" · ");
    return (
      <span
        key={`m${i}`}
        className={m.what === "objected" ? `mk m-${m.what} inferred` : `mk m-${m.what}`}
        style={{ left: `${pct(m.at)}%` }}
        data-tip={tip}
        role={m.seq !== undefined ? "button" : undefined}
        tabIndex={m.seq !== undefined ? 0 : undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (m.seq !== undefined) onOpenPost(m.seq);
        }}
      >
        {GLYPH[m.what]}
      </span>
    );
  };

  return (
    <div
      className={estimated ? "apanel chart inferred" : "apanel chart"}
      data-component="RunTimeline"
      data-state={recorded || estimated ? (focus ? "focused" : estimated ? "estimated" : "lanes") : "not recorded"}
      data-tip={estimated ? ESTIMATED_EVENTS_TIP : undefined}
    >
      <div className="head">
        <div className="label">
          {title}
          {estimated ? (
            <span className="hint" title={ESTIMATED_EVENTS_TIP}>
              estimated
            </span>
          ) : null}
        </div>
        <div className="legend">
          {legend.map((k) => (
            <button key={k} aria-pressed={shown(k)} onClick={() => toggle(k)}>
              <Swatch of={k} />
              {legendWord(k, silentAfterMs)}
            </button>
          ))}
        </div>
      </div>
      {!recorded && !estimated ? (
        <p className="nr">{NOT_RECORDED_LINE}</p>
      ) : (
        <div className="scroll">
          <div className="tl">
            {band && (
              <div className="row lockband">
                <div className="name">
                  <span className="t">merge lock</span>
                </div>
                <div className="lane">
                  {shown("merging") &&
                    band.map((b, i) => (
                      <span key={i} className="seg s-merging" style={place(b.from, b.to)} data-tip={`${splitMember(b.member).seat} held the lock · ${span(b.from, b.to)}`} />
                    ))}
                </div>
              </div>
            )}
            {lanes.map((lane) => {
              const id = splitMember(lane.member).seat;
              const cls = ["row", focus === lane.member ? "hl" : focus ? "dim" : ""].join(" ").trim();
              return (
                <div key={lane.member} className={cls} data-lane={lane.member} onClick={onFocus ? () => onFocus(focus === lane.member ? null : lane.member) : undefined}>
                  <div className="name">
                    <MemberTag name={lane.member} />
                    <span className="nick">{lane.nick}</span>
                  </div>
                  <div className="lane">
                    {lane.spans.length === 0 && lane.posts.length > 0 && <span className="rule" />}
                    {lane.spans
                      .filter((s) => shown(s.what))
                      .map((s, i) => (
                        <span key={`s${i}`} className={s.inferred ? `seg s-${s.what} inferred` : `seg s-${s.what}`} style={place(s.from, s.to)} data-tip={`${id} · ${lane.nick} · ${SPAN_WORD[s.what]} · ${span(s.from, s.to)}`} />
                      ))}
                    {shown("post") &&
                      lane.posts.map((p, i) => <span key={`p${i}`} className="post" style={{ left: `${pct(p)}%` }} data-tip={`${id} posted at ${when(p)}`} />)}
                    {lane.marks.filter((m) => isMark(m.what) && shown(m.what)).map((m, i) => markOf(lane, m, i))}
                  </div>
                </div>
              );
            })}
            {ticks.map((t) => (
              <span key={t.at} className="grid-line" style={{ left: `calc(190px + (100% - 190px) * ${pct(t.at) / 100})` }} />
            ))}
            <div className="axis">
              <span />
              <div className="ticks">
                {ticks.map((t) => (
                  <span key={t.at} style={{ left: `${pct(t.at)}%` }}>
                    {t.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
