// codebase-rework#D2, D6: swarm-board's units in one strict order (plan §3.1). A unit imports only units of a lower
// rank; units of one rank never import each other; the imports §3.1 names as must-not-exist fail by name. Type-only
// and dynamic imports count, as the bench's layers count them.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname, "..", "src");
const AIVIEW = path.resolve(import.meta.dirname, "..", "..", "aiview");

/** §3.1, bottom to top. */
const RANK: Record<string, number> = { host: 0, contract: 1, store: 1, link: 2, packs: 2, board: 3, client: 4, server: 4, cli: 5 };

type Import = { from: string; spec: string; target: string | null; dynamic: boolean };

const sourcesUnder = (dir: string): string[] =>
  fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes("node_modules")).map((f) => path.join(dir, f)) : [];

const STATIC_IMPORT = /^\s*(?:(?:import|export)\b[^;'"]*?\bfrom|import)\s*["']([^"']+)["']/gm;
const DYNAMIC_IMPORT = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

function importsOf(file: string): Import[] {
  const text = fs.readFileSync(file, "utf8");
  const resolve = (spec: string): string | null => (spec.startsWith(".") ? path.resolve(path.dirname(file), spec) : null);
  return [
    ...[...text.matchAll(STATIC_IMPORT)].map((m) => ({ from: file, spec: m[1], target: resolve(m[1]), dynamic: false })),
    ...[...text.matchAll(DYNAMIC_IMPORT)].map((m) => ({ from: file, spec: m[1], target: resolve(m[1]), dynamic: true })),
  ];
}

/** `file`'s unit, `src/<unit>/…`; "" for a file at src/'s root, which has no rank. */
const unitOf = (file: string): string => {
  const parts = path.relative(SRC, file).split(path.sep);
  return parts.length > 1 ? parts[0] : "";
};
const insideSrc = (file: string): boolean => !path.relative(SRC, file).startsWith("..");
const shown = (i: Import): string => `${path.relative(SRC, i.from).split(path.sep).join("/")} → ${i.spec}`;
const srcPath = (file: string): string => path.relative(SRC, file).split(path.sep).join("/");

const swarmImports = (): Import[] => sourcesUnder(SRC).flatMap(importsOf);

test("every file of src/ sits in a unit of §3.1 (D5: none at src/'s root)", () => {
  const stray = sourcesUnder(SRC).map(srcPath).filter((f) => !(unitOf(path.join(SRC, f)) in RANK));
  assert.deepEqual(stray, []);
});

test("a unit imports only units of a lower rank (D2)", () => {
  const upward = swarmImports()
    .filter((i) => i.target && insideSrc(i.target))
    .filter((i) => {
      const [from, to] = [unitOf(i.from), unitOf(i.target!)];
      return from !== to && !((RANK[to] ?? Infinity) < (RANK[from] ?? -Infinity));
    })
    .map(shown);
  assert.deepEqual(upward, []);
});

test("host/ imports node:* only", () => {
  const foreign = swarmImports()
    .filter((i) => unitOf(i.from) === "host" && !i.spec.startsWith("node:") && !(i.target && unitOf(i.target) === "host"))
    .map(shown);
  assert.deepEqual(foreign, []);
});

test("board/ reaches packs/ through registry.ts and types.ts only, never packs/code/*", () => {
  const allowed = new Set(["packs/registry.ts", "packs/types.ts"]);
  const reach = swarmImports()
    .filter((i) => unitOf(i.from) === "board" && i.target && unitOf(i.target) === "packs" && !allowed.has(srcPath(i.target)))
    .map(shown);
  assert.deepEqual(reach, []);
});

test("cli/ never imports packs/, and server/ only by a dynamic import", () => {
  const reach = swarmImports()
    .filter((i) => unitOf(i.from) === "cli" && i.target && (unitOf(i.target) === "packs" || (unitOf(i.target) === "server" && !i.dynamic)))
    .map(shown);
  assert.deepEqual(reach, []);
});

test("aiview reaches swarm-board's src/ through client/reader.ts and host/* only", () => {
  const reach = [...sourcesUnder(path.join(AIVIEW, "src")), ...sourcesUnder(path.join(AIVIEW, "app"))]
    .flatMap(importsOf)
    .filter((i) => i.target && insideSrc(i.target) && srcPath(i.target) !== "client/reader.ts" && unitOf(i.target) !== "host")
    .map((i) => `${path.relative(AIVIEW, i.from).split(path.sep).join("/")} → ${i.spec}`);
  assert.deepEqual(reach, []);
});
