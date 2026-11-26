// What the verbs share: the model and insights held per commit for this process, the comparison of
// a head with a base (whole or seen from one scope), the kinds of changed files, and the readings
// git gives exactly (blame per function, empty folders). The verbs (verbs.mjs) only shape answers.
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, posix } from "node:path";
import { compareOf, insightsOf } from "./insights.mjs";
import { modelOf } from "./model.mjs";
import { baseOf, churnOf, commitOf, isTest, netOf, rangeChurnOf, renamesOf, sinceOf, treeOf } from "./repo.mjs";

export const CHURN_DAYS = 60;

/**
 * Which commits count as "changes often": with a base named (`--since`, a picked base), the commits of
 * base..head; without one, the last CHURN_DAYS days. `{ churn, label, range }`, the label said wherever a count is shown.
 */
export function churnWindowOf(root, flags) {
  if (!flags.since) return { churn: churnOf(root, CHURN_DAYS), label: `commits in ${CHURN_DAYS} days`, range: null };
  const base = sinceOf(root, flags.since).base, head = flags.head ? commitOf(root, flags.head) : commitOf(root, "HEAD");
  return { churn: rangeChurnOf(root, base, head), label: `commits ${base}..${head}`, range: `${base}..${head}` };
}
export const BRANCH_DAYS = 30;
export const cache = new Map();
/** Drops every model this process holds: the repository changed. */
export const forget = () => cache.clear();

/** The model and insights at a commit (`null` = the working tree), memoised for this process. */
export function stateAt(root, ref, withHistory) {
  const key = `${ref ?? "work"}:${withHistory ? 1 : 0}`;
  if (cache.has(key)) return cache.get(key);
  const tree = treeOf(root, ref);
  const model = modelOf(tree, tree.configs);
  const history = withHistory ? { churn: churnOf(root, CHURN_DAYS) } : {};
  const state = { model, insights: insightsOf(model, history) };
  cache.set(key, state);
  return state;
}

export const short = (n) => (n >= 10000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
export const inScope = (scope) => (id) => !scope || id === scope || id.startsWith(`${scope}/`) || id.startsWith(scope);
export function scopeOf(state, asked) {
  if (!asked || asked === "all" || asked === ".") return null;
  const clean = asked.replace(/\\/g, "/").replace(/\/$/, "");
  const { model } = state;
  for (const [dir, m] of model.manifests) if (m.name === clean) return dir;
  if ([...model.files.keys()].some((p) => p === clean || p.startsWith(`${clean}/`))) return clean;
  const unit = model.units.find((u) => u.id.endsWith(`/${clean}`) || posix.basename(u.id) === clean);
  if (unit) return unit.id;
  throw new Error(`no folder, package or unit named ${asked}: try a path from the repository root`);
}
export const pct = (a, b) => (b ? `${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 100)} %` : "");
export const delta = (c) => `${c.base} → ${c.head}${c.added.length ? `  (${c.added.length} new)` : ""}${c.gone.length ? `  (${c.gone.length} gone)` : ""}`;

/** Head (a commit, or the working tree when `headRef` is absent) against base: both states, the comparison, the net lines. */
export function compared(root, sinceRef, headRef) {
  const since = sinceRef ? sinceOf(root, sinceRef) : { base: baseOf(root), note: null };
  const base = since.base;
  const headSha = headRef ? commitOf(root, headRef) : null;
  const head = headSha ?? commitOf(root, "HEAD");
  const now = stateAt(root, headSha, true);
  const was = stateAt(root, base, false);
  const net = netOf(root, base, headSha);
  const window = churnWindowOf(root, { since: sinceRef, head: headRef });
  const withNet = insightsOf(now.model, { churn: window.churn, net });
  const renames = renamesOf(root, base, headSha);
  const cmp = compareOf(was.insights, withNet, renames);
  const touched = new Set(net.keys());
  cmp.warnings.push(...withNet.hotspots.filter((h) => touched.has(h.path)).slice(0, 5).map((h) => ({ kind: "hotspot", text: `changed a hotspot: ${h.path} (${h.lines} lines × ${h.changes} commits)` })));
  // the commit that wrote the import line or the export is exact; a file crossing the size norm has no one line that did it, so no commit is named
  for (const r of cmp.regressions) if (r.kind !== "outlier") r.since = blameOf(root, r.at, headSha);
  const added = [...net.values()].reduce((s, r) => s + r.added, 0), removed = [...net.values()].reduce((s, r) => s + r.removed, 0);
  const byKind = {};
  for (const [path, r] of net) {
    const kind = kindOf(path);
    byKind[kind] ??= { added: 0, removed: 0, files: 0 };
    byKind[kind].added += r.added;
    byKind[kind].removed += r.removed;
    byKind[kind].files++;
  }
  return { base, baseNote: since.note, churnLabel: window.label, churnRange: window.range, head, working: !headSha, byKind, renames, netMap: net, now: withNet, was: was.insights, nowModel: now.model, wasModel: was.model, cmp, net: { added, removed, files: net.size } };
}

/** The comparison seen from inside one scope: every list and every count kept to what lies in it. */
export function scopedOf(c, keep) {
  const pick = (ins) => {
    const units = ins.units.filter((u) => keep(u.id));
    return { ...ins, units, modules: [...ins.modulesIn].filter(keep).length, unitEdges: ins.unitEdges.filter((e) => keep(e.from) || keep(e.to)), upward: ins.upward.filter((e) => keep(e.from) || keep(e.to)), cycles: ins.cycles.filter((x) => x.members.some(keep)), hubs: ins.hubs.filter((u) => keep(u.id)), outliers: ins.outliers.filter((o) => keep(o.path)), fat: ins.fat.filter((u) => keep(u.id)), hotspots: ins.hotspots.filter((h) => keep(h.path)), dead: ins.dead.filter((d) => keep(d.path)), shallow: ins.shallow.filter((s) => keep(s.path)), lines: units.reduce((s, u) => s + u.lines, 0), files: units.reduce((s, u) => s + u.files, 0) };
  };
  const now = pick(c.now), was = pick(c.was);
  const cmp = compareOf(was, now, c.renames);
  const since = new Map(c.cmp.regressions.map((r) => [r.text, r.since]));
  for (const r of cmp.regressions) r.since = since.get(r.text);
  cmp.warnings.push(...c.cmp.warnings.filter((w) => w.kind === "hotspot" && now.hotspots.some((h) => w.text.includes(h.path))));
  const net = [...c.netMap].filter(([p]) => keep(p));
  const byKind = {};
  for (const [path, r] of net) {
    const kind = kindOf(path);
    byKind[kind] ??= { added: 0, removed: 0, files: 0 };
    byKind[kind].added += r.added;
    byKind[kind].removed += r.removed;
    byKind[kind].files++;
  }
  return { ...c, now, was, cmp, byKind, net: { added: net.reduce((s, [, r]) => s + r.added, 0), removed: net.reduce((s, [, r]) => s + r.removed, 0), files: net.length } };
}

/** A scope that is one unit, broken into its first-level folders and files, with the imports between them. */
export function partsGraphOf(model, scope) {
  const partOf = (p) => (p.startsWith(`${scope}/`) ? `${scope}/${p.slice(scope.length + 1).split("/")[0]}` : null);
  const parts = new Map();
  for (const [p, f] of model.files) { const part = partOf(p); if (part && !f.test) { const u = parts.get(part) ?? parts.set(part, { id: part, lines: 0 }).get(part); u.lines += f.lines; } }
  const pairs = new Map();
  for (const e of model.edges) { const a = partOf(e.from), b = partOf(e.to); if (a && b && a !== b && !model.files.get(e.from).test) { const k = `${a}>${b}`; const row = pairs.get(k) ?? pairs.set(k, { from: a, to: b, count: 0 }).get(k); row.count++; } }
  return { units: [...parts.values()].sort((a, b) => b.lines - a.lines), edges: [...pairs.values()] };
}

/** What a changed file is, from its extension and the test conventions: code first, then tests, markup, data, docs. */
/** Net lines by kind of each commit of a range (oldest first), from `git diff` against its first parent, and the total. */
export function perCommitOf(root, range) {
  const shas = execFileSync("git", ["rev-list", "--reverse", "--no-merges", range], { windowsHide: true, cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  const total = {};
  const rows = shas.map((sha) => {
    const subject = execFileSync("git", ["log", "-1", "--format=%s", sha], { windowsHide: true, cwd: root, encoding: "utf8" }).trim();
    const byKind = {};
    for (const [path, r] of netOf(root, `${sha}^`, sha)) {
      const kind = kindOf(path);
      for (const into of [byKind, total]) {
        into[kind] ??= { added: 0, removed: 0, files: 0 };
        into[kind].added += r.added;
        into[kind].removed += r.removed;
        into[kind].files++;
      }
    }
    return { sha: sha.slice(0, 9), subject, byKind };
  });
  return { rows, total };
}

/** The commit a verb reads (`--head <ref>`), or null for the working tree. */
export const headShaOf = (root, flags) => (flags?.head ? commitOf(root, flags.head) : null);

export const KINDS = ["code", "tests", "markup", "data", "docs"];
export const kindOf = (path) =>
  /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(path) ? (isTest(path) ? "tests" : "code")
  : /\.(html|css|scss|sass|less|svg|vue|svelte)$/.test(path) ? "markup"
  : /\.(md|mdx|txt|rst|png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|otf)$/.test(path) ? "docs"
  : "data";
export const netByKind = (byKind) => KINDS.filter((k) => byKind[k]).map((k) => { const n = byKind[k].added - byKind[k].removed; return `${k} ${n >= 0 ? "+" : ""}${n}`; }).join(" · ");

/** Per function of one file: the distinct commits of the churn window that wrote a line still in it (git blame, exact for the lines that survive). */
export function functionChurnOf(root, path, functions, range) {
  let out;
  try {
    out = execFileSync("git", ["blame", "--line-porcelain", ...(range ? [range] : [`--since=${CHURN_DAYS}.days`]), "--", path], { windowsHide: true, cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return [];
  }
  const byLine = [];
  let line = 0, sha = "";
  for (const row of out.split("\n")) {
    const head = row.match(/^([0-9a-f]{40}) \d+ (\d+)/);
    if (head) { sha = head[1]; line = Number(head[2]); }
    else if (row.startsWith("boundary")) sha = "";
    else if (row.startsWith("\t")) byLine[line] = sha;
  }
  return functions
    .map((f) => ({ ...f, commits: new Set(byLine.slice(f.line, f.end + 1).filter(Boolean)).size }))
    .filter((f) => f.commits > 0)
    .sort((a, b) => b.commits - a.commits);
}

/** Folders on disk that hold no tracked or untracked-but-kept file, under folders git tracks: empty, or holding only ignored content (leftovers of moves and deletions). */
export function emptyFoldersOf(root) {
  const tracked = new Set();
  for (const p of execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { windowsHide: true, cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n")) for (let d = posix.dirname(p); d && d !== "."; d = posix.dirname(d)) tracked.add(d);
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith(".") || ["node_modules", "dist", "build", "coverage"].includes(e.name)) continue;
      const sub = dir ? `${dir}/${e.name}` : e.name;
      if (tracked.has(sub)) walk(sub);
      else if (tracked.has(dir)) out.push(sub); // under a tracked folder, holding nothing git tracks: empty, or only ignored content
    }
  };
  walk("");
  return out.sort();
}

/** The commit that wrote a line (`path:line`), or "uncommitted". */
export function blameOf(root, at, headSha) {
  const [, path, line] = String(at ?? "").match(/^(.*):(\d+)$/) ?? [];
  if (!path) return null;
  try {
    const out = execFileSync("git", ["blame", "-L", `${line},${line}`, "--porcelain", ...(headSha ? [headSha] : []), "--", path], { windowsHide: true, cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const sha = out.slice(0, 40);
    return /^0+$/.test(sha) ? "uncommitted" : `${sha.slice(0, 9)} ${out.match(/^summary (.*)$/m)?.[1]?.slice(0, 60) ?? ""}`.trim();
  } catch { return null; }
}

export const mermaidOf = (units, edges, upward) => {
  const id = (u) => u.replace(/[^\w]/g, "_");
  const up = new Set(upward.map((e) => `${e.from}>${e.to}`));
  const lines = ["graph TD", ...units.map((u) => `  ${id(u.id)}["${posix.basename(u.id) || u.id} · ${short(u.lines)}"]`)];
  for (const e of edges) lines.push(`  ${id(e.from)} -->|${e.count}| ${id(e.to)}`);
  edges.forEach((e, i) => {
    if (up.has(`${e.from}>${e.to}`)) lines.push(`  linkStyle ${i} stroke:#e5484d,stroke-width:2px`);
  });
  return lines.join("\n");
};



/** Findings per unit at base and head, and how many of the head's are new and how many of the base's are gone. */
export function unitHealthOf(c) {
  const rows = new Map(), row = (id) => rows.get(id) ?? rows.set(id, { base: 0, head: 0, new: 0, fixed: 0 }).get(id);
  const pathOf = (x) => x.path ?? x.members?.[0] ?? (x.at ? x.at.replace(/:\d+$/, "") : null);
  const count = (ins, model, side) => { for (const x of [...ins.dead, ...ins.outliers, ...ins.shallow, ...ins.cycles]) { const u = model.unitOf(pathOf(x)) ?? model.units.find((v) => pathOf(x)?.startsWith(`${v.id}/`))?.id; if (u) row(u)[side]++; } };
  count(c.now, c.nowModel, "head");
  count(c.was, c.wasModel, "base");
  for (const r of c.cmp.regressions) { const p = r.at?.replace(/:\d+$/, ""); const u = p && (c.nowModel.unitOf(p) ?? c.nowModel.units.find((v) => p.startsWith(`${v.id}/`))?.id); if (u) row(u).new++; }
  for (const x of [...c.cmp.cycles.gone, ...c.cmp.outliers.gone, ...c.cmp.dead.gone, ...c.cmp.upward.gone]) { const p = pathOf(x) ?? x.from; const u = p && (c.wasModel.unitOf(p) ?? p); if (u) row(u).fixed++; }
  return Object.fromEntries(rows);
}

/** Parts that never import each other, each with its own layers: the connected groups of the unit graph, levels counted inside each. */
export function stacksOf(units, edges) {
  const parent = new Map(units.map((u) => [u.id, u.id]));
  const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
  for (const e of edges) if (parent.has(e.from) && parent.has(e.to)) parent.set(find(e.from), find(e.to));
  const groups = new Map();
  for (const u of units) (groups.get(find(u.id)) ?? groups.set(find(u.id), []).get(find(u.id))).push(u);
  return [...groups.values()]
    .map((group) => {
      const min = Math.min(...group.map((u) => u.level));
      const byLevel = new Map();
      for (const u of group) (byLevel.get(u.level - min) ?? byLevel.set(u.level - min, []).get(u.level - min)).push(u.id);
      return { units: group.map((u) => u.id), depth: Math.max(...byLevel.keys()) + 1, levels: [...byLevel].sort((a, b) => b[0] - a[0]) };
    })
    .sort((a, b) => b.units.length - a.units.length);
}

export const pickUnit = (u) => ({ id: u.id, package: u.package, lines: u.lines, files: u.files, fanIn: u.fanIn, level: u.level, churn: u.churn, added: u.added, removed: u.removed });
export const measuresOf = (c) => ({
  cycles: { base: c.cmp.cycles.base, head: c.cmp.cycles.head, added: c.cmp.cycles.added.length },
  upward: { base: c.cmp.upward.base, head: c.cmp.upward.head, added: c.cmp.upward.added.length },
  outliers: { base: c.cmp.outliers.base, head: c.cmp.outliers.head, added: c.cmp.outliers.added.length },
  dead: { base: c.cmp.dead.base, head: c.cmp.dead.head, added: c.cmp.dead.added.length },
  needless: { base: c.cmp.needless.base, head: c.cmp.needless.head, added: c.cmp.needless.added.length },
  fat: { base: c.was.fat.length, head: c.now.fat.length },
  hubs: { base: c.was.hubs.length, head: c.now.hubs.length },
  shallow: { base: c.was.shallow.length, head: c.now.shallow.length },
  hotspots: { head: c.now.hotspots.length },
  lines: { base: c.was.lines, head: c.now.lines },
});
