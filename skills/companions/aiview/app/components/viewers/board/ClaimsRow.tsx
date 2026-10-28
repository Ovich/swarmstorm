// The files held, one row at the bottom of the page (D7): collapsed by default, its count and
// how many are shared by two members or more; opened, one file per line with its holders, a shared one
// ending on a faint "shared". A viewer's opening it is remembered in their browser.
import { useState } from "react";
import { MemberName } from "./chips.tsx";

export const CLAIMS_EXPANDED_KEY = "swarm.filemap.expanded";

export type ClaimRow = { path: string; holders: string[]; shared: boolean };

function readExpanded(): boolean {
  try {
    return window.localStorage.getItem(CLAIMS_EXPANDED_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberExpanded(expanded: boolean): void {
  try {
    window.localStorage.setItem(CLAIMS_EXPANDED_KEY, expanded ? "1" : "0");
  } catch {
    // storage unavailable: the choice lasts this page only
  }
}

export function ClaimsRow({ rows }: { rows: ClaimRow[] }) {
  const [expanded, setExpanded] = useState(readExpanded);
  const shared = rows.filter((r) => r.shared).length;
  const toggle = (): void => {
    rememberExpanded(!expanded);
    setExpanded(!expanded);
  };
  return (
    <section className="claims-row" data-component="ClaimsRow" data-expanded={expanded} aria-label="Claims">
      <button className="claims-toggle" aria-expanded={expanded} onClick={toggle}>
        <span aria-hidden="true">{expanded ? "▾" : "▸"}</span> Claims{" "}
        <span className="n">
          {rows.length} {rows.length === 1 ? "file" : "files"}
          {shared > 0 && <> · {shared} shared</>}
        </span>
      </button>
      {expanded && (
        <ul className="claims-list">
          {rows.map((r) => (
            <li key={r.path}>
              <span className="path">{r.path}</span>
              <span className="holders">
                {r.holders.map((h) => (
                  <MemberName key={h} name={h} />
                ))}
                {r.shared && <span className="shared">shared</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
