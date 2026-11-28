// Pure project rules — no sqlite, no fs, by design (see the plan's boundary diagram).
// The tricky parts live here precisely so they are testable without a database:
// overlapping prefixes, Windows case-insensitivity, and the resolution order.
import path from "node:path";

export interface Project {
  slug: string;
  title: string | null;
  /** Absolute directory prefixes this project covers. Working directories, NEVER
   *  document locations — a document's project is the folder it sits in. */
  paths: string[];
}

/** Comparable form: trailing separators dropped, separators unified, lowercased on Windows. */
const norm = (p: string): string => {
  const unified = p.replace(/[\\/]+$/, "").split(/[\\/]/).join(path.sep);
  return process.platform === "win32" ? unified.toLowerCase() : unified;
};

/** True when `child` is `parent` itself or sits underneath it. */
export function isInside(child: string, parent: string): boolean {
  if (!parent) return false;
  const c = norm(child);
  const p = norm(parent);
  return c === p || c.startsWith(p + path.sep);
}

/** The project covering `dir`. Longest prefix wins, so a sub-repo can be split out
 *  of a wider project later without touching the wider one. null = unclaimed. */
export function projectForCwd(dir: string, projects: Project[]): Project | null {
  let best: Project | null = null;
  let bestLen = -1;
  for (const project of projects) {
    for (const prefix of project.paths) {
      if (!isInside(dir, prefix)) continue;
      const len = norm(prefix).length;
      if (len > bestLen) {
        bestLen = len;
        best = project;
      }
    }
  }
  return best;
}

/** The `<docs>/<slug>/` folder a file sits in, or null when it is not filed under one. */
export function projectFromDocsPath(absFile: string, docsRoot: string): string | null {
  if (!isInside(path.dirname(absFile), docsRoot)) return null;
  const [first, ...rest] = path.relative(docsRoot, absFile).split(/[\\/]/);
  return rest.length > 0 && first ? first : null;
}

interface ResolveInput {
  /** An explicit --project, which always wins. */
  explicit?: string;
  absFile: string;
  docsRoot: string;
  /** The project already on the row, for a document being re-registered. */
  existing?: string;
  /** Last resort — today's derived value (nearest .git basename). */
  fallback: string;
}

/** Spec § "How a document gets its project": first match wins. The document's own
 *  path is never prefix-matched against projects.paths — that would re-couple a
 *  document to a repo, which is the thing this design removes. */
export function resolveProject({ explicit, absFile, docsRoot, existing, fallback }: ResolveInput): string {
  if (explicit) return explicit;
  return projectFromDocsPath(absFile, docsRoot) ?? existing ?? fallback;
}
