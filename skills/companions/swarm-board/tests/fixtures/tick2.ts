import { badgeConfirmMs } from "../../src/board/liveness.ts";

/** board-split D55 (amended, U-F27): a badge opens once its predicate held BADGE_CONFIRM_MS, and closes once it held
 *  false as long; a test that means "the server ticked at `at`" ticks at `at` and BADGE_CONFIRM_MS later, so an
 *  episode due at `at` opens (or closes) there. */
export function tick2<B extends { livenessTick(run: number, at: Date, presence: any): boolean }>(board: B, run: number, at: Date, presence: Parameters<B["livenessTick"]>[2]): boolean {
  const first = board.livenessTick(run, at, presence);
  const second = board.livenessTick(run, new Date(at.getTime() + badgeConfirmMs()), presence);
  return first || second;
}
