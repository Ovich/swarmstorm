/** A duration as the board writes it: "40s", "1m 50s" under ten minutes, "18m", "2h 42m"; floored, never rounded up. */
export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  if (m < 10) return s ? `${m}m ${String(s).padStart(2, "0")}s` : `${m}m`;
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
