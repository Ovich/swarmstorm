// The board's agents strip opens folded by default; the tests read the open strip.
import { beforeEach } from "vitest";

beforeEach(() => {
  try {
    localStorage.setItem("aiview.board.roster", "open");
  } catch {
    /* no storage: the strip stays folded */
  }
});
