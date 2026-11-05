// The files claimed this phase, one row at the bottom of the page (D7): collapsed by default, its count and
// how many are shared by two active members or more; opened, one file per line with its active holders, a shared
// one marked by a faint "shared", then each past holder marked "merged <sha7>" or "ended", greyed as already done;
// one that merged and changed the file again stands in both, its past one saying "active again". A viewer's opening
// it is remembered in their browser.
import { useState } from "react";
import type { ClaimRow, PastClaim } from "../../../lib/board/view.ts";
import { MemberName } from "./chips.tsx";

export const CLAIMS_EXPANDED_KEY = "swarm.filemap.expanded";

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

/** A past holder's mark: "merged <sha7>", or "ended". */
function pastStateLabel(p: PastClaim): string {
  if (p.state === "ended") return "ended";
  return p.sha ? `merged ${p.sha.slice(0, 7)}` : "merged";
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
                {r.past.map((p) => (
                  <span key={p.member} className="past" data-state={p.state} title={`${p.member}: ${pastStateLabel(p)}, already done this phase`}>
                    <span className="past-mark" aria-hidden="true">{p.state === "merged" ? "✓" : "■"}</span>
                    <MemberName name={p.member} /> <span className="past-state">{pastStateLabel(p)}</span>
                    {r.holders.includes(p.member) && <span className="past-again">· active again</span>}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
