import { useState } from "react";
import type { MemberStats, RunStats, Stats } from "../../../../../swarm-board/src/client/reader.ts";
import { agreementText, countedWithoutAgreement, formatDuration, plural, runLength } from "../../../lib/board/analytics.ts";
import { basename, splitMember } from "../../../lib/board/view.ts";
import { KpiTile } from "./KpiTile.tsx";
import { MembersTable } from "./MembersTable.tsx";
import { RunTimeline, type LegendKey, type LockTurn } from "./RunTimeline.tsx";
import { SharedFilesList } from "./SharedFilesList.tsx";

const LEGEND: LegendKey[] = ["working", "waiting", "merging", "silent", "agreement", "race", "flag", "conflict"];

/** A figure written into a line, or no line when the figure is unknown. */
const line = (n: number | null | undefined, write: (n: number) => string): string | null => (n === null || n === undefined ? null : write(n));
const seatOf = (m: MemberStats): string => splitMember(m.member).seat;

/** "SL6, 14m, came back": a silent member and its first silent span, read from its intervals (plan D34). */
function silentLine(members: MemberStats[], silentMembers: number | null): string | null {
  const silent = members.filter((m) => m.intervals.some((i) => i.what === "silent"));
  if (!silentMembers || silent.length === 0) return null;
  if (silent.length > 1) return silent.map(seatOf).join(", ");
  const m = silent[0];
  const at = m.intervals.findIndex((i) => i.what === "silent");
  const span = m.intervals[at];
  const back = m.intervals.slice(at + 1).some((i) => i.what !== "silent");
  return [seatOf(m), formatDuration(Date.parse(span.to) - Date.parse(span.from)), ...(back ? ["came back"] : [])].join(", ");
}

/** "SL4 wrote view.ts": the one flag's writer and file, from its mark. */
function flagLine(members: MemberStats[], flags: number | null): string | null {
  if (flags !== 1) return null;
  const by = members.find((m) => m.marks.some((x) => x.what === "flag"));
  const mark = by?.marks.find((x) => x.what === "flag");
  if (!by || !mark) return null;
  return mark.path ? `${seatOf(by)} wrote ${basename(mark.path)}` : seatOf(by);
}

function PlanTiles({ stats, run }: { stats: Stats; run: RunStats }) {
  const plan = run.plan!;
  const t = stats.totals;
  const withoutAgreement = t.shared.withoutAgreement;
  // the one file the funnel counts without an agreement, named when there is one only (D46)
  const unsettled = plan.shared.perFile.find(countedWithoutAgreement);
  const lockLine = [line(t.lockWait.p90Ms, (n) => `p90 ${formatDuration(n)}`), line(run.racesLost, (n) => plural(n, "race lost", "races lost"))].filter(Boolean).join(" · ");
  return (
    <div className="kpis">
      <KpiTile
        label="Slices merged"
        value={line(t.slices.merged, String)}
        unit={line(t.slices.of, (n) => `of ${n}`)}
        delta={plan.slices.addedMidRun ? `+${plan.slices.addedMidRun} drawn mid-run` : null}
      />
      <KpiTile label="Length" value={line(run.lengthMs, runLength)} delta={line(run.firstMergeAtMs, (n) => `first merge at ${formatDuration(n)}`)} />
      <KpiTile label="Lock wait" value={line(t.lockWait.p50Ms, formatDuration)} unit="p50" delta={lockLine || null} tone="warn" newRecord />
      <KpiTile
        label="Shared files settled"
        value={line(t.shared.agreed, String)}
        unit={line(t.shared.files, (n) => `of ${n}`)}
        delta={withoutAgreement === 1 && unsettled ? `${basename(unsettled.path)}: ${agreementText(unsettled)}` : withoutAgreement ? `${withoutAgreement} with no agreement` : null}
        tone="warn"
        estimatedRuns={t.shared.estimatedRuns}
      />
      <KpiTile label="Flags" value={line(plan.flags, String)} delta={flagLine(run.members, plan.flags)} tone="bad" />
      <KpiTile
        label="Rebase conflicts"
        value={line(t.conflicts.known, String)}
        unit={t.conflicts.unknownMerges ? `+ ${t.conflicts.unknownMerges} unknown` : null}
        delta={line(t.conflicts.inShared, (n) => `${n} in shared files`)}
        tone="bad"
        newRecord
      />
      <KpiTile label="Silent members" value={line(t.silentMembers, String)} delta={silentLine(run.members, t.silentMembers)} newRecord />
    </div>
  );
}

/** One plan run's Analytics (plan D33; prototype #677 `run`): its seven tiles, the timeline under the merge
 *  lock band, its members and its shared files. Owns the focused lane. */
export function PlanRunAnalytics({ stats, run, onOpenPost }: { stats: Stats; run: RunStats; onOpenPost: (seq: number) => void }) {
  const [focus, setFocus] = useState<string | null>(null);
  const to = run.closedAt ?? new Date().toISOString();
  const lanes = run.members.map((m) => ({ member: m.member, nick: m.nick, spans: m.intervals, posts: [], marks: m.marks }));
  const band: LockTurn[] = run.members.flatMap((m) => m.intervals.filter((i) => i.what === "merging").map((i) => ({ member: m.member, from: i.from, to: i.to })));
  return (
    <>
      <PlanTiles stats={stats} run={run} />
      <RunTimeline
        title="Timeline"
        clock
        lanes={lanes}
        band={band}
        legend={LEGEND}
        from={run.openedAt}
        to={to}
        recorded={run.recorded}
        estimated={run.members.some((m) => m.estimated)}
        silentAfterMs={stats.silentAfterMs}
        focus={focus}
        onFocus={setFocus}
        onOpenPost={onOpenPost}
      />
      <div className="grid2 rundetail">
        <MembersTable members={run.members} recorded={run.recorded} runLengthMs={run.lengthMs} until={to} focus={focus} onFocus={setFocus} />
        <SharedFilesList perFile={run.plan?.shared.perFile ?? []} recorded={run.recorded} estimated={run.plan?.shared.estimated ?? false} />
      </div>
    </>
  );
}
