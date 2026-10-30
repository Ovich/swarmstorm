import type { RunSummary } from "../../../../../swarm-board/src/client/reader.ts";
import { useStats } from "../../../hooks/useStats.ts";
import { runLine, summaryLine, type RunView } from "../../../lib/board/analytics.ts";
import { pauseChip } from "../../../lib/board/view.ts";
import { BrainstormRunAnalytics } from "./BrainstormRunAnalytics.tsx";
import { PlanRunAnalytics } from "./PlanRunAnalytics.tsx";
import { RunViewSwitch } from "./RunViewSwitch.tsx";

/** A run tab on Analytics (board D10, plan D31-D33): `GET /api/stats?run=<id>`, refetched on the board's
 *  change event, under the run's switch; a plan run's view or a brainstorm run's by the answer's kind.
 *  The switch's line is the board's summary until the figures arrive. */
export function RunAnalytics({
  repo,
  summary,
  onView,
  onOpenPost,
  phases = [],
}: {
  repo: string;
  summary: RunSummary;
  onView: (view: RunView) => void;
  onOpenPost: (seq: number) => void;
  /** Every phase the run opened, for the strip. */
  phases?: { name: string; text: string }[];
}) {
  const { stats, body, error } = useStats(repo, { run: summary.run });
  const run = stats?.runs.find((r) => r.run === summary.run) ?? null;
  const state = error ? "error" : stats === null ? "loading" : (run?.kind ?? "loading");
  return (
    <>
      <RunViewSwitch view="analytics" line={run && stats ? runLine(run, stats.totals) : summaryLine(summary)} phase={summary.phase ?? null} progress={summary.progress ?? null} phases={phases} pause={pauseChip(summary)} json={body} onView={onView} />
      <section className="analytics" data-component="RunAnalytics" data-state={state}>
        {error ? (
          <p className="notice">{error}</p>
        ) : stats === null || run === null ? (
          <p className="faint">Loading the run's figures…</p>
        ) : run.plan ? (
          <PlanRunAnalytics stats={stats} run={run} onOpenPost={onOpenPost} />
        ) : run.brainstorm ? (
          <BrainstormRunAnalytics stats={stats} run={run} onOpenPost={onOpenPost} />
        ) : null}
      </section>
    </>
  );
}
