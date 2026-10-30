// Where the board's store lives: the data home, beside aiview's index, never in a project's checkout.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Data home: $SWARMSTORM_HOME (or $CHARRETTE_HOME, its name before the rename), else ~/swarmstorm_appdata;
 *  an install from before the rename keeps ~/charrette_appdata while no ~/swarmstorm_appdata exists, so nothing moves. */
const homeFromEnv = process.env.SWARMSTORM_HOME ?? process.env.CHARRETTE_HOME;
const NEW_HOME = path.join(os.homedir(), "swarmstorm_appdata");
const OLD_HOME = path.join(os.homedir(), "charrette_appdata");
export const DATA_ROOT = homeFromEnv ? path.resolve(homeFromEnv) : !fs.existsSync(NEW_HOME) && fs.existsSync(OLD_HOME) ? OLD_HOME : NEW_HOME;

/** The home this process uses when it is not the default, as a command must carry it to reach the same board (G3); null at the default. */
// SWARMSTORM_PRINT_HOME=0 keeps the commands bare (the test suite, whose every home is a temporary one)
export const HOME_OVERRIDE: string | null = homeFromEnv && path.resolve(homeFromEnv) !== NEW_HOME && process.env.SWARMSTORM_PRINT_HOME !== "0" ? DATA_ROOT : null;

export const SQLITE_PATH = path.join(DATA_ROOT, "swarm.sqlite");
