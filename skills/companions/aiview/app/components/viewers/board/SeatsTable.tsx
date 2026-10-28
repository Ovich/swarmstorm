import type { MemberStats } from "../../../../../swarm-board/src/client/reader.ts";
import { figure } from "../../../lib/board/analytics.ts";
import { MemberTag } from "./chips.tsx";

/** A count shown faint at 0, in `tone` past it, "not recorded" when unknown. */
const countCell = (n: number | null, tone = ""): { className: string; text: string } => ({
  className: ["num", n === null ? "nr" : n === 0 ? "faint" : tone].join(" ").trim(),
  text: figure(n),
});

/** A brainstorm run's seats in numbers (prototype #677 SeatsTable): posts, agreements made, endorsements
 *  (each seat's own, plan D46), objections (inferred, plan D23), claims without a source, each as swarm counts it (plan D40). */
export function SeatsTable({ members }: { members: MemberStats[] }) {
  return (
    <div className="apanel" data-component="SeatsTable">
      <div className="label">Seats in numbers</div>
      <div className="tablewrap">
        <table className="t seats">
          <thead>
            <tr>
              <th>Seat</th>
              <th className="num">Posts</th>
              <th className="num">Agreements made</th>
              <th className="num">Endorsed</th>
              <th className="num">Objections</th>
              <th className="num">Claims without a source</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const cells = [
                countCell(m.posts),
                countCell(m.agreementsMade),
                countCell(m.endorsed),
                countCell(m.objections),
                countCell(m.unsourced, "warn"),
              ];
              return (
                <tr key={m.member}>
                  <td>
                    <MemberTag name={m.member} /> <span className="nick">{m.nick}</span>
                  </td>
                  {cells.map((c, i) => (
                    <td key={i} className={c.className}>
                      {c.text}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
