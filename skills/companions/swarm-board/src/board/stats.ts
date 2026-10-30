// The calculation behind `swarm stats` and the Analytics views: internal to the board, imported by
// board.ts only. The core's figures (runs, seats, messages, phases, a brainstorm's debate) are computed here; each
// pack's figures come from its `StatsFigures`, placed where the core says (board-split#D15). Reads the store, never git or the CLI. Every figure is nullable
// (D34): null means not recorded or not computed yet, never 0; a list may be empty. A run with a
// run_stats row is read whole from it (D20); an open run, or a closed one with none, is computed from
// the raw rows (D21, D22). A brainstorm run's debate comes from its messages alone, so a run before the
// records still carries it (D4, D33).
import type { DatabaseSync } from "node:sqlite";
import { registry } from "../packs/registry.ts";
import type { RunId } from "./board.ts";
import { type Kind, profileOf } from "./kinds.ts";
import { planCode } from "./mentions.ts";
import { firstLine, iso, ms, percentile, sumKnown, type Row } from "./stats-math.ts";

export type StatsScope = { repo: string; run?: RunId; since?: string /* "30d" | ISO; absent: every run kept */; kinds?: Kind[]; closedOnly?: boolean };
export type Interval = { from: string; to: string; what: "working" | "silent" | "waiting" | "merging"; inferred: boolean };
/** `what`: the core's agreement, endorsed and objected, or a pack's own mark. */
export type Mark = { at: string; what: string; seq?: number; path?: string; note: string };
export type MemberStats = {
  member: string;
  nick: string;
  seat: string;
  joined: string;
  ended: string | null;
  intervals: Interval[];
  marks: Mark[];
  posts: number | null;
  postTimes: string[];
  unsourced: number | null /* posts without a source, D23 */;
  /** Its agreements posted (D40). */
  agreementsMade: number | null;
  /** A brainstorm run's: its endorsements of agreements on a `D<n>`, any seat's (D46), and its objections (inferred, D23); null on
   *  a plan run, which computes neither (D40). */
  endorsed: number | null;
  objections: number | null;
  /** True: its intervals and time read from the board's events, the calls not kept (D45); false on a recorded run. */
  estimated: boolean;
};
/** A question `D<n>`, from the `about` of the posts and agreements (D4). `outcome`: the first agreement on it the skeptic
 *  endorsed, at that agreement's time and seq; none, null (D30; no escalation until D26). `exchanges`: the seats' `msg`,
 *  `urgent` and `agreement` posts about it strictly before its outcome's agreement, events not (D33, D46). */
export type QuestionStats = { id: string /* D<n> */; firstPost: string; outcome: { at: string; seq: number; kind: "agreed" } | null; exchanges: number | null };
export type BrainstormRunStats = {
  /** Ordered by first post. */
  questions: QuestionStats[];
  /** The agreements about a `D<n>`; `endorsed`: the skeptic's endorsements of them (D30); each seat's own, `MemberStats.endorsed` (D46). */
  agreements: number | null;
  endorsed: number | null;
  /** Inferred (D23). A claim: a member's `msg` or `urgent` post about a `D<n>`, up to its outcome. It carries a source when
   *  its body holds `file:line` (`<name>.<ext>:<digits>`), `#<digits>` or an `http://` / `https://` URL; a source named in
   *  words reads unsourced, and counts in its author's `unsourced`. An objection (a mark `objected`): the skeptic's
   *  `msg` or `urgent` post about a `D<n>` when the latest agreement on it, by another member, was not yet endorsed by the
   *  skeptic at the post's time (D46). */
  claimsWithSource: { n: number | null; of: number | null; inferred: true }; // AGENTS EXCEPTION (rule D24): `claimsWithSource` is a debate's claims (its points made), not the code pack's; a `stats --json` key, frozen
};
export type RunStats = {
  run: RunId;
  kind: Kind;
  code: string;
  title: string;
  openedAt: string;
  closedAt: string | null;
  /** To its close, or to now for an open run. */
  lengthMs: number | null;
  recorded: boolean; // false: opened before the store's records-since; its new-record figures null
  members: MemberStats[];
  brainstorm?: BrainstormRunStats;
};
export type Totals = {
  runs: number | null;
  byKind: { plan: number | null; brainstorm: number | null };
  notRecorded: number | null;
  members: number | null;
  silentMembers: number | null;
    brainstorm: {
    /** The scope's brainstorm runs before the records, whose silent seats are unknown; null with no brainstorm run. */
    notRecorded: number | null;
    questionsSettled: number | null;
    questions: number | null;
    exchangesMedian: number | null;
    objectedThenAgreed: number | null;
    sourcedShare: number | null /* 0–1 */;
    /** The share's numerator and denominator, summed over the debated runs (D35). */
    claimsWithSource: { n: number | null; of: number | null }; // AGENTS EXCEPTION (rule D24): `claimsWithSource` is a debate's claims (its points made), not the code pack's; a `stats --json` key, frozen
    silentSeats: number | null;
  };
  /** One point per run, as `runs`; null: not recorded, a gap (D32); an estimated figure is a point (D44). A pack's
   *  series come before the core's. */
  series: Record<"silentMembers", (number | null)[]>;
};
/** `files`: what the packs read across the runs (the code pack's files members met in). */
export type Stats = { scope: StatsScope; runs: RunStats[] /* oldest first */; totals: Totals; files: unknown[]; silentAfterMs: number };

/** An exact span of a member's timeline, a pack's: it wins over the inferred ones, the first listed over the rest. */
export type TimelineSpan = { from: number; to: number; what: Interval["what"] };
/** What a pack reads a run's figures from: the run's row, its members and messages, as the core read them. */
export type RunFigureInput = {
  db: DatabaseSync;
  run: Row;
  people: Row[];
  messages: Row[];
  recorded: boolean;
  runOver: number;
  orchestrators: Set<number>;
  nameOf: (p: Row) => string;
};
/** A member's figures from a pack: its exact spans and marks, its estimated timeline before the records (null: the
 *  core's), its fields placed after `postTimes` (`counts`) and after `unsourced` (`late`). */
export type MemberFigures = { spans: TimelineSpan[]; marks: Mark[]; estimated: Interval[] | null; counts: Record<string, unknown>; late: Record<string, unknown> };
/** A pack's part of `swarm stats` (board-split#D15): its fields on each run, member and the totals, and its files. */
export interface StatsFigures {
  ofRun(input: RunFigureInput): {
    member(p: Row, window: { joined: number; over: number; endCalls: number[] }): MemberFigures;
    /** Placed after `recorded`. */
    runFields(): Record<string, unknown>;
    /** Placed after `members`; null: none for this run. */
    kindFields(): Record<string, unknown> | null;
  };
  /** A stored or computed run's pack figures filled where a summary lacks them. */
  fill(run: RunStats): RunStats;
  /** Placed after `silentMembers`; `series` before the core's. */
  totals(runs: RunStats[]): { fields: Record<string, unknown>; series: Record<string, (number | null)[]> };
  files(runs: RunStats[]): unknown[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** The settings row the board writes when the analytics records begin (D33). */
const RECORDS_SINCE = "records-since";
const ORCHESTRATOR = "orchestrator";
/** The seat id of a brainstorm's skeptic (D30). */
const SKEPTIC = "skeptic";
/** A brainstorm question's `about` (D4). */
const QUESTION = /^D\d+$/;
/** A post is sourced when it carries file:line, #id or a URL (D23). */
const SOURCE = /[\w./\\-]+\.\w+:\d+|#\d+|https?:\/\/\S+/;
/** The period's start, ISO: `<n>d` back from now, or an ISO time; absent, no start. */
function periodStart(since: string | undefined): string | null {
  if (since === undefined) return null;
  const days = since.match(/^(\d+)d$/);
  const at = days ? Date.now() - Number(days[1]) * DAY_MS : Date.parse(since);
  if (Number.isNaN(at)) throw new Error(`since takes <n>d or an ISO time, got ${since}`);
  return new Date(at).toISOString();
}

type Span = TimelineSpan;

/** The member's timeline (board D9, D12): the packs' spans exact, working and silent inferred,
 *  silent being the whole gap between two calls longer than `silentAfterMs` (D33). */
function timeline(joined: number, over: number, calls: number[], exact: Span[], silentAfterMs: number): Interval[] {
  if (!(over > joined)) return [];
  const points = [joined, ...calls.filter((c) => c > joined && c < over), over].sort((a, b) => a - b);
  const silent: Span[] = [];
  for (let i = 1; i < points.length; i++) if (points[i] - points[i - 1] > silentAfterMs) silent.push({ from: points[i - 1], to: points[i], what: "silent" });
  const clip = (t: number): number => Math.min(over, Math.max(joined, t));
  const bounds = [...new Set([joined, over, ...[...exact, ...silent].flatMap((s) => [clip(s.from), clip(s.to)])])].sort((a, b) => a - b);
  const inside = (spans: Span[], what: Interval["what"], at: number): boolean => spans.some((s) => s.what === what && s.from <= at && at < s.to);
  const out: Interval[] = [];
  for (let i = 1; i < bounds.length; i++) {
    const from = bounds[i - 1];
    const to = bounds[i];
    const mid = (from + to) / 2;
    // the exact spans win over the inferred ones, the first listed over the rest
    const what: Interval["what"] = exact.find((s) => s.from <= mid && mid < s.to)?.what ?? (inside(silent, "silent", mid) ? "silent" : "working");
    const last = out[out.length - 1];
    if (last && last.what === what && ms(last.to) === from) last.to = iso(to);
    else out.push({ from: iso(from), to: iso(to), what, inferred: what === "working" || what === "silent" });
  }
  return out;
}

/** The packs whose figures `swarm stats` carries: every registered pack's, a member's and the totals on every run; a run's
 *  own block its kind's pack's alone (V-19). */
const statsPacks = (): StatsFigures[] => registry.statsFigures();

/** The run's figures computed from the raw rows; `now` ends an open run and a member still there. Reads, never writes. */
function computeRun(db: DatabaseSync, r: Row, now: number, silentAfterMs: number): RunStats {
  const id = Number(r.id);
  const kind = profileOf(String(r.kind ?? "plan")).kind;
  const openedAt = String(r.opened_at);
  const closedAt = r.closed_at == null ? null : String(r.closed_at);
  const runOver = closedAt ? ms(closedAt) : now;
  const since = db.prepare("SELECT value FROM settings WHERE name = ?").get(RECORDS_SINCE) as Row | undefined;
  // opened before the records began: its new-record figures null (D32, D33)
  const recorded = since !== undefined && ms(openedAt) >= ms(since.value);

  const people = db.prepare("SELECT * FROM participants WHERE run = ? ORDER BY id").all(id) as Row[];
  const ids = people.map((p) => Number(p.id));
  const marks = ids.map(() => "?").join(", ") || "NULL";
  const nameOf = (p: Row): string => `${r.plan}/${p.seat}`;
  const messages = db.prepare(`SELECT * FROM messages WHERE run = ? OR (run IS NULL AND author IN (${marks})) ORDER BY seq`).all(id, ...ids) as Row[];
  const orchestrators = new Set(people.filter((p) => String(p.seat) === ORCHESTRATOR).map((p) => Number(p.id)));
  const packRuns = statsPacks().map((f) => f.ofRun({ db, run: r, people, messages, recorded, runOver, orchestrators, nameOf }));
  // V-19 (D66): the run-level figures (merges, the lock, conflicts) are its kind's pack's alone; a brainswarm carries none
  const kindPacks = new Set(registry.statsFiguresFor(kind));
  const kindPackRuns = packRuns.filter((_, i) => kindPacks.has(statsPacks()[i]));

  const members: MemberStats[] = people.map((p) => {
    const pid = Number(p.id);
    const joined = ms(p.joined_at);
    const over = Math.min(p.ended_at == null ? runOver : ms(p.ended_at), Math.max(now, joined));
    const calls = recorded ? (db.prepare("SELECT at, verb FROM call_log WHERE participant = ? ORDER BY at").all(pid) as Row[]) : [];
    const endCalls = calls.filter((c) => c.verb === "end").map((c) => ms(c.at));
    const figures = packRuns.map((f) => f.member(p, { joined, over, endCalls }));
    const own = messages.filter((m) => Number(m.author) === pid);
    const posts = own.filter((m) => m.kind !== "event" && Number(m.by_board ?? 0) === 0);
    const memberMarks: Mark[] = [
      ...figures.flatMap((f) => f.marks),
      ...own.filter((x) => x.kind === "agreement").map((m) => ({
        at: String(m.at),
        what: "agreement",
        seq: Number(m.seq),
        ...(m.about != null ? { path: String(m.about) } : {}),
        note: firstLine(String(m.body)),
      })),
    ].sort((a, b) => ms(a.at) - ms(b.at));
    const working: Interval[] = over > joined ? [{ from: iso(joined), to: iso(over), what: "working", inferred: true }] : [];
    return {
      member: nameOf(p),
      nick: p.nick == null ? String(p.seat) : String(p.nick),
      seat: String(p.seat),
      joined: String(p.joined_at),
      ended: p.ended_at == null ? null : String(p.ended_at),
      intervals: recorded
        ? timeline(joined, over, calls.map((c) => ms(c.at)), figures.flatMap((f) => f.spans), silentAfterMs)
        : (figures.find((f) => f.estimated !== null)?.estimated ?? working),
      marks: memberMarks,
      posts: posts.length,
      postTimes: posts.map((m) => String(m.at)),
      ...Object.assign({}, ...figures.map((f) => f.counts)),
      unsourced: posts.filter((m) => !SOURCE.test(String(m.body))).length,
      ...Object.assign({}, ...figures.map((f) => f.late)),
      // read from its spans and marks once they are whole, below (D40)
      agreementsMade: null,
      endorsed: null,
      objections: null,
      estimated: !recorded,
    };
  });

  const length = runOver - ms(openedAt);
  const base: RunStats = {
    run: id,
    kind,
    code: planCode(String(r.plan)),
    title: String(r.title),
    openedAt,
    closedAt,
    lengthMs: Number.isNaN(length) ? null : length,
    recorded,
    ...Object.assign({}, ...kindPackRuns.map((f) => f.runFields())),
    members,
  };
  if (kind === "brainstorm") {
    const { brainstorm, marksOf, unsourcedOf } = debateOf(db, id, people.filter((p) => !orchestrators.has(Number(p.id))), messages);
    members.forEach((m, i) => {
      const pid = Number(people[i].id);
      m.marks = [...m.marks, ...(marksOf.get(pid) ?? [])].sort((a, b) => ms(a.at) - ms(b.at));
      // a brainstorm member's unsourced: its claims without a source (D23, D29)
      m.unsourced = unsourcedOf.get(pid) ?? 0;
    });
    return { ...base, brainstorm };
  }
  return { ...base, ...Object.assign({}, ...kindPackRuns.map((f) => f.kindFields() ?? {})) };
}

/** The skeptic's participant ids (D30): the seat with id `skeptic`, else the first seat whose row subscribes to `agreement`. */
function skepticOf(db: DatabaseSync, run: RunId, seats: Row[]): Set<number> {
  const seated = (seat: string): Set<number> => new Set(seats.filter((p) => String(p.seat) === seat).map((p) => Number(p.id)));
  const named = seated(SKEPTIC);
  if (named.size) return named;
  const rows = db.prepare("SELECT id, on_events FROM seats WHERE run = ? AND on_events IS NOT NULL ORDER BY ord").all(run) as Row[];
  const subscribesToAgreement = (row: Row): boolean =>
    (JSON.parse(String(row.on_events)) as string[]).flatMap((e) => e.split(",")).some((e) => e.trim().replace(/^(any|main):/, "") === "agreement");
  const subscribed = rows.find(subscribesToAgreement);
  return subscribed ? seated(String(subscribed.id)) : new Set();
}

/** A brainstorm run's debate, from its messages in seq order (D4, D23, D29, D30, D33, D46): its block, each seat's marks
 *  `endorsed` and the skeptic's `objected` by participant id, and each member's claims without a source by participant id. */
function debateOf(
  db: DatabaseSync,
  run: RunId,
  seats: Row[],
  messages: Row[],
): { brainstorm: BrainstormRunStats; marksOf: Map<number, Mark[]>; unsourcedOf: Map<number, number> } {
  const skeptic = skepticOf(db, run, seats);
  const seatIds = new Set(seats.map((p) => Number(p.id)));
  const questionOf = (m: Row): string | null => {
    const about = m.about == null ? "" : String(m.about).trim();
    return QUESTION.test(about) ? about : null;
  };
  // what a member says itself: a post or an agreement, never an event or the board's own line
  const spoken = (m: Row): boolean => Number(m.by_board ?? 0) === 0 && (m.kind === "msg" || m.kind === "urgent" || m.kind === "agreement");
  const bySeq = new Map(messages.map((m) => [Number(m.seq), m]));

  // every seat's endorsements of agreements on a question (D46); the skeptic's, by the seq it endorsed at (D30): a
  // question's outcome is its first agreement the skeptic endorsed
  const endorsements: { endorsement: Row; question: string }[] = [];
  const skepticEndorsedAt = new Map<number, number>();
  for (const m of messages) {
    if (m.kind !== "endorsement" || m.endorses == null) continue;
    const agreement = bySeq.get(Number(m.endorses));
    const question = agreement && agreement.kind === "agreement" ? questionOf(agreement) : null;
    if (question === null) continue;
    endorsements.push({ endorsement: m, question });
    if (skeptic.has(Number(m.author)) && !skepticEndorsedAt.has(Number(m.endorses))) skepticEndorsedAt.set(Number(m.endorses), Number(m.seq));
  }
  const endorsedSeqs = new Set(skepticEndorsedAt.keys());
  const skepticEndorsements = endorsements.filter(({ endorsement }) => skeptic.has(Number(endorsement.author)));
  /** The skeptic had endorsed the agreement `agreementSeq` before the post at `seq`. */
  const endorsedBefore = (agreementSeq: number, seq: number): boolean => (skepticEndorsedAt.get(agreementSeq) ?? Infinity) < seq;
  const outcomeOf = new Map<string, Row>();
  for (const m of messages) {
    const q = questionOf(m);
    if (q !== null && m.kind === "agreement" && endorsedSeqs.has(Number(m.seq)) && !outcomeOf.has(q)) outcomeOf.set(q, m);
  }

  const questions = new Map<string, QuestionStats>();
  const marksOf = new Map<number, Mark[]>();
  const unsourcedOf = new Map<number, number>();
  const mark = (pid: number, x: Mark): void => void marksOf.set(pid, [...(marksOf.get(pid) ?? []), x]);
  const lastAgreementOn = new Map<string, Row>();
  let agreements = 0;
  let sourced = 0;
  let pointsMade = 0;
  for (const m of messages) {
    const q = questionOf(m);
    if (q === null || !spoken(m)) continue;
    const author = Number(m.author);
    const question = questions.get(q) ?? { id: q, firstPost: String(m.at), outcome: null, exchanges: 0 };
    questions.set(q, question);
    const outcome = outcomeOf.get(q);
    // the outcome's own agreement is no exchange (D46)
    const beforeOutcome = !outcome || Number(m.seq) < Number(outcome.seq);
    if (beforeOutcome && seatIds.has(author)) question.exchanges = (question.exchanges ?? 0) + 1;
    if (m.kind === "agreement") {
      agreements++;
      lastAgreementOn.set(q, m);
      continue;
    }
    if (beforeOutcome) {
      pointsMade++;
      if (SOURCE.test(String(m.body))) sourced++;
      else unsourcedOf.set(author, (unsourcedOf.get(author) ?? 0) + 1);
    }
    // an objection, inferred: the skeptic speaks on a question while another's latest agreement on it is not yet endorsed
    // by the skeptic (D23, D46)
    const last = lastAgreementOn.get(q);
    if (skeptic.has(author) && last && Number(last.author) !== author && !endorsedBefore(Number(last.seq), Number(m.seq))) {
      mark(author, { at: String(m.at), what: "objected", seq: Number(m.seq), path: q, note: `objects to #${last.seq}: ${firstLine(String(m.body))}` });
    }
  }
  for (const { endorsement, question } of endorsements) {
    mark(Number(endorsement.author), { at: String(endorsement.at), what: "endorsed", seq: Number(endorsement.seq), path: question, note: `endorses #${endorsement.endorses}` });
  }
  for (const [q, outcome] of outcomeOf) {
    const question = questions.get(q);
    if (question) question.outcome = { at: String(outcome.at), seq: Number(outcome.seq), kind: "agreed" };
  }
  return {
    brainstorm: {
      questions: [...questions.values()].sort((a, b) => ms(a.firstPost) - ms(b.firstPost)),
      agreements,
      endorsed: skepticEndorsements.length,
      claimsWithSource: { n: sourced, of: pointsMade, inferred: true }, // AGENTS EXCEPTION (rule D24): the frozen `stats --json` key
    },
    marksOf,
    unsourcedOf,
  };
}

/** The run with each member's own figures (D40), read from the member's spans and marks: those a summary carries
 *  are kept, those it lacks (a summary from before) filled, so a stored run reads as a computed one; then each pack's. */
function withMemberFigures(run: RunStats): RunStats {
  const debated = run.brainstorm !== undefined;
  const marked = (m: MemberStats, what: Mark["what"]): number => m.marks.filter((x) => x.what === what).length;
  const members = run.members.map((m) => ({
    ...m,
    agreementsMade: m.agreementsMade ?? marked(m, "agreement"),
    endorsed: m.endorsed ?? (debated ? marked(m, "endorsed") : null),
    objections: m.objections ?? (debated ? marked(m, "objected") : null),
    // a summary from before the events were read (D45) reads its member as not estimated
    estimated: m.estimated ?? false,
  }));
  return statsPacks().reduce<RunStats>((filled, f) => f.fill(filled), { ...run, members });
}

/** A run kept: not pruned, or pruned with its summary kept (D21). */
const KEPT = "(pruned_at IS NULL OR id IN (SELECT run FROM run_stats))";

/** A closed run's summary, for its run_stats row (D20); the caller stores it. Reads, never writes. */
export function summarize(db: DatabaseSync, run: RunId, silentAfterMs: number): RunStats {
  const r = db.prepare("SELECT * FROM runs WHERE id = ?").get(run) as Row | undefined;
  if (!r) throw new Error(`no run ${run}`);
  return withMemberFigures(computeRun(db, r, Date.now(), silentAfterMs));
}

/** The scope's totals, from its runs' figures alone, stored or computed alike (D28, D34). */
function totalsOf(runs: RunStats[]): Totals {
  const recorded = runs.filter((r) => r.recorded);
  const silentOf = (r: RunStats): number => r.members.filter((m) => m.intervals.some((i) => i.what === "silent")).length;
  // one point per run; a run before the records is a gap (D32)
  const series = (figure: (r: RunStats) => number | null): (number | null)[] => runs.map((r) => (r.recorded ? figure(r) : null));
  const packTotals = statsPacks().map((f) => f.totals(runs));
  return {
    runs: runs.length,
    byKind: { plan: runs.filter((r) => r.kind === "plan").length, brainstorm: runs.filter((r) => r.kind === "brainstorm").length },
    notRecorded: runs.length - recorded.length,
    members: runs.length ? runs.reduce((n, r) => n + r.members.length, 0) : null,
    silentMembers: sumKnown(recorded.map(silentOf)),
    ...Object.assign({}, ...packTotals.map((t) => t.fields)),
    brainstorm: brainstormTotalsOf(runs),
    series: {
      ...Object.assign({}, ...packTotals.map((t) => t.series)),
      silentMembers: series(silentOf),
    },
  };
}

/** The brainstorm figures over the scope's brainstorm runs with a debate block; null where none is (D34). */
function brainstormTotalsOf(runs: RunStats[]): Totals["brainstorm"] {
  const debated = runs.flatMap((r) => (r.brainstorm ? [{ run: r, debate: r.brainstorm }] : []));
  const questions = debated.flatMap((d) => d.debate.questions);
  const settled = questions.filter((q) => q.outcome !== null);
  // a question objected then agreed: the skeptic objected on it before the agreement that settled it
  const objectedOf = (r: RunStats, q: QuestionStats): boolean =>
    q.outcome !== null && r.members.some((m) => m.marks.some((x) => x.what === "objected" && x.path === q.id && x.seq !== undefined && x.seq < q.outcome!.seq));
  const n = sumKnown(debated.map((d) => d.debate.claimsWithSource.n)); // AGENTS EXCEPTION (rule D24): the frozen `stats --json` key
  const of = sumKnown(debated.map((d) => d.debate.claimsWithSource.of)); // AGENTS EXCEPTION (rule D24): the frozen `stats --json` key
  // the seats (the orchestrator is none) with a silent interval, over the runs whose intervals are recorded
  const silentSeatsOf = (r: RunStats): number => r.members.filter((m) => m.seat !== ORCHESTRATOR && m.intervals.some((i) => i.what === "silent")).length;
  const brainstorms = runs.filter((r) => r.kind === "brainstorm");
  return {
    notRecorded: brainstorms.length ? brainstorms.filter((r) => !r.recorded).length : null,
    questionsSettled: debated.length ? settled.length : null,
    questions: debated.length ? questions.length : null,
    exchangesMedian: percentile(settled.flatMap((q) => (q.exchanges === null ? [] : [q.exchanges])), 0.5),
    objectedThenAgreed: debated.length ? debated.reduce((k, d) => k + d.debate.questions.filter((q) => objectedOf(d.run, q)).length, 0) : null,
    sourcedShare: n === null || !of ? null : n / of,
    claimsWithSource: { n, of }, // AGENTS EXCEPTION (rule D24): the frozen `stats --json` key
    silentSeats: sumKnown(debated.filter((d) => d.run.recorded).map((d) => silentSeatsOf(d.run))),
  };
}

/** The scope's runs, oldest first, in one read (D22): a run with a run_stats row read whole from it, pruned or not;
 *  the rest computed. Throws on an unknown run or kind, or an unreadable since. `silentAfterMs`: the board's silent rule (board D12). */
export function statsOf(db: DatabaseSync, scope: StatsScope, silentAfterMs: number): Stats {
  for (const k of scope.kinds ?? []) profileOf(k);
  const start = periodStart(scope.since);
  const where = ["repo = ?", KEPT];
  const params: (string | number)[] = [scope.repo];
  if (scope.run !== undefined) {
    where.push("id = ?");
    params.push(scope.run);
  }
  if (scope.kinds?.length) {
    where.push(`kind IN (${scope.kinds.map(() => "?").join(", ")})`);
    params.push(...scope.kinds);
  }
  if (scope.closedOnly) where.push("state = 'closed'");
  if (start) {
    where.push("(state = 'open' OR closed_at >= ?)");
    params.push(start);
  }
  db.exec("BEGIN");
  try {
    if (scope.run !== undefined && !db.prepare(`SELECT 1 FROM runs WHERE id = ? AND repo = ? AND ${KEPT}`).get(scope.run, scope.repo)) {
      throw new Error(`no run ${scope.run}`);
    }
    const rows = db.prepare(`SELECT * FROM runs WHERE ${where.join(" AND ")} ORDER BY opened_at, id`).all(...params) as Row[];
    const stored = db.prepare("SELECT body FROM run_stats WHERE run = ?");
    const now = Date.now();
    const runs = rows.map((r) => {
      const row = stored.get(Number(r.id)) as Row | undefined;
      return withMemberFigures(row ? (JSON.parse(String(row.body)) as RunStats) : computeRun(db, r, now, silentAfterMs));
    });
    return { scope, runs, totals: totalsOf(runs), files: statsPacks().flatMap((f) => f.files(runs)), silentAfterMs };
  } finally {
    db.exec("COMMIT");
  }
}
