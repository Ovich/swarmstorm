/** An upkeep, tick or frame effect that throws is logged to stderr, and the server goes on (S21). */
export function guarded(what: string, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    console.error(`swarm server: ${what} failed: ${(e as Error).stack ?? (e as Error).message}`);
  }
}
