// The analytics views as the page's URL keeps them (D31): the across-runs view's scope, a run tab's
// Analytics; the `/api/stats` route each asks, and how a figure and a run's line read. Formats and selects, never aggregates (D34, D35): a figure the JSON does not
// carry is not drawn here. Pure: no DOM, no fetch.
import type { Kind, RunStats, RunSummary, Totals } from "../../../../swarm-board/src/client/reader.ts";
import type { RunId } from "./view.ts";

/** "all": every run kept, `since` left out (D33). */
export type Period = "30d" | "7d" | "all";
export type AcrossScope = { period: Period; kinds: Kind[] /* never empty */ };

export const PERIODS: { value: Period; label: string }[] = [
  { value: "30d", label: "Last 30 days" },
  { value: "7d", label: "Last 7 days" },
  { value: "all", label: "Every run kept" },
];
export const KINDS: Kind[] = ["plan", "brainstorm"];
export const DEFAULT_SCOPE: AcrossScope = { period: "30d", kinds: KINDS };

/** The hash's fields, in order; a field without `=` kept as written. */
function fieldsOf(hash: string): [string, string | null][] {
  return hash
    .replace(/^#/, "")
    .split("&")
    .filter(Boolean)
    .map((part) => {
      const i = part.indexOf("=");
      return i < 0 ? [part, null] : [part.slice(0, i), decodeURIComponent(part.slice(i + 1))];
    });
}

/** The across view the hash opens, or null when it opens none: `across=1&period=7d&kinds=plan`.
 *  An unknown period or kind falls back to the default, never an error: a hash is typed by people. */
export function readAcross(hash: string): AcrossScope | null {
  const fields = new Map(fieldsOf(hash));
  if (fields.get("across") !== "1") return null;
  const period = PERIODS.find((p) => p.value === fields.get("period"))?.value ?? DEFAULT_SCOPE.period;
  const kinds = KINDS.filter((k) => (fields.get("kinds") ?? "").split(",").includes(k));
  return { period, kinds: kinds.length ? kinds : DEFAULT_SCOPE.kinds };
}

const ACROSS_KEYS = new Set(["across", "period", "kinds"]);
const RUN_VIEW_KEYS = new Set(["run", "view"]);

/** The hash with `keys` taken out and `added` put at its end, every other field kept: the document
 *  and the pointer stay where they are. Without the leading `#`. */
function hashWith(hash: string, keys: ReadonlySet<string>, added: string[]): string {
  const kept = fieldsOf(hash)
    .filter(([key]) => !keys.has(key))
    .map(([key, value]) => (value === null ? key : `${key}=${encodeURIComponent(value)}`));
  return [...kept, ...added].join("&");
}

/** The hash with the across view written in (null: taken out). */
export function hashWithAcross(hash: string, scope: AcrossScope | null): string {
  return hashWith(hash, ACROSS_KEYS, scope ? ["across=1", `period=${scope.period}`, `kinds=${scope.kinds.join(",")}`] : []);
}

/** A run tab's two views (D31): it opens on the conversation; Analytics is kept in the URL. */
export type RunView = "conversation" | "analytics";

/** The run whose Analytics the hash opens, `run=13&view=analytics`, or null: a run tab opens on
 *  its conversation, so only Analytics is written (D31). */
export function readRunAnalytics(hash: string): RunId | null {
  const fields = new Map(fieldsOf(hash));
  const run = Number(fields.get("run"));
  return fields.get("view") === "analytics" && Number.isInteger(run) && run > 0 ? run : null;
}

/** The run the hash names, `run=13`, on its Analytics or not; null when it names none. */
export function readRunInHash(hash: string): RunId | null {
  const run = Number(new Map(fieldsOf(hash)).get("run"));
  return Number.isInteger(run) && run > 0 ? run : null;
}

/** The hash's board fields, the run's and the across view's, as one key: a hashchange that leaves it equal moved
 *  nothing on the board (the document or its pointer moved). */
export function boardFieldsOf(hash: string): string {
  return fieldsOf(hash)
    .filter(([key]) => RUN_VIEW_KEYS.has(key) || ACROSS_KEYS.has(key))
    .map(([key, value]) => `${key}=${value ?? ""}`)
    .join("&");
}

/** The hash with a run's Analytics written in (null: taken out). */
export function hashWithRunAnalytics(hash: string, run: RunId | null): string {
  return hashWith(hash, RUN_VIEW_KEYS, run === null ? [] : [`run=${run}`, "view=analytics"]);
}

/** What a view asks `/api/stats` for: the across view's scope, or one run (its tab's Analytics). */
export type StatsAsk = AcrossScope | { run: RunId };

/** The route a view asks. The across view: closed runs only (D33); every kind sends none, so the body
 *  equals `swarm stats --repo <repo> --since 30d --closed --json` (or `--all`), a kind subset `--kind`
 *  (D34). One run: no period, so the body equals `swarm stats --repo <repo> --run <id> --all --json`. */
export function statsUrl(repo: string, ask: StatsAsk): string {
  if ("run" in ask) return `/api/stats?${new URLSearchParams({ project: repo, run: String(ask.run) }).toString()}`;
  const q = new URLSearchParams({ project: repo, since: ask.period });
  if (ask.kinds.length < KINDS.length) q.set("kind", ask.kinds.join(","));
  q.set("closedOnly", "1");
  return `/api/stats?${q.toString()}`;
}

/** The kinds with one turned on or off; the last one on stays on (D33). */
export function toggleKind(kinds: Kind[], kind: Kind): Kind[] {
  if (!kinds.includes(kind)) return KINDS.filter((k) => k === kind || kinds.includes(k));
  return kinds.length > 1 ? kinds.filter((k) => k !== kind) : kinds;
}

/** What a figure the store has no record of reads (plan US1, D34): never 0. */
export const NOT_RECORDED = "not recorded";

/** The tip of a figure estimated for a run before the records (D44), drawn as an inferred one (D23, D33). */
export const ESTIMATED_TIP = "Estimated: this run closed before analytics recorded it; read from its claims and members.";

/** The tip of a member's spans and time estimated from the board's events for a run before the records (D45). */
export const ESTIMATED_EVENTS_TIP = "Estimated: this run closed before analytics recorded it; read from its board events.";

/** A duration as the board writes it: "40s", "1m 50s" under ten minutes, "18m", "2h 42m"; floored, never rounded up,
 *  as `swarm stats` floors (D46). */
export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  if (m < 10) return s ? `${m}m ${String(s).padStart(2, "0")}s` : `${m}m`;
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** The inferred rule a sourced claim is counted by (plan D23). */
export const SOURCED_RULE = "Inferred: a post counts as sourced when it carries file:line, #id or a URL.";

/** A run's length as `swarm stats` writes it on the run's line, one rule in both (D46): floored to the minute, "14m",
 *  "2h 05m"; "40s" under a minute. */
export function runLength(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
  return minutes >= 1 ? `${minutes}m` : `${Math.round(ms / 1000)}s`;
}

/** A shared file's agreement as the funnel counts it (D38, D46): "agreed 2m after", "agreed before the tell", "none";
 *  a file not told to every holder says so, its agreement not counted. */
export function agreementText(file: { told: boolean; agreement: number | null; agreedAfterMs: number | null }): string {
  const agreed = file.agreement === null ? "none" : file.agreedAfterMs === null ? "agreed" : file.agreedAfterMs < 0 ? "agreed before the tell" : `agreed ${formatDuration(file.agreedAfterMs)} after`;
  return file.told ? agreed : `${file.agreement === null ? "none" : "agreed"} · not every holder told`;
}

/** A shared file the funnel counts without an agreement: none given, or its holders not all told (D38, D46). */
export const countedWithoutAgreement = (file: { told: boolean; agreement: number | null }): boolean => file.agreement === null || !file.told;

/** A nullable figure written, or "not recorded" (D34). */
export const figure = (n: number | null | undefined, write: (n: number) => string = String): string =>
  n === null || n === undefined ? NOT_RECORDED : write(n);

/** A share of two figures of one object, "78%" (D35); null when either is unknown or the whole is 0. */
export function share(part: number | null, whole: number | null): string | null {
  if (part === null || whole === null || whole === 0) return null;
  return `${Math.round((part / whole) * 100)}%`;
}

/** A difference of two figures of one object (D35); null when either is unknown. */
export const less = (from: number | null, minus: number | null): number | null => (from === null || minus === null ? null : from - minus);

/** A count with its noun agreeing in number, "1 run", "2 runs" (plan D38). */
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** A share 0–1 the JSON carries, written "89%" (D35). */
export const percent = (fraction: number): string => `${Math.round(fraction * 100)}%`;

const openOrClosed = (open: boolean): string => (open ? "open" : "closed");

/** A run tab's line under Analytics, from its figures: `plan · run 13 · closed · 9 of 9 slices · 2h 42m`,
 *  `brainstorm · run 11 · closed · 4 of 5 questions settled · 41m`; "open" while the run is (D33). */
export function runLine(run: RunStats, totals: Totals): string {
  const parts = [run.kind, `run ${run.run}`, openOrClosed(run.closedAt === null)];
  const slices = run.plan?.slices;
  if (slices && slices.of !== null) parts.push(slices.merged === null ? plural(slices.of, "slice") : `${slices.merged} of ${plural(slices.of, "slice")}`);
  const { questionsSettled, questions } = totals.brainstorm;
  if (run.brainstorm && questions !== null) parts.push(`${questionsSettled ?? figure(null)} of ${plural(questions, "question")} settled`);
  if (run.lengthMs !== null) parts.push(runLength(run.lengthMs));
  return parts.join(" · ");
}

/** The same line under Conversation, where no figure is asked (D31): what the board's summary carries. */
export function summaryLine(run: RunSummary): string {
  const parts = [run.kind, `run ${run.run}`, openOrClosed(run.open)];
  if (run.of > 0) parts.push(`${run.done} of ${plural(run.of, "slice")}`);
  return parts.join(" · ");
}
