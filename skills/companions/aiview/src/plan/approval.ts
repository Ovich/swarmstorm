// The approval of a plan (write-plan skill), judged against its decisions table. Text
// only, like the tracker, so it ships in the CLI bundle.
//
// A decision nobody was asked about is a row whose Source is `agent default`. It is
// legitimate, but the person has to have seen it: the status line names the defaults
// they confirmed. An approved plan whose defaults were never confirmed approved a table
// the person may not have read. The check warns and never refuses: refusing brings back
// the cost that made agents skip the interview in the first place.

/** `> **Status**: approved: …`, quoted or not, bold or not. */
const STATUS = /^\s*>?\s*(\*\*)?status(\*\*)?\s*:\s*(.*)$/i;
const APPROVED = /^approved\b/i;
const CONFIRMED = /defaults confirmed\s*:\s*([^;]*)/i;
/** `## 8. Decisions`, numbered or not. */
const DECISIONS = /^#{2,3}\s*(\d+\.\s*)?decisions\b/i;
const HEADING = /^#{1,6}\s/;
/** `### Walkthrough 2026-11-19`: the date after it is not read. */
const WALKTHROUGH = /^###\s+walkthrough\b/i;
const DEFAULT_SOURCE = /\bagent'?s? default\b/i;

export interface Decision {
  readonly id: string;
  readonly kind: string;
  readonly source: string;
  /** 1-based line in the file. */
  readonly line: number;
}

interface PlanApproval {
  /** The status line's value, empty when the plan has none. */
  readonly status: string;
  /** 1-based line of the status line, 0 when there is none. */
  readonly statusLine: number;
  readonly approved: boolean;
  /** The ids the status names as confirmed, undefined when it names none; `all` is
   *  expanded to every default. */
  readonly confirmed: readonly string[] | undefined;
  readonly decisions: readonly Decision[];
  /** The rows whose source is `agent default`, `contract` ones first. */
  readonly defaults: readonly Decision[];
  /** The rows of the last `### Walkthrough` table, empty when the plan has none. */
  readonly walkthrough: readonly Walked[];
}

/** One unit of a walkthrough (interview skill's `references/walkthrough.md`), by the
 *  last answer the person gave on it. Understanding only, never an approval. */
interface Walked {
  /** `W1`, `W2`, … */
  readonly id: string;
  readonly unit: string;
  /** The `D<n>` the unit cites. */
  readonly decisions: readonly string[];
  readonly answer: Answer;
  /** 1-based line in the file. */
  readonly line: number;
}

export type Answer = "understood" | "need more" | "disagree" | "not walked";

export interface Finding {
  readonly line: number;
  readonly text: string;
}

const cell = (s: string): string => s.replace(/[`*_]/g, "").trim();
/** A pipe with a backslash before it is text inside a cell, not a column break. */
const PIPE = /(?<!\\)\|/;
const cells = (row: string): string[] =>
  row
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(PIPE)
    .map((c) => cell(c.replace(/\\\|/g, "|")));
const isRule = (row: string): boolean => /^\s*\|?[\s:|-]+\|?\s*$/.test(row) && row.includes("-");

interface Row {
  /** The cell under a header name (lowercased), empty when the column is absent. */
  readonly at: (name: string) => string;
  /** 1-based line in the file. */
  readonly line: number;
}

/** The first table under the heading at `start`, read by its header, so a table whose
 *  columns are ordered otherwise still reads. Ends at the next heading, or at the first
 *  non-table line after its rows. */
function readTable(lines: readonly string[], start: number): Row[] {
  if (start < 0) return [];
  const out: Row[] = [];
  let header: string[] | undefined;
  for (let i = start + 1; i < lines.length && !HEADING.test(lines[i]!); i++) {
    const l = lines[i]!;
    if (!l.trim().startsWith("|")) {
      if (header && out.length) break;
      continue;
    }
    if (isRule(l)) continue;
    const row = cells(l);
    if (!header) {
      header = row.map((h) => h.toLowerCase());
      continue;
    }
    const names = header;
    out.push({ at: (name) => row[names.indexOf(name)] ?? "", line: i + 1 });
  }
  return out;
}

/** The §8 table. */
function readDecisions(lines: readonly string[]): Decision[] {
  return readTable(lines, lines.findIndex((l) => DECISIONS.test(l)))
    .filter((r) => r.at("id"))
    .map((r) => ({ id: r.at("id"), kind: r.at("kind").toLowerCase(), source: r.at("source"), line: r.line }));
}

/** An answer's leading words, the one place they are named. */
const ANSWERS: Readonly<Record<string, Answer>> = {
  understood: "understood",
  "need more": "need more",
  disagree: "disagree",
};
const LEADING = new RegExp(`^(${Object.keys(ANSWERS).join("|")})\\b`);
const DECISION_ID = /\bD\d+\b/g;

/** The last segment of an `a → b → c` chain counts; empty, or words no answer starts
 *  with, is a unit not walked. */
function lastAnswer(chain: string): Answer {
  const last = chain.split("→").pop()!.trim().toLowerCase().replace(/\s+/g, " ");
  return ANSWERS[LEADING.exec(last)?.[1] ?? ""] ?? "not walked";
}

/** The last walkthrough table: a second walk adds a table below, never edits the old. */
function readWalkthrough(lines: readonly string[]): Walked[] {
  let start = -1;
  lines.forEach((l, i) => {
    if (WALKTHROUGH.test(l)) start = i;
  });
  return readTable(lines, start)
    .filter((r) => r.at("id"))
    .map((r) => ({
      id: r.at("id"),
      unit: r.at("unit"),
      decisions: r.at("decisions").match(DECISION_ID) ?? [],
      answer: lastAnswer(r.at("answers")),
      line: r.line,
    }));
}

export function readApproval(text: string): PlanApproval {
  const lines = text.split("\n");
  const statusIdx = lines.findIndex((l) => STATUS.test(l));
  const status = statusIdx < 0 ? "" : STATUS.exec(lines[statusIdx]!)![3]!.trim();
  const decisions = readDecisions(lines);
  const defaults = decisions
    .filter((d) => DEFAULT_SOURCE.test(d.source))
    .sort((a, b) => Number(b.kind === "contract") - Number(a.kind === "contract"));
  const named = CONFIRMED.exec(status)?.[1]?.trim();
  const confirmed =
    named === undefined
      ? undefined
      : /^all\b/i.test(named)
        ? defaults.map((d) => d.id)
        : named.split(/[\s,]+/).map(cell).filter((s) => s && !/^none$/i.test(s));
  return {
    status,
    statusLine: statusIdx + 1,
    approved: APPROVED.test(status),
    confirmed,
    decisions,
    defaults,
    walkthrough: readWalkthrough(lines),
  };
}

/** Warnings only. A draft is not judged: its defaults are what the approval message
 *  will list. */
export function check(plan: PlanApproval): Finding[] {
  if (!plan.statusLine) return [{ line: 1, text: "no status line: `> **Status**: draft | approved: <who>, <date>, \"<words>\"`" }];
  if (!plan.approved) return [];
  const out: Finding[] = [];
  const ids = (ds: readonly Decision[]) => ds.map((d) => `${d.id}${d.kind === "contract" ? " (contract)" : ""}`).join(", ");
  if (plan.defaults.length && plan.confirmed === undefined) {
    out.push({
      line: plan.statusLine,
      text: `approved, but ${plan.defaults.length} agent default(s) were never confirmed: ${ids(plan.defaults)}; list them to the person and add "defaults confirmed: <ids>" to the status`,
    });
    return out;
  }
  const confirmed = new Set(plan.confirmed ?? []);
  const unconfirmed = plan.defaults.filter((d) => !confirmed.has(d.id));
  if (unconfirmed.length)
    out.push({ line: plan.statusLine, text: `agent default(s) approved without confirmation: ${ids(unconfirmed)}` });
  const known = new Set(plan.defaults.map((d) => d.id));
  for (const id of confirmed)
    if (!known.has(id)) out.push({ line: plan.statusLine, text: `${id} is confirmed in the status, but no decision row with source agent default has that id` });
  return out;
}
