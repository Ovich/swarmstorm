// The code as a graph, read from one tree (repo.mjs): every source file parsed alone with TypeScript's
// parser, its imports resolved (relative paths, workspace packages, tsconfig paths), then grouped into
// modules (a package, or a folder holding an index file) and into the map's units. No configuration:
// all of it is inferred from the files.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, posix } from "node:path";
import { isTest } from "./repo.mjs";

/** TypeScript's parser API, from the bench's own install (TypeScript 7 ships none): `npm ci` in this skill's folder once. */
const ts = (() => {
  try {
    return createRequire(import.meta.url)("typescript");
  } catch {
    throw new Error("typescript not installed for the codebase bench: run npm ci in .claude/skills/workbench-codebase");
  }
})();

const EXTS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const INDEX = /(^|\/)index\.[cm]?[jt]sx?$/;
const WORD = /[A-Za-z_$][\w$]*/g;
const FACTS_VERSION = 5; // raised whenever factsOf answers differently, so an older cache is never read
const CACHE_KEEP = 20000;

/**
 * Parsed facts by file content, kept between calls in the tool's own cache folder: derived data,
 * rebuilt from the sources whenever it is missing, so every call after the first parses only what changed.
 */
function factsCache(dir) {
  const file = dir ? join(dir, `facts-${FACTS_VERSION}.json`) : null;
  let held = {};
  try {
    if (file && existsSync(file)) held = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    held = {};
  }
  const used = new Map();
  let added = 0;
  return {
    get: (key) => {
      const f = held[key];
      if (f) used.set(key, f);
      return f;
    },
    set: (key, f) => {
      used.set(key, f);
      added++;
    },
    save: () => {
      if (!file || !added) return;
      const keep = Object.fromEntries([...Object.entries(held).slice(-CACHE_KEEP), ...used]);
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, JSON.stringify(keep));
    },
  };
}

/** One file's facts: its lines, its imports and re-exports (`{ spec, names, typeOnly, line }`), its exported names. */
function factsOf(path, text) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, /x$/.test(path) ? ts.ScriptKind.TSX : undefined);
  const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const imports = [], exports = [];
  const exported = (node) => ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const node of source.statements) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const named = clause?.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : [];
      const names = [...(clause?.name ? ["default"] : []), ...named.map((e) => (e.propertyName ?? e.name).text), ...(clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings) ? ["*"] : [])];
      const typeOnly = !!clause && (clause.isTypeOnly || (!clause.name && named.length > 0 && named.every((e) => e.isTypeOnly)));
      imports.push({ spec: node.moduleSpecifier.text, names, typeOnly, line: lineOf(node) });
    } else if (ts.isExportDeclaration(node)) {
      const names = node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements.map((e) => e.name.text) : ["*"];
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const from = node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements.map((e) => (e.propertyName ?? e.name).text) : ["*"];
        imports.push({ spec: node.moduleSpecifier.text, names: from, typeOnly: node.isTypeOnly, line: lineOf(node), reexport: true });
      }
      for (const name of names) if (name !== "*") exports.push({ name, line: lineOf(node), listed: !node.moduleSpecifier, passed: !!node.moduleSpecifier });
    } else if (ts.isExportAssignment(node)) exports.push({ name: "default", line: lineOf(node) });
    else if (exported(node)) {
      const isDefault = (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
      const names = ts.isVariableStatement(node) ? node.declarationList.declarations.flatMap((d) => (ts.isIdentifier(d.name) ? [d.name.text] : [])) : node.name ? [node.name.text] : [];
      const declKind = ts.isTypeAliasDeclaration(node) ? "type" : ts.isInterfaceDeclaration(node) ? "interface" : ts.isClassDeclaration(node) ? "class" : ts.isFunctionDeclaration(node) ? "function" : ts.isEnumDeclaration(node) ? "enum" : "value";
      for (const name of isDefault ? ["default"] : names) exports.push({ name, line: lineOf(node), declKind });
    }
  }
  for (const match of text.matchAll(/(?:\bimport|\brequire)\s*\(\s*["'`]([^"'`]+)["'`]/g)) imports.push({ spec: match[1], names: ["*"], typeOnly: false, line: text.slice(0, match.index).split("\n").length, dynamic: true });
  // how often each exported name is read in its own file, past its declaration and an export list naming it again
  const occurrences = new Map();
  for (const word of text.match(WORD) ?? []) occurrences.set(word, (occurrences.get(word) ?? 0) + 1);
  for (const ex of exports) ex.localUses = Math.max(0, (occurrences.get(ex.name) ?? 0) - 1 - (ex.listed ? 1 : 0));
  const onlyReexports = source.statements.length > 0 && source.statements.every((s) => ts.isExportDeclaration(s) && !!s.moduleSpecifier);
  return { lines: text.split("\n").length, imports, exports, functions: functionsOf(source, text), onlyReexports, ...shapesOf(source) };
}

/**
 * What the whole tree says about types and their values: the interfaces a class implements, the types an
 * object `satisfies`, and the `kind` literals declared in a type (a union's variants) and those written
 * into an object (produced). All read from the syntax, exactly as written.
 */
function shapesOf(source) {
  const implementsOf = [], satisfiesOf = [], kindDeclared = [], kindProduced = [];
  const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const nameOf = (node) => (ts.isIdentifier(node) ? node.text : ts.isPropertyAccessExpression(node) ? node.name.text : null);
  const keyIsKind = (name) => name && ((ts.isIdentifier(name) && name.text === "kind") || (ts.isStringLiteral(name) && name.text === "kind"));
  const visit = (node) => {
    if (ts.isClassDeclaration(node)) for (const h of node.heritageClauses ?? []) if (h.token === ts.SyntaxKind.ImplementsKeyword) for (const t of h.types) { const n = nameOf(t.expression); if (n) implementsOf.push({ name: n, line: lineOf(t) }); }
    if (ts.isSatisfiesExpression?.(node) && ts.isTypeReferenceNode(node.type)) { const n = nameOf(node.type.typeName); if (n) satisfiesOf.push({ name: n, line: lineOf(node) }); }
    if (ts.isPropertySignature(node) && keyIsKind(node.name) && node.type && ts.isLiteralTypeNode(node.type) && ts.isStringLiteral(node.type.literal)) kindDeclared.push({ value: node.type.literal.text, line: lineOf(node) });
    if (ts.isPropertyAssignment(node) && keyIsKind(node.name) && ts.isStringLiteralLike(node.initializer)) kindProduced.push(node.initializer.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { implementsOf, satisfiesOf, kindDeclared, kindProduced: [...new Set(kindProduced)] };
}

/** The named functions of a file (top-level functions, functions held by a const, class methods): name, first and last line, a hash of the exact text. */
function functionsOf(source, text) {
  const out = [];
  const lineOf = (pos) => source.getLineAndCharacterOfPosition(pos).line + 1;
  const add = (name, node) => out.push({ name, line: lineOf(node.getStart(source)), end: lineOf(node.end), hash: createHash("sha1").update(text.slice(node.getStart(source), node.end)).digest("hex").slice(0, 16) });
  for (const node of source.statements) {
    if (ts.isFunctionDeclaration(node) && node.name) add(node.name.text, node);
    else if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) add(d.name.text, d);
    } else if (ts.isClassDeclaration(node) && node.name) {
      for (const m of node.members) if ((ts.isMethodDeclaration(m) || ts.isGetAccessor(m)) && m.name && ts.isIdentifier(m.name)) add(`${node.name.text}.${m.name.text}`, m);
    }
  }
  return out;
}

/** The tsconfig `paths` that apply under each folder: `[{ dir, base, paths }]`, nearest first when matched. */
function pathRules(files) {
  const rules = [];
  for (const [path, text] of files) {
    if (!/(^|\/)tsconfig[^/]*\.json$/.test(path)) continue;
    const { config } = ts.parseConfigFileTextToJson(path, text);
    const options = config?.compilerOptions;
    if (!options?.paths) continue;
    const dir = posix.dirname(path);
    rules.push({ dir: dir === "." ? "" : dir, base: posix.join(dir, options.baseUrl ?? "."), paths: options.paths });
  }
  return rules.sort((a, b) => b.dir.length - a.dir.length);
}

/** The resolver for one tree: `(from, spec) → path | null`; external packages resolve to null. */
function resolverOf(files, manifests, configs) {
  const has = (path) => files.has(path);
  const probe = (base) => {
    const clean = posix.normalize(base).replace(/\/$/, "");
    if (has(clean)) return clean;
    const swapped = clean.replace(/\.(m|c)?js$/, (_, k) => `.${k ?? ""}ts`);
    if (swapped !== clean && has(swapped)) return swapped;
    if (/\.jsx$/.test(clean) && has(clean.replace(/x$/, "").replace(/\.js$/, ".tsx"))) return clean.replace(/\.jsx$/, ".tsx");
    for (const ext of EXTS) if (has(clean + ext)) return clean + ext;
    for (const ext of EXTS) if (has(`${clean}/index${ext}`)) return `${clean}/index${ext}`;
    return null;
  };
  const packages = [...manifests].filter(([, m]) => m.name).map(([dir, m]) => ({ dir: dir === "." ? "" : dir, name: m.name, manifest: m })).sort((a, b) => b.name.length - a.name.length);
  const entryOf = (pkg, sub) => {
    const key = sub ? `./${sub}` : ".";
    const pick = (v) => (typeof v === "string" ? v : v && typeof v === "object" ? pick(v.types ?? v.import ?? v.default ?? v.require) : undefined);
    const exportsMap = typeof pkg.manifest.exports === "string" ? { ".": pkg.manifest.exports } : pkg.manifest.exports;
    const targets = [pick(exportsMap?.[key]), ...(sub ? [sub, `src/${sub}`] : [pkg.manifest.types, pkg.manifest.module, pkg.manifest.main, "src/index", "index"])];
    for (const target of targets) if (target) { const found = probe(posix.join(pkg.dir, target)); if (found) return found; }
    return null;
  };
  const configs_ = pathRules(configs);
  return (from, spec) => {
    if (spec.startsWith(".")) return probe(posix.join(posix.dirname(from), spec));
    for (const rule of configs_) {
      if (rule.dir && !from.startsWith(`${rule.dir}/`)) continue;
      for (const [pattern, targets] of Object.entries(rule.paths)) {
        const star = pattern.indexOf("*");
        const hit = star < 0 ? spec === pattern : spec.startsWith(pattern.slice(0, star)) && spec.endsWith(pattern.slice(star + 1));
        if (!hit) continue;
        const middle = star < 0 ? "" : spec.slice(star, spec.length - (pattern.length - star - 1));
        for (const target of targets) { const found = probe(posix.join(rule.base, target.replace("*", middle))); if (found) return found; }
      }
    }
    for (const pkg of packages) if (spec === pkg.name || spec.startsWith(`${pkg.name}/`)) return entryOf(pkg, spec.slice(pkg.name.length + 1));
    return null;
  };
}

/**
 * The graph of one tree: `{ files, edges, modules, units, unitOf, moduleOf, packages, usedWords }`.
 * `files`: path → `{ lines, imports, exports, test }`; `edges`: `[{ from, to, typeOnly, line, names }]`, resolved only.
 */
export function modelOf(tree, configTexts) {
  const files = new Map();
  const usedWords = new Map(); // word → number of files that hold it
  const cache = factsCache(tree.cacheDir);
  for (const [path, text] of tree.files) {
    const key = `${path}@${tree.ids?.get(path) ?? createHash("sha1").update(text).digest("hex")}`;
    let facts = cache.get(key);
    if (!facts) {
      try {
        facts = factsOf(path, text);
      } catch {
        facts = { lines: text.split("\n").length, imports: [], exports: [], functions: [] };
      }
      facts.words = [...new Set(text.match(WORD))];
      cache.set(key, facts);
    }
    files.set(path, { ...facts, test: isTest(path) });
    for (const word of facts.words) usedWords.set(word, (usedWords.get(word) ?? 0) + 1);
  }
  cache.save();
  const resolve = resolverOf(tree.files, tree.manifests, configTexts);
  const edges = [];
  for (const [from, facts] of files) for (const imp of facts.imports) { const to = resolve(from, imp.spec); if (to && to !== from) edges.push({ from, to, typeOnly: imp.typeOnly, line: imp.line, names: imp.names, reexport: !!imp.reexport }); }

  const packageDirs = [...tree.manifests.keys()].map((d) => (d === "." ? "" : d)).sort((a, b) => b.length - a.length);
  const packageOf = (path) => packageDirs.find((d) => d === "" || path.startsWith(`${d}/`)) ?? "";
  const moduleDirs = new Set(packageDirs);
  for (const path of files.keys()) if (INDEX.test(path)) moduleDirs.add(posix.dirname(path) === "." ? "" : posix.dirname(path));
  const moduleOf = (path) => { for (let dir = posix.dirname(path); ; dir = posix.dirname(dir)) { const d = dir === "." ? "" : dir; if (moduleDirs.has(d)) return d; if (!d) return ""; } };

  const units = unitsOf(files, packageDirs, moduleDirs, packageOf);
  const unitOf = (path) => units.byFile.get(path);
  return { files, edges, modules: moduleDirs, moduleOf, packageOf, packages: packageDirs, units: units.list, unitOf, usedWords, manifests: tree.manifests };
}

/**
 * The map's units: each package, or, inside a large package, the modules found at its first level
 * that holds two or more of them (its areas), plus one unit for the rest of the package.
 */
function unitsOf(files, packageDirs, moduleDirs, packageOf) {
  const linesIn = new Map();
  for (const [path, f] of files) if (!f.test) linesIn.set(packageOf(path), (linesIn.get(packageOf(path)) ?? 0) + f.lines);
  const total = [...linesIn.values()].reduce((s, n) => s + n, 0);
  const byFile = new Map(), list = new Map();
  const childModules = (dir) => [...moduleDirs].filter((m) => m && m !== dir && (posix.dirname(m) === dir || (dir === "" && !m.includes("/"))));
  for (const pkg of packageDirs) {
    let split = [], splitAt = null;
    if ((linesIn.get(pkg) ?? 0) > total * 0.08) {
      const queue = [pkg];
      while (queue.length) {
        const dir = queue.shift();
        const kids = childModules(dir).filter((m) => packageOf(`${m}/x`) === pkg);
        const folders = new Set([...files.keys()].filter((p) => !files.get(p).test && packageOf(p) === pkg && p.startsWith(`${dir}/`) && p.slice(dir.length + 1).includes("/")).map((p) => p.slice(dir.length + 1).split("/")[0]));
        if (kids.length < 2 && dir !== pkg && folders.size >= 2) { split = [...folders].map((f) => `${dir}/${f}`); splitAt = dir; break; }
        if (kids.length >= 2) { split = [...new Set([...files.keys()].filter((p) => packageOf(p) === pkg && p.startsWith(`${dir}/`) && p.slice(dir.length + 1).includes("/")).map((p) => `${dir}/${p.slice(dir.length + 1).split("/")[0]}`))]; splitAt = dir; break; }
        const counts = new Map();
        for (const [p, f] of files) if (!f.test && packageOf(p) === pkg && p.startsWith(dir ? `${dir}/` : "")) { const seg = p.slice(dir ? dir.length + 1 : 0).split("/"); if (seg.length > 1) counts.set(seg[0], (counts.get(seg[0]) ?? 0) + f.lines); }
        const main = [...counts].sort((a, b) => b[1] - a[1])[0];
        if (main && dir.split("/").length < pkg.split("/").length + 4) queue.push(dir ? `${dir}/${main[0]}` : main[0]);
      }
    }
    for (const unit of split) list.set(unit, { id: unit, package: pkg, lines: 0, files: 0 });
    if (splitAt) list.set(splitAt, { id: splitAt, package: pkg, lines: 0, files: 0, root: true });
    list.set(pkg || ".", { id: pkg || ".", package: pkg, lines: 0, files: 0, rest: split.length > 0 });
    for (const [path, f] of files) {
      if (packageOf(path) !== pkg) continue;
      const unit = split.find((u) => path.startsWith(`${u}/`)) ?? (splitAt && posix.dirname(path) === splitAt ? splitAt : pkg || ".");
      byFile.set(path, unit);
      if (!f.test) { const u = list.get(unit); u.lines += f.lines; u.files += 1; }
    }
  }
  return { list: [...list.values()].filter((u) => u.files > 0), byFile };
}
