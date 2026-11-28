#!/usr/bin/env node
// The guide's checker (product-shape#D11, D22): how far a repository's folders and names stray from its product
// map, measured now and at a base, so a change is judged by what it added. No dependencies: node, and git run as
// a program, never through a shell. M4 runs only when dependency-cruiser is already on the machine.
//
//   node check.mjs [--base <ref>] [--all] [--scope <path>…]
//
// Default: exit 1 only on a violation new since the base. --all: exit 1 on any violation in the scope.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MAP_PATH = ".claude/skills/guide-product-map/SKILL.md";
const CODE_FILE = /\.[mc]?[jt]sx?$/;
const TEST_FILE = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[^/]+$/;

const fail = (line) => {
  console.error(line);
  process.exit(2);
};

function parseCommandLine(argv) {
  const options = { base: null, all: false, scopes: [] };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--all") options.all = true;
    else if (flag === "--base" && argv[i + 1]) options.base = argv[++i];
    else if (flag === "--scope" && argv[i + 1]) {
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) options.scopes.push(normalizeFolder(argv[++i]));
    } else fail(`unknown argument ${flag}: usage: node check.mjs [--base <ref>] [--all] [--scope <path>…]`);
  }
  return options;
}

const normalizeFolder = (path) => path.trim().replace(/`/g, "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");

function runGit(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] });
}

/** git's answer, or null when git exits non-zero (a ref that does not resolve, a grep that matched nothing). */
function tryGit(root, args) {
  try {
    return runGit(root, args);
  } catch {
    return null;
  }
}

/** Lowercase words of a path or an identifier, split on separators, kebab, snake and camel case. */
const wordsOf = (text) =>
  text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** A map word in one spelling, so `merge-lock`, `merge_lock` and `mergeLock` compare equal. */
const spellingOf = (text) => wordsOf(text).join("-");

/** Each part of a path as its words, the file name's extension off: `cli/code-wording.ts` is [[cli], [code, wording]]. */
const pathPartsOf = (path) => path.split("/").map((part, i, all) => wordsOf(i === all.length - 1 ? part.replace(/\.[^.]+$/, "") : part));

/** Whether `words` holds `term` as a contiguous run. */
const carries = (words, term) => words.some((_, start) => term.every((word, k) => words[start + k] === word));

const isUnder = (path, folder) => folder === "" || path === folder || path.startsWith(`${folder}/`);

// ── the map ──────────────────────────────────────────────────────────────────────────────────────────────────

function sectionLines(text, heading) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading}`);
  if (start < 0) return [];
  const end = lines.findIndex((line, i) => i > start && /^#{1,2}\s/.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end);
}

const bulletsOf = (lines) => lines.filter((line) => /^\s*[-*]\s+/.test(line)).map((line) => line.replace(/^\s*[-*]\s+/, "").replace(/`/g, "").trim());

const listCell = (cell) => (cell ?? "").replace(/`/g, "").split(",").map((item) => item.trim()).filter((item) => item && item !== "—" && item !== "-");

/** The map: its features (word and its aliases, entries, homes, retired; product-shape#D22, homes amended to a list), its horizontal folders, its stoplist; null without a table. */
function readProductMap(text) {
  const rows = sectionLines(text, "map").filter((line) => line.trim().startsWith("|"));
  const cellsOf = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
  if (rows.length < 2) return null;
  const header = cellsOf(rows[0]).map((cell) => cell.toLowerCase());
  const column = (name) => header.indexOf(name);
  if (["word", "entries", "home", "retired"].some((name) => column(name) < 0)) return null;
  const features = rows
    .slice(1)
    .map(cellsOf)
    .filter((cells) => !cells.every((cell) => /^:?-+:?$/.test(cell)))
    .map((cells) => {
      const [word = "", ...aliases] = listCell(cells[column("word")]);
      return { word, aliases, entries: listCell(cells[column("entries")]),
      homes: listCell(cells[column("home")]).map(normalizeFolder),
      retired: listCell(cells[column("retired")]) };
    })
    .filter((feature) => feature.word && feature.homes.length > 0);
  return {
    features,
    horizontal: bulletsOf(sectionLines(text, "horizontal")).map(normalizeFolder),
    stoplist: new Set(bulletsOf(sectionLines(text, "stoplist")).map(spellingOf)),
  };
}

// ── the layout the map implies ───────────────────────────────────────────────────────────────────────────────

/** Folders holding a home are the feature layers; a layer's child folders are its feature folders. */
function layoutOf(map) {
  const layers = [...new Set(map.features.flatMap((feature) => feature.homes.map((home) => home.split("/").slice(0, -1).join("/"))))];
  const isHorizontal = (path) => map.horizontal.some((folder) => isUnder(path, folder));
  const layerOf = (file) => layers.filter((layer) => isUnder(file, layer)).sort((a, b) => b.length - a.length)[0];
  const featureFolderOf = (file) => {
    const layer = layerOf(file);
    if (layer === undefined) return null;
    const rest = file.slice(layer === "" ? 0 : layer.length + 1).split("/");
    if (rest.length < 2) return null;
    const folder = layer === "" ? rest[0] : `${layer}/${rest[0]}`;
    return isHorizontal(folder) ? null : folder;
  };
  const isHome = (file, feature) => feature.homes.some((home) => isUnder(file, home));
  const homeOf = (file) => map.features.find((feature) => isHome(file, feature));
  return { layers, isHorizontal, layerOf, featureFolderOf, isHome, homeOf };
}

// ── what a revision holds ────────────────────────────────────────────────────────────────────────────────────

/** The files in scope at `revision`, or in the working tree when it is null, and the lines naming a retired word. */
function snapshotOf(root, revision, scopes, retiredWords) {
  const inScope = (file) => scopes.length === 0 || scopes.some((scope) => isUnder(file, scope));
  const split = (out) => (out ?? "").split("\0").filter(Boolean);
  let files;
  if (revision) files = split(tryGit(root, ["ls-tree", "-r", "--name-only", "-z", revision]));
  else {
    const deleted = new Set(split(tryGit(root, ["ls-files", "-z", "--deleted"])));
    files = [...new Set(split(tryGit(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])))].filter((file) => !deleted.has(file));
  }
  files = files.filter(inScope);
  const lines = [];
  if (retiredWords.length > 0) {
    const pattern = retiredWords.map((word) => wordsOf(word).join("[^a-z0-9]*")).join("|");
    const pathspecs = scopes.length > 0 ? ["--", ...scopes] : [];
    const grep = revision ? ["grep", "-I", "-n", "-i", "-z", "-E", "-e", pattern, revision] : ["grep", "--untracked", "-I", "-n", "-i", "-z", "-E", "-e", pattern];
    const out = tryGit(root, [...grep, ...pathspecs]) ?? "";
    for (const row of out.split("\n")) {
      const [path, number, text] = row.split("\0");
      if (text === undefined) continue;
      const file = revision ? path.slice(revision.length + 1) : path;
      if (CODE_FILE.test(file) && inScope(file)) lines.push({ file, number: Number(number), text });
    }
  }
  return { files, lines };
}

// ── the measures (guide-complexity: a table, not a chain) ────────────────────────────────────────────────────

function measureSpread({ map, layout, snapshot }) {
  const terms = map.features.flatMap((feature) =>
    [feature.word, ...feature.aliases, ...feature.entries].filter((term) => !map.stoplist.has(spellingOf(term))).map((term) => ({ term, words: wordsOf(term), feature })),
  );
  const violations = [];
  for (const file of snapshot.files) {
    const layer = layout.layerOf(file);
    if (layer === undefined || TEST_FILE.test(file) || layout.isHorizontal(file)) continue;
    // Path parts below the feature layer (product-shape#D22): a word matches a whole part or a contiguous run inside a compound one.
    const parts = pathPartsOf(file.slice(layer === "" ? 0 : layer.length + 1));
    const seen = new Set();
    for (const { term, words, feature } of terms) {
      if (seen.has(feature) || layout.isHome(file, feature) || !parts.some((part) => carries(part, words))) continue;
      seen.add(feature);
      violations.push({ key: `M1|${file}|${feature.word}`, file, term, feature });
    }
  }
  return violations;
}

function measureHiddenConcept({ map, layout, snapshot }) {
  const folders = new Set(snapshot.files.filter((file) => !TEST_FILE.test(file)).map(layout.featureFolderOf).filter(Boolean));
  return [...folders]
    .filter((folder) => !map.features.some((feature) => feature.homes.includes(folder)))
    .map((folder) => ({ key: `M2|${folder}`, file: `${folder}/` }));
}

function measureWordDrift({ map, snapshot }) {
  const retired = map.features.flatMap((feature) => feature.retired.map((word) => ({ word, words: wordsOf(word), feature })));
  const violations = new Map();
  const note = (file, entry, where) => {
    const key = `M3|${file}|${entry.word}`;
    if (!violations.has(key)) violations.set(key, { key, file, word: entry.word, feature: entry.feature, where });
  };
  for (const file of snapshot.files) for (const entry of retired) if (pathPartsOf(file).some((part) => carries(part, entry.words))) note(file, entry, "its path");
  for (const line of snapshot.lines) {
    const identifiers = line.text.match(/[A-Za-z_$][\w$]*/g) ?? [];
    for (const entry of retired) {
      const identifier = identifiers.find((name) => carries(wordsOf(name), entry.words));
      if (identifier) note(line.file, entry, `\`${identifier}\` at line ${line.number}`);
    }
  }
  return [...violations.values()];
}

/** dependency-cruiser's entry: the repository's own, else the one the dependency-graph skill caches. */
function findCruiser(root) {
  const local = join(root, "node_modules", "dependency-cruiser", "bin", "dependency-cruiser.mjs");
  if (existsSync(local)) return local;
  const cache = join(homedir(), ".cache", "swarmstorm-depgraph");
  if (!existsSync(cache)) return null;
  // dependency-cruiser cannot load TypeScript 7 or later (codebase-rework#D25): a cache built on one parses nothing.
  const cached = readdirSync(cache)
    .filter((version) => Number(/-ts(\d+)/.exec(version)?.[1] ?? 0) < 7)
    .sort()
    .reverse()
    .map((version) => join(cache, version, "node_modules", "dependency-cruiser", "bin", "dependency-cruiser.mjs"))
    .find(existsSync);
  return cached ?? null;
}

/** Imports from one feature folder into another, read at the working tree only; null with the reason when not measured. */
function measureCrossFeatureImports({ root, layout, scopes }) {
  const cruiser = findCruiser(root);
  if (!cruiser) return { notMeasured: "dependency-cruiser not found (the dependency-graph skill installs it)" };
  const roots = layout.layers.map((layer) => layer || ".").filter((layer) => scopes.length === 0 || scopes.some((scope) => isUnder(layer, scope) || isUnder(scope, layer)));
  let modules;
  try {
    const out = execFileSync(process.execPath, [cruiser, "--no-config", "--output-type", "json", "--exclude", "node_modules", "--do-not-follow", "node_modules", ...roots], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 1 << 28,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 300_000,
    });
    modules = JSON.parse(out).modules ?? [];
    if (modules.length === 0) return { notMeasured: "dependency-cruiser parsed no module under the feature layers" };
  } catch (error) {
    return { notMeasured: `dependency-cruiser failed: ${String(error.stderr || error.message).trim().split("\n")[0]}` };
  }
  const violations = new Map();
  for (const module of modules) {
    const from = module.source.replace(/\\/g, "/");
    const fromFolder = TEST_FILE.test(from) ? null : layout.featureFolderOf(from);
    if (!fromFolder || (scopes.length > 0 && !scopes.some((scope) => isUnder(from, scope)))) continue;
    for (const dependency of module.dependencies ?? []) {
      const to = (dependency.resolved ?? "").replace(/\\/g, "/");
      const toFolder = layout.featureFolderOf(to);
      if (!toFolder || toFolder === fromFolder) continue;
      const key = `M4|${from}|${toFolder}`;
      if (!violations.has(key)) violations.set(key, { key, file: from, fromFolder, to, toFolder });
    }
  }
  return { violations: [...violations.values()] };
}

const MEASURES = [
  {
    id: "M1",
    name: "spread",
    measure: measureSpread,
    fix: (v) => `fix: move it under ${v.feature.homes.map((home) => `${home}/`).join(" or ")}, the ${v.feature.word} feature's home, or add "${v.term}" to the map's ## Stoplist if the word is generic there`,
    describe: (v) => `carries "${v.term}" outside ${v.feature.homes.map((home) => `${home}/`).join(", ")}`,
  },
  {
    id: "M2",
    name: "hidden concept",
    measure: measureHiddenConcept,
    fix: () => "fix: name it in the map (the home of a feature, in the product's word), list it under ## Horizontal if it is storage, transport or process, or move its files to the home of the feature they serve",
    describe: () => "a feature folder no surface names",
  },
  {
    id: "M3",
    name: "word drift",
    measure: measureWordDrift,
    fix: (v) => `fix: rename it to the product word "${v.feature.word}"`,
    describe: (v) => `the retired word "${v.word}" in ${v.where}`,
  },
  {
    id: "M4",
    name: "cross-feature imports",
    measure: measureCrossFeatureImports,
    atWorkingTreeOnly: true,
    fix: (v) => `fix: move what it imports into ${v.fromFolder}/ or a horizontal folder, or name the concept both share in the map`,
    describe: (v) => `imports ${v.to} from the feature ${v.toFolder}/`,
  },
];

// ── the run ──────────────────────────────────────────────────────────────────────────────────────────────────

function resolveBase(root, requested) {
  if (requested) {
    const sha = tryGit(root, ["rev-parse", "--verify", "--quiet", `${requested}^{commit}`]);
    if (!sha) fail(`the base ${requested} does not resolve to a commit: pass --base <ref> with a branch, tag or sha`);
    return { sha: sha.trim(), how: `--base ${requested}` };
  }
  for (const branch of ["origin/HEAD", "main"]) {
    const sha = tryGit(root, ["merge-base", "HEAD", branch]);
    if (sha) return { sha: sha.trim(), how: `merge-base with ${branch}` };
  }
  fail("no base: neither origin/HEAD nor main shares history with HEAD; pass --base <ref>");
}

function main() {
  const options = parseCommandLine(process.argv.slice(2));
  const top = tryGit(process.cwd(), ["rev-parse", "--show-toplevel"]);
  if (!top) fail("not inside a git repository: run it from the repository whose product map is checked");
  const root = top.trim();
  const mapFile = join(root, MAP_PATH);
  const map = existsSync(mapFile) ? readProductMap(readFileSync(mapFile, "utf8")) : null;
  if (!map) {
    console.log(`no product map at ${MAP_PATH} (or no "## Map" table with word | entries | home | retired): write it as the guide-screaming-architecture skill's references/product-map.md says; nothing measured`);
    return 0;
  }
  const layout = layoutOf(map);
  const scopes = options.scopes.length > 0 ? options.scopes : [...layout.layers, ...map.horizontal];
  const scopesShown = scopes.includes("") ? "the whole repository" : scopes.join(", ");
  const base = resolveBase(root, options.base);
  const retiredWords = map.features.flatMap((feature) => feature.retired);
  const now = { root, map, layout, scopes: scopes.includes("") ? [] : scopes, snapshot: snapshotOf(root, null, scopes.includes("") ? [] : scopes, retiredWords) };
  const then = { ...now, snapshot: snapshotOf(root, base.sha, now.scopes, retiredWords) };
  const changedSinceBase = new Set([
    ...(tryGit(root, ["diff", "--name-only", "-z", base.sha]) ?? "").split("\0").filter(Boolean),
    ...(tryGit(root, ["ls-files", "-z", "--others", "--exclude-standard"]) ?? "").split("\0").filter(Boolean),
  ]);

  console.log(`product map ${MAP_PATH}; scope ${scopesShown}; base ${base.sha.slice(0, 8)} (${base.how})`);
  const shown = [];
  let newCount = 0;
  let totalCount = 0;
  for (const measure of MEASURES) {
    const current = measure.measure(now);
    if (current.notMeasured) {
      console.log(`${measure.id} not measured: ${current.notMeasured}`);
      continue;
    }
    const violations = current.violations ?? current;
    // M4 reads the working tree only: a violation is new when the file importing changed since the base.
    const before = measure.atWorkingTreeOnly ? null : new Set(measure.measure(then).map((v) => v.key));
    const isNew = (v) => (before ? !before.has(v.key) : changedSinceBase.has(v.file));
    const fresh = violations.filter(isNew);
    console.log(`${measure.id} ${measure.name}: ${violations.length} (${fresh.length} new)`);
    for (const v of options.all ? violations : fresh) shown.push(`  ${measure.id} ${v.file}: ${measure.describe(v)}${isNew(v) ? " (new)" : ""}; ${measure.fix(v)}`);
    newCount += fresh.length;
    totalCount += violations.length;
  }
  const counted = now.snapshot.files.filter((file) => !TEST_FILE.test(file) && !layout.isHorizontal(file) && layout.layerOf(file) !== undefined);
  const housed = counted.filter((file) => layout.homeOf(file));
  const percent = counted.length === 0 ? 100 : Math.round((100 * housed.length) / counted.length);
  console.log(`alignment ${percent}% (${housed.length} of ${counted.length} files under the feature layers sit under a home; tests and horizontal folders apart)`);
  if (shown.length > 0) console.log(options.all ? "every violation in scope:" : `new since ${base.sha.slice(0, 8)}:`);
  for (const line of shown) console.log(line);
  const failing = options.all ? totalCount : newCount;
  console.log(failing > 0 ? `${failing} ${options.all ? "" : "new "}violation${failing === 1 ? "" : "s"}: fix each as its line says, then run again` : options.all ? "no violation in scope" : `no new violation since ${base.sha.slice(0, 8)}`);
  return failing > 0 ? 1 : 0;
}

process.exitCode = main();
