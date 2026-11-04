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

/**
 * The program and argv that open `url` on `platform`. The URL is always one argv element, untouched: on Windows
 * no `cmd` ever parses it (trust-adaptations#D9: `cmd /c start` split the board link at its `&`), so the shell
 * protocol handler takes it whole.
 */
export function browserCommand(url: string, platform: NodeJS.Platform = process.platform): [program: string, argv: string[]] {
  if (platform === "win32") return ["rundll32", ["url.dll,FileProtocolHandler", url]];
  if (platform === "darwin") return ["open", [url]];
  return ["xdg-open", [url]];
}

/** Spawns the browser on `url`, detached, with no refusal check: `openBrowser` is the guarded entry. */
export function launchBrowser(url: string): void {
  const [program, argv] = browserCommand(url);
  try {
    spawn(program, argv, { detached: true, stdio: "ignore", windowsHide: true }).unref(); // AGENTS EXCEPTION (D39): a browser opener: the browser's own window is the point
  } catch (e) {
    console.error(`could not open browser: ${(e as Error).message}`);
  }
}

/** Opens `url` in the person's browser, when `browserRefusal` allows it; answers the refusal, or null once launched. */
export function openBrowser(url: string): string | null {
  const refused = browserRefusal();
  if (refused) {
    console.error(`aiview: no browser opened for ${url} (${refused})`);
    return refused;
  }
  launchBrowser(url);
  return null;
}
