// Architecture guides: a skill folder whose SKILL.md frontmatter carries `paths:`, globs over the
// repository the guide speaks for. Shipped guides sit in the plugin's skills/guides/*, a project's
// in <repo>/.claude/skills/guide-*. The board names them to a member as its work touches them.
import fs from "node:fs";
import path from "node:path";

/** `name`: what a member names in `merged --guides`; `skill`: the skill to load; `paths`: repo-relative globs. */
export type Guide = { name: string; skill: string; paths: string[] };

/** The frontmatter's `name` and `paths` (inline `[a, b]`, a block list, or one scalar); null without `paths`. */
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
    if (v.startsWith("[")) paths = v.replace(/^\[|\]$/g, "").split(",").map(unquote).filter(Boolean);
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
export function discoverGuides(toolRoot: string, repoRoot: string | null): Guide[] {
  const shipped = guidesIn(path.resolve(toolRoot, "..", "..", "..", "skills", "guides"), () => true);
  const project = repoRoot ? guidesIn(path.join(repoRoot, ".claude", "skills"), (f) => f.startsWith("guide-")) : [];
  const names = new Set(project.map((g) => g.name));
  return [...shipped.filter((g) => !names.has(g.name)), ...project];
}

/** A glob as a regex over a repo-relative, forward-slashed path: `**` any depth, `*` within a segment, `?` one character. */
export function globRegex(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      const slash = glob[i + 2] === "/";
      re += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
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

/** `merged --guides "<name>:ok|n/a <why>, …"`: the names it settles; the rest of each entry is the member's word. */
export const guidesNamed = (arg: string): string[] =>
  arg
    // an entry starts at `<name>:`, so a why may hold commas
    .split(/,(?=\s*[^\s:,]+\s*:)/)
    .map((e) => /^\s*([^:\s]+)\s*:/.exec(e)?.[1])
    .filter((n): n is string => !!n);
