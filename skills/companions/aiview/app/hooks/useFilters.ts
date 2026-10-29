import { useMemo, useState } from "react";
import type { DocumentWithState } from "../lib/api.ts";
import { docActivity } from "./useSidebarEntries.ts";

export interface Filters {
  query: string;
  kinds: Set<string>;
  tags: Set<string>;
}

/** The project scope, applied BEFORE anything else (D16). Everything downstream —
 *  the kind chips, the tag chips, the search — is derived from what this returns,
 *  which is what makes "everything below is scoped" true rather than decorative. */
export function applyScope(docs: DocumentWithState[], project: string): DocumentWithState[] {
  return docs.filter((d) => d.project === project);
}

/** The tags of the scoped documents, the most recently active first: a tag is as recent as
 *  the latest document carrying it, since the work a person is on is the work they filter by.
 *  The project's own slug is left out when a project is given, as the scope already applies it. */
export function recentTags(docs: DocumentWithState[], project: string | null = null): string[] {
  const latest = new Map<string, string>();
  for (const d of docs) {
    const at = docActivity(d);
    for (const t of d.tags) if ((latest.get(t) ?? "") < at) latest.set(t, at);
  }
  const slug = project === null ? null : project.toLowerCase();
  return [...latest.entries()]
    .filter(([t]) => t.toLowerCase() !== slug)
    .sort(([a, x], [b, y]) => y.localeCompare(x) || a.localeCompare(b))
    .map(([t]) => t);
}

/** Pure so the component tests can hit it directly. */
export function applyFilters(docs: DocumentWithState[], f: Filters): DocumentWithState[] {
  const q = f.query.toLowerCase();
  return docs.filter(
    (d) =>
      (f.kinds.size === 0 || f.kinds.has(d.kind)) &&
      [...f.tags].every((t) => d.tags.includes(t)) &&
      (!q || (d.title ?? "").toLowerCase().includes(q) || d.file_path.toLowerCase().includes(q)),
  );
}

export function useFilters(allDocs: DocumentWithState[], project: string) {
  const [query, setQuery] = useState("");
  const [kinds, setKinds] = useState<Set<string>>(new Set());
  const [tags, setTags] = useState<Set<string>>(new Set());

  const docs = useMemo(() => applyScope(allDocs, project), [allDocs, project]);
  const allKinds = useMemo(() => [...new Set(docs.map((d) => d.kind))].sort(), [docs]);
  const allTags = useMemo(() => recentTags(docs, project), [docs, project]);
  const shown = useMemo(() => applyFilters(docs, { query, kinds, tags }), [docs, query, kinds, tags]);

  const toggle = (set: Set<string>, v: string) => {
    const next = new Set(set);
    next.has(v) ? next.delete(v) : next.add(v);
    return next;
  };

  return {
    query,
    setQuery,
    kinds,
    tags,
    allKinds,
    allTags,
    shown,
    toggleKind: (k: string) => setKinds((s) => toggle(s, k)),
    toggleTag: (t: string) => setTags((s) => toggle(s, t)),
  };
}
