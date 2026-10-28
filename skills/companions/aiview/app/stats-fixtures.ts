// `Stats` as `GET /api/stats` answers them, for the analytics views: the across view's closed runs of
// swarmstorm-app, and one run's answer each for a plan run, a brainstorm run, a run before the records
// and an open run. The totals are written by hand, and on purpose they disagree with what summing or
// counting the runs would give: the page reads them, it never counts (D34, D35).
import type { MemberStats, RunStats, Stats, Totals } from "../../swarm-board/src/client/reader.ts";
import { APP } from "./board-fixtures.ts";

const at = (hm: string): string => {
  const [h, m] = hm.split(":").map(Number);
  return new Date(2026, 9, 7, h, m).toISOString();
};
const MIN = 60_000;
export const SILENT_AFTER_MS = 10 * MIN;

const member = (member: string, nick: string, joined: string, over: Partial<MemberStats> = {}): MemberStats => ({
  member,
  nick,
  seat: member.slice(member.lastIndexOf("/") + 1),
  joined: at(joined),
  ended: null,
  intervals: [],
  marks: [],
  posts: 0,
  postTimes: [],
  claims: 0,
  flags: 0,
  unsourced: 0,
  waitingMs: 0,
  agreementsMade: 0,
  endorsed: null,
  objections: null,
  estimated: false,
  ...over,
});

const series = (points: (number | null)[]): Totals["series"] => ({
  slicesMerged: points,
  sliceTimeP50: points,
  lockWaitP50: points,
  sharedAgreed: points,
  flags: points,
  conflicts: points,
  silentMembers: points,
});

const totals = (over: Partial<Totals> = {}, points: (number | null)[] = []): Totals => ({
  runs: 1,
  byKind: { plan: 1, brainstorm: 0 },
  notRecorded: 0,
  members: 2,
  silentMembers: 0,
  slices: { merged: 1, of: 1, p50Ms: 5 * MIN, p90Ms: 5 * MIN, timesEstimatedRuns: 0 },
  lockWait: { merges: 1, p50Ms: MIN, p90Ms: MIN, bins: [0, 1, 0, 0, 0] },
  shared: { files: 0, everyHolderTold: 0, agreed: 0, agreedBeforeMerge: 0, withoutAgreement: 0, estimatedRuns: 0 },
  flags: 0,
  runsWithoutFlag: 1,
  conflicts: { known: 0, inShared: 0, unknownMerges: 0 },
  brainstorm: { notRecorded: null, questionsSettled: null, questions: null, exchangesMedian: null, objectedThenAgreed: null, sourcedShare: null, claimsWithSource: { n: null, of: null }, silentSeats: null },
  series: series(points),
  ...over,
});

// ── One plan run, closed and recorded: The login page (run 4) ──────────────────────────────

const LP = "login-page";
/** S4's spans wait one minute for the lock; its `waitingMs` says twelve, and the page reads the twelve (D40). */
export const LP_S4 = member(`${LP}/S4`, "Brave Badger", "13:00", {
  ended: at("13:20"),
  intervals: [
    { from: at("13:00"), to: at("13:04"), what: "working", inferred: true },
    { from: at("13:04"), to: at("13:16"), what: "silent", inferred: true },
    { from: at("13:16"), to: at("13:17"), what: "working", inferred: true },
    { from: at("13:17"), to: at("13:18"), what: "waiting", inferred: false },
    { from: at("13:18"), to: at("13:20"), what: "merging", inferred: false },
  ],
  marks: [{ at: at("13:10"), what: "agreement", seq: 14, path: "src/login.ts", note: "S4 writes the form, S3 the route" }],
  posts: 3,
  claims: 2,
  waitingMs: 12 * MIN,
  agreementsMade: 1,
});
const LP_RUN: RunStats = {
  run: 4,
  kind: "plan",
  code: "LP",
  title: "The login page",
  openedAt: at("13:00"),
  closedAt: at("13:20"),
  lengthMs: 20 * MIN,
  recorded: true,
  firstMergeAtMs: 18 * MIN,
  racesLost: 0,
  members: [
    member(`${LP}/orchestrator`, "Gentle Bison", "13:00", { ended: at("13:20"), intervals: [{ from: at("13:00"), to: at("13:20"), what: "working", inferred: true }] }),
    LP_S4,
  ],
  plan: {
    slices: { merged: 1, of: 4, addedMidRun: 0, timesMs: [18 * MIN], timesEstimated: false },
    lock: { waitsMs: [MIN], racesLost: [] },
    shared: {
      files: 2,
      everyHolderTold: 2,
      agreed: 1,
      agreedBeforeMerge: 1,
      perFile: [
        { path: "src/login.ts", holders: [`${LP}/S3`, `${LP}/S4`], told: true, agreement: 14, agreedAfterMs: 2 * MIN, conflict: true, interface: false },
        { path: "src/session.ts", holders: [`${LP}/S3`, `${LP}/S4`], told: true, agreement: null, agreedAfterMs: null, conflict: null, interface: false },
      ],
      estimated: false,
    },
    flags: 1,
    conflicts: { known: 1, inShared: 1, unknownMerges: 0 },
  },
};
export const PLAN_RUN: Stats = {
  scope: { repo: APP, run: 4 },
  runs: [LP_RUN],
  totals: totals({
    members: 2,
    slices: { merged: 1, of: 4, p50Ms: 18 * MIN, p90Ms: 18 * MIN, timesEstimatedRuns: 0 },
    shared: { files: 2, everyHolderTold: 2, agreed: 1, agreedBeforeMerge: 1, withoutAgreement: 1, estimatedRuns: 0 },
    flags: 1,
    conflicts: { known: 1, inShared: 1, unknownMerges: 0 },
    silentMembers: 1,
  }, [1]),
  files: [],
  silentAfterMs: SILENT_AFTER_MS,
};

// ── One brainstorm run, closed: Theme tokens (run 5) ───────────────────────────────────────

const TT = "theme-tokens";
/** The skeptic's marks hold one endorsement and no objection; its counts say 3 and 2 (D40). */
export const TT_SKEPTIC = member(`${TT}/skeptic`, "Witty Heron", "13:30", {
  ended: at("13:50"),
  marks: [{ at: at("13:40"), what: "endorsed", seq: 31, path: "D1", note: "endorses #30" }],
  posts: 5,
  postTimes: [at("13:32"), at("13:35"), at("13:38")],
  waitingMs: null,
  agreementsMade: 4,
  endorsed: 3,
  objections: 2,
  unsourced: 1,
});
/** One agreement mark; `agreementsMade` says 2; one endorsement, a seat's that is not the skeptic (D46). */
export const TT_USER = member(`${TT}/user`, "Jolly Walrus", "13:30", {
  ended: at("13:50"),
  marks: [{ at: at("13:39"), what: "agreement", seq: 30, path: "D1", note: "two names per token" }],
  posts: 4,
  postTimes: [at("13:33"), at("13:39")],
  waitingMs: null,
  agreementsMade: 2,
  endorsed: 1,
  objections: 0,
  unsourced: 2,
});
const TT_RUN: RunStats = {
  run: 5,
  kind: "brainstorm",
  code: "TT",
  title: "Theme tokens",
  openedAt: at("13:30"),
  closedAt: at("13:50"),
  lengthMs: 20 * MIN,
  recorded: true,
  firstMergeAtMs: null,
  racesLost: null,
  members: [member(`${TT}/orchestrator`, "Swift Hare", "13:30", { ended: at("13:50"), waitingMs: null }), TT_SKEPTIC, TT_USER],
  brainstorm: {
    questions: [
      { id: "D1", firstPost: at("13:32"), outcome: { at: at("13:39"), seq: 30, kind: "agreed" }, exchanges: 4 },
      { id: "D2", firstPost: at("13:35"), outcome: null, exchanges: 2 },
    ],
    agreements: 2,
    endorsed: 1,
    claimsWithSource: { n: 5, of: 8, inferred: true },
  },
};
export const BRAINSTORM_RUN: Stats = {
  scope: { repo: APP, run: 5 },
  runs: [TT_RUN],
  totals: totals({
    byKind: { plan: 0, brainstorm: 1 },
    members: 3,
    slices: { merged: null, of: null, p50Ms: null, p90Ms: null, timesEstimatedRuns: 0 },
    lockWait: { merges: null, p50Ms: null, p90Ms: null, bins: [] },
    shared: { files: null, everyHolderTold: null, agreed: null, agreedBeforeMerge: null, withoutAgreement: null, estimatedRuns: 0 },
    flags: null,
    runsWithoutFlag: null,
    conflicts: { known: null, inShared: null, unknownMerges: null },
    brainstorm: { notRecorded: 0, questionsSettled: 1, questions: 2, exchangesMedian: 4, objectedThenAgreed: 1, sourcedShare: 5 / 8, claimsWithSource: { n: 5, of: 8 }, silentSeats: 0 },
  }, [null]),
  files: [],
  silentAfterMs: SILENT_AFTER_MS,
};

// ── A plan run before the records: The old login (run 8) ────────────────────────────────

const OLD_RUN: RunStats = {
  run: 8,
  kind: "plan",
  code: "OL",
  title: "The old login",
  openedAt: at("09:00"),
  closedAt: at("10:00"),
  lengthMs: 60 * MIN,
  recorded: false,
  firstMergeAtMs: null,
  racesLost: null,
  members: [member("old-login/S1", "Quiet Llama", "09:00", { ended: at("10:00"), posts: 6, waitingMs: null })],
  // its slices and shared files estimated from its members' rows and claims (D44)
  plan: {
    slices: { merged: 1, of: 2, addedMidRun: 0, timesMs: [55 * MIN], timesEstimated: true },
    lock: { waitsMs: [], racesLost: [] },
    shared: {
      files: 1,
      everyHolderTold: 1,
      agreed: 0,
      agreedBeforeMerge: null,
      perFile: [{ path: "src/old-login.ts", holders: ["old-login/S1", "old-login/S2"], told: true, agreement: null, agreedAfterMs: null, conflict: null, interface: false }],
      estimated: true,
    },
    flags: 0,
    conflicts: { known: null, inShared: null, unknownMerges: null },
  },
};
export const UNRECORDED_RUN: Stats = {
  scope: { repo: APP, run: 8 },
  runs: [OLD_RUN],
  totals: totals({
    notRecorded: 1,
    members: 1,
    silentMembers: null,
    slices: { merged: 1, of: 2, p50Ms: 55 * MIN, p90Ms: 55 * MIN, timesEstimatedRuns: 1 },
    lockWait: { merges: null, p50Ms: null, p90Ms: null, bins: [] },
    shared: { files: 1, everyHolderTold: 1, agreed: 0, agreedBeforeMerge: null, withoutAgreement: 1, estimatedRuns: 1 },
    conflicts: { known: null, inShared: null, unknownMerges: null },
  }, [null]),
  files: [],
  silentAfterMs: SILENT_AFTER_MS,
};

// ── A plan run before the records read from its board events: The old signup (run 9) ─────────

const EVENTS_RUN: RunStats = {
  ...OLD_RUN,
  run: 9,
  code: "OS",
  title: "The old signup",
  firstMergeAtMs: 20 * MIN,
  // its spans read from its `joined`, `merged` and `ended` events, estimated (D45)
  members: [
    member("old-signup/S1", "Quiet Llama", "09:00", {
      ended: at("09:25"),
      waitingMs: null,
      estimated: true,
      intervals: [
        { from: at("09:00"), to: at("09:20"), what: "working", inferred: true },
        { from: at("09:20"), to: at("09:20"), what: "merging", inferred: true },
      ],
    }),
    member("old-signup/S2", "Shy Otter", "09:05", {
      ended: at("09:50"),
      waitingMs: null,
      estimated: true,
      intervals: [{ from: at("09:05"), to: at("09:50"), what: "working", inferred: true }],
    }),
  ],
  plan: { ...OLD_RUN.plan!, slices: { merged: 1, of: 2, addedMidRun: 0, timesMs: [20 * MIN, 45 * MIN], timesEstimated: true }, shared: { ...OLD_RUN.plan!.shared, agreedBeforeMerge: 0 } },
};
export const EVENTS_READ_RUN: Stats = { ...UNRECORDED_RUN, scope: { repo: APP, run: 9 }, runs: [EVENTS_RUN] };

// ── An open plan run: Sessions with refresh tokens (run 1), its spans to now ───────────────

export const OPEN_RUN: Stats = {
  ...PLAN_RUN,
  scope: { repo: APP, run: 1 },
  runs: [{ ...LP_RUN, run: 1, code: "RT", title: "Sessions with refresh tokens", openedAt: at("14:00"), closedAt: null, lengthMs: 14 * MIN, members: [] }],
};

// ── The across view: the closed runs of the last 30 days ─────────────────────────────────

/** Four runs, oldest first, the second before the records: summing their flags gives 1, their conflicts 1,
 *  their shared files 2; counting them gives 3 plan runs and 1 brainstorm. Every totals figure says otherwise. */
export const ACROSS: Stats = {
  scope: { repo: APP, since: "30d", closedOnly: true },
  runs: [LP_RUN, OLD_RUN, { ...LP_RUN, run: 9, code: "SE", title: "Settings", members: [LP_S4] }, TT_RUN],
  totals: totals(
    {
      runs: 14,
      byKind: { plan: 11, brainstorm: 3 },
      notRecorded: 1,
      members: 37,
      silentMembers: null,
      slices: { merged: 29, of: 33, p50Ms: 17 * MIN, p90Ms: 41 * MIN, timesEstimatedRuns: 1 },
      lockWait: { merges: 23, p50Ms: 4 * MIN + 10_000, p90Ms: 9 * MIN, bins: [6, 5, 7, 3, 2] },
      shared: { files: 9, everyHolderTold: 8, agreed: 6, agreedBeforeMerge: 4, withoutAgreement: 3, estimatedRuns: 1 },
      flags: 7,
      runsWithoutFlag: 5,
      conflicts: { known: 5, inShared: 3, unknownMerges: 2 },
    },
    // one point per run; the run before the records is a gap
    [2, null, 4, 5],
  ),
  files: [],
  silentAfterMs: SILENT_AFTER_MS,
};

/** The same scope with every merge's conflicts known. */
export const ACROSS_ALL_KNOWN: Stats = { ...ACROSS, totals: { ...ACROSS.totals, conflicts: { known: 5, inShared: 3, unknownMerges: 0 } } };

/** No closed run in the scope. */
export const ACROSS_EMPTY: Stats = {
  scope: { repo: APP, since: "30d", closedOnly: true },
  runs: [],
  totals: totals({ runs: 0, byKind: { plan: 0, brainstorm: 0 }, members: null }, []),
  files: [],
  silentAfterMs: SILENT_AFTER_MS,
};

/** A body as the server sends it, spaced as no re-serialization would space it: Copy as JSON must copy it unchanged. */
export const bodyOf = (stats: Stats): string => `${JSON.stringify(stats, null, 3)}\n`;
