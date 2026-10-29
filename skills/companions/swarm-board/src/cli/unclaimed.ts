// The line `end` and `merge-lock` print for files written without a claim (D72, F24): one summary per
// reconcile, its count and the first few paths; a rename is one `old → new` entry. The store's flags are untouched.
export const SHOWN = 3;

export type Rename = [from: string, to: string];

/** The entries written without a claim: a rename with a side unclaimed is one `old → new`. */
export function unclaimedEntries(paths: string[], renames: Rename[] = []): string[] {
  const left = new Set(paths);
  const entries: string[] = [];
  for (const [from, to] of renames) {
    if (!left.has(from) && !left.has(to)) continue;
    left.delete(from);
    left.delete(to);
    entries.push(`${from} → ${to}`);
  }
  return [...paths.filter((p) => left.has(p)), ...entries];
}

/** One line for the whole reconcile, none when every write was claimed. */
export function unclaimedLines(paths: string[], renames: Rename[] = []): string[] {
  const entries = unclaimedEntries(paths, renames);
  if (!entries.length) return [];
  const shown = entries.slice(0, SHOWN).join(", ") + (entries.length > SHOWN ? ", …" : "");
  return [`reconciled ${entries.length} written without a claim: ${shown}`];
}
