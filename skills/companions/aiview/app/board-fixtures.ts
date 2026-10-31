// The prototype's "live" variant (2026-10-07-swarm-board.prototype.html) as the Board would return
// it: two plans and a brainstorm open on one repository, two closed runs, a second repository.
import type { BoardSnapshot, RepoSummary, RunSummary, SnapshotEvent, SnapshotMember } from "../../swarm-board/src/client/reader.ts";

const at = (hm: string): string => {
  const [h, m] = hm.split(":").map(Number);
  return new Date(2026, 9, 7, h, m).toISOString();
};

export const APP = "/repos/swarmstorm-app/.git";
const RT = "refresh-tokens";
const AL = "audit-log";
const NM = "naming";
const LP = "login-page";
const TT = "theme-tokens";
/** Each run's id: every item is stored with its author's run (plan D1, D13). */
const RUN_OF: Record<string, number> = { [RT]: 1, [AL]: 2, [NM]: 3, [LP]: 4, [TT]: 5, landing: 7 };
const runOf = (name: string): number => RUN_OF[name.slice(0, name.lastIndexOf("/"))] ?? 0;

/** The members' funny names (D43), the orchestrators' included (plan D17), fixed here; the
 *  Board picks them at random. */
export const NICKS: Record<string, string> = {
  [`${RT}/orchestrator`]: "Calm Owl",
  [`${AL}/orchestrator`]: "Proud Lynx",
  [`${NM}/orchestrator`]: "Wise Crow",
  [`${LP}/orchestrator`]: "Gentle Bison",
  [`${TT}/orchestrator`]: "Swift Hare",
  [`${RT}/S2`]: "Lucky Moose",
  [`${RT}/S3`]: "Sleepy Otter",
  [`${RT}/S4`]: "Brave Badger",
  [`${RT}/S5`]: "Dizzy Puffin",
  [`${AL}/S1`]: "Jolly Walrus",
  [`${AL}/S2`]: "Quiet Llama",
  [`${NM}/critic`]: "Witty Heron",
  ["landing/S1"]: "Merry Finch",
};
const nickOf = (name: string): string => {
  const nick = NICKS[name];
  if (!nick) throw new Error(`fixtures: no funny name for ${name}`);
  return nick;
};

const member = (
  name: string,
  role: string,
  doing: string,
  state: SnapshotMember["state"],
  files: [string, boolean?][],
  joined: string,
  calls: number,
  ended: string | null = null,
  lastCall: string = ended ?? joined,
): SnapshotMember => {
  const i = name.lastIndexOf("/");
  return {
    member: name,
    badge: null,
    nick: nickOf(name),
    plan: name.slice(0, i),
    seat: name.slice(i + 1),
    role,
    doing,
    state,
    stale: false,
    files: files.map(([path, iface]) => ({ path, interface: !!iface, shared: false })),
    joined: at(joined),
    ended: ended === null ? null : at(ended),
    calls,
    listening: false,
    lastCall: at(lastCall),
  };
};

let seq = 0;
/** An item, stored with its author's run (plan D13); `channel` mirrors it, as the snapshot keeps it. */
const ev = (hm: string, kind: SnapshotEvent["kind"], from: string, body: string, about: string | null = null): SnapshotEvent => ({
  seq: ++seq,
  at: at(hm),
  kind,
  from,
  body,
  about,
  run: runOf(from),
  channel: runOf(from),
});
/** A board event, its name stored (D11). */
const named = (hm: string, from: string, event: NonNullable<SnapshotEvent["event"]>, body: string): SnapshotEvent => ({
  ...ev(hm, "event", from, body),
  event,
  mentions: [],
});

const RT_SLICES: [string, string, string, string[]][] = [
  ["S1", "Sessions table gains a token column", "ended", []],
  ["S2", "The token store", "ended", []],
  ["S3", "The Session interface carries the refresh token", "idle", []],
  ["S4", "The refresh endpoint", "idle", []],
  ["S5", "The client retries once on 401", "idle", []],
  ["S6", "Settings lists signed-in devices", "blocked", ["S3", "S5"]],
  ["S7", "A session survives expiry, end to end", "blocked", ["S4", "S5"]],
];
const AL_SLICES: [string, string, string, string[]][] = [
  ["S1", "The audit table and its writer", "idle", []],
  ["S2", "Every auth route writes an audit entry", "idle", []],
  ["S3", "The audit page", "blocked", ["S1"]],
];
/** The audit-log plan and its first slice carry their documents' links (D44); the rest none. */
export const AL_LINK = "http://localhost:4321/d/41";
export const AL_S1_LINK = "http://localhost:4321/d/42";
const queue = (plan: string, seats: [string, string, string, string[]][]) =>
  seats.map(([seat, role, state, blockers]) => ({
    seat,
    role,
    link: plan === AL && seat === "S1" ? AL_S1_LINK : null,
    state,
    blockers,
    member: state !== "empty" ? `${plan}/${seat}` : null,
  }));

export const RUNS: RunSummary[] = [
  { run: 1, kind: "plan", plan: RT, group: RT, code: "RT", title: "Sessions with refresh tokens", link: null, open: true, members: 4, done: 2, of: 7 },
  { run: 2, kind: "plan", plan: AL, group: AL, code: "AL", title: "Audit log", link: AL_LINK, open: true, members: 2, done: 0, of: 3 },
];

/** A brainstorm open beside the plans: its seats hold no file (D3). */
export const BRAINSTORM: RunSummary = { run: 3, kind: "brainstorm", plan: NM, group: NM, code: "NM", title: "Naming the kinds", link: null, open: true, members: 1, done: 0, of: 1 };

/** Runs of swarmstorm-app closed earlier: the Board lists them with the open ones (D34, D46). */
export const CLOSED: RunSummary[] = [
  { run: 4, kind: "plan", plan: LP, group: LP, code: "LP", title: "The login page", link: null, open: false, members: 0, done: 4, of: 4 },
  { run: 5, kind: "brainstorm", plan: TT, group: TT, code: "TT", title: "Theme tokens", link: null, open: false, members: 0, done: 2, of: 2 },
];

export const LIVE: BoardSnapshot = {
  repo: APP,
  name: "swarmstorm-app",
  runs: [...CLOSED, ...RUNS, BRAINSTORM],
  lock: null,
  lockHistory: [],
  roster: [
    member(`${RT}/S3`, "The Session interface carries the refresh token", "Adding refreshToken to Session, then its two readers", "working", [["src/auth/session.ts", true], ["src/auth/session.test.ts"]], "14:02", 31),
    member(`${RT}/orchestrator`, "", "7 slices prepared, 5 dispatched; S6 and S7 wait for their blockers", "working", [], "14:00", 0),
    member(`${AL}/orchestrator`, "", "3 slices prepared, 2 dispatched; S3 waits for S1", "working", [], "14:05", 0),
    member(`${RT}/S4`, "The refresh endpoint", "Writing POST /auth/refresh against the token store", "working", [["src/routes/auth.ts"], ["src/routes/refresh.test.ts"]], "14:02", 24),
    member(`${RT}/S5`, "The client retries once on 401", "Running the client tests", "working", [["web/http/client.ts"], ["web/http/client.test.ts"]], "14:10", 12),
    member(`${AL}/S1`, "The audit table and its writer", "Writing the migration for audit_entries", "working", [["src/audit/audit.ts", true], ["migrations/0042_audit.sql"]], "14:06", 15),
    member(`${AL}/S2`, "Every auth route writes an audit entry", "Adding audit() to the login and logout handlers", "working", [["src/routes/login.ts"]], "14:06", 11),
    member(`${RT}/S2`, "The token store", "merged and ended", "ended", [], "14:01", 9, "14:09"),
    member(`${NM}/critic`, "The critic", "Reading the names proposed", "working", [], "14:04", 3),
  ],
  events: [
    ev("13:18", "msg", `${LP}/S4`, "@orchestrator merged 9f0c1d2"),
    named("13:20", `${LP}/orchestrator`, "closed", "run 4 closed"),
    ev("13:40", "msg", `${TT}/critic`, "Two names per token, not three."),
    named("13:50", `${TT}/orchestrator`, "closed", "run 5 closed"),
    named("14:00", `${RT}/orchestrator`, "opened", "run 1 opened: plan refresh-tokens, Sessions with refresh tokens"),
    named("14:02", `${RT}/S3`, "joined", "joined: the Session interface"),
    ev("14:03", "msg", `${RT}/S3`, "@swarm I'm adding `refreshToken: string | null` to `Session`. Readers I know of: `web/http/client.ts`.", "src/auth/session.ts"),
    ev("14:04", "msg", `${NM}/critic`, "`kind` reads better than `type` on a run."),
    ev("14:05", "msg", `${RT}/S4`, "@S2 does `store.rotate()` return the new token or only write it?", "src/tokens/store.ts"),
    ev("14:06", "msg", `${RT}/S2`, "@S4 it returns it. Signature at `src/tokens/store.ts:12`.", "src/tokens/store.ts"),
    named("14:09", `${RT}/S2`, "merged", "merged a41c9e2: rebase onto a41c9e2.\nfiles: src/tokens/store.ts"),
    ev("14:12", "msg", `${AL}/S2`, "@RT·S4 I need one call at the top of every handler in `src/routes/auth.ts`. You hold it.", "src/routes/auth.ts"),
    ev("14:12", "msg", `${RT}/S4`, "@AL·S2 yes, I add it.", "src/routes/auth.ts"),
    ev("14:12", "agreement", `${RT}/S4`, "RT·S4 adds `audit(req, 'refresh')` in `src/routes/auth.ts`; AL·S2 does not touch the file.", "src/routes/auth.ts"),
    ev("14:13", "msg", `${RT}/S5`, "@S3 I read `Session` in the client. Is `expiresAt` staying a number?", "src/auth/session.ts"),
    ev("14:13", "msg", `${RT}/S3`, "@S5 yes, unchanged. Only the new field.", "src/auth/session.ts"),
  ],
  queues: { [RT]: queue(RT, RT_SLICES), [AL]: queue(AL, AL_SLICES) },
  files: [],
  flags: [],
};
// the claims, as the Board derives them: one holder each here
LIVE.files = LIVE.roster.flatMap((r) => r.files.map((f) => ({ path: f.path, holders: [r.member], interface: f.interface })));

/** The same repository with only the brainstorm and the closed runs: no claims, no merge lock (D3). */
export const BRAINSTORM_ONLY: BoardSnapshot = {
  ...LIVE,
  runs: [...CLOSED, BRAINSTORM],
  roster: LIVE.roster.filter((r) => r.plan === NM),
  events: LIVE.events.filter((e) => [3, 4, 5].includes(e.run)),
  queues: {},
  files: [],
};

/** The brainstorm in its phases: the orchestrator opened `diverge` (`swarm phase`), a separator in the
 *  thread mentioning every member of its run, its name stored in the meta. */
export const PHASE: SnapshotEvent = {
  ...ev("14:03", "event", `${NM}/orchestrator`, "phase diverge: every name a run could carry, no judgment yet"),
  event: "phase",
  mentions: [`${NM}/*`],
  meta: { phase: "diverge" },
};
export const PHASED: BoardSnapshot = {
  ...BRAINSTORM_ONLY,
  runs: BRAINSTORM_ONLY.runs.map((r) => (r.run === BRAINSTORM.run ? { ...r, phase: { name: "diverge", text: "every name a run could carry, no judgment yet" } } : r)),
  events: [...BRAINSTORM_ONLY.events, PHASE].sort((a, b) => a.at.localeCompare(b.at) || a.seq - b.seq),
};

/** The same repository once every run has closed: the page opens on the newest closed run. */
export const ALL_CLOSED: BoardSnapshot = { ...LIVE, runs: CLOSED, roster: [], queues: {}, files: [], lock: null };

/** A second repository on the board, one plan open: used by the board tests. */
export const OTHER = "/repos/swarmstorm-site/.git";
export const SITE: BoardSnapshot = {
  repo: OTHER,
  name: "swarmstorm-site",
  runs: [{ run: 7, kind: "plan", plan: "landing", group: "landing", code: "LA", title: "The landing page", link: null, open: true, members: 1, done: 0, of: 2 }],
  lock: null,
  lockHistory: [],
  roster: [member("landing/S1", "The hero", "Writing the hero", "working", [["site/hero.tsx"]], "14:03", 4)],
  events: [named("14:03", "landing/orchestrator", "opened", "run 7 opened: plan landing, The landing page")],
  queues: {},
  files: [{ path: "site/hero.tsx", holders: ["landing/S1"], interface: false }],
  flags: [],
};

/** The repositories as useBoard lists them. */
export const REPOS: RepoSummary[] = [
  { repo: APP, name: LIVE.name, runs: LIVE.runs },
  { repo: OTHER, name: SITE.name, runs: SITE.runs },
];

export const at1414 = at("14:14");
