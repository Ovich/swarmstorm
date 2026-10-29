// board-split D24 (D18): the core knows no code domain. In src/board/, src/server/, src/link/ and the core files of
// src/cli/answer/, no identifier or string holds the whole word worktree, claim, claims, merge, merged, merge-lock or
// flag; `lock`, `locks`, `unlock` are the machine's locks and allowed; comments and `AGENTS EXCEPTION` lines are not
// read. src/packs/** and the code pack's answer files are the domain's own. The sites left from before the split are
// ALLOWED, per file; each move into the code pack lowers its count, which may only fall, and the phase closes on none.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SRC = join(import.meta.dirname, "..", "src");
const CORE_DIRS = ["board", "server", "link"].map((d) => join(SRC, d));
const ANSWER = join(SRC, "cli", "answer");
const CODE_ANSWER = new Set(["code-rules.ts", "code-wording.ts"]);
const DOMAIN_WORDS = new Set(["worktree", "worktrees", "claim", "claims", "merge", "merged", "flag"]);
const EXCEPTION = "AGENTS EXCEPTION";

/** Sites per file (path relative to src/, `/`-separated) allowed today; each count may only fall. */
const ALLOWED: Record<string, number> = {
  "board/board.ts": 22,
  "board/events.ts": 3,
  "cli/answer/usage.ts": 8,
};

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });

/** The source with its comments blanked, strings and code kept, line breaks kept so line numbers hold. */
export function withoutComments(src: string): string {
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const two = src.slice(i, i + 2);
    if (c === '"' || c === "'" || c === "`") {
      // a string or template, copied whole (a `${…}` inside a template is code, read as part of it)
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j;
    } else if (two === "//") {
      while (i < src.length && src[i] !== "\n") i++;
      out += "\n";
    } else if (two === "/*") {
      const end = src.indexOf("*/", i + 2);
      const body = src.slice(i, end < 0 ? src.length : end + 2);
      out += body.replace(/[^\n]/g, " ");
      i = (end < 0 ? src.length : end + 2) - 1;
    } else if (c === "/" && /[(,=:[!&|?{};]\s*$/.test(out)) {
      // a regex literal, copied whole
      let j = i + 1;
      while (j < src.length && src[j] !== "/" && src[j] !== "\n") j += src[j] === "\\" ? 2 : src[j] === "[" ? Math.max(1, src.indexOf("]", j) - j + 1) : 1;
      out += src.slice(i, j + 1);
      i = j;
    } else out += c;
  }
  return out;
}

/** The words of a line: identifiers split at camelCase, `_` and `-`, lower-cased. */
const wordsOf = (line: string): string[] =>
  line
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((w) => w.toLowerCase())
    .filter(Boolean);

const coreFiles = (): string[] => [
  ...CORE_DIRS.flatMap(files),
  ...files(ANSWER).filter((f) => !CODE_ANSWER.has(f.slice(ANSWER.length + 1))),
];

export function domainSites(): Map<string, string[]> {
  const sites = new Map<string, string[]>();
  for (const f of coreFiles()) {
    const raw = readFileSync(f, "utf8").split("\n");
    const code = withoutComments(readFileSync(f, "utf8")).split("\n");
    const rel = relative(SRC, f).split(sep).join("/");
    code.forEach((line, i) => {
      if (raw[i]?.includes(EXCEPTION)) return;
      const hits = wordsOf(line).filter((w) => DOMAIN_WORDS.has(w));
      if (hits.length) sites.set(rel, [...(sites.get(rel) ?? []), `${rel}:${i + 1} ${[...new Set(hits)].join(",")}`]);
    });
  }
  return sites;
}

test("the core names no code domain beyond today's allowed sites, which may only fall (D24)", () => {
  const over: string[] = [];
  for (const [file, lines] of domainSites()) {
    const allowed = ALLOWED[file] ?? 0;
    if (lines.length > allowed) over.push(`${file}: ${lines.length} sites, allowed ${allowed}\n  ${lines.join("\n  ")}`);
  }
  assert.deepEqual(over, [], "a code-domain word in the core: move it into src/packs/code/ (or code-wording.ts)");
});

test("an allowed count above today's sites is lowered, so the list only shrinks (D24)", () => {
  const now = domainSites();
  const stale = Object.entries(ALLOWED)
    .filter(([file, n]) => (now.get(file)?.length ?? 0) < n)
    .map(([file, n]) => `${file}: allowed ${n}, now ${now.get(file)?.length ?? 0}`);
  assert.deepEqual(stale, [], "lower ALLOWED to today's count");
});

test("the scanner reads code and strings, never comments", () => {
  const src = 'const a = 1; // a claim here\n/* merged\n worktree */ const b = "the claim";\nconst re = /flag/;';
  const code = withoutComments(src).split("\n");
  assert.deepEqual(code.map(wordsOf), [["const", "a", "1"], [], ["const", "b", "the", "claim"], ["const", "re", "flag"]]);
  assert.deepEqual(wordsOf("lockMerge mergeLock unlock locks"), ["lock", "merge", "merge", "lock", "unlock", "locks"]);
});
