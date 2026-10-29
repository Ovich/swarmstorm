// The arithmetic the stats share with a pack's figures (board-split#D15): times, percentiles, sums of known figures,
// path folding. No import, so a pack's figures can use it whatever order the modules load in.

export type Row = Record<string, unknown>;

const CASELESS = process.platform === "win32";
export const foldPath = (p: string): string => (CASELESS ? p.toLowerCase() : p);

export const ms = (at: unknown): number => Date.parse(String(at));
export const iso = (t: number): string => new Date(t).toISOString();
export const firstLine = (body: string): string => body.split(/\r?\n/)[0].slice(0, 120);

/** Nearest rank; null for no values. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

/** The sum of the figures known; null when none is (D34). */
export function sumKnown(values: (number | null | undefined)[]): number | null {
  const known = values.filter((v): v is number => typeof v === "number");
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}
