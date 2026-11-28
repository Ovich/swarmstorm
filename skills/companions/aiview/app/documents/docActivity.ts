import type { DocumentWithState } from "../lib/api.ts";

/** When a document last actually changed. The file's mtime, not `last_seen_at`:
 *  registering or moving a document bumps the latter, and bookkeeping must never
 *  reorder the sidebar. Falls back to `last_seen_at` when the file is missing. */
export const docActivity = (d: DocumentWithState): string => d.updated_at ?? d.last_seen_at;
