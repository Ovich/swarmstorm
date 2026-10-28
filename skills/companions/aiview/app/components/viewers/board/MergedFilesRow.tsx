// A closed run's merged files, where the claims row sits for an open run: collapsed by default,
// its count; opened, one path per line with who merged it. Reuses the claims row's classes.
import { useState } from "react";
import type { MergedFileRow } from "../../../lib/board/view.ts";
import { MemberName } from "./chips.tsx";

export function MergedFilesRow({ rows }: { rows: MergedFileRow[] }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="claims-row" data-component="MergedFilesRow" data-expanded={expanded} aria-label="Files merged">
      <button className="claims-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        <span aria-hidden="true">{expanded ? "▾" : "▸"}</span> Files merged{" "}
        <span className="n">
          {rows.length} {rows.length === 1 ? "file" : "files"}
        </span>
      </button>
      {expanded && (
        <ul className="claims-list">
          {rows.map((r) => (
            <li key={r.path}>
              <span className="path">{r.path}</span>
              <span className="holders">
                {r.mergers.map((m) => (
                  <MemberName key={m} name={m} />
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
