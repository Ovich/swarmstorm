import type { Interval, MemberStats } from "../../../../../swarm-board/src/client/reader.ts";
import { ESTIMATED_EVENTS_TIP, figure, formatDuration } from "../../../lib/board/analytics.ts";
import { MemberTag } from "./chips.tsx";

/** The Time bar's order: working, silent, waiting, merging (prototype #677). */
const ORDER: Interval["what"][] = ["working", "silent", "waiting", "merging"];
/** Past this much waiting for the lock, the member's waiting is written beside its time, in warn. */
const LONG_WAIT_MS = 8 * 60_000;
/** The bar's width for the run's whole length. */
const BAR_PX = 140;

const lengthOf = (i: { from: string; to: string }): number => Date.parse(i.to) - Date.parse(i.from);

/** Where each member's time went (prototype #677 MembersTable): its spans drawn as a bar in the run's
 *  scale, its time from joining to its end and its waiting as swarm counts it (plan D40), its posts, claims and flags. A member
 *  `estimated` (D45), its spans read from the board's events, has its Time drawn as inferred with the estimate's tip; "—" in
 *  Time when the run is not recorded and the member not estimated (D33). A row focuses that member's lane. */
export function MembersTable({
  members,
  recorded,
  runLengthMs,
  until,
  focus,
  onFocus,
}: {
  members: MemberStats[];
  recorded: boolean;
  runLengthMs: number | null;
  /** The end of a member that has not ended: now, for an open run (D32). */
  until: string;
  focus: string | null;
  onFocus: (member: string | null) => void;
}) {
  const scale = runLengthMs ? BAR_PX / runLengthMs : 0;
  return (
    <div className="apanel" data-component="MembersTable">
      <div className="label">
        Members <span className="hint">where each one's time went</span>
      </div>
      <div className="tablewrap">
        <table className="t members">
          <thead>
            <tr>
              <th>Member</th>
              <th>Time</th>
              <th className="num">Posts</th>
              <th className="num">Claims</th>
              <th className="num">Flags</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const spans = ORDER.flatMap((what) => m.intervals.filter((i) => i.what === what));
              return (
                <tr
                  key={m.member}
                  className={focus === m.member ? "hl" : undefined}
                  tabIndex={0}
                  onClick={() => onFocus(focus === m.member ? null : m.member)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onFocus(focus === m.member ? null : m.member);
                  }}
                >
                  <td>
                    <MemberTag name={m.member} /> <span className="nick">{m.nick}</span>
                  </td>
                  <td className={m.estimated ? "inferred" : undefined} data-tip={m.estimated ? ESTIMATED_EVENTS_TIP : undefined}>
                    {recorded || m.estimated ? (
                      <>
                        <span className="stack">
                          {spans.map((s, i) => (
                            <i key={i} className={s.inferred ? `s-${s.what} inferred` : `s-${s.what}`} style={{ width: `${lengthOf(s) * scale}px` }} />
                          ))}
                        </span>{" "}
                        <span className="sub">
                          {formatDuration(lengthOf({ from: m.joined, to: m.ended ?? until }))}
                          {m.waitingMs !== null && m.waitingMs > LONG_WAIT_MS && <span className="warn"> · {formatDuration(m.waitingMs)} waiting</span>}
                        </span>
                      </>
                    ) : (
                      <span className="faint">—</span>
                    )}
                  </td>
                  <td className={m.posts === null ? "num nr" : "num"}>{figure(m.posts)}</td>
                  <td className={m.claims === null ? "num nr" : "num"}>{figure(m.claims)}</td>
                  <td className={m.flags ? "num bad" : m.flags === 0 ? "num faint" : "num nr"}>{figure(m.flags)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
