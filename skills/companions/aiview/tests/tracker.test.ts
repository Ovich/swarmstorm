import { test } from "node:test";
import assert from "node:assert/strict";
import { findTracker, derive, check, sync } from "../src/plan/tracker.ts";

/** A plan as it is written: the tracker first, the design's diagrams below it. */
const plan = (body: string) => `# A plan

Phasing diagram, and the record of where the work stands.

${tracker(body)}

Dependency graph: what may import what.

${other}
`;

/** A plan whose tracker sits below another diagram, as plans written before the rule do. */
const buried = (body: string) => `# A plan

Dependency graph: what may import what.

${other}

Phasing diagram, and the record of where the work stands.

${tracker(body)}
`;

const other = `\`\`\`mermaid
flowchart TB
  a["apps/web"] --> b["apps/api"]
\`\`\``;

const tracker = (body: string) => `\`\`\`mermaid
flowchart TB
  %% tracker
${body}
  classDef done stroke:#4a9d5f
  classDef next stroke:#d08b28
  classDef todo stroke-dasharray:4 3
  classDef state stroke:#8a8a8a
\`\`\`

mandate: seats 4 · phases 2 · verify off · run through · opus · tests at the slice end`;

/** Steps live inside a slice, so a fixture that omits one is not a tracker. */
const slice = (n: number, steps: string[], title = `Slice ${n}`) =>
  [`  subgraph SL${n}["${title}"]`, ...steps.map((s) => `    ${s}`), "  end"].join("\n");

const need = (text: string) => {
  const t = findTracker(text);
  assert.ok(t, "a tracker was expected");
  return t;
};

test("the tracker names itself, and is not merely the first diagram", () => {
  const t = need(buried([slice(1, [`S1.1["✅ S1.1 done"]`]), "  class S1.1 done"].join("\n")));
  assert.equal(t.marked, true);
  assert.match(check(t)[0].text, /^the tracker is drawn below another diagram: it is the first thing in the plan/);
  assert.deepEqual(check(need(plan([slice(1, [`S1.1["✅ S1.1 done"]`]), "  class S1.1 done"].join("\n")))), []);
  assert.deepEqual(t.nodes.map((n) => n.id), ["S1.1"]);
  assert.equal(t.nodes[0].glyph, "✅");
  // The dependency graph above has nodes too, and none of them reaches the result.
  assert.equal(t.nodes.some((n) => n.id === "a"), false);
});

test("a plan written before the marker is still read, by its glyphs, and says so", () => {
  const t = need(plan([slice(1, [`S1.1["✅ S1.1 done"]`]), "  class S1.1 done"].join("\n")).replace("  %% tracker\n", ""));
  assert.equal(t.marked, false);
  assert.deepEqual(t.nodes.map((n) => n.id), ["S1.1"]);
});

test("a marked block wins over an unmarked one that merely has glyphs", () => {
  const text = `\`\`\`mermaid
flowchart TB
  subgraph SL9["Old"]
    S9.1["✅ a glyph, but not the tracker"]
  end
\`\`\`

\`\`\`mermaid
flowchart TB
  %% tracker
  subgraph SL1["Slice 1"]
    S1.1["▶ the real one"]
  end
  classDef next stroke:#d08b28
  class S1.1 next
\`\`\`
`;
  const t = need(text);
  assert.equal(t.marked, true);
  assert.deepEqual(t.nodes.map((n) => n.id), ["S1.1"]);
});

test("a file with no tracker answers nothing rather than guessing", () => {
  assert.equal(findTracker("# notes\n\nno diagram here"), undefined);
  assert.equal(findTracker('```mermaid\nflowchart TB\n  a["plain"] --> b["nodes"]\n```'), undefined);
});

test("slices are read with their titles, and a person mark is noticed", () => {
  const t = need(plan([slice(1, [`S1.1["✅ done"]`], "Slice 1 · US3 · the value on a page · 👤 design review"), "  class S1.1 done"].join("\n")));
  assert.deepEqual(t.slices.map((s) => s.id), ["SL1"]);
  assert.equal(t.slices[0].needsPerson, true);
  assert.equal(t.nodes[0].slice, "SL1");
});

test("the class a node should carry comes from its glyph", () => {
  const body = [
    slice(1, [`A["✅ done"]`, `B["▶ running"]`, `C["⬜ later"]`, `D["⏸ waits on the registrar"]`, `E["✖ dropped"]`]),
    `  ST["📍 state · today"]`,
    "  class A done",
  ].join("\n");
  assert.deepEqual([...derive(need(plan(body)))], [
    ["A", "done"], ["B", "next"], ["C", "todo"], ["D", "todo"], ["E", "todo"], ["ST", "state"],
  ]);
});

test("a class no classDef declares is never derived", () => {
  const text = plan([slice(1, [`A["✅ done"]`]), "  class A done"].join("\n"));
  assert.equal(derive(need(text.replace("  classDef done stroke:#4a9d5f\n", ""))).has("A"), false);
});

test("check: the glyph and the class disagreeing is the finding that matters", () => {
  const t = need(plan([slice(1, [`A["✅ done"]`, `B["▶ running"]`]), "  class A,B done"].join("\n")));
  const f = check(t);
  assert.equal(f.length, 1);
  assert.match(f[0].text, /^B is ▶ but styled 'done': the glyph says 'next'$/);
});

test("check: a node in two classes, and a node in none", () => {
  const two = need(plan([slice(1, [`A["▶ running"]`, `B["⬜ later"]`]), "  class A next", "  class A,B todo"].join("\n")));
  const texts = check(two).map((x) => x.text);
  assert.equal(texts.length, 1);
  assert.match(texts[0], /A is in 2 classes \(next, todo\).*glyph ▶ says 'next'/);

  const orphan = need(plan([slice(1, [`A["✅ done"]`, `B["⬜ later"]`]), "  class A done"].join("\n")));
  assert.match(check(orphan)[0].text, /^B is ⬜ and belongs to no class: it should be 'todo'$/);
});

test("check: a label with no glyph, and a class naming a node that does not exist", () => {
  const t = need(plan([slice(1, [`A["✅ done"]`, `B["a step nobody marked"]`]), "  class A done", "  class Z todo"].join("\n")));
  const texts = check(t).map((x) => x.text);
  assert.ok(texts.some((x) => /^B opens with no status glyph/.test(x)));
  assert.ok(texts.some((x) => /^Z is styled 'todo' but no node declares it$/.test(x)));
});

test("check: two steps running in one slice, but one per slice is fine", () => {
  const clash = need(plan([slice(1, [`S1.1["▶ one"]`, `S1.2["▶ two"]`]), "  class S1.1,S1.2 next"].join("\n")));
  assert.match(check(clash)[0].text, /^2 steps are ▶ in SL1 \(S1.1, S1.2\)/);

  const phase = need(plan([
    slice(1, [`S1.1["▶ seat1, the api"]`]),
    slice(2, [`S2.1["▶ seat2, the infra"]`]),
    "  class S1.1,S2.1 next",
  ].join("\n")));
  assert.deepEqual(check(phase), []);
});

test("check: a step drawn in the wrong slice, and one drawn outside every slice", () => {
  const misplaced = need(plan([slice(1, [`S3.4["✅ built in the wrong box"]`]), "  class S3.4 done"].join("\n")));
  assert.match(check(misplaced)[0].text, /^S3.4 names slice 3 but is drawn inside SL1$/);

  const loose = need(plan([slice(1, [`S1.1["✅ done"]`]), `  S2.1["⬜ nowhere"]`, "  class S1.1 done", "  class S2.1 todo"].join("\n")));
  assert.match(check(loose)[0].text, /^S2.1 is a step drawn outside every slice/);
});

test("check: a paused step must say what it waits on", () => {
  const silent = need(plan([slice(1, [`A["⏸ the bootstrap"]`]), "  class A todo"].join("\n")));
  assert.match(check(silent)[0].text, /^A is ⏸ and does not say what it waits on/);
  const spoken = need(plan([slice(1, [`A["⏸ the bootstrap<br/>waits on the registrar, asked 2026-09-09"]`]), "  class A todo"].join("\n")));
  assert.deepEqual(check(spoken), []);
});

test("check: the state node's fields are overwritten, so a repeated one is a log", () => {
  const ok = need(plan([slice(1, [`A["✅ done"]`]), `  ST["📍 state · today<br/>branch main @ abc<br/>next S1.2"]`, "  class A done", "  class ST state"].join("\n")));
  assert.deepEqual(check(ok), []);
  const logged = need(plan([slice(1, [`A["✅ done"]`]), `  ST["📍 state · today<br/>branch main @ abc<br/>next S1.2<br/>branch main @ def"]`, "  class A done", "  class ST state"].join("\n")));
  assert.match(check(logged)[0].text, /the state node names branch more than once/);
});

test("check: the state node describes now, and the mandate lives in the plan", () => {
  const mixed = need(plan([slice(1, [`A["✅ done"]`]), `  ST["📍 state · today<br/>branch: main @ abc<br/>branch: main @ def<br/>pace: run through"]`, "  class A done", "  class ST state"].join("\n")));
  const texts = check(mixed).map((x) => x.text);
  assert.ok(texts.some((x) => /names branch more than once/.test(x)), "a field written with a colon is still the field");
  assert.ok(texts.some((x) => /^the state node carries pace: the mandate lives/.test(x)));
});

test("check: a step holds three short lines, and one that grows past them is a log", () => {
  const shaped = need(plan([slice(1, [`A["✅ A the route answers<br/>went on: suite green here · abc1234 · #41<br/>run: steered a rename"]`]), "  class A done"].join("\n")));
  assert.deepEqual(check(shaped), []);

  const logged = need(plan([slice(1, [`A["✅ A the route<br/>one<br/>two<br/>three"]`]), "  class A done"].join("\n")));
  assert.match(check(logged)[0].text, /^A has 4 lines: a step holds 3 at most/);

  const wide = need(plan([slice(1, [`A["✅ A the route<br/>${"x".repeat(81)}"]`]), "  class A done"].join("\n")));
  assert.match(check(wide)[0].text, /^A has a line over 80 characters/);

  const state = need(plan([slice(1, [`A["✅ done"]`]), `  ST["📍 state · today<br/>branch: b<br/>deployed: d<br/>next: n<br/>blocked: nothing<br/>parked: nothing"]`, "  class A done", "  class ST state"].join("\n")));
  assert.deepEqual(check(state), [], "the state node is not a step");
});

test("check: the mandate in force is stated right under the tracker", () => {
  const body = [slice(1, [`A["✅ done"]`]), "  class A done"].join("\n");
  assert.deepEqual(check(need(plan(body))), []);
  const silent = plan(body).replace(/^mandate:.*$/m, "Some prose about the slices.");
  assert.match(check(need(silent))[0].text, /^no mandate line under the tracker/);
  const bold = plan(body).replace(/^mandate:/m, "**mandate**:");
  assert.deepEqual(check(need(bold)), [], "bold or not");
});

test("check: a mandate that says tests at the plan end needs its tests phase in the tracker", () => {
  const fast = (body: string) => plan(body).replace("tests at the slice end", "tests at the plan end");
  const without = [slice(1, [`A["⬜ A the route answers"]`]), "  class A todo"].join("\n");
  assert.match(check(need(fast(without)))[0].text, /^the mandate says tests at the plan end and no phase is the tests phase/);
  const withIt = [slice(1, [`A["⬜ A the route answers"]`]), slice(2, [`B["⬜ B every named case a test"]`], "Slice 2 · US1 · the tests"), "  class A,B todo"].join("\n");
  assert.deepEqual(check(need(fast(withIt))), []);
  assert.deepEqual(check(need(plan(without))), [], "another rhythm asks for no tests phase");
});

test("check: the glyph names the verdict line, and a step ticked without one is caught", () => {
  const ticked = need(plan([slice(1, [`A["✅ A the route answers<br/>done when: pnpm check exits 0"]`]), "  class A done"].join("\n")));
  assert.match(check(ticked)[0].text, /^A is ✅ and says 'done when': its verdict line is 'went on'/);

  const early = need(plan([slice(1, [`A["⬜ A the route answers<br/>went on: suite green here"]`]), "  class A todo"].join("\n")));
  assert.match(check(early)[0].text, /^A is ⬜ and says 'went on': its verdict line is 'done when'/);

  const paused = need(plan([slice(1, [`A["⏸ A the route answers<br/>done when: the record resolves<br/>paused: the registrar, asked 2026-01-01"]`]), "  class A todo"].join("\n")));
  assert.deepEqual(check(paused), [], "a paused step keeps its done-when");

  const dropped = need(plan([slice(1, [`A["✖ A the route answers<br/>dropped: the library cannot stream · D14"]`]), "  class A todo"].join("\n")));
  assert.deepEqual(check(dropped), []);
});

test("check: a step's title says what an observer could tell, never an identifier", () => {
  const called = need(plan([slice(1, [`A["⬜ A chatModel() and the mock<br/>done when: pnpm check exits 0"]`]), "  class A todo"].join("\n")));
  assert.match(check(called)[0].text, /^A names 'chatModel' in its title/);

  const plain = need(plan([slice(1, [`A["⬜ A LangGraph ships in the bundle, unused · US1<br/>done when: pnpm check exits 0"]`]), "  class A todo"].join("\n")));
  assert.deepEqual(check(plain), [], "a product name and a story id are not identifiers");
});

test("sync: the class lines are rewritten from the glyphs, in classDef order", () => {
  const before = plan([slice(1, [`A["✅ done"]`, `B["▶ running"]`, `C["⬜ later"]`]), "  class A,B done", "  class C,A todo"].join("\n"));
  const { text, changed } = sync(before, need(before));
  assert.equal(changed, true);
  assert.deepEqual(check(need(text)), []);
  assert.deepEqual(text.split("\n").filter((l) => /^\s*class\s/.test(l)), ["  class A done", "  class B next", "  class C todo"]);
});

test("sync: a tracker that already agrees is left byte for byte alone", () => {
  const before = plan([slice(1, [`A["✅ done"]`, `B["▶ running"]`]), "  class A done", "  class B next"].join("\n"));
  const { text, changed } = sync(before, need(before));
  assert.equal(changed, false);
  assert.equal(text, before);
});

test("sync: nothing outside the class lines moves, the diagram above included", () => {
  const before = plan([slice(1, [`A["✅ done"]`, `B["⬜ later"]`]), "  A --> B", "  class A,B done"].join("\n"));
  const { text } = sync(before, need(before));
  assert.ok(text.includes('  a["apps/web"] --> b["apps/api"]'), "the other diagram is untouched");
  assert.ok(text.includes('  subgraph SL1["Slice 1"]'), "the subgraph is untouched");
  assert.ok(text.includes("  A --> B"), "the edges are untouched");
  assert.ok(text.includes("  classDef done stroke:#4a9d5f"), "the classDefs are untouched");
  assert.ok(text.includes("  %% tracker"), "the marker is untouched");
});
