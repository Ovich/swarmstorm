import type { SharedFile } from "../../../../../swarm-board/src/client/reader.ts";
import { ESTIMATED_TIP, agreementText, countedWithoutAgreement } from "../../../lib/board/analytics.ts";
import { MemberTag } from "./chips.tsx";

/** What a file's merge met: a conflict, none, or unknown (git older than 2.38, board D13); a run before
 *  the records says nothing, its tile and column already reading not recorded once (D45). */
function ConflictNote({ conflict, recorded }: { conflict: boolean | null; recorded: boolean }) {
  if (conflict === true) return <span className="bad"> · conflict at merge</span>;
  if (conflict === false || !recorded) return null;
  return <span className="faint"> · conflict unknown (git older than 2.38)</span>;
}

/** The files two members held in this run (prototype #677 SharedFilesList): their holders, and whether the
 *  holders agreed and how long after, or none, as the funnel counts it (D38, D46). `estimated`: a run before the shares
 *  record, its files the paths two members claimed while both were members, drawn as inferred (D44, D46). */
export function SharedFilesList({ perFile, recorded, estimated }: { perFile: SharedFile[]; recorded: boolean; estimated: boolean }) {
  return (
    <div
      className={estimated ? "apanel inferred" : "apanel"}
      data-component="SharedFilesList"
      data-state={perFile.length ? (estimated ? "estimated" : "files") : "none"}
      data-tip={estimated ? ESTIMATED_TIP : undefined}
    >
      <div className="label">
        Shared files in this run
        {estimated ? (
          <span className="hint" title={ESTIMATED_TIP}>
            estimated
          </span>
        ) : null}
      </div>
      {perFile.length === 0 ? (
        <p className="faint">No file was shared in this run.</p>
      ) : (
        <div className="tablewrap">
          <table className="t shared">
            <thead>
              <tr>
                <th>File</th>
                <th>Holders</th>
                <th>Agreement</th>
              </tr>
            </thead>
            <tbody>
              {perFile.map((f) => (
                <tr key={f.path}>
                  <td className="apath" title={f.path}>
                    {f.path}
                  </td>
                  <td>
                    <span className="holders">
                      {f.holders.map((h) => (
                        <MemberTag key={h} name={h} />
                      ))}
                    </span>
                  </td>
                  <td>
                    {countedWithoutAgreement(f) ? <span className="warn">{agreementText(f)}</span> : agreementText(f)}
                    <ConflictNote conflict={f.conflict} recorded={recorded} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
