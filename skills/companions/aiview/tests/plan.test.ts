import { test } from "node:test";
import assert from "node:assert/strict";
import { check, readApproval } from "../src/plan/approval.ts";

/** A plan as write-plan writes it: the status in the header, the decisions in §8. */
const plan = (status: string, rows: string) => `# feed, plan

> **Status**: ${status}
> **Delivers**: the feed

## The tracker
Not cut yet.

# Design

## 8. Decisions
| id | Kind | Decision | Status | Source | Slice |
|---|---|---|---|---|---|
${rows}

# Execution

## 9. The slices
`;

const rows = `| D1 | purpose | Ship the feed | agreed | interview | 1 |
| D2 | module | Cache in memory | agreed | \`agent default\` | 1 |
| D3 | contract | Markdown applied at once | agreed | agent default | 1 |`;

test("the defaults are read from the Source column, contract first", () => {
  const p = readApproval(plan("draft", rows));
  assert.equal(p.approved, false);
  assert.equal(p.decisions.length, 3);
  assert.deepEqual(p.defaults.map((d) => d.id), ["D3", "D2"]);
  assert.equal(p.defaults[0]!.line, 16);
  assert.deepEqual(check(p), []);
});

test("an approved plan whose defaults were never confirmed warns, naming them", () => {
  const p = readApproval(plan(`approved: Ada, 2026-10-14, "Yes go for it"`, rows));
  const f = check(p);
  assert.equal(f.length, 1);
  assert.equal(f[0]!.line, 3);
  assert.match(f[0]!.text, /2 agent default\(s\) were never confirmed: D3 \(contract\), D2/);
});

test("confirmed defaults pass; a partial or a stray confirmation warns", () => {
  assert.deepEqual(check(readApproval(plan(`approved: Ada, 2026-10-14, "yes"; defaults confirmed: D2, D3`, rows))), []);
  assert.deepEqual(check(readApproval(plan(`approved: Ada, 2026-10-14, "yes"; defaults confirmed: all`, rows))), []);
  const partial = check(readApproval(plan(`approved: Ada, 2026-10-14, "yes"; defaults confirmed: D2, D9`, rows)));
  assert.equal(partial.length, 2);
  assert.match(partial[0]!.text, /without confirmation: D3 \(contract\)/);
  assert.match(partial[1]!.text, /D9 is confirmed/);
});

test("a plan without defaults, or without a decisions table, is quiet once approved", () => {
  assert.deepEqual(check(readApproval(plan(`approved: Ada, 2026-10-14, "yes"`, "| D1 | purpose | x | agreed | interview | 1 |"))), []);
  assert.deepEqual(check(readApproval(`> **Status**: approved: Ada\n\n# Design\n`)), []);
});

test("a plan with no status line is named", () => {
  const f = check(readApproval("# a plan\n"));
  assert.match(f[0]!.text, /no status line/);
});

/** A plan with its interview log, the walkthrough tables under it as `interview`'s
 *  `references/walkthrough.md` writes them. */
const walked = (...tables: string[]) => `${plan("draft", rows)}
## Interview log

**Q1 · D1.** Options: (1) ship it. **Answer: 1.**
${tables
  .map(
    (body, n) => `
### Walkthrough 2026-11-${19 + n}

Understanding, not approval: the defaults are confirmed only at the approval.

| id | Unit | Decisions | Answers | Parts asked about |
|---|---|---|---|---|
${body}
`,
  )
  .join("")}`;

test("no walkthrough table, no rows", () => {
  assert.deepEqual(readApproval(plan("draft", rows)).walkthrough, []);
});

test("the last walkthrough table counts; a second walk never merges with the first", () => {
  const p = readApproval(
    walked(
      "| W1 | The feed | D1 | need more → disagree | cache |\n| W2 | The cache | D2 | |  |",
      "| W1 | The feed, again | D1, D3 | understood | |",
    ),
  );
  assert.equal(p.walkthrough.length, 1);
  const w = p.walkthrough[0]!;
  assert.deepEqual({ ...w, line: 0 }, { id: "W1", unit: "The feed, again", decisions: ["D1", "D3"], answer: "understood", line: 0 });
});

test("a chain's last segment counts, matched on its leading words; empty Answers is not walked", () => {
  const p = readApproval(
    walked(
      [
        "| W1 | Phase 1 | D1, D2 | need more → Disagree: the cache should be on disk | cache, D2 |",
        "| W2 | Phase 2 | see D3 and D10 | understood → need more on the retry |  |",
        "| W3 | Phase 3 | | Understood. | |",
        "| W4 | Phase 4 | D4 | | |",
      ].join("\n"),
    ),
  );
  assert.deepEqual(
    p.walkthrough.map((w) => [w.id, w.answer, w.decisions]),
    [
      ["W1", "disagree", ["D1", "D2"]],
      ["W2", "need more", ["D3", "D10"]],
      ["W3", "understood", []],
      ["W4", "not walked", ["D4"]],
    ],
  );
});

test("each walked row keeps its own 1-based line", () => {
  const text = walked("| W1 | A | D1 | understood | |\n| W2 | B | D2 | | |");
  const p = readApproval(text);
  const lines = text.split("\n");
  assert.match(lines[p.walkthrough[0]!.line - 1]!, /^\| W1 \|/);
  assert.match(lines[p.walkthrough[1]!.line - 1]!, /^\| W2 \|/);
});

test("an escaped pipe inside a §8 cell is text, so the row's source reads right", () => {
  const p = readApproval(
    plan("draft", `| D1 | contract | The status is \`draft \\| approved\` | agreed | agent default | 1 |\n| D2 | purpose | Ship | agreed | interview | 1 |`),
  );
  assert.deepEqual(p.defaults.map((d) => d.id), ["D1"]);
  assert.equal(p.decisions[0]!.kind, "contract");
  assert.equal(p.decisions[1]!.source, "interview");
});
