// The board's agents strip opens folded by default; the tests read the open strip.
import { beforeEach } from "vitest";

// no app test run opens the person's browser, nor a server it starts (src/core/browser.ts)
process.env.AIVIEW_NO_BROWSER = "1";

beforeEach(() => {
  try {
    localStorage.setItem("aiview.board.roster", "open");
  } catch {
    /* no storage: the strip stays folded */
  }
});
