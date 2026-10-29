// The one browser opener (board-split: the person's browser flooded by test runs). A window opens only for the
// person's own data home, never under AIVIEW_NO_BROWSER=1 (every test run sets it), never for a scratch, test or
// dev home. A refused open says so on stderr and does nothing else.
import { spawn } from "node:child_process"; // AGENTS EXCEPTION (D39): the browser opener below, its window the point
import { DATA_ROOT, isPersonHome } from "./home.ts";

/** Why a browser window may not open here, or null when it may. */
export function browserRefusal(env: NodeJS.ProcessEnv = process.env, dataRoot: string = DATA_ROOT): string | null {
  if (env.AIVIEW_NO_BROWSER === "1") return "AIVIEW_NO_BROWSER=1";
  if (!isPersonHome(dataRoot)) return `the data home ${dataRoot} is not the person's own`;
  return null;
}

/** Opens `url` in the person's browser, when `browserRefusal` allows it. */
export function openBrowser(url: string): void {
  const refused = browserRefusal();
  if (refused) {
    console.error(`aiview: no browser opened for ${url} (${refused})`);
    return;
  }
  const [c, args] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    spawn(c, args as string[], { detached: true, stdio: "ignore", windowsHide: true }).unref(); // AGENTS EXCEPTION (D39): a browser opener: the browser's own window is the point
  } catch (e) {
    console.error(`could not open browser: ${(e as Error).message}`);
  }
}
