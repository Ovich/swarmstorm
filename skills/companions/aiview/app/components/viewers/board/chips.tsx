import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { BOARD_AUTHOR, planCode } from "../../../../../swarm-board/src/client/reader.ts";
import { SEQ_REF } from "../../../lib/board/post.ts";
import { runHue, memberLabel } from "../../../lib/board/view.ts";

/** A member's chip, "RT·S3": the KindChip recipe at its light tone, in its run's hue (D19). */
export function MemberTag({ name, plan = true }: { name: string; plan?: boolean }) {
  if (name === BOARD_AUTHOR) return <span className="who board" data-component="MemberTag" title="the board">swarm</span>;
  const { code, seat } = memberLabel(name);
  const h = runHue(code);
  const s = 60;
  return (
    <span className="who" style={{ "--h": h, "--s": s } as CSSProperties} data-component="MemberTag">
      {plan && <span className="pc">{code}·</span>}
      {seat}
    </span>
  );
}

/** An agent's mark: a rounded square in its run's hue, its seat in two or three letters
 *  ("S9", "W13", "OR"); the orchestrator's outlined. */
export function AgentMark({ name }: { name: string }) {
  // D51: the board's own alarms are authored by the board, no member: its own mark
  if (name === BOARD_AUTHOR) return <span className="mark board" aria-hidden="true" data-component="AgentMark">SW</span>;
  const { code, seat } = memberLabel(name);
  const orch = seat === "orchestrator";
  const m = seat.match(/^([a-z])[a-z-]*?(\d+)$/i);
  const text = orch ? "OR" : m ? `${m[1]}${m[2]}`.toUpperCase() : seat.slice(0, 2).toUpperCase();
  return (
    <span className={orch ? "mark orch" : "mark"} style={{ "--h": runHue(code) } as CSSProperties} aria-hidden="true" data-component="AgentMark">
      {text}
    </span>
  );
}

/** Each member's funny name by `<plan>/<seat>` (D43), provided by App from the snapshot. */
export const NicksContext = createContext<ReadonlyMap<string, string>>(new Map());

/** A member wherever the page shows one: its tag, then its funny name, "RT·S3 Sleepy Otter" (D10).
 *  A member with no name is its tag alone. */
export function MemberName({ name, plan = true }: { name: string; plan?: boolean }) {
  const nick = useContext(NicksContext).get(name);
  if (!nick) return <MemberTag name={name} plan={plan} />;
  return (
    <span className="rname" data-component="MemberName">
      <MemberTag name={name} plan={plan} />
      <span className="nick">{nick}</span>
    </span>
  );
}

/** An agent beside its mark: its funny name, then its role in grey ("Dizzy Yak  orchestrator").
 *  The mark carries the run's colour and the short role, so no chip repeats them; the full
 *  "RT·S3" is the tooltip. With no name, the role alone. */
export function AgentLabel({ name, role = true }: { name: string; role?: boolean }) {
  if (name === BOARD_AUTHOR) return <span className="alabel" data-component="AgentLabel" title="the board"><span className="nick">swarm</span></span>;
  const nick = useContext(NicksContext).get(name);
  const { code, seat } = memberLabel(name);
  return (
    <span className="alabel" data-component="AgentLabel" title={`${code}·${seat}`}>
      {nick ? <span className="nick">{nick}</span> : <span className="nick">{seat}</span>}
      {nick && role && <span className="role">{seat}</span>}
    </span>
  );
}

/** A flag's chip: FLAG in the danger colour, glowing (static under reduced motion). */
export function FlagChip() {
  return (
    <span className="flag-chip" data-component="FlagChip" data-kind="flag">
      flag
    </span>
  );
}

/** A plan's two letters (D30). */
export function PlanCode({ plan }: { plan: string }) {
  return (
    <span className="code" data-component="PlanCode">
      {planCode(plan)}
    </span>
  );
}

const MENTION = /(?<![\w@])@[A-Za-z0-9][\w.\-]*(?:[\/·][A-Za-z0-9][\w.\-]*)?/g;

/** `#<n>` as a link to row n when that row is shown, else the text as written. */
function withSeqLinks(text: string, shown: ReadonlySet<number> | undefined, key: string): ReactNode[] {
  if (!shown?.size) return [text];
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(SEQ_REF)) {
    const seq = Number(m[1]);
    if (!shown.has(seq)) continue;
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push(
      <a
        key={`${key}-#${at}`}
        className="seq-ref"
        href={`#seq-${seq}`}
        onClick={(ev) => {
          const row = document.getElementById(`seq-${seq}`);
          if (!row) return;
          ev.preventDefault();
          row.scrollIntoView?.({ behavior: "smooth", block: "center" });
        }}
      >
        {m[0]}
      </a>,
    );
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** A body as written: `code` spans, @mentions in the accent, `#<n>` linking to a shown row;
 *  nothing else is interpreted. */
export function RichText({ text, mentions = true, shown }: { text: string; mentions?: boolean; shown?: ReadonlySet<number> }) {
  const out: ReactNode[] = [];
  text.split(/(`[^`\n]+`)/).forEach((part, i) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 1) {
      out.push(<code key={i}>{part.slice(1, -1)}</code>);
      return;
    }
    if (!mentions) {
      out.push(...withSeqLinks(part, shown, `${i}`));
      return;
    }
    let last = 0;
    for (const m of part.matchAll(MENTION)) {
      const at = m.index ?? 0;
      if (at > last) out.push(...withSeqLinks(part.slice(last, at), shown, `${i}-${last}`));
      out.push(
        <span key={`${i}-${at}`} className="mention">
          {m[0].replace(/[.\-]+$/, "")}
        </span>,
      );
      const trail = m[0].match(/[.\-]+$/)?.[0];
      if (trail) out.push(trail);
      last = at + m[0].length;
    }
    if (last < part.length) out.push(...withSeqLinks(part.slice(last), shown, `${i}-${last}`));
  });
  return <>{out}</>;
}
