import type { DocumentWithState } from "../lib/api.ts";

export type SidebarEntry =
  | { type: "doc"; doc: DocumentWithState }
  | { type: "group"; slug: string; title: string; docs: DocumentWithState[] };

/** When a document last actually changed. The file's mtime, not `last_seen_at`:
 *  registering or moving a document bumps the latter, and bookkeeping must never
 *  reorder the sidebar. Falls back to `last_seen_at` when the file is missing. */
export const docActivity = (d: DocumentWithState): string => d.updated_at ?? d.last_seen_at;

/** Sidebar order (pure, tested):
 *  - grouped docs collapse into one container entry per group
 *  - members inside a group read oldest-first (the board that started it on top)
 *  - every entry sorts by its most recently changed member, newest first — so the
 *    group holding the latest document is on top
 *  - a swarm document (a board file not yet migrated to the /board page) comes first, whatever its age */
export function sidebarEntries(
  docs: DocumentWithState[],
  groups: Record<string, string>,
): SidebarEntry[] {
  const byGroup = new Map<string, DocumentWithState[]>();
  const flat: DocumentWithState[] = [];
  for (const d of docs) {
    if (d.group_slug) {
      const list = byGroup.get(d.group_slug) ?? [];
      list.push(d);
      byGroup.set(d.group_slug, list);
    } else {
      flat.push(d);
    }
  }
  const entries: SidebarEntry[] = flat.map((doc) => ({ type: "doc", doc }));
  for (const [slug, members] of byGroup) {
    members.sort((a, b) => a.created_at.localeCompare(b.created_at));
    entries.push({ type: "group", slug, title: groups[slug] ?? slug, docs: members });
  }
  const activity = (e: SidebarEntry): string =>
    e.type === "doc" ? docActivity(e.doc) : e.docs.reduce((m, d) => (docActivity(d) > m ? docActivity(d) : m), "");
  // the project's swarm board is pinned above every other entry (swarm plan D17)
  const pinned = (e: SidebarEntry): number => (e.type === "doc" && e.doc.kind === "swarm" ? 0 : 1);
  return entries.sort((a, b) => pinned(a) - pinned(b) || activity(b).localeCompare(activity(a)));
}
