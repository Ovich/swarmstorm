// The data home, beside aiview's index, never in a project's checkout, and the board server's files in it: one copy
// for both companions (codebase-rework#D17).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Data home: $SWARMSTORM_HOME (or $CHARRETTE_HOME, its name before the rename), else ~/swarmstorm_appdata;
 *  an install from before the rename keeps ~/charrette_appdata while no ~/swarmstorm_appdata exists, so nothing moves. */
export const HOME_FROM_ENV = process.env.SWARMSTORM_HOME ?? process.env.CHARRETTE_HOME;
export const NEW_HOME = path.join(os.homedir(), "swarmstorm_appdata");
export const OLD_HOME = path.join(os.homedir(), "charrette_appdata");
export const DATA_ROOT = HOME_FROM_ENV ? path.resolve(HOME_FROM_ENV) : !fs.existsSync(NEW_HOME) && fs.existsSync(OLD_HOME) ? OLD_HOME : NEW_HOME;

/** What the running board server writes for its clients: `<dataRoot>/swarm-server.json` (D7, D17). */
export function serverStateFile(dataRoot: string): string {
  return path.join(dataRoot, "swarm-server.json");
}

/** The server's own log, `<dataRoot>/swarm-server.log`: a started server's output, its start line and
 *  every link's exit reason while it answers (D42). */
export function serverLogFile(dataRoot: string): string {
  return path.join(dataRoot, "swarm-server.log");
}

/** The lock a starting server takes beside its state file and holds while it runs, its pid inside
 *  (swarm-relay D40): one server per data home. */
export function serverStartLock(dataRoot: string): string {
  return path.join(dataRoot, "swarm-server.lock");
}
