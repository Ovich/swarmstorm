import { useEffect, useState } from "react";
import type { Pending } from "../lib/api.ts";

/** "4m", "1h 20m" — coarse on purpose: this is a reassurance, not a stopwatch. */
function elapsed(since: string, now: number): string {
  const ms = now - new Date(since).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

/** Past this, "still running" stops being a claim we can honestly make: nothing tells
 *  the index that the process behind a card died, so we soften the wording instead of
 *  pretending. `aiview pending clear <doc>` removes them. */
const STALE_MINUTES = 30;
const isStale = (since: string, now: number): boolean => now - new Date(since).getTime() > STALE_MINUTES * 60000;

/** Work still running behind a document the reader can already open.
 *
 *  The point is that a long document does not have to be finished to be useful: the
 *  reader gets the parts that are ready, and these cards say — precisely, not vaguely —
 *  what is still coming and who is fetching it.
 *
 *  They sit at the HEAD, above the content: "this is incomplete, and here is what is
 *  missing" is something the reader has to know before they start, not after they have
 *  read to the end and drawn conclusions from a document with holes in it. */
export function PendingCards({ items }: { items: Pending[] }) {
  const [now, setNow] = useState(() => Date.now());

  // One timer for the whole list; a minute is finer than the labels ever render.
  useEffect(() => {
    if (!items.length) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [items.length]);

  if (!items.length) return null;

  return (
    <section className="mb-9 rounded-[10px] border border-border bg-surface-2 px-4 py-3.5" aria-live="polite">
      <h2 className="mb-2.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        <span className="relative flex h-2 w-2" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
        </span>
        Still working — {items.length} {items.length === 1 ? "task" : "tasks"}
      </h2>

      <ul className="grid list-none gap-2 p-0 sm:grid-cols-2">
        {items.map((p) => {
          const stale = isStale(p.started_at, now);
          return (
            <li
              key={p.id}
              className="rounded-[8px] border border-border bg-background px-3.5 py-2.5"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] font-semibold text-foreground">{p.label}</span>
                <span
                  className={`shrink-0 font-mono text-[10.5px] ${stale ? "text-faint-foreground" : "text-muted-foreground"}`}
                  title={p.started_at}
                >
                  {stale ? `no news for ${elapsed(p.started_at, now)}` : elapsed(p.started_at, now)}
                </span>
              </div>
              {p.note && <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">{p.note}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
