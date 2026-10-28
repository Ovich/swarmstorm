import type { RunStats, Stats } from "../../../../../swarm-board/src/client/reader.ts";
import { SOURCED_RULE, less, percent, runLength } from "../../../lib/board/analytics.ts";
import { ORCHESTRATOR } from "../../../lib/board/view.ts";
import { KpiTile } from "./KpiTile.tsx";
import { QuestionsChart } from "./QuestionsChart.tsx";
import { RunTimeline, type LegendKey } from "./RunTimeline.tsx";
import { SeatsTable } from "./SeatsTable.tsx";

const LEGEND: LegendKey[] = ["post", "agreement", "endorsed", "objected"];

const line = (n: number | null | undefined, write: (n: number) => string): string | null => (n === null || n === undefined ? null : write(n));

function BrainstormTiles({ stats, run }: { stats: Stats; run: RunStats }) {
  const b = stats.totals.brainstorm;
  const claims = run.brainstorm!.claimsWithSource;
  const without = less(claims.of, claims.n);
  // each seat's own count of claims without a source, "USER 2, DOCS 1"
  const whose = run.members
    .filter((m) => m.unsourced)
    .map((m) => `${m.seat.toUpperCase()} ${m.unsourced}`)
    .join(", ");
  return (
    <div className="kpis six">
      <KpiTile label="Questions settled" value={line(b.questionsSettled, String)} unit={line(b.questions, (n) => `of ${n}`)} />
      <KpiTile label="Exchanges to agree" value={line(b.exchangesMedian, String)} unit="median" />
      <KpiTile
        label="Agreements endorsed"
        value={line(run.brainstorm!.endorsed, String)}
        unit={line(run.brainstorm!.agreements, (n) => `of ${n}`)}
        delta={b.objectedThenAgreed ? `${b.objectedThenAgreed} objected, then agreed again` : null}
      />
      <KpiTile
        label="Claims with a source"
        value={line(b.sourcedShare, percent)}
        unit={claims.n !== null && claims.of !== null ? `${claims.n} of ${claims.of}` : null}
        delta={without ? `${without} without${whose ? `: ${whose}` : ""}` : null}
        tone="warn"
        inferred={SOURCED_RULE}
      />
      <KpiTile label="Length" value={line(run.lengthMs, runLength)} />
      <KpiTile label="Silent seats" value={line(b.silentSeats, String)} />
    </div>
  );
}

/** One brainstorm run's Analytics (board D15, plan D24, D33; prototype #677 `brun`): six tiles with no budget,
 *  its questions, a lane per seat, the seats in numbers. No claims, no merge lock. */
export function BrainstormRunAnalytics({ stats, run, onOpenPost }: { stats: Stats; run: RunStats; onOpenPost: (seq: number) => void }) {
  const to = run.closedAt ?? new Date().toISOString();
  const seats = run.members.filter((m) => m.seat !== ORCHESTRATOR);
  const lanes = seats.map((m) => ({ member: m.member, nick: m.nick, spans: [], posts: m.postTimes, marks: m.marks }));
  return (
    <>
      <BrainstormTiles stats={stats} run={run} />
      <QuestionsChart questions={run.brainstorm?.questions ?? []} from={run.openedAt} to={to} />
      <RunTimeline
        title="Seats"
        clock={false}
        lanes={lanes}
        band={null}
        legend={LEGEND}
        from={run.openedAt}
        to={to}
        // a seat's posts and marks come from the messages, kept before the records too (D33)
        recorded
        silentAfterMs={stats.silentAfterMs}
        focus={null}
        onOpenPost={onOpenPost}
      />
      <SeatsTable members={seats} />
    </>
  );
}
