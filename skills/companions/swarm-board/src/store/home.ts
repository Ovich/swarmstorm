// Where the board's store lives: the data home (host/home.ts), never in a project's checkout.
import path from "node:path";
import { DATA_ROOT, HOME_FROM_ENV, NEW_HOME } from "../host/home.ts";

/** The home this process uses when it is not the default, as a command must carry it to reach the same board (G3); null at the default. */
// SWARMSTORM_PRINT_HOME=0 keeps the commands bare (the test suite, whose every home is a temporary one)
export const HOME_OVERRIDE: string | null = HOME_FROM_ENV && path.resolve(HOME_FROM_ENV) !== NEW_HOME && process.env.SWARMSTORM_PRINT_HOME !== "0" ? DATA_ROOT : null;

export const SQLITE_PATH = path.join(DATA_ROOT, "swarm.sqlite");
