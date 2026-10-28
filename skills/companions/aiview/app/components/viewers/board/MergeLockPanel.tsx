import type { RunStats, Totals } from "../../../../../swarm-board/src/client/reader.ts";
import { figure, formatDuration, plural } from "../../../lib/board/analytics.ts";
import { MemberTag } from "./chips.tsx";

const BINS = ["< 1m", "1–2m", "2–5m", "5–10m", "10m +"];
/** The bins past five minutes are drawn amber. */
const SLOW_FROM = 3;

/** The merge lock over the scope (a new record): its waits in `totals.lockWait`'s bins, and the members
 *  who lost the race for it, as each run's `plan.lock.racesLost` lists them. */
export function MergeLockPanel({ lockWait, runs }: { lockWait: Totals["lockWait"]; runs: RunStats[] }) {
  const tallest = Math.max(1, ...lockWait.bins);
  const lost = runs.flatMap((r) =>
    (r.plan?.lock.racesLost ?? []).filter((x) => x.lost).map((x) => ({ ...x, run: r.run, nick: r.members.find((m) => m.member === x.member)?.nick ?? null })),
  );
  return (
    <div className="apanel" data-component="MergeLockPanel">
      <div className="label">
        Merge lock <span className="newrec">new record</span>
        <span className="hint">
          {lockWait.merges === null
            ? figure(null)
            : `${plural(lockWait.merges, "merge")} · p50 ${figure(lockWait.p50Ms, formatDuration)} · p90 ${figure(lockWait.p90Ms, formatDuration)}`}
        </span>
      </div>
      {lockWait.bins.length ? (
        <>
          <div className="hist">
            {lockWait.bins.map((n, i) => (
              <div key={BINS[i]} className={i >= SLOW_FROM ? "col slow" : "col"} title={plural(n, "merge")}>
                <span>{n}</span>
                <i style={{ height: `${(n / tallest) * 85}%` }} />
              </div>
            ))}
          </div>
          <div className="xl">
            {BINS.map((b) => (
              <span key={b}>{b}</span>
            ))}
          </div>
        </>
      ) : (
        <p className="nr">Lock waits: {figure(null)}</p>
      )}
      {lost.length > 0 && (
        <div className="races">
          <div className="label">Lost the race for the lock</div>
          {lost.map((x) => (
            <div key={`${x.run}-${x.member}`}>
              <MemberTag name={x.member} />
              {x.nick && <span className="nick">{x.nick}</span>}
              <span className="lost">
                {x.lost} lost · {figure(x.waitedMs, formatDuration)} waited
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
