// The code pack's figures (board-split#D15): what claims, flags, merges and the merge lock add to `swarm stats`. The core
// stats call them through `StatsFigures` and place what they return; the figures and their nullability (board D34) are
// as the core computed them before the split, so `stats --json` reads the same.
import type { RunId } from "../../board/board.ts";
import type { Interval, Mark, MemberStats, RunFigureInput, RunStats, StatsFigures, TimelineSpan } from "../../board/stats.ts";
import { firstLine, foldPath, iso, ms, percentile, sumKnown, type Row } from "../../board/stats-math.ts";

const MINUTE_MS = 60 * 1000;
/** The settings row the board writes when the shares record begins (D39). */
const SHARES_SINCE = "shares-since";
// a flag as the board wrote it before the `event` column (D43): its body, posted by the board (by_board 1); its path and holder
const FLAG_BODY = /flag:\s*\S+\s+wrote\s+(\S+)\s+outside its claim(?:;\s*(\S+)\s+holds it)?/;
/** The lock wait histogram's upper bounds, the last bin open-ended: < 1m, 1–2m, 2–5m, 5–10m, 10m + (D28). */
const waitBinsMs = (): number[] => [1, 2, 5, 10].map((m) => m * MINUTE_MS);

/** `estimated` (D44): the run closed before the records, its figures read from what the store kept for every run
 *  (`participants`, `claim_log`) and approximate, never passed off as recorded (D23); false on a recorded run. */
export type PlanRunStats = {
  /** Before the records, `merged` is the members whose row says merged, exact; `timesMs` each member's join to its first
   *  `merged` event, else to its end (D45), and `timesEstimated` true: only the times are estimated, never the count. */
  slices: { merged: number | null; of: number | null; addedMidRun: number | null; timesMs: number[]; timesEstimated: boolean };
  lock: { waitsMs: number[]; racesLost: { member: string; lost: number | null; waitedMs: number | null }[] };
  /** Estimated (before `shares-since`): a path two or more members claimed while both were members of the run, their
   *  membership spans overlapping (D46); `agreedBeforeMerge`
   *  against the first `merged` event of a holder that carried the path (D45). */
  shared: { files: number | null; everyHolderTold: number | null; agreed: number | null; agreedBeforeMerge: number | null; perFile: SharedFile[]; estimated: boolean };
  flags: number | null;
  /** `known`: conflicted paths over the merges whose conflicts are known; `inShared`: those another member of the run held;
   *  `unknownMerges`: merges whose conflicts git could not tell (board D13, D16). */
  conflicts: { known: number | null; inShared: number | null; unknownMerges: number | null };
};
export type SharedFile = {
  path: string;
  holders: string[];
  /** Every later holder told every earlier one (D41): the funnel counts its agreement only then (D38, D46). */
  told: boolean;
  agreement: number | null /* seq */;
  /** From the first tell to the agreement; below 0 when the agreement came before the tell (D46). */
  agreedAfterMs: number | null;
  conflict: boolean | null;
  /** A holder declared it an interface at join, or claimed it as one (D37); null on a summary from before. */
  interface: boolean | null;
};
export type CodeMemberStats = {
  claims: number | null;
  flags: number | null;
  /** Its spans waiting for the merge lock, summed; null when the run is not recorded (D40). */
  waitingMs: number | null;
};
export type CodeRunStats = { firstMergeAtMs: number | null; racesLost: number | null /* summed over members, D34 */; plan?: PlanRunStats };
export type CodeTotals = {
  /** `timesEstimatedRuns`: the plan runs whose seat times are estimated (D44), counted so the page never counts (D35);
   *  `merged` is exact for every run. */
  slices: { merged: number | null; of: number | null; p50Ms: number | null; p90Ms: number | null; timesEstimatedRuns: number };
  lockWait: { merges: number | null; p50Ms: number | null; p90Ms: number | null; bins: number[] /* < 1m, 1–2m, 2–5m, 5–10m, 10m + */ };
  shared: { files: number | null; everyHolderTold: number | null; agreed: number | null; agreedBeforeMerge: number | null; withoutAgreement: number | null; estimatedRuns: number };
  flags: number | null;
  runsWithoutFlag: number | null;
  conflicts: { known: number | null; inShared: number | null; unknownMerges: number | null };
};
export type FileAcrossRuns = {
  path: string;
  runs: RunId[];
  holders: number | null;
  agreements: number | null;
  conflicts: number | null;
  declaredInterface: number | null;
  perRun: { run: RunId; holders: number | null; conflict: boolean | null }[] /* oldest first, D33 */;
};
/** A run's stats as the code pack reads them: the core's, with its fields. */
type CodeRun = RunStats & Partial<CodeRunStats> & { members: (MemberStats & Partial<CodeMemberStats>)[] };

/** A flag the board posted, from its message (D43): the `flag` event, or a board-written row from before
 *  the event name with the flag's body. Never the `flags` table, which the release of a claim empties,
 *  and never a member's own post quoting a flag. */
const isBoardFlag = (m: Row): boolean =>
  Number(m.by_board ?? 0) === 1 && (m.event === "flag" || (m.event == null && FLAG_BODY.test(String(m.body))));
/** The board's flags without their repeats: one per writer, path and holder in a run (D43, D46); the first kept. */
function distinctFlags(messages: Row[]): Row[] {
  const seen = new Set<string>();
  return messages.filter((m) => {
    if (!isBoardFlag(m)) return false;
    const [, path = m.about ?? "", holder = ""] = String(m.body).match(FLAG_BODY) ?? [];
    const key = JSON.stringify([Number(m.author), foldPath(String(path)), holder]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** `about` (a path, or its tail) names `path`. */
const aboutNames = (about: unknown, path: string): boolean => {
  if (about == null) return false;
  const a = foldPath(String(about).replace(/\\/g, "/"));
  const f = foldPath(path);
  return a === f || f.endsWith(`/${a}`);
};

/** One lock turn of a member, its times in ms; `over`: when it ended, by its merge, an end call, or the member's end. */
type LockTurn = { asked: number; granted: number | null; merged: number | null; refused: number; over: number };

/** A merge as the stats read it: from the `merges` table on a recorded run; before the records, from the board's
 *  `merged` events (D45), whose conflicts were not kept and whose files are those of the body's `files:` line, null
 *  when it has none. */
type MergeRead = { participant: number; at: number; files: string[] | null; conflicts: string[] | null };
/** A `merged` event: by its name, or by its body on a row from before the `event` column (D43). */
const MERGED_BODY = /^merged \S+/;
const FILES_LINE = /^files: (.*)$/m;
function mergesFromEvents(messages: Row[]): MergeRead[] {
  return messages
    .filter((m) => m.kind === "event" && (m.event === "merged" || (m.event == null && MERGED_BODY.test(String(m.body)))))
    .map((m) => {
      const line = String(m.body).match(FILES_LINE)?.[1].trim();
      const files = line === undefined ? null : line === "-" ? [] : line.split(", ").map((f) => f.trim()).filter(Boolean);
      return { participant: Number(m.author), at: ms(m.at), files, conflicts: null };
    });
}

/** A run before the records' member timeline, read from its board events (D45): working from its join to its first
 *  merge, else to its end, then a mark of no length at each merge; every span estimated. No waiting, no silent: the
 *  calls were not kept. */
function estimatedTimeline(joined: number, over: number, mergedAt: number[]): Interval[] {
  if (!(over > joined)) return [];
  const merges = mergedAt.filter((t) => t > joined && t <= over).sort((a, b) => a - b);
  const working: Interval = { from: iso(joined), to: iso(merges[0] ?? over), what: "working", inferred: true };
  return [working, ...merges.map((t): Interval => ({ from: iso(t), to: iso(t), what: "merging", inferred: true }))];
}

/** A run's code figures, from the raw rows. */
function ofRun(input: RunFigureInput) {
  const { db, run: r, people, messages, recorded, runOver, orchestrators, nameOf } = input;
  const id = Number(r.id);
  const repo = String(r.repo);
  const ids = people.map((p) => Number(p.id));
  const marks = ids.map(() => "?").join(", ") || "NULL";
  const sharesSince = db.prepare("SELECT value FROM settings WHERE name = ?").get(SHARES_SINCE) as Row | undefined;
  // opened before the shares record began: which paths were held at once is unknown, its funnel estimated from the claims (D39, D44)
  const sharesRecorded = sharesSince !== undefined && ms(r.opened_at) >= ms(sharesSince.value);
  const merges = recorded ? (db.prepare("SELECT * FROM merges WHERE run = ? ORDER BY rowid").all(id) as Row[]) : [];
  const claimLog = db.prepare(`SELECT path, participant, kind FROM claim_log WHERE participant IN (${marks}) ORDER BY rowid`).all(...ids) as Row[];
  // shares: a claim granted beside another member of the run still holding the path (D39)
  const shares = db
    .prepare(`SELECT path, participant, other FROM shares WHERE participant IN (${marks}) AND other IN (${marks})`)
    .all(...ids, ...ids) as Row[];
  const conflictedOf = (m: Row): string[] | null => (m.conflicts == null ? null : (JSON.parse(String(m.conflicts)) as string[]));
  // the run's merges: recorded, or read from its `merged` events before the records (D45)
  const mergesRead: MergeRead[] = recorded
    ? merges.map((m) => ({ participant: Number(m.participant), at: ms(m.at), files: JSON.parse(String(m.files)) as string[], conflicts: conflictedOf(m) }))
    : mergesFromEvents(messages);
  const mergeTimesOf = (pid: number): number[] => mergesRead.filter((m) => m.participant === pid).map((m) => m.at);
  // every grant on the repository, any run's: what a race is lost to (D33)
  const grants = recorded
    ? (db
        .prepare(
          `SELECT t.participant, t.asked_at, t.granted_at, p.seat, r.plan FROM lock_requests t
             LEFT JOIN participants p ON p.id = t.participant LEFT JOIN runs r ON r.id = p.run
           WHERE t.repo = ? AND t.granted_at IS NOT NULL ORDER BY t.granted_at`,
        )
        .all(repo) as Row[])
    : [];
  const lockWaitsMs: number[] = [];
  // a flag repeated for one writer, path and holder counts once (D46)
  const boardFlags = distinctFlags(messages);
  const racesLost: PlanRunStats["lock"]["racesLost"] = [];

  const memberOf = (p: Row, window: { joined: number; over: number; endCalls: number[] }) => {
    const pid = Number(p.id);
    const turns: LockTurn[] = recorded
      ? (db.prepare("SELECT * FROM lock_requests WHERE participant = ? ORDER BY rowid").all(pid) as Row[]).map((t) => {
          const asked = ms(t.asked_at);
          const merged = t.merged_at == null ? null : ms(t.merged_at);
          return {
            asked,
            granted: t.granted_at == null ? null : ms(t.granted_at),
            merged,
            refused: Number(t.refused),
            // a turn without a merge is closed by the member's next end call (D25), else by its end
            over: merged ?? window.endCalls.find((e) => e >= asked) ?? window.over,
          };
        })
      : [];
    const memberMarks: Mark[] = [];
    // a race lost: a refused turn still pending while the lock goes to a member who asked later (D33);
    // waitedMs: how long it had waited at the last race it lost
    let lost = 0;
    let waitedMs: number | null = null;
    for (const t of turns) {
      if (t.granted !== null) lockWaitsMs.push(t.granted - t.asked);
      if (t.refused === 0) continue;
      const until = t.granted ?? t.over;
      for (const g of grants) {
        const at = ms(g.granted_at);
        if (Number(g.participant) === pid || !(ms(g.asked_at) > t.asked) || !(at > t.asked && at < until)) continue;
        lost++;
        waitedMs = Math.max(waitedMs ?? 0, at - t.asked);
        const winner = g.seat == null ? "a member" : `${g.plan}/${g.seat}`;
        memberMarks.push({ at: iso(at), what: "race", note: `the merge lock went to ${winner}, who asked later` });
      }
    }
    if (lost) racesLost.push({ member: nameOf(p), lost, waitedMs });
    const flagged = boardFlags.filter((m) => Number(m.author) === pid);
    for (const m of flagged) {
      memberMarks.push({ at: String(m.at), what: "flag", seq: Number(m.seq), ...(m.about != null ? { path: String(m.about) } : {}), note: firstLine(String(m.body)) });
    }
    for (const m of mergesRead.filter((x) => x.participant === pid)) {
      for (const f of m.conflicts ?? []) memberMarks.push({ at: iso(m.at), what: "conflict", path: f, note: `the rebase met a conflict in ${f}` });
    }
    // the exact spans, merging first: it wins over waiting where both hold
    const spans: TimelineSpan[] = [
      ...turns.flatMap((t) => (t.granted !== null ? [{ from: t.granted, to: t.merged ?? t.over, what: "merging" as const }] : [])),
      ...turns.flatMap((t) => (t.refused > 0 ? [{ from: t.asked, to: t.granted ?? t.over, what: "waiting" as const }] : [])),
    ];
    return {
      spans,
      marks: memberMarks,
      estimated: recorded ? null : estimatedTimeline(window.joined, window.over, mergeTimesOf(pid)),
      counts: { claims: claimLog.filter((c) => Number(c.participant) === pid).length, flags: flagged.length },
      // read from its spans once they are whole, in `fill` (D40)
      late: { waitingMs: null },
    };
  };

  /** The run's own fields, read once every member is (racesLost sums the members'). */
  const runFields = (): Omit<CodeRunStats, "plan"> => {
    const firstMerge = mergesRead.length ? Math.min(...mergesRead.map((m) => m.at)) : null;
    return {
      firstMergeAtMs: firstMerge === null ? null : firstMerge - ms(r.opened_at),
      racesLost: recorded ? racesLost.reduce((n, x) => n + (x.lost ?? 0), 0) : null,
    };
  };

  /** A plan run's block (board D9): its slices, the lock, the shared files, flags and conflicts. */
  const kindFields = (): { plan: PlanRunStats } | null => {
    // a plan's slices are seats: the figures of a plan run alone, as before the split
    if (String(r.kind ?? "plan") !== "plan") return null;
    const sliceMembers = people.filter((p) => !orchestrators.has(Number(p.id)));
    // a seat's time: its join to its first merge, else to its end (board D9); before the records, the merge read from
    // its `merged` event (D45)
    const timesMs = sliceMembers.flatMap((p) => {
      const mergedAt = mergeTimesOf(Number(p.id));
      const end = mergedAt.length ? Math.min(...mergedAt) : p.ended_at == null ? null : ms(p.ended_at);
      return end === null ? [] : [end - ms(p.joined_at)];
    });
    const sliceCount = Number((db.prepare("SELECT COUNT(*) AS n FROM seats WHERE run = ?").get(id) as Row).n);
    const addedMidRun = messages.filter((m) => m.kind === "event" && orchestrators.has(Number(m.author)) && /^added \S+: /.test(String(m.body))).length;

    // shared files: a path two members of the run held at the same time (D39), its holders in the order they took it;
    // before the shares record, a path two members claimed while both were members, standing in for at once (D44, D46)
    const holdersByPath = new Map<string, { path: string; holders: number[] }>();
    for (const c of claimLog) {
      const key = foldPath(String(c.path));
      const entry = holdersByPath.get(key) ?? { path: String(c.path), holders: [] };
      if (!entry.holders.includes(Number(c.participant))) entry.holders.push(Number(c.participant));
      holdersByPath.set(key, entry);
    }
    // a holder counts when it held the path at once with another member, either side of a share
    const sharersOf = (path: string): Set<number> =>
      new Set(shares.filter((sh) => foldPath(String(sh.path)) === foldPath(path)).flatMap((sh) => [Number(sh.participant), Number(sh.other)]));
    const byId = new Map(people.map((p) => [Number(p.id), p]));
    // a member's span in the run: its join to its end, else to the run's close
    const membershipOf = (pid: number): { from: number; to: number } => {
      const p = byId.get(pid)!;
      return { from: ms(p.joined_at), to: p.ended_at == null ? runOver : ms(p.ended_at) };
    };
    const membersTogether = (a: number, b: number): boolean => {
      const x = membershipOf(a);
      const y = membershipOf(b);
      return x.from < y.to && y.from < x.to;
    };
    // before the shares record: the claimers whose membership overlapped another claimer's (D46)
    const claimersTogether = (claimers: number[]): number[] => claimers.filter((h) => claimers.some((o) => o !== h && membersTogether(h, o)));
    const namesPath = (m: Row, path: string): boolean => {
      if (aboutNames(m.about, path)) return true;
      const body = foldPath(String(m.body));
      return body.includes(foldPath(path)) || body.includes(foldPath(path.split("/").pop()!));
    };
    const said = messages.filter((m) => m.kind !== "event" && Number(m.by_board ?? 0) === 0);
    // the claims made as an interface, kept past their release (D42)
    const interfaceClaims = claimLog.filter((c) => c.kind === "interface");
    const perFile: SharedFile[] = [];
    // the funnel is nested (D38): each step counts only the files that passed the step before
    let everyHolderTold = 0;
    let agreed = 0;
    let agreedBeforeMerge = 0;
    for (const { path, holders: everyHolder } of holdersByPath.values()) {
      const sharers = sharersOf(path);
      const holders = sharesRecorded ? everyHolder.filter((h) => sharers.has(h)) : claimersTogether(everyHolder);
      if (holders.length < 2) continue;
      // each later holder posted about the path mentioning every earlier one (D41); the file is shared from the first such post
      const tellTimes: number[] = [];
      let told = true;
      for (let i = 1; i < holders.length; i++) {
        const tells = said.filter((m) => Number(m.author) === holders[i] && namesPath(m, path));
        tellTimes.push(...tells.map((m) => ms(m.at)));
        const mentioned = (e: number): boolean =>
          tells.some((m) => {
            const named = JSON.parse(String(m.mentions)) as string[];
            return named.includes(nameOf(byId.get(e)!)) || named.includes(`${r.plan}/*`);
          });
        if (!holders.slice(0, i).every(mentioned)) told = false;
      }
      const sharedAt = tellTimes.length ? Math.min(...tellTimes) : null;
      const agreement = messages.find((m) => m.kind === "agreement" && aboutNames(m.about, path));
      // the merges that carried the path; a `merged` event without its files line, a holder's (D45)
      const mergedWith = mergesRead.filter((m) => (m.files ? m.files.some((f) => foldPath(f) === foldPath(path)) : holders.includes(m.participant)));
      const firstMergeOfPath = mergedWith.length ? Math.min(...mergedWith.map((m) => m.at)) : null;
      if (told) {
        everyHolderTold++;
        if (agreement) {
          agreed++;
          if (firstMergeOfPath === null || ms(agreement.at) < firstMergeOfPath) agreedBeforeMerge++;
        }
      }
      const met = mergedWith.map((m) => m.conflicts);
      const conflict = !recorded ? null : met.some((c) => c?.some((f) => foldPath(f) === foldPath(path))) ? true : met.some((c) => c === null) ? null : false;
      // an interface: declared so at join (repository-relative), or claimed so (D37)
      const declaredInterface = holders.some((h) =>
        (JSON.parse(String(byId.get(h)!.files ?? "[]")) as { path: string; interface?: boolean }[]).some((d) => d.interface === true && aboutNames(d.path, path)),
      );
      const claimedInterface = interfaceClaims.some((c) => holders.includes(Number(c.participant)) && foldPath(String(c.path)) === foldPath(path));
      perFile.push({
        path,
        holders: holders.map((h) => nameOf(byId.get(h)!)),
        interface: declaredInterface || claimedInterface,
        told,
        agreement: agreement ? Number(agreement.seq) : null,
        // below 0: agreed before the tell (D46)
        agreedAfterMs: agreement && sharedAt !== null ? ms(agreement.at) - sharedAt : null,
        conflict,
      });
    }

    // conflicts: paths over the merges whose conflicts are known; inShared, those another member held (board D13, D16)
    let known = 0;
    let inShared = 0;
    let unknownMerges = 0;
    for (const m of merges) {
      const files = conflictedOf(m);
      if (files === null) {
        unknownMerges++;
        continue;
      }
      known += files.length;
      inShared += files.filter((f) => claimLog.some((c) => Number(c.participant) !== Number(m.participant) && foldPath(String(c.path)) === foldPath(f))).length;
    }
    // before the records, the members whose row says merged, once each (D44)
    const mergedSlices = recorded
      ? new Set(merges.map((m) => Number(m.participant)).filter((pid) => !orchestrators.has(pid))).size
      : sliceMembers.filter((p) => Number(p.merged ?? 0) === 1).length;
    return {
      plan: {
        slices: { merged: mergedSlices, of: sliceCount, addedMidRun, timesMs, timesEstimated: !recorded },
        lock: { waitsMs: lockWaitsMs, racesLost },
        shared: { files: perFile.length, everyHolderTold, agreed, agreedBeforeMerge, perFile, estimated: !sharesRecorded },
        flags: boardFlags.length,
        conflicts: recorded ? { known, inShared, unknownMerges } : { known: null, inShared: null, unknownMerges: null },
      },
    };
  };

  return { member: memberOf, runFields, kindFields };
}

/** A summary's slices as today's: `timesEstimated` read from the `estimated` it was named before (it meant the times,
 *  the count being exact), false when a summary from before the estimates (D44) carries neither. */
function slicesOfSummary(slices: PlanRunStats["slices"] & { estimated?: boolean }): PlanRunStats["slices"] {
  const { estimated, ...rest } = slices;
  return { ...rest, timesEstimated: slices.timesEstimated ?? estimated ?? false };
}

/** A run's code figures filled the way a stored summary lacks them: each member's waitingMs from its spans (D40), the
 *  plan block's fields from before (D44, D46). */
function fill(run: RunStats): RunStats {
  const codeRun = run as CodeRun;
  const lengthOf = (i: Interval): number => ms(i.to) - ms(i.from);
  const members = codeRun.members.map((m) =>
    "waitingMs" in m ? { ...m, waitingMs: m.waitingMs ?? (run.recorded ? m.intervals.filter((i) => i.what === "waiting").reduce((n, i) => n + lengthOf(i), 0) : null) } : m,
  );
  const plan = codeRun.plan && {
    ...codeRun.plan,
    slices: slicesOfSummary(codeRun.plan.slices),
    shared: {
      ...codeRun.plan.shared,
      estimated: codeRun.plan.shared.estimated ?? false,
      // a summary from before `told` (D46) reads each file told, as its list read it
      perFile: codeRun.plan.shared.perFile.map((f) => ({ ...f, told: f.told ?? true })),
    },
  };
  return { ...run, members, ...(plan ? { plan } : {}) } as RunStats;
}

/** The scope's code totals, from its runs' figures alone, stored or computed alike (D28, D34). */
function totals(runs: RunStats[]): { fields: CodeTotals; series: Record<string, (number | null)[]> } {
  const codeRuns = runs as CodeRun[];
  const plans = codeRuns.flatMap((r) => (r.plan ? [r.plan] : []));
  const recordedPlans = codeRuns.filter((r) => r.recorded).flatMap((r) => (r.plan ? [r.plan] : []));
  // seat times count estimated ones too (D44)
  const times = plans.flatMap((p) => p.slices.timesMs);
  const waits = recordedPlans.flatMap((p) => p.lock.waitsMs);
  const bounds = waitBinsMs();
  const bins = [...bounds, Infinity].map((upper, i) => waits.filter((w) => w >= (bounds[i - 1] ?? 0) && w < upper).length);
  const shared = (pick: (s: PlanRunStats["shared"]) => number | null): number | null => sumKnown(plans.map((p) => pick(p.shared)));
  const files = shared((s) => s.files);
  const agreed = shared((s) => s.agreed);
  // one point per run; a run before the records is a gap (D32), unless the figure is read from what every run kept (D43, D44)
  const series = (figure: (r: CodeRun) => number | null): (number | null)[] => codeRuns.map((r) => (r.recorded ? figure(r) : null));
  const everyRun = (figure: (r: CodeRun) => number | null): (number | null)[] => codeRuns.map(figure);
  return {
    fields: {
      slices: {
        merged: sumKnown(plans.map((p) => p.slices.merged)),
        of: sumKnown(plans.map((p) => p.slices.of)),
        p50Ms: percentile(times, 0.5),
        p90Ms: percentile(times, 0.9),
        timesEstimatedRuns: plans.filter((p) => p.slices.timesEstimated).length,
      },
      // merges: the lock turns granted, each one merge's wait
      lockWait: { merges: recordedPlans.length ? waits.length : null, p50Ms: percentile(waits, 0.5), p90Ms: percentile(waits, 0.9), bins: recordedPlans.length ? bins : [] },
      shared: {
        files,
        everyHolderTold: shared((s) => s.everyHolderTold),
        agreed,
        agreedBeforeMerge: shared((s) => s.agreedBeforeMerge),
        withoutAgreement: files === null || agreed === null ? null : files - agreed,
        estimatedRuns: plans.filter((p) => p.shared.estimated).length,
      },
      flags: sumKnown(plans.map((p) => p.flags)),
      runsWithoutFlag: plans.length ? plans.filter((p) => p.flags === 0).length : null,
      conflicts: {
        known: sumKnown(plans.map((p) => p.conflicts.known)),
        inShared: sumKnown(plans.map((p) => p.conflicts.inShared)),
        unknownMerges: sumKnown(plans.map((p) => p.conflicts.unknownMerges)),
      },
    },
    series: {
      slicesMerged: everyRun((r) => r.plan?.slices.merged ?? null),
      sliceTimeP50: everyRun((r) => (r.plan ? percentile(r.plan.slices.timesMs, 0.5) : null)),
      lockWaitP50: series((r) => (r.plan ? percentile(r.plan.lock.waitsMs, 0.5) : null)),
      sharedAgreed: everyRun((r) => r.plan?.shared.agreed ?? null),
      // flags come from the board's messages, kept for a run before the records too (D43)
      flags: everyRun((r) => r.plan?.flags ?? null),
      conflicts: series((r) => r.plan?.conflicts.known ?? null),
    },
  };
}

/** The files members met in across the scope's runs, most runs first (D33). */
function filesAcross(runs: RunStats[]): FileAcrossRuns[] {
  const byPath = new Map<string, { path: string; perRun: { run: RunId; holders: string[]; agreed: boolean; conflict: boolean | null; interface: boolean | null }[] }>();
  for (const r of runs as CodeRun[]) {
    for (const f of r.plan?.shared.perFile ?? []) {
      const key = foldPath(f.path);
      const entry = byPath.get(key) ?? { path: f.path, perRun: [] };
      entry.perRun.push({ run: r.run, holders: f.holders, agreed: f.agreement !== null, conflict: f.conflict, interface: f.interface ?? null });
      byPath.set(key, entry);
    }
  }
  return [...byPath.values()]
    .map(({ path, perRun }) => ({
      path,
      runs: perRun.map((x) => x.run),
      holders: new Set(perRun.flatMap((x) => x.holders)).size,
      agreements: perRun.filter((x) => x.agreed).length,
      conflicts: perRun.every((x) => x.conflict === null) ? null : perRun.filter((x) => x.conflict === true).length,
      // the runs in which a holder declared or claimed it an interface; null when none knows (summaries from before D37)
      declaredInterface: perRun.every((x) => x.interface === null) ? null : perRun.filter((x) => x.interface === true).length,
      perRun: perRun.map((x) => ({ run: x.run, holders: x.holders.length, conflict: x.conflict })),
    }))
    .sort((a, b) => b.runs.length - a.runs.length || a.path.localeCompare(b.path));
}

export const codeStats: StatsFigures = { ofRun, fill, totals, files: filesAcross };
