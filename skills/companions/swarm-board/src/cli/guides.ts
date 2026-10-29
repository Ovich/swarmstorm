// Architecture guides: a skill folder whose SKILL.md frontmatter carries `paths:`, globs over the
// repository the guide speaks for. Shipped guides sit in the plugin's skills/guides/*, a project's
// in <repo>/.claude/skills/guide-*. The board names them to a member as its work touches them.
import fs from "node:fs";
import path from "node:path";

/** `name`: what a member names in `merged --guides`; `skill`: the skill to load; `paths`: repo-relative globs. */
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

export function parseGuide(text: string, folder: string): Guide | null {
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
  if (!paths?.length) return null;
  return { name: folder.replace(/^guide-/, ""), skill, paths };
}

/** Every guide in `dir`'s subfolders whose name passes `keep`. */
function guidesIn(dir: string, keep: (folder: string) => boolean): Guide[] {
  let folders: string[];
  try {
    folders = fs.readdirSync(dir).filter(keep).sort();
  } catch {
    return [];
  }
  const out: Guide[] = [];
  for (const f of folders) {
    try {
      const g = parseGuide(fs.readFileSync(path.join(dir, f, "SKILL.md"), "utf8"), f);
      if (g) out.push(g);
    } catch {
      // a folder without SKILL.md is no guide
    }
  }
  return out;
}

/** The shipped guides (the plugin root is three levels above the swarm-board skill), then the project's;
 *  a project guide of the same name stands in for the shipped one. */
export function discoverGuides(toolRoot: string, repoRoot: string | null, alsoProject: Guide[] = []): Guide[] {
  const shipped = guidesIn(path.resolve(toolRoot, "..", "..", "..", "skills", "guides"), () => true);
  const here = repoRoot ? guidesIn(path.join(repoRoot, ".claude", "skills"), (f) => f.startsWith("guide-")) : [];
  // the worktree's own stands in for one of the same name from elsewhere (the target's tree)
  const project = [...here, ...alsoProject.filter((g) => !here.some((h) => h.name === g.name))];
  const names = new Set(project.map((g) => g.name));
  return [...shipped.filter((g) => !names.has(g.name)), ...project];
}

/** A glob as a regex over a repo-relative, forward-slashed path: `**` any depth, `*` within a segment, `?` one character. */
export function globRegex(glob: string): RegExp {
  let re = "";
  let depth = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      const slash = glob[i + 2] === "/";
      re += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    // G41: `{a,b}` is one of its alternatives, nested ones too
    else if (c === "{") {
      re += "(?:";
      depth++;
    } else if (c === "}" && depth > 0) {
      re += ")";
      depth--;
    } else if (c === "," && depth > 0) re += "|";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** The guides any of `files` (repo-relative) falls under, in discovery order. */
export function guidesFor(guides: Guide[], files: string[]): Guide[] {
  return guides.filter((g) => g.paths.some((glob) => files.some((f) => globRegex(glob).test(f))));
}

/** The line naming guides to load, or null for none. */
export const guidesLine = (guides: Guide[]): string | null =>
  guides.length ? `guides for this work: ${guides.map((g) => `${g.name} (${g.skill})`).join(", ")}; load each before editing` : null;

/** How `merged --guides` settles the guides merge-lock listed: those left out, names it never listed,
 *  and entries whose verdict is neither `ok` nor `n/a <why>`. */
export function guidesSettlement(arg: string, listed: string[]): { missing: string[]; unknown: string[]; unjudged: string[] } {
  const entries = arg
    .split(/,(?=\s*[^\s:,]+\s*:)/)
    .map((e) => /^\s*([^:\s]+)\s*:\s*(.*)$/s.exec(e))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ name: m[1], verdict: m[2].trim() }));
  const named = entries.map((e) => e.name);
  return {
    missing: listed.filter((g) => !named.includes(g)),
    unknown: named.filter((n) => !listed.includes(n)),
    unjudged: entries.filter((e) => !/^ok\b/.test(e.verdict) && !/^n\/a\s+\S/.test(e.verdict)).map((e) => e.name),
  };
}

/** The project guides in `ref`'s tree, read through git: what a branch will meet once rebased onto it. */
export function projectGuidesAt(show: (spec: string) => string | null, list: string | null): Guide[] {
  const out: Guide[] = [];
  for (const folder of (list ?? "").split(/\r?\n/).map((l) => l.trim().split("/").pop() ?? "").filter((f) => f.startsWith("guide-")).sort()) {
    const text = show(`.claude/skills/${folder}/SKILL.md`);
    const g = text ? parseGuide(text, folder) : null;
    if (g) out.push(g);
  }
  return out;
}
