// The archive (D7, D18, prototype #643): every closed run, newest first, searchable on title, code,
// orchestrator and kind; a drawer from the left. A row picks the run; ×, Escape or a click outside closes.
import { useEffect, useRef, useState } from "react";
import { seatCount, type ArchivedRun, type RunId } from "../../../lib/board/view.ts";

/** "Oct 14, 22:28", local time. */
function closedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${day}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** A row's meta: a plan counts its slices, a brainstorm its seats (its slice rows are seats). */
function runMeta(r: ArchivedRun): string {
  const count = r.kind === "brainstorm" || r.kind === "task" ? seatCount(r.of) : `${r.done}/${r.of} slices`;
  return `${count} · ${r.orchestrator}`;
}

export function ArchivePanel({
  runs,
  total,
  onPick,
  onClose,
}: {
  runs: (query: string) => ArchivedRun[];
  total: number;
  onPick: (run: RunId) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const drawer = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    search.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Element;
      // ☰ toggles the panel itself; closing here would reopen it on the same click
      if (drawer.current && !drawer.current.contains(target) && !target.closest?.(".menu")) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);
  const matches = runs(query);
  return (
    <div className="drawer" ref={drawer} data-component="ArchivePanel" role="dialog" aria-label="Archive">
      <div className="archive">
        <div className="ahead">
          Archive
          <span>· {total} closed runs</span>
          <button className="aclose" aria-label="Close the archive" onClick={onClose}>
            ×
          </button>
        </div>
        <input ref={search} type="search" placeholder="Find a run by title, code, orchestrator or kind" value={query} onChange={(e) => setQuery(e.target.value)} />
        {matches.length === 0 ? (
          <p className="aempty">No archived run matches.</p>
        ) : (
          matches.map((r) => (
            <button key={r.run} className="arow" onClick={() => onPick(r.run)}>
              <span className="code">{r.code}</span>
              <span className="at">
                {r.title}
                <span className={`kchip ${r.kind}`} data-component="KindChip">
                  {r.protocol ?? r.kind}
                </span>
              </span>
              <span className="ad">{closedAt(r.closed)}</span>
              <span className="am">{runMeta(r)}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
