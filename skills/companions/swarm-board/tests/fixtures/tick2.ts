/** board-split D55: a badge holds only when its predicate is true at two consecutive ticks; a test that means "the
 *  server ticked at `at`" ticks twice, at `at` and one millisecond later, so an episode due at `at` opens there. */
export function tick2<B extends { livenessTick(run: number, at: Date, presence: any): boolean }>(board: B, run: number, at: Date, presence: Parameters<B["livenessTick"]>[2]): boolean {
  const first = board.livenessTick(run, at, presence);
  const second = board.livenessTick(run, new Date(at.getTime() + 1), presence);
  return first || second;
}
