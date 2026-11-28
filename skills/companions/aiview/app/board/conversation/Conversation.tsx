import { useLayoutEffect, useMemo, useRef } from "react";
import { hhmm } from "../names.ts";
import type { Item } from "./conversation.ts";
import { MemberLabel, MemberMark, RichText } from "../chips.tsx";
import { PostBody } from "./PostBody.tsx";

type Said = Exclude<Item, { kind: "event" | "phase" }>;
type BoardEventItem = Extract<Item, { kind: "event" }>;
type PhaseItem = Extract<Item, { kind: "phase" }>;

/** A word that explains itself (D9): dotted-underlined, focusable, its tip read by `TipLayer`. */
function TipWord({ word, tip, className }: { word: string; tip: string | null; className?: string }) {
  if (!tip) return <span className={className}>{word}</span>;
  return (
    <span className={["tip", className].filter(Boolean).join(" ")} tabIndex={0} data-tip={tip}>
      {word}
    </span>
  );
}

const TIER_CLASS: Record<Said["tier"], string> = { act: "act", wait: "wait", decided: "decided", talk: "" };

/** An item's classes: its tier (D8), its kind, an open flag, a joined message, a fresh one. */
function saidClass(item: Said, fresh: boolean): string {
  return ["item", TIER_CLASS[item.tier], item.kind, item.kind === "flag" && item.state === "open" && "open", item.joined && "cont", fresh && "new"]
    .filter(Boolean)
    .join(" ");
}

function SaidItem({ item, fresh, seqs }: { item: Said; fresh: boolean; seqs: ReadonlySet<number> }) {
  return (
    <li id={`seq-${item.seq}`} className={saidClass(item, fresh)} data-component="ConversationItem" data-kind={item.kind} data-tier={item.tier}>
      <span className="time" title={item.at}>
        {hhmm(item.at)}
      </span>
      {!item.joined && <MemberMark name={item.from} />}
      {!item.joined && (
        <div className="head">
          <MemberLabel name={item.from} />
          {item.word && <TipWord word={item.word} tip={item.tip} className="what" />}
        </div>
      )}
      <div className="text">
        <PostBody body={item.text} shown={seqs} />
      </div>
    </li>
  );
}

function BoardEventLine({ item, fresh }: { item: BoardEventItem; fresh: boolean }) {
  return (
    <li id={`seq-${item.seq}`} className={fresh ? "event new" : "event"} data-component="BoardEvent">
      <span className="time" title={item.at}>
        {hhmm(item.at)}
      </span>
      <div className="head">
        <MemberLabel name={item.from} />
        {item.word && (
          <span className={`eword ${item.tone}`} data-component="EventWord" {...(item.tip ? { tabIndex: 0, "data-tip": item.tip } : {})}>
            {item.word}
          </span>
        )}
      </div>
      {/* the text below its author, as a message's (D8); the word above says what happened */}
      {(item.word ? item.rest : item.text) && (
        <div className="text">
          {!item.word && item.tip ? (
            <span className="tip" tabIndex={0} data-tip={item.tip}>
              <RichText text={item.text} mentions={false} />
            </span>
          ) : (
            <RichText text={item.word ? item.rest : item.text} mentions={false} />
          )}
        </div>
      )}
    </li>
  );
}

/** A phase the orchestrator opened (`swarm phase`): a line cut in the middle by the phase's name, its text
 *  on hover; neither a post nor an event line. */
function PhaseSeparator({ item, fresh }: { item: PhaseItem; fresh: boolean }) {
  return (
    <li
      id={`seq-${item.seq}`}
      className={fresh ? "phase new" : "phase"}
      data-component="PhaseSeparator"
      data-phase={item.name}
      role="separator"
      aria-label={`Phase ${item.name}: ${item.text}`}
      title={item.text ? `${item.name}: ${item.text} (${item.at})` : item.at}
    >
      <span className="label">
        <span className="name">{item.name}</span>
        {item.text && <span className="said">{item.text}</span>}
      </span>
    </li>
  );
}

/** The one conversation (D8): every item on one grammar, the few kinds that ask something told
 *  apart by edge, weight and word; a closed run's archived line first. Reads from the bottom. */
export function Conversation({
  items,
  archived,
  fresh,
}: {
  items: Item[];
  archived: { closed: string; summary: string } | null;
  fresh: ReadonlySet<number>;
}) {
  const seqs = useMemo(() => new Set(items.map((i) => i.seq)), [items]);
  const streamRef = useRef<HTMLOListElement>(null);
  const atBottom = useRef(true);
  const onScroll = (): void => {
    const el = streamRef.current;
    if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };
  useLayoutEffect(() => {
    const el = streamRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [items]);
  return (
    <section className="convo" data-component="Conversation" aria-label="The conversation">
      <ol className="stream" aria-live="polite" ref={streamRef} onScroll={onScroll}>
        {archived && (
          <li className="archived-line" data-component="ArchivedLine">
            Archived {archived.closed} · read only · {archived.summary}
          </li>
        )}
        {items.length ? (
          items.map((i) =>
            i.kind === "phase" ? (
              <PhaseSeparator key={i.seq} item={i} fresh={fresh.has(i.seq)} />
            ) : i.kind === "event" ? (
              <BoardEventLine key={i.seq} item={i} fresh={fresh.has(i.seq)} />
            ) : (
              <SaidItem key={i.seq} item={i} fresh={fresh.has(i.seq)} seqs={seqs} />
            ),
          )
        ) : (
          <li className="none">No item yet.</li>
        )}
      </ol>
    </section>
  );
}
