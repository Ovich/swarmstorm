// Every verb as a function of the repository: `(ctx, args, flags) → { title, lines, count, data, exit? }`.
// The CLI prints the answer and records it; the page asks the same functions over HTTP. A model is built
// once per commit per process (memory only).
import { execFileSync } from "node:child_process";
import { posix } from "node:path";
import { BRANCH_DAYS, CHURN_DAYS, churnWindowOf, compared, delta, emptyFoldersOf, functionChurnOf, headShaOf, inScope, measuresOf, mermaidOf, netByKind, partsGraphOf, pct, perCommitOf, pickUnit, scopedOf, scopeOf, short, stacksOf, stateAt, unitHealthOf } from "./comparison.mjs";
import { FIT_VERBS } from "./fit-verbs.mjs";
import { baseOf, branchesOf, commitOf } from "./repo.mjs";
import { runsOf, stepsOf } from "./trace.mjs";

export const VERBS = {
  overview: {
    help: "overview [scope] [--since <ref>] [--mermaid]   the system at a glance: what is due since the base first, then units, layers, cycles, upward imports, hubs, hotspots, outliers, dead exports",
    run(root, [asked], flags) {
      const whole = compared(root, flags.since, flags.head);
      const scope = scopeOf({ model: whole.nowModel }, asked);
      const c = scope ? scopedOf(whole, inScope(scope)) : whole;
      const ins = c.now, cmp = c.cmp, keep = inScope(scope);
      const units = ins.units.filter((u) => keep(u.id)).sort((a, b) => b.lines - a.lines);
      const edges = ins.unitEdges.filter((e) => keep(e.from) || keep(e.to));
      if (flags.mermaid && scope && units.length <= 1) {
        const parts = partsGraphOf(c.nowModel, scope);
        return { title: "overview", lines: mermaidOf(parts.units, parts.edges, []).split("\n"), count: "", data: { mermaid: mermaidOf(parts.units, parts.edges, []) }, raw: true };
      }
      if (flags.mermaid) return { title: "overview", lines: mermaidOf(units, edges.filter((e) => e.count >= 2), ins.upward).split("\n"), count: "", data: { mermaid: mermaidOf(units, edges, ins.upward) }, raw: true };
      const due = [...cmp.regressions.map((r) => `✗ ${r.text}${r.at ? `  ${r.at}` : ""}${r.since ? `  since ${r.since}` : ""}`), ...cmp.warnings.map((w) => `! ${w.text}`)];
      const lines = [
        ...(c.baseNote ? [`base: ${c.baseNote}`] : []),
        `drift since ${c.base}: ${cmp.regressions.length} regressions, ${cmp.warnings.length} warnings`,
        ...(due.length ? due.slice(0, flags.full ? undefined : 8).map((l) => `  ${l}`) : ["  nothing degraded"]),
        `change   ${netByKind(c.byKind)} lines (${c.net.files} files)`,
        `size     ${ins.files} files · ${short(ins.lines)} lines (${pct(ins.lines, c.was.lines)}) · ${ins.modules} modules · ${ins.units.length} units · ${ins.layers} layers`,
        `cycles   ${delta(cmp.cycles)}${ins.cycles.length ? `  e.g. ${ins.cycles[0].members.slice(0, 3).join(" ↔ ")}` : ""}`,
        `upward   ${delta(cmp.upward)}${ins.upward[0] ? `  e.g. ${ins.upward[0].from} → ${ins.upward[0].to}` : ""}`,
        `hubs     ${ins.hubs.slice(0, 4).map((u) => `${u.id} ←${u.fanIn}`).join(" · ") || "none"}`,
        `hotspots (${c.churnLabel}) ${ins.hotspots.slice(0, 3).map((h) => `${h.path} ${h.lines}×${h.changes}`).join(" · ") || "none"}`,
        `outliers ${delta(cmp.outliers)} files over ${ins.fileLine} lines${ins.outliers[0] ? `, largest ${ins.outliers[0].path} ${ins.outliers[0].lines}` : ""}`,
        `fat      ${ins.fat.map((u) => `${u.id} ${short(u.lines)}`).slice(0, 4).join(" · ") || "none"} (units over ${Number.isFinite(ins.unitLine) ? short(ins.unitLine) : "— too few units for a norm"})`,
        `dead     ${delta(cmp.dead)} dead code (exported, read nowhere, its own file included)`,
        `needless ${delta(cmp.needless)} needless exports (read only inside their own file)`,
        `shallow  ${ins.shallow.length} modules offering ≤ 1 name`,
        `units    ${units.slice(0, flags.full ? undefined : 8).map((u) => `${u.id} ${short(u.lines)}`).join(" · ")}`,
      ];
      return { title: "overview", lines, count: `overview ${scope ?? "all"} · base ${c.base} → working tree at ${c.head}`, data: { base: c.base, head: c.head, churnLabel: c.churnLabel, scope, net: { ...c.net, byKind: c.byKind }, due: { regressions: cmp.regressions, warnings: cmp.warnings }, measures: measuresOf(c), units, edges, upward: ins.upward, cycles: ins.cycles, hubs: ins.hubs.map(pickUnit), hotspots: ins.hotspots, outliers: ins.outliers, fileLine: ins.fileLine, fat: ins.fat.map(pickUnit), unitLine: ins.unitLine, dead: ins.dead, shallow: ins.shallow, gone: { cycles: cmp.cycles.gone, upward: cmp.upward.gone, outliers: cmp.outliers.gone, dead: cmp.dead.gone.length }, working: c.working, baseUnits: c.was.units.filter((u) => keep(u.id)).map(pickUnit), baseEdges: c.was.unitEdges.filter((e) => keep(e.from) || keep(e.to)).map(({ from, to, count }) => ({ from, to, count })), unitHealth: unitHealthOf(c) } };
    },
  },
  check: {
    help: "check [--since <ref>]   the gate: exit 1 on a structural regression since the base (new cycle, upward import, dead export, outlier file), warnings for hotspots and growth; every scope",
    run(root, _args, flags) {
      const c = compared(root, flags.since, flags.head);
      const { regressions, warnings } = c.cmp;
      const lines = [...(c.baseNote ? [`base: ${c.baseNote}`] : []), ...regressions.map((r) => `✗ ${r.text}${r.at ? `  ${r.at}` : ""}${r.since ? `
    since ${r.since}` : ""}`), ...warnings.map((w) => `! ${w.text}`), `fixed: ${c.cmp.cycles.gone.length} cycles, ${c.cmp.upward.gone.length} upward imports, ${c.cmp.dead.gone.length} dead code, ${c.cmp.needless.gone.length} needless exports, ${c.cmp.outliers.gone.length} outlier files`];
      return { title: "check", lines, count: `check since ${c.base}: ${regressions.length ? `✗ ${regressions.length} regressions` : "✓ no regression"}, ${warnings.length} warnings`, data: { base: c.base, head: c.head, pass: regressions.length === 0, regressions, warnings, fixed: { cycles: c.cmp.cycles.gone, upward: c.cmp.upward.gone, dead: c.cmp.dead.gone.length, outliers: c.cmp.outliers.gone } }, exit: regressions.length ? 1 : 0 };
    },
  },
  cycles: {
    help: "cycles [scope]   import cycles on runtime imports, between modules (folders with an index) and between files, each with one import site",
    run(root, [asked], flags = {}) {
      const s = stateAt(root, headShaOf(root, flags), false), scope = scopeOf(s, asked), keep = inScope(scope);
      const list = s.insights.cycles.filter((c) => c.members.some(keep));
      return { title: "cycles", lines: list.map((c) => `${c.kind === "modules" ? "modules" : `${c.members.length} files`}: ${c.members.join(" ↔ ")}${c.at ? `  ${c.at}` : ""}`), count: `cycles ${scope ?? "all"}: ${list.filter((c) => c.kind === "modules").length} between modules, ${list.filter((c) => c.kind === "files").length} between files`, data: list };
    },
  },
  deps: {
    help: "deps <module|folder|file> [--edges] [--mermaid]   what it imports and who imports it, by unit, with the import lines (--edges: every file:line behind each)",
    run(root, [asked], flags) {
      if (!asked) throw new Error("name what to read: deps <folder|file|package>");
      if (flags.since || flags.head) {
        const c = compared(root, flags.since, flags.head), target = scopeOf({ model: c.nowModel }, asked), touch = (e) => inScope(target)(e.from) || inScope(target)(e.to);
        const key = (e) => `${e.from}>${e.to}`, was = new Map(c.was.unitEdges.filter(touch).map((e) => [key(e), e])), now = new Map(c.now.unitEdges.filter(touch).map((e) => [key(e), e]));
        const added = [...now.values()].filter((e) => !was.has(key(e))), removed = [...was.values()].filter((e) => !now.has(key(e))), changed = [...now.values()].filter((e) => was.has(key(e)) && was.get(key(e)).count !== e.count);
        const lines = [...added.map((e) => `+ ${e.from} → ${e.to} ·${e.count}  ${e.sites[0]}`), ...removed.map((e) => `− ${e.from} → ${e.to} ·${e.count}`), ...changed.map((e) => `~ ${e.from} → ${e.to} ·${was.get(key(e)).count} → ${e.count}`)];
        return { title: `deps ${target}`, lines, count: `deps ${target} since ${c.base}: ${added.length} new edges, ${removed.length} gone, ${changed.length} changed`, data: { base: c.base, head: c.head, added, removed, changed } };
      }
      const s = stateAt(root, headShaOf(root, flags), false), rootUnit = asked === "." && s.model.units.some((u) => u.id === ".");
      const scope = rootUnit ? "." : scopeOf(s, asked), inside = rootUnit ? (p) => s.model.unitOf(p) === "." : (p) => p === scope || p.startsWith(`${scope}/`);
      const out = new Map(), into = new Map();
      for (const e of s.model.edges) {
        if (inside(e.from) && !inside(e.to)) { const k = s.model.unitOf(e.to) ?? e.to; (out.get(k) ?? out.set(k, []).get(k)).push(`${e.from}:${e.line}`); }
        if (inside(e.to) && !inside(e.from)) { const k = s.model.unitOf(e.from) ?? e.from; (into.get(k) ?? into.set(k, []).get(k)).push(`${e.from}:${e.line}`); }
      }
      const rows = (m) => [...m].sort((a, b) => b[1].length - a[1].length);
      if (flags.mermaid) {
        const id = (u) => u.replace(/[^\w]/g, "_"), me = id(scope);
        const lines = ["graph LR", `  ${me}["${scope}"]`, ...rows(into).map(([u, l]) => `  ${id(u)}["${u}"] -->|${l.length}| ${me}`), ...rows(out).map(([u, l]) => `  ${me} -->|${l.length}| ${id(u)}["${u}"]`)];
        return { title: "deps", lines, count: "", data: { mermaid: lines.join("\n") }, raw: true };
      }
      const sites = (l) => (flags.edges ? l.map((x) => `      ${x}`) : []);
      const lines = ["imported by", ...rows(into).flatMap(([u, l]) => [`  ${u} ·${l.length}  ${l[0]}`, ...sites(l)]), "imports", ...rows(out).flatMap(([u, l]) => [`  ${u} ·${l.length}  ${l[0]}`, ...sites(l)])];
      return { title: `deps ${scope}`, lines, count: `deps ${scope}: imported by ${into.size} units, imports ${out.size}`, data: { target: scope, importers: Object.fromEntries(rows(into)), imports: Object.fromEntries(rows(out)) } };
    },
  },
  fan: {
    help: "fan [scope]   units ranked by how many others import them (hubs) and how many they import",
    run(root, [asked], flags = {}) {
      const s = stateAt(root, headShaOf(root, flags), false), keep = inScope(scopeOf(s, asked));
      const out = new Map();
      for (const e of s.insights.unitEdges) out.set(e.from, (out.get(e.from) ?? 0) + 1);
      const list = s.insights.units.filter((u) => keep(u.id)).map((u) => ({ id: u.id, fanIn: u.fanIn, fanOut: out.get(u.id) ?? 0 })).sort((a, b) => b.fanIn - a.fanIn);
      return { title: "fan", lines: list.slice(0, 25).map((u) => `${String(u.fanIn).padStart(3)} ← ${u.id} → ${u.fanOut}`), count: `fan: ${list.length} units, hubs ${s.insights.hubs.map((h) => h.id).join(", ") || "none"}`, data: list };
    },
  },
  layers: {
    help: "layers [scope]   the order the imports imply, from the units that import nothing (0) up; upward imports go against it",
    run(root, [asked], flags = {}) {
      const s = stateAt(root, headShaOf(root, flags), false), keep = inScope(scopeOf(s, asked));
      const units = s.insights.units.filter((u) => keep(u.id));
      const stacks = stacksOf(units, s.insights.unitEdges.filter((e) => keep(e.from) && keep(e.to)));
      const lines = stacks.flatMap((stack, i) => [`stack ${i + 1}: ${stack.units.length} units, ${stack.depth} layers`, ...stack.levels.map(([l, ids]) => `  ${String(l).padStart(2)}  ${ids.join(" · ")}`)]);
      lines.push(...s.insights.upward.filter((e) => keep(e.from)).map((e) => `upward  ${e.from} → ${e.to} ·${e.count}  ${e.sites[0]}`));
      return { title: "layers", lines, count: `layers: ${stacks.length} independent stacks (parts that never import each other), deepest ${Math.max(0, ...stacks.map((x) => x.depth))} layers, ${s.insights.upward.length} upward imports`, data: { stacks, upward: s.insights.upward } };
    },
  },
  hotspots: {
    help: `hotspots [scope] [--functions] [--since <ref>]   files where change costs most: lines × commits (in the last ${CHURN_DAYS} days, or base..head with --since), above the repository's own norm; --functions: inside each, the functions whose surviving lines were written by the most commits in that window (git blame)`,
    run(root, [asked], flags = {}) {
      const s = stateAt(root, headShaOf(root, flags), true), keep = inScope(scopeOf(s, asked));
      const window = churnWindowOf(root, flags);
      const all = flags.since ? compared(root, flags.since, flags.head).now.hotspots : s.insights.hotspots;
      const list = all.filter((h) => keep(h.path));
      if (flags.functions) {
        const rows = list.slice(0, flags.full ? undefined : 8).map((h) => ({ ...h, functions: functionChurnOf(root, h.path, s.model.files.get(h.path)?.functions ?? [], window.range) }));
        const lines = rows.flatMap((h) => [`${h.path}  ${h.lines} lines × ${h.changes} commits`, ...(h.functions.length ? h.functions.slice(0, 5).map((f) => `  ${String(f.commits).padStart(3)} commits  ${f.name}  :${f.line}-${f.end}`) : ["  (no named function holds a line this window wrote: its changes are statements, exports or types)"])]);
        return { title: "hotspots", lines, count: `hotspots by function: ${rows.length} files; commits = distinct ${window.label} that wrote a line still in the function (git blame)`, data: rows };
      }
      return { title: "hotspots", lines: list.map((h) => `${h.path}  ${h.lines} lines × ${h.changes} commits`), count: `hotspots: ${list.length} over the norm (lines × ${window.label})`, data: list };
    },
  },
  size: {
    help: "size [scope] [--since <ref>] [--head <ref>] [--per-commit <range>]   the weight of each unit and the outlier files, against the repository's own distribution; with --since, each unit's lines at base → head; --per-commit, net lines by kind for each commit of a range and the total",
    run(root, [asked], flags) {
      if (flags.perCommit) {
        const { rows, total } = perCommitOf(root, flags.perCommit);
        const lines = [...rows.map((r) => `${r.sha}  ${netByKind(r.byKind) || "no lines"}  ${r.subject.slice(0, 70)}`), `total  ${netByKind(total)}`];
        return { title: "size per commit", lines, count: `size per commit ${flags.perCommit}: ${rows.length} commits (merges left out; each against its first parent)`, data: { rows, total } };
      }
      if (flags.since || flags.head) {
        const c = compared(root, flags.since, flags.head), keep = inScope(scopeOf({ model: c.nowModel }, asked));
        const was = new Map(c.was.units.map((u) => [u.id, u.lines])), now = new Map(c.now.units.map((u) => [u.id, u.lines]));
        const ids = [...new Set([...was.keys(), ...now.keys()])].filter(keep);
        const rows = ids.map((id) => ({ id, base: was.get(id) ?? null, head: now.get(id) ?? null, delta: (now.get(id) ?? 0) - (was.get(id) ?? 0) })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
        const lines = rows.filter((r) => r.delta).map((r) => `${(r.delta > 0 ? "+" : "") + r.delta}`.padStart(7) + `  ${r.id}  ${r.base === null ? "new" : short(r.base)} → ${r.head === null ? "gone" : short(r.head)}`);
        return { title: "size", lines, count: `size since ${c.base}: ${netByKind(c.byKind)} · ${rows.filter((r) => r.delta).length} units changed, ${rows.filter((r) => r.base === null).length} new, ${rows.filter((r) => r.head === null).length} gone`, data: { base: c.base, head: c.head, units: rows } };
      }
      const s = stateAt(root, headShaOf(root, flags), false), keep = inScope(scopeOf(s, asked)), ins = s.insights;
      const units = ins.units.filter((u) => keep(u.id)).sort((a, b) => b.lines - a.lines);
      const files = ins.outliers.filter((o) => keep(o.path));
      const lines = [...units.slice(0, flags.full ? undefined : 15).map((u) => `${short(u.lines).padStart(6)}  ${u.id}${u.lines > ins.unitLine ? "  (fat)" : ""}`), `outlier files (over ${ins.fileLine} lines):`, ...files.map((o) => `  ${o.lines}  ${o.path}`)];
      return { title: "size", lines, count: `size: ${units.length} units, ${files.length} outlier files`, data: { units: units.map(pickUnit), outliers: files, fileLine: ins.fileLine, unitLine: ins.unitLine } };
    },
  },
  dead: {
    help: "dead [scope]   exports no other file reads (tests count as users), split exactly: dead code (read nowhere, its own file included) and needless exports (read only in their own file); --full grouped by kind and unit",
    run(root, [asked], flags = {}) {
      const s = stateAt(root, headShaOf(root, flags), false), keep = inScope(scopeOf(s, asked));
      const list = s.insights.dead.filter((d) => keep(d.path));
      const grouped = [["code", "dead code: read nowhere, delete it"], ["needless", "needless exports: read only in their file, drop export"]].flatMap(([kind, label]) => {
        const ofKind = list.filter((d) => d.kind === kind), byUnit = new Map();
        for (const d of ofKind) { const u = s.model.unitOf(d.path) ?? "."; (byUnit.get(u) ?? byUnit.set(u, []).get(u)).push(d); }
        return [`${label} · ${ofKind.length}`, ...[...byUnit].sort((a, b) => b[1].length - a[1].length).flatMap(([u, ds]) => [`  ${u} · ${ds.length}`, ...ds.map((d) => `    ${d.name}  ${d.path}:${d.line}${d.declKind === "type" ? "  (a type: a compile-time check if that is its purpose)" : ""}`)])];
      });
      return { title: "dead", lines: flags.full ? grouped : list.map((d) => `${d.kind === "code" ? "dead code " : "needless  "} ${d.name}  ${d.path}:${d.line}${d.declKind === "type" ? "  (type: a compile-time check?)" : ""}`), count: `dead: ${list.filter((d) => d.kind === "code").length} dead code, ${list.filter((d) => d.kind === "needless").length} needless exports`, data: list };
    },
  },
  branches: {
    help: `branches   unmerged branches that moved in ${BRANCH_DAYS} days, the units each touches, and files also changed on HEAD since they parted`,
    run(root) {
      const s = stateAt(root, headShaOf(root, flags), false);
      const list = branchesOf(root, BRANCH_DAYS).map((b) => ({ name: b.name, at: b.at, ahead: b.ahead, units: [...new Set(b.files.map((f) => s.model.unitOf(f)).filter(Boolean))], clashes: b.files.filter((f) => b.headFiles.has(f)) }));
      return { title: "branches", lines: list.map((b) => `${b.name} (${b.ahead} commits not on HEAD, last ${new Date(b.at * 1000).toISOString().slice(0, 10)}): ${b.units.join(", ") || "no source"}${b.clashes.length ? `  ⚠ also changed on HEAD: ${b.clashes.slice(0, 3).join(", ")}${b.clashes.length > 3 ? " …" : ""}` : ""}`), count: `branches: ${list.length} open, ${list.filter((b) => b.clashes.length).length} overlapping HEAD`, data: list };
    },
  },
  outline: {
    help: "outline <folder> [--since <ref>]   its subfolders and files by weight (the treemap's data), and what its index offers; with --since, each part's lines at base too",
    run(root, [asked], flags = {}) {
      const headSha = flags.head ? commitOf(root, flags.head) : null;
      const s = stateAt(root, headSha, true), scope = scopeOf(s, asked) ?? "", base = scope ? `${scope}/` : "";
      const kids = new Map();
      const window = churnWindowOf(root, flags), churn = window.churn;
      for (const [p, f] of s.model.files) {
        if (f.test || !p.startsWith(base)) continue;
        const rest = p.slice(base.length), name = rest.split("/")[0], isFile = !rest.includes("/");
        const k = kids.get(name) ?? { name, path: base + name, file: isFile, lines: 0, files: 0, churn: 0 };
        k.lines += f.lines; k.files++; k.churn += churn.get(p) ?? 0; kids.set(name, k);
      }
      if (flags.since || flags.head) {
        const was = stateAt(root, baseOf(root, flags.since), false);
        for (const [p, f] of was.model.files) {
          if (f.test || !p.startsWith(base)) continue;
          const rest = p.slice(base.length), name = rest.split("/")[0];
          const k = kids.get(name) ?? kids.set(name, { name, path: base + name, file: !rest.includes("/"), lines: 0, files: 0, churn: 0 }).get(name);
          k.baseLines = (k.baseLines ?? 0) + f.lines;
        }
        for (const k of kids.values()) k.baseLines ??= 0;
      }
      const list = [...kids.values()].sort((a, b) => Math.max(b.lines, b.baseLines ?? 0) - Math.max(a.lines, a.baseLines ?? 0));
      const index = [...s.model.files.keys()].find((p) => posix.dirname(p) === (scope || ".") && /\/?index\.[cm]?[jt]sx?$/.test(p));
      const offers = index ? s.model.files.get(index).exports.map((e) => e.name) : [];
      return { title: `outline ${scope}`, lines: [...list.map((k) => `${k.baseLines !== undefined ? `${short(k.baseLines).padStart(6)} →` : ""}${short(k.lines).padStart(6)}  ${k.name}${k.file ? "" : "/"}  ${k.churn}Δ`), ...(index ? [`index offers ${offers.length}: ${offers.slice(0, 12).join(", ")}${offers.length > 12 ? " …" : ""}`] : [])], count: `outline ${scope || "."}: ${list.length} parts · Δ = ${window.label}`, data: { path: scope, parts: list, index, offers, churnLabel: window.label } };
    },
  },
  uses: {
    help: "uses <name>   the files that import a name, with the line",
    run(root, [name], flags = {}) {
      if (!name) throw new Error("name the export: uses <Name>");
      const s = stateAt(root, headShaOf(root, flags), false);
      const list = s.model.edges.filter((e) => e.names.includes(name)).map((e) => ({ from: e.from, line: e.line, to: e.to }));
      return { title: `uses ${name}`, lines: list.map((u) => `${u.from}:${u.line}  ← ${u.to}`), count: `uses ${name}: ${list.length} imports`, data: list };
    },
  },
  shallow: {
    help: "shallow [scope]   modules whose index offers at most one name over several files, and folders that hold no tracked file at all",
    run(root, [asked], flags = {}) {
      const s = stateAt(root, headShaOf(root, flags), false), keep = inScope(scopeOf(s, asked));
      const list = s.insights.shallow.filter((x) => keep(x.path));
      const empty = emptyFoldersOf(root).filter(keep);
      const lines = [...list.map((x) => `${x.path}  offers ${x.offered} · ${x.files} files`), ...(empty.length ? ["folders with no tracked file:", ...empty.map((d) => `  ${d}`)] : [])];
      return { title: "shallow", lines, count: `shallow: ${list.length} modules, ${empty.length} empty folders`, data: { shallow: list, empty } };
    },
  },
  "same-names": {
    help: "same-names [scope]   functions declared under one name in several files, and which of them are byte-identical",
    run(root, [asked], flags = {}) {
      const s = stateAt(root, headShaOf(root, flags), false), keep = inScope(scopeOf(s, asked));
      const byName = new Map();
      for (const [path, f] of s.model.files) if (!f.test && keep(path)) for (const fn of f.functions ?? []) (byName.get(fn.name) ?? byName.set(fn.name, []).get(fn.name)).push({ path, ...fn });
      const groups = [...byName].filter(([, xs]) => new Set(xs.map((x) => x.path)).size > 1).map(([name, xs]) => ({ name, places: xs, identical: xs.length - new Set(xs.map((x) => x.hash)).size > 0 ? [...new Set(xs.map((x) => x.hash))].filter((h) => xs.filter((x) => x.hash === h).length > 1).map((h) => xs.filter((x) => x.hash === h).map((x) => `${x.path}:${x.line}`)) : [] })).sort((a, b) => b.places.length - a.places.length || a.name.localeCompare(b.name));
      const lines = groups.flatMap((g) => [`${g.name} · ${g.places.length} places${g.identical.length ? ` · ${g.identical.map((ids) => ids.length).join("+")} byte-identical` : ""}`, ...g.places.map((x) => `  ${x.path}:${x.line}`)]);
      return { title: "same-names", lines, count: `same-names: ${groups.length} names declared in several files, ${groups.filter((g) => g.identical.length).length} with byte-identical bodies`, data: groups };
    },
  },
  refs: {
    help: "refs   recent commits and branches, to pick a base or a head",
    run(root) {
      const log = execFileSync("git", ["log", "-30", "--format=%h%x09%cs%x09%s"], { windowsHide: true, cwd: root, encoding: "utf8" }).trim().split(/\r?\n/).map((l) => { const [sha, date, subject] = l.split("\t"); return { ref: sha, label: `${sha} ${date} ${subject.slice(0, 60)}` }; });
      const heads = execFileSync("git", ["for-each-ref", "--sort=-committerdate", "--count=30", "--format=%(refname:short)", "refs/heads"], { windowsHide: true, cwd: root, encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean).map((b) => ({ ref: b, label: b }));
      return { title: "refs", lines: [...heads.map((h) => h.label), ...log.map((l) => l.label)], count: `${heads.length} branches, ${log.length} commits`, data: { branches: heads, commits: log, base: baseOf(root) } };
    },
  },
  runs: {
    help: "runs [<run>]   the recorded runs of this repository, or one run's calls",
    run(root, [id]) {
      if (id) { const steps = stepsOf(root, id); return { title: `run ${id}`, lines: steps.map((s) => `${s.at.slice(11, 19)}  code ${s.argv.join(" ")}  → ${s.count}`), count: `${steps.length} calls`, data: steps }; }
      const runs = runsOf(root);
      return { title: "runs", lines: runs.map((r) => `${r.id}  ${r.steps} calls  ${r.lastAt.slice(0, 16)}`), count: `${runs.length} runs`, data: runs };
    },
  },
};
Object.assign(VERBS, FIT_VERBS);
