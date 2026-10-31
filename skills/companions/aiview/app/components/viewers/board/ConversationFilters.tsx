// The conversation's filters (SL11, prototype #643): one quiet row of kind chips, one at a time,
// counted within what the pick shows, then File ▾, a searchable menu of every file the items are
// about. Escape, × or a click outside closes the menu.
import { useCallback, useEffect, useRef, useState } from "react";
import { basename, conversationFiles, filterCounts, type Item, type KindFilter, type Narrow } from "../../../lib/board/view.ts";

const KINDS: { kind: KindFilter; label: string }[] = [
  { kind: "all", label: "All" },
  { kind: "messages", label: "Messages" },
  { kind: "agreements", label: "Agreements" },
  { kind: "flags", label: "Flags" },
];

function FileMenu({ files, onPick, onClose }: { files: { path: string; count: number }[]; onPick: (path: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    search.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Element;
      // File ▾ toggles the menu itself; closing here would reopen it on the same click
      if (menu.current && !menu.current.contains(target) && !target.closest?.(".fchip.file")) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);
  const q = query.trim().toLowerCase();
  const matches = files.filter((f) => !q || f.path.toLowerCase().includes(q));
  return (
    <div className="fmenu" ref={menu} data-component="FileMenu" role="dialog" aria-label="Files">
      <div className="fhead">
        <input ref={search} type="search" placeholder="Find a file" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="fclose" aria-label="Close the files" onClick={onClose}>
          ×
        </button>
      </div>
      {matches.length === 0 ? (
        <p className="fempty">No file matches.</p>
      ) : (
        matches.map((f) => (
          <button key={f.path} className="frow" onClick={() => onPick(f.path)}>
            <code>{f.path}</code>
            <span className="n">{f.count}</span>
          </button>
        ))
      )}
    </div>
  );
}

export function ConversationFilters({ items, narrow, onNarrow }: { items: Item[]; narrow: Narrow; onNarrow: (n: Narrow) => void }) {
  const [open, setOpen] = useState(false);
  const counts = filterCounts(items);
  const files = conversationFiles(items);
  const close = useCallback(() => setOpen(false), []);
  return (
    <div className="filters" data-component="ConversationFilters" role="toolbar" aria-label="Filters">
      {KINDS.map(({ kind, label }) => (
        <button key={kind} className="fchip" aria-pressed={narrow.kind === kind} onClick={() => onNarrow({ ...narrow, kind })}>
          {label}
          {kind !== "all" && <span className="n">{counts[kind]}</span>}
        </button>
      ))}
      <span className="fwrap">
        {narrow.file ? (
          <span className="fchip file" aria-pressed="true">
            File: <code>{basename(narrow.file)}</code>
            <button className="fx" aria-label="Clear the file" onClick={() => onNarrow({ ...narrow, file: null })}>
              ×
            </button>
          </span>
        ) : (
          <button className="fchip file" aria-pressed="false" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            File ▾
          </button>
        )}
        {open && (
          <FileMenu
            files={files}
            onClose={close}
            onPick={(file) => {
              onNarrow({ ...narrow, file });
              setOpen(false);
            }}
          />
        )}
      </span>
    </div>
  );
}
