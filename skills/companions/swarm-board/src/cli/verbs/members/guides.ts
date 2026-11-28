// Architecture guides: a skill folder whose SKILL.md frontmatter carries `paths:`, globs over the
// repository the guide speaks for. Shipped guides sit in the plugin's skills/guides/*, a project's
// in <repo>/.claude/skills/guide-*. The board names them to a member once, at its join, as skills to
// load; it checks nothing against them, at a merge or anywhere.
import fs from "node:fs";
import path from "node:path";

/** `name`: the guide's short name; `skill`: the skill to load; `paths`: the repo-relative globs it speaks for. */
export type Guide = { name: string; skill: string; paths: string[] };

/** The frontmatter's `name` and `paths` (inline `[a, b]`, a block list, or one scalar); null without `paths`. */
/** A flow list's items: split on the commas outside quotes and braces, so a brace glob such as `*.{ts,js}` stays one item (G41). */
function flowItems(list: string): string[] {
  const items: string[] = [];
  let item = "";
  let quote: string | null = null;
  let braces = 0;
  for (const c of list) {
    if (quote) quote = c === quote ? null : quote;
    else if (c === '"' || c === "'") quote = c;
    else if (c === "{") braces++;
    else if (c === "}") braces = Math.max(0, braces - 1);
    else if (c === "," && braces === 0) {
      items.push(item);
      item = "";
      continue;
    }
    item += c;
  }
  return [...items, item];
}

export function parseGuide(text: string, folder: string, fallback: string[] | null = null): Guide | null {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
  if (!fm) return null;
  const lines = fm.split(/\r?\n/);
  const unquote = (s: string): string => s.trim().replace(/^["'](.*)["']$/, "$1");
  let skill = folder;
  let paths: string[] | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\w[\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    if (m[1] === "name" && m[2].trim()) skill = unquote(m[2]);
    if (m[1] !== "paths") continue;
    const v = m[2].trim();
    if (v.startsWith("[")) paths = flowItems(v.replace(/^\[|\]$/g, "")).map(unquote).filter(Boolean);
    else if (v) paths = [unquote(v)];
    else {
      paths = [];
      while (i + 1 < lines.length && /^\s*-\s*/.test(lines[i + 1])) paths.push(unquote(lines[++i].replace(/^\s*-\s*/, "")));
    }
  }
  if (!paths?.length) paths = fallback;
  if (!paths?.length) return null;
  return { name: folder.replace(/^guide-/, ""), skill, paths };
}

/** Every guide in `dir`'s subfolders whose name passes `keep`. */
function guidesIn(dir: string, keep: (folder: string) => boolean, fallback: (folder: string) => string[] | null = () => null): Guide[] {
  let folders: string[];
  try {
    folders = fs.readdirSync(dir).filter(keep).sort();
  } catch {
    return [];
  }
  const out: Guide[] = [];
  for (const f of folders) {
    try {
      const g = parseGuide(fs.readFileSync(path.join(dir, f, "SKILL.md"), "utf8"), f, fallback(f));
      if (g) out.push(g);
    } catch {
      // a folder without SKILL.md is no guide
    }
  }
  return out;
}

/** What the shipped guides cover: every code file. Their frontmatter leaves `paths:` out (the plugin
 *  directory accepts no such key from community plugins); a project guide still names its own. */
export const SHIPPED_GUIDE_PATHS = ["**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,rs,java,kt,cs,rb,php,swift,c,cpp,h}"];
const SHIPPED_GUIDES = new Set(["guide-complexity", "guide-deepen-module", "guide-screaming-architecture"]);

/** The shipped guides (the plugin root is three levels above the swarm-board skill), then the project's;
 *  a project guide of the same name stands in for the shipped one. */
export function discoverGuides(toolRoot: string, repoRoot: string | null): Guide[] {
  const shipped = guidesIn(path.resolve(toolRoot, "..", "..", "..", "skills", "guides"), () => true, (f) => (SHIPPED_GUIDES.has(f) ? SHIPPED_GUIDE_PATHS : null));
  const project = repoRoot ? guidesIn(path.join(repoRoot, ".claude", "skills"), (f) => f.startsWith("guide-")) : [];
  const names = new Set(project.map((g) => g.name));
  return [...shipped.filter((g) => !names.has(g.name)), ...project];
}

/** The line naming guides to load, or null for none. */
export const guidesLine = (guides: Guide[]): string | null =>
  guides.length ? `guides for this work: ${guides.map((g) => `${g.name} (${g.skill})`).join(", ")}; load each before editing` : null;
