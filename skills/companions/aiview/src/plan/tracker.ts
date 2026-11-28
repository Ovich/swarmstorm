// The tracker of a plan (execute-plan skill): the mermaid diagram that is also the
// record of where the work stands. Text only, no Mermaid import, so this ships in the
// CLI bundle and runs whether or not the parser bundle is built.
//
// A step's state is written twice in that format: as the glyph opening its label, and
// as membership of a `class` line at the foot of the diagram. Two places, hand-edited,
// and they drift — within one session and, more quietly, between two. So the glyph is
// the truth here and the class lines are derived from it.

/** The glyphs the protocol defines, in the order a reader meets them. */
const GLYPH_CLASS: ReadonlyMap<string, string> = new Map([
  ["✅", "done"],
  ["▶", "next"],
  ["⏸", "todo"],
  ["⬜", "todo"],
  ["✖", "todo"],
  ["📍", "state"],
]);

const NODE = /^(\s*)([A-Za-z_][\w.-]*)\[\s*"(.*)"\s*\]\s*$/;
const CLASS_LINE = /^(\s*)class\s+([\w.,\s-]+?)\s+(\w+)\s*$/;
const CLASSDEF = /^\s*classDef\s+(\w+)\b/;
/** A slice: `subgraph SL12["P1 · seat2 · US4 · … · 👤 design review"]`. The id names the
 *  slice the way a step id does (`S12.4`), so the two can be held to each other. */
const SUBGRAPH = /^\s*subgraph\s+([A-Za-z_][\w.-]*)\s*\[\s*"?(.*?)"?\s*\]\s*$/;
const END = /^\s*end\s*$/;
/** The slice number a `SL<n>` id or an `S<n>.<step>` id carries. */
const sliceOf = (id: string): string | undefined =>
  (/^SL(\d+)$/i.exec(id) ?? /^S(\d+)\.\w+$/i.exec(id))?.[1];

interface TrackerNode {
  readonly id: string;
  readonly glyph: string | undefined;
  readonly label: string;
  /** 1-based line in the file. */
  readonly line: number;
  /** The id of the slice this step is drawn inside, or undefined when it stands
   *  outside every slice, as the state node does. */
  readonly slice: string | undefined;
}

export interface Slice {
  readonly id: string;
  readonly title: string;
  readonly line: number;
  /** True when the slice's title marks it as needing a person. */
  readonly needsPerson: boolean;
}

/** The marker naming a block as the tracker, as a mermaid comment inside the fence.
 *  A plan holds several diagrams and only one is the record, so it says which. */
const MARKER = /^\s*%%\s*(aiview:)?tracker\b/i;

/** The mandate in force, as one line right under the diagram: `mandate: run through · …`,
 *  bold or not. */
const MANDATE_LINE = /^\s*(\*\*)?mandate(\*\*)?\s*:/i;

interface Tracker {
  /** 1-based line of the block's opening fence, 0 when the file is a bare diagram. */
  readonly fence: number;
  /** True when the block named itself with `%% tracker`, false when it was found by
   *  its glyphs. The fallback keeps plans written before the marker working. */
  readonly marked: boolean;
  /** How many diagrams the plan draws above this one. The tracker is what a reader opens
   *  the plan for, so it comes first. */
  readonly diagramsAbove: number;
  /** True when the first line under the diagram states the mandate in force. A bare
   *  diagram has no document around it, and counts as having one. */
  readonly mandateLine: boolean;
  /** That line's text, empty when there is none: what the mandate says decides what the
   *  tracker must hold. */
  readonly mandate: string;
  readonly nodes: readonly TrackerNode[];
  readonly slices: readonly Slice[];
  /** Class name per node id, as the `class` lines currently assign it. */
  readonly assigned: ReadonlyMap<string, readonly string[]>;
  /** Class names a `classDef` declares, so a derived line never invents one. */
  readonly declared: ReadonlySet<string>;
  /** 1-based lines holding `class` assignments, in file order. */
  readonly classLines: readonly number[];
  readonly indent: string;
}

/** The block that carries a tracker: the one that says so with `%% tracker`, or, in a
 *  plan written before the marker existed, the first whose nodes open with the
 *  protocol's glyphs. A plan usually holds other diagrams, and none of them is the
 *  record, so a marked block always wins over a guessed one. */
export function findTracker(text: string): Tracker | undefined {
  const lines = text.split("\n");
  let start = -1;
  const blocks: Array<{ fence: number; from: number; to: number }> = [];
  lines.forEach((line, i) => {
    if (!/^\s*```/.test(line)) return;
    if (start < 0 && /^\s*```\s*mermaid\b/.test(line)) start = i;
    else if (start >= 0) {
      blocks.push({ fence: start + 1, from: start + 1, to: i });
      start = -1;
    }
  });
  if (!blocks.length) blocks.push({ fence: 0, from: 0, to: lines.length });

  const read = (block: { fence: number; from: number; to: number }, diagramsAbove: number): Tracker => {
    const nodes: TrackerNode[] = [];
    const slices: Slice[] = [];
    const assigned = new Map<string, string[]>();
    const declared = new Set<string>();
    const classLines: number[] = [];
    const open: string[] = [];
    let marked = false;
    let indent = "  ";
    for (let i = block.from; i < block.to; i++) {
      const raw = lines[i];
      if (MARKER.test(raw)) {
        marked = true;
        continue;
      }
      const sub = SUBGRAPH.exec(raw);
      if (sub) {
        const [, id, title] = sub;
        slices.push({ id, title, line: i + 1, needsPerson: title.includes("👤") });
        open.push(id);
        continue;
      }
      if (END.test(raw)) {
        open.pop();
        continue;
      }
      const node = NODE.exec(raw);
      if (node) {
        const [, pad, id, label] = node;
        const glyph = [...label.trimStart()][0];
        nodes.push({ id, glyph: GLYPH_CLASS.has(glyph) ? glyph : undefined, label, line: i + 1, slice: open.at(-1) });
        if (pad) indent = pad;
        continue;
      }
      const def = CLASSDEF.exec(raw);
      if (def) {
        declared.add(def[1]);
        continue;
      }
      const cls = CLASS_LINE.exec(raw);
      if (cls) {
        const [, pad, ids, name] = cls;
        classLines.push(i + 1);
        indent = pad || indent;
        for (const id of ids.split(",").map((s) => s.trim()).filter(Boolean)) {
          assigned.set(id, [...(assigned.get(id) ?? []), name]);
        }
      }
    }
    const under = lines.slice(block.to + 1).find((l) => l.trim() !== "") ?? "";
    const mandateLine = block.fence === 0 || MANDATE_LINE.test(under);
    const mandate = MANDATE_LINE.test(under) ? under.trim() : "";
    return { fence: block.fence, marked, diagramsAbove, mandateLine, mandate, nodes, slices, assigned, declared, classLines, indent };
  };

  const all = blocks.map((block, i) => read(block, i));
  return all.find((t) => t.marked) ?? all.find((t) => t.nodes.some((n) => n.glyph));
}

/** What each node's class should be, from its glyph alone. Nodes whose glyph is not
 *  the protocol's are left out: the tracker says nothing about them. */
export function derive(t: Tracker): Map<string, string> {
  const out = new Map<string, string>();
  for (const n of t.nodes) {
    const cls = n.glyph ? GLYPH_CLASS.get(n.glyph) : undefined;
    if (cls && t.declared.has(cls)) out.set(n.id, cls);
  }
  return out;
}

export interface Finding {
  readonly line: number;
  readonly text: string;
}

/** Everything the tracker says about itself that cannot be true at once. */
export function check(t: Tracker): Finding[] {
  const found: Finding[] = [];
  const want = derive(t);

  if (t.diagramsAbove > 0) {
    found.push({ line: t.fence, text: `the tracker is drawn below ${t.diagramsAbove === 1 ? "another diagram" : `${t.diagramsAbove} other diagrams`}: it is the first thing in the plan, under the header` });
  }

  if (!t.mandateLine) {
    found.push({ line: t.fence, text: "no mandate line under the tracker: the first line below the diagram states the mandate in force, `mandate: seats 4 · phases 3 · …`" });
  }

  // Tests at the plan end is chosen in the mandate and paid for in the tracker: without
  // its tests phase every slice runs untested and nothing ever writes the tests.
  if (/tests at the plan end/i.test(t.mandate) && !t.slices.some((sl) => /\bthe tests\b/i.test(sl.title))) {
    found.push({ line: t.fence, text: "the mandate says tests at the plan end and no phase is the tests phase: draw it, titled `… · the tests`, last before the person's checks, every other slice owing it its tests" });
  }

  for (const n of t.nodes) {
    const has = t.assigned.get(n.id) ?? [];
    if (!n.glyph) {
      found.push({ line: n.line, text: `${n.id} opens with no status glyph: a step's label starts with one of ✅ ▶ ⏸ ⬜ ✖` });
      continue;
    }
    const should = want.get(n.id);
    if (!should) continue;
    if (has.length === 0) {
      found.push({ line: n.line, text: `${n.id} is ${n.glyph} and belongs to no class: it should be '${should}'` });
    } else if (has.length > 1) {
      found.push({ line: n.line, text: `${n.id} is in ${has.length} classes (${has.join(", ")}): a node carries one, and its glyph ${n.glyph} says '${should}'` });
    } else if (has[0] !== should) {
      found.push({ line: n.line, text: `${n.id} is ${n.glyph} but styled '${has[0]}': the glyph says '${should}'` });
    }
  }

  const ids = new Set(t.nodes.map((n) => n.id));
  for (const [id, names] of t.assigned) {
    if (!ids.has(id)) found.push({ line: t.classLines[0] ?? 0, text: `${id} is styled '${names.join(", ")}' but no node declares it` });
  }

  // One ▶ per slice: every seat of the open phase runs one, each inside its own slice,
  // so two running steps in one slice is the case to name.
  const perSlice = new Map<string, TrackerNode[]>();
  for (const n of t.nodes.filter((x) => x.glyph === "▶")) {
    const key = n.slice ?? "";
    perSlice.set(key, [...(perSlice.get(key) ?? []), n]);
  }
  for (const [slice, running] of perSlice) {
    if (running.length > 1) {
      found.push({
        line: running[1].line,
        text: `${running.length} steps are ▶ in ${slice || "no slice"} (${running.map((n) => n.id).join(", ")}): one at a time, or one per branch the slice draws`,
      });
    }
  }

  // A step's id names its slice, and so does the subgraph it is drawn in. When the two
  // disagree, one of them is a copy-paste and the tracker no longer answers "where".
  for (const n of t.nodes) {
    if (!n.slice || !n.glyph || n.glyph === "📍") continue;
    const byId = sliceOf(n.id);
    const bySlice = sliceOf(n.slice);
    if (byId && bySlice && byId !== bySlice) {
      found.push({ line: n.line, text: `${n.id} names slice ${byId} but is drawn inside ${n.slice}` });
    }
  }

  for (const n of t.nodes) {
    if (n.glyph && n.glyph !== "📍" && !n.slice) {
      found.push({ line: n.line, text: `${n.id} is a step drawn outside every slice: only the state node stands on its own` });
    }
  }

  for (const n of t.nodes) {
    if (n.glyph === "⏸" && !/paused|wait|block|until|needs|asked/i.test(n.label)) {
      found.push({ line: n.line, text: `${n.id} is ⏸ and does not say what it waits on, or since when` });
    }
  }

  for (const n of t.nodes) {
    if (n.glyph && n.glyph !== "📍") found.push(...shapeFindings(n));
  }

  const state = t.nodes.find((n) => n.glyph === "📍");
  if (state) found.push(...stateFindings(state));
  return found;
}

/** A step's shape: the person reads it to see where the run stands and the orchestrator
 *  to decide what comes next, so it holds its title, its verdict and at most the one
 *  thing the orchestrator did; a step that grows past that has become a log. */
const STEP_LINES = 3;
const STEP_WIDTH = 80;

/** The verdict line each glyph allows, and the ones it has left behind: a ✅ step that
 *  still says `done when` was ticked without saying what was observed. */
const VERDICTS = ["done when", "went on", "paused", "dropped"] as const;
const VERDICT_OF: ReadonlyMap<string, readonly string[]> = new Map([
  ["⬜", ["done when"]],
  ["▶", ["done when"]],
  ["✅", ["went on"]],
  ["⏸", ["done when", "paused"]],
  ["✖", ["dropped"]],
]);

/** An identifier from the code in a step's title: a call, or a camelCase name. */
const IDENTIFIER = /\w\(\)|\b[a-z]+[A-Z]\w*/;

function shapeFindings(n: TrackerNode): Finding[] {
  const lines = n.label.split(/<br\s*\/?>/i).map((l) => l.trim());
  const found: Finding[] = [];
  if (lines.length > STEP_LINES) {
    found.push({ line: n.line, text: `${n.id} has ${lines.length} lines: a step holds ${STEP_LINES} at most, and the rest has a home in the pull request, a decisions row or the slice document` });
  }
  const wide = lines.filter((l) => [...l].length > STEP_WIDTH);
  if (wide.length) {
    found.push({ line: n.line, text: `${n.id} has ${wide.length === 1 ? "a line" : `${wide.length} lines`} over ${STEP_WIDTH} characters: "${[...wide[0]].slice(0, 40).join("")}…"` });
  }
  const allowed = VERDICT_OF.get(n.glyph ?? "") ?? [];
  const stray = lines
    .map((l) => VERDICTS.find((v) => l.toLowerCase().startsWith(`${v}:`)))
    .filter((v): v is (typeof VERDICTS)[number] => !!v && !allowed.includes(v));
  if (stray.length) {
    found.push({ line: n.line, text: `${n.id} is ${n.glyph} and says '${stray.join("', '")}': its verdict line is '${allowed.at(-1)}'` });
  }
  const named = IDENTIFIER.exec(lines[0])?.[0];
  if (named) {
    found.push({ line: n.line, text: `${n.id} names '${named}' in its title: the first line says what an observer of the system could tell, and the slice document holds the identifier` });
  }
  return found;
}

/** The fixed fields of the state node, which are overwritten and never appended to. The
 *  mandate's fields (seats, phases, pace, model, verify) live in the plan's Mandate section. */
const STATE_FIELDS = ["branch", "deployed", "next", "blocked", "parked"] as const;
const MANDATE_FIELDS = ["seats", "phases", "pace", "model", "verify"] as const;

function stateFindings(state: TrackerNode): Finding[] {
  const seen = new Map<string, number>();
  const mandate: string[] = [];
  for (const part of state.label.split(/<br\s*\/?>/i)) {
    const word = part.trim().split(/\s+/)[0]?.toLowerCase().replace(/:$/, "");
    if (word && (MANDATE_FIELDS as readonly string[]).includes(word)) mandate.push(word);
    if (word && (STATE_FIELDS as readonly string[]).includes(word)) seen.set(word, (seen.get(word) ?? 0) + 1);
  }
  const twice = [...seen].filter(([, n]) => n > 1).map(([f]) => f);
  const found: Finding[] = [];
  if (twice.length) {
    found.push({ line: state.line, text: `the state node names ${twice.join(" and ")} more than once: its fields are overwritten, and a node appended to becomes a log` });
  }
  if (mandate.length) {
    found.push({ line: state.line, text: `the state node carries ${mandate.join(" and ")}: the mandate lives in the plan's Mandate section, and the state node describes now` });
  }
  return found;
}

/** The class lines rewritten from the glyphs, one line per class, node order kept.
 *  Returns the text unchanged when it already agrees. */
export function sync(text: string, t: Tracker): { text: string; changed: boolean } {
  const want = derive(t);
  const byClass = new Map<string, string[]>();
  for (const n of t.nodes) {
    const cls = want.get(n.id);
    if (cls) byClass.set(cls, [...(byClass.get(cls) ?? []), n.id]);
  }
  // Declaration order, so the file reads the way its classDefs were written.
  const order = [...t.declared].filter((c) => byClass.has(c));
  const rewritten = order.map((c) => `${t.indent}class ${byClass.get(c)!.join(",")} ${c}`);

  const lines = text.split("\n");
  const first = t.classLines[0];
  if (!first) return { text, changed: false };
  const drop = new Set(t.classLines);
  const out: string[] = [];
  lines.forEach((line, i) => {
    const n = i + 1;
    if (n === first) out.push(...rewritten);
    else if (!drop.has(n)) out.push(line);
  });
  const next = out.join("\n");
  return { text: next, changed: next !== text };
}
