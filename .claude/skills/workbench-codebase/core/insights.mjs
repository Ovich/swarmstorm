// What a person or an agent needs to see the system at a glance, computed from the model alone: its
// units and their weight, how they import each other, the layers that order implies, and the weak
// spots measured against the repository's own norms (no threshold is a constant of a project).
// `compareOf` sets two of these side by side: what is new, what is gone, what is due.
import { posix } from "node:path";

/** Tarjan's strongly connected components of `{ node → Set(next) }`, only those of two or more. */
function sccsOf(next) {
  let index = 0;
  const stack = [], on = new Set(), idx = new Map(), low = new Map(), out = [];
  const visit = (v) => {
    idx.set(v, index); low.set(v, index); index++; stack.push(v); on.add(v);
    for (const w of next.get(v) ?? []) {
      if (!idx.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) { const comp = []; let w; do { w = stack.pop(); on.delete(w); comp.push(w); } while (w !== v); if (comp.length > 1) out.push(comp); }
  };
  for (const v of next.keys()) if (!idx.has(v)) visit(v);
  return out;
}
const graphOf = (pairs) => { const g = new Map(); for (const [a, b] of pairs) { if (!g.has(a)) g.set(a, new Set()); if (!g.has(b)) g.set(b, new Set()); g.get(a).add(b); } return g; };
/** The outlier line of a distribution: above the third quartile by three interquartile ranges. */
const outlierLine = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length < 8) return Infinity;
  const q = (p) => sorted[Math.floor((sorted.length - 1) * p)];
  return Math.round(q(0.75) + 3 * (q(0.75) - q(0.25)));
};

/** Every measure of one model; `churn` (path → commits) and `net` (path → {added, removed}) are optional. */
export function insightsOf(model, { churn, net } = {}) {
  const { files, edges } = model;
  const source = [...files].filter(([, f]) => !f.test);
  const runtime = edges.filter((e) => !e.typeOnly && !files.get(e.from)?.test && !files.get(e.to)?.test);

  // cycles: files on runtime imports, and modules (folders with an index) on the same edges
  const fileCycles = sccsOf(graphOf(runtime.map((e) => [e.from, e.to]))).map((c) => c.sort());
  const moduleEdges = runtime.map((e) => [model.moduleOf(e.from), model.moduleOf(e.to)]).filter(([a, b]) => a !== b && !a.startsWith(`${b}/`) && !b.startsWith(`${a}/`));
  const moduleCycles = sccsOf(graphOf(moduleEdges)).map((c) => c.sort());
  const cycles = [
    ...moduleCycles.map((members) => ({ kind: "modules", members, key: `m:${members.join("|")}`, at: siteOf(runtime, (e) => members.includes(model.moduleOf(e.from)) && members.includes(model.moduleOf(e.to)) && model.moduleOf(e.from) !== model.moduleOf(e.to)) })),
    ...fileCycles.map((members) => ({ kind: "files", members, key: `f:${members.join("|")}`, at: siteOf(runtime, (e) => members.includes(e.from) && members.includes(e.to)) })),
  ];

  // units, their weight, their edges, their layers
  const units = model.units.map((u) => ({ ...u, churn: 0, added: 0, removed: 0 }));
  const byId = new Map(units.map((u) => [u.id, u]));
  for (const [path, _f] of source) {
    const u = byId.get(model.unitOf(path));
    if (!u) continue;
    u.churn += churn?.get(path) ?? 0;
  }
  for (const [path, row] of net ?? []) { const u = byId.get(model.unitOf(path)); if (u && files.has(path) && !files.get(path).test) { u.added += row.added; u.removed += row.removed; } }
  const unitPairs = new Map();
  for (const e of edges) {
    if (files.get(e.from)?.test) continue;
    const a = model.unitOf(e.from), b = model.unitOf(e.to);
    if (!a || !b || a === b) continue;
    const key = `${a}>${b}`;
    const row = unitPairs.get(key) ?? { from: a, to: b, count: 0, sites: [] };
    row.count++; if (row.sites.length < 20) row.sites.push(`${e.from}:${e.line}`);
    unitPairs.set(key, row);
  }
  const unitEdges = [...unitPairs.values()];
  const unitGraph = graphOf(unitEdges.map((e) => [e.from, e.to]));
  for (const u of units) if (!unitGraph.has(u.id)) unitGraph.set(u.id, new Set());
  const unitSccs = sccsOf(unitGraph);
  const sccOf = new Map();
  unitSccs.forEach((c, i) => { for (const u of c) sccOf.set(u, i); });
  const level = new Map();
  const levelOf = (u, seen = new Set()) => {
    if (level.has(u)) return level.get(u);
    seen.add(u);
    let l = 0;
    for (const v of unitGraph.get(u) ?? []) if (!seen.has(v) && !(sccOf.has(u) && sccOf.get(u) === sccOf.get(v))) l = Math.max(l, levelOf(v, seen) + 1);
    seen.delete(u); level.set(u, l); return l;
  };
  for (const u of units) u.level = levelOf(u.id);
  const upward = unitEdges.filter((e) => sccOf.has(e.from) && sccOf.get(e.from) === sccOf.get(e.to)).map((e) => ({ ...e, key: `u:${e.from}>${e.to}` }));
  const fanIn = new Map();
  for (const e of unitEdges) fanIn.set(e.to, (fanIn.get(e.to) ?? new Set()).add(e.from));
  for (const u of units) u.fanIn = fanIn.get(u.id)?.size ?? 0;
  const hubLine = Math.max(3, outlierLine(units.map((u) => u.fanIn)));
  const hubs = units.filter((u) => u.fanIn >= hubLine || u.fanIn >= Math.max(3, units.length * 0.25)).sort((a, b) => b.fanIn - a.fanIn).slice(0, 8);

  // size: outlier files and fat units, against this repository's own distribution
  const fileLine = outlierLine(source.map(([, f]) => f.lines));
  const outliers = source.filter(([, f]) => f.lines > fileLine).map(([path, f]) => ({ path, lines: f.lines, key: `o:${path}` })).sort((a, b) => b.lines - a.lines);
  const unitLine = outlierLine(units.map((u) => u.lines));
  const fat = units.filter((u) => u.lines > unitLine).sort((a, b) => b.lines - a.lines);

  // hotspots: lines × commits, the outliers of that product among files that changed
  const scored = churn ? source.map(([path, f]) => ({ path, lines: f.lines, changes: churn.get(path) ?? 0 })).filter((r) => r.changes > 0).map((r) => ({ ...r, score: r.lines * r.changes })) : [];
  const hotLine = outlierLine(scored.map((r) => r.score));
  const hotspots = scored.filter((r) => r.score > hotLine).sort((a, b) => b.score - a.score).slice(0, 15).map((r) => ({ ...r, key: `h:${r.path}` }));

  // unused exports: exported, never imported by name or wholesale, the name in no other file; then split
  // exactly by whether the own file reads it: dead code (read nowhere, delete it) or a needless export (drop `export`)
  const used = usedNamesOf(model);
  const reexporters = new Map(); // name → files naming it in an `export … from`
  for (const e of edges) if (e.reexport) for (const n of e.names) if (n !== "*") reexporters.set(n, (reexporters.get(n) ?? 0) + 1);
  const dead = [];
  for (const [path, f] of files) {
    if (f.test) continue;
    const u = used.get(path);
    if (u?.has("*")) continue;
    for (const ex of f.exports) {
      // a name read in another file than its own and the barrels re-exporting it counts as used (a template, a string, a dynamic access)
      if (ex.name === "default" || u?.has(ex.name) || (model.usedWords.get(ex.name) ?? 0) - 1 - (reexporters.get(ex.name) ?? 0) > 0) continue;
      // a name a barrel passes on (`export … from`) and nobody reads through it is a needless export of the barrel, not dead code
      const needless = (ex.localUses ?? 0) > 0 || !!ex.passed;
      dead.push({ path, name: ex.name, line: ex.line, kind: needless ? "needless" : "code", passed: !!ex.passed, declKind: ex.declKind, key: `${needless ? "n" : "d"}:${path}#${ex.name}` });
    }
  }

  // shallow modules: an index offering at most one name over a folder of several files
  const shallow = [];
  for (const dir of model.modules) {
    const index = [...files.keys()].find((p) => posix.dirname(p) === (dir || ".") && /(^|\/)index\.[cm]?[jt]sx?$/.test(p));
    if (!index || files.get(index).test) continue;
    const f = files.get(index);
    const offered = f.exports.length + f.imports.filter((i) => i.reexport && i.names.includes("*")).length * 2;
    const inside = source.filter(([p]) => p.startsWith(dir ? `${dir}/` : "")).length;
    if (offered <= 1 && inside >= 3) shallow.push({ path: dir, offered, files: inside, key: `s:${dir}` });
  }

  const lines = source.reduce((s, [, f]) => s + f.lines, 0);
  return { files: source.length, tests: files.size - source.length, lines, modules: model.modules.size, modulesIn: model.modules, units, unitEdges, upward, cycles, hubs, outliers, fileLine, fat, unitLine, hotspots, dead, shallow, layers: Math.max(0, ...units.map((u) => u.level)) + 1 };
}

/**
 * The names each file has that someone reads: what is imported from it by name (or wholesale), what a
 * barrel re-exports from it and is itself read through that barrel, and everything a public package
 * (one not marked private) offers at its entries, since an outside caller may read it. A re-export alone
 * is not a use.
 */
function usedNamesOf(model) {
  const entries = entryFiles(model), used = new Map();
  const add = (path, name) => { const set = used.get(path) ?? used.set(path, new Set()).get(path); if (set.has(name)) return false; set.add(name); return true; };
  for (const p of entries.public) add(p, "*");
  for (const e of model.edges) if (!e.reexport) for (const n of e.names) add(e.to, n);
  const reexports = model.edges.filter((e) => e.reexport);
  for (let changed = true; changed; ) {
    changed = false;
    for (const e of reexports) {
      const at = used.get(e.from);
      if (!at) continue;
      if (e.names.includes("*")) { for (const n of at) if (n === "*" || model.files.get(e.to)?.exports.some((x) => x.name === n)) changed = add(e.to, n) || changed; }
      else for (const n of e.names) if (at.has("*") || at.has(n)) changed = add(e.to, n) || changed;
    }
  }
  return used;
}

const siteOf = (edges, pick) => { const e = edges.find(pick); return e ? `${e.from}:${e.line}` : null; };

/**
 * The files a package offers to others (its manifest's targets, its root index, an app's main and
 * config): `all` of them, and `public` those of packages not marked private plus the tool entry points
 * (configs, scripts), whose exports an outside caller may read and so are never counted unused.
 */
function entryFiles(model) {
  const all = new Set(), pub = new Set();
  for (const [dir, manifest] of model.manifests) {
    const base = dir === "." ? "" : dir, mine = [];
    const targets = [manifest.main, manifest.module, manifest.types, ...flat(manifest.exports), ...Object.values(manifest.bin ?? {})].filter((t) => typeof t === "string");
    for (const t of targets) for (const p of [posix.join(base, t), posix.join(base, t).replace(/\.js$/, ".ts")]) if (model.files.has(p)) mine.push(p);
    for (const p of model.files.keys()) if (/(^|\/)(src\/)?(index|main|app\.config|app\.routes)\.[cm]?[jt]sx?$/.test(p) && model.packageOf(p) === base && posix.dirname(p).split("/").length <= (base ? base.split("/").length + 2 : 2)) mine.push(p);
    for (const p of mine) { all.add(p); if (manifest.private !== true || /(^|\/)(main|app\.config|app\.routes)\.[cm]?[jt]sx?$/.test(p)) pub.add(p); }
  }
  for (const p of model.files.keys()) if (/(^|\/)[^/]*\.config\.[cm]?[jt]s$|(^|\/)(scripts|bin)\//.test(p)) { all.add(p); pub.add(p); }
  return { all, public: pub };
}
const flat = (v) => (typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).flatMap(flat) : []);

/**
 * Head against base: per measure the count before and after, what is new, what is gone, and the due
 * list: structural regressions (new cycle, new upward import, new dead export, new outlier file), which
 * fail `check`, then norms crossed (new hotspots, fat units grown), which warn.
 */
export function compareOf(base, head, renames = { files: new Map(), dirs: new Map() }) {
  const old = (path) => renames.files.get(path) ?? renames.dirs.get(path) ?? path;
  const atBase = (key) => key.replace(/^(\w):(.*)$/, (_, k, rest) => `${k}:${rest.split("|").map((p) => { const [a, b] = p.split("#"); return b ? `${old(a)}#${b}` : old(a); }).join("|")}`);
  const diff = (a, b) => { const was = new Set(a.map((x) => x.key)), now = new Set(b.map((x) => atBase(x.key))); return { base: a.length, head: b.length, added: b.filter((x) => !was.has(atBase(x.key))), gone: a.filter((x) => !now.has(x.key)) }; };
  const cycles = diff(base.cycles, head.cycles);
  const upward = diff(base.upward, head.upward);
  const dead = diff(base.dead.filter((d) => d.kind !== "needless"), head.dead.filter((d) => d.kind !== "needless"));
  const needless = diff(base.dead.filter((d) => d.kind === "needless"), head.dead.filter((d) => d.kind === "needless"));
  const outliers = diff(base.outliers, head.outliers);
  outliers.added = outliers.added.filter((o) => o.lines > base.fileLine); // over the norm as it stood too: a file the norm moved past is not a regression
  const hotspots = head.hotspots.length ? diff(base.hotspots ?? [], head.hotspots) : { base: 0, head: 0, added: [], gone: [] };
  const fatGrown = head.fat.filter((u) => !base.fat.some((b) => b.id === u.id));
  const regressions = [
    ...cycles.added.map((c) => ({ kind: "cycle", text: `new cycle: ${c.members.join(" ↔ ")}`, at: c.at })),
    ...upward.added.map((e) => ({ kind: "upward", text: `new upward import: ${e.from} → ${e.to}`, at: e.sites[0] })),
    ...dead.added.map((d) => ({ kind: "dead", text: `new dead code: ${d.name} (read nowhere: delete it)`, at: `${d.path}:${d.line}` })),
    ...needless.added.map((d) => ({ kind: "needless", text: `new needless export: ${d.name} (read only in its file: drop export)`, at: `${d.path}:${d.line}` })),
    ...outliers.added.map((o) => ({ kind: "outlier", text: `new outlier file: ${o.path} ${o.lines} lines (line ${head.fileLine})`, at: `${o.path}:1` })),
  ];
  const warnings = [
    ...fatGrown.map((u) => ({ kind: "fat", text: `unit grew past the norm: ${u.id} ${u.lines} lines (line ${head.unitLine})` })),
    ...(head.lines - base.lines > base.lines * 0.05 ? [{ kind: "lines", text: `${head.lines - base.lines} more lines (+${Math.round(((head.lines - base.lines) / base.lines) * 100)} %)` }] : []),
  ];
  return { cycles, upward, dead, needless, outliers, hotspots, fatGrown, regressions, warnings, lines: { base: base.lines, head: head.lines } };
}
