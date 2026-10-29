// Where the user's data lives — deliberately NOT where the code lives.
//
// Two roots, one rule: the checkout holds what `npm run build` can recreate
// (app/, dist/, dist-cli/, node_modules/); the data home holds what it can't
// (the index, the server files, the documents). Delete the checkout, clone it
// again, rebuild — nothing of the user's is lost, because none of it was there.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Data home: $SWARMSTORM_HOME (or $CHARRETTE_HOME, its name before the rename), else ~/swarmstorm_appdata;
 *  an install from before the rename keeps ~/charrette_appdata while no ~/swarmstorm_appdata exists, so nothing moves. */
const homeFromEnv = process.env.SWARMSTORM_HOME ?? process.env.CHARRETTE_HOME;
const NEW_HOME = path.join(os.homedir(), "swarmstorm_appdata");
const OLD_HOME = path.join(os.homedir(), "charrette_appdata");
export const DATA_ROOT = homeFromEnv ? path.resolve(homeFromEnv) : !fs.existsSync(NEW_HOME) && fs.existsSync(OLD_HOME) ? OLD_HOME : NEW_HOME;

/** The default home's port; another data home gets its own, so two homes' servers never clash (G22). */
const HOME_PORT = 4321;

/** The port aiview serves on when none is asked: 4321 for the default home, else one in 4400–4899 derived from the home's path. */
export function defaultPort(root: string = DATA_ROOT): number {
  if (path.resolve(root) === NEW_HOME || path.resolve(root) === OLD_HOME) return HOME_PORT;
  let hash = 2166136261;
  for (const ch of path.resolve(root).toLowerCase()) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  return 4400 + (hash % 500);
}

/** Documents live here, one directory per project. Never inside a project repo. */
export const DOCS_ROOT = path.join(DATA_ROOT, "docs");

/** The document directory for a project slug (the slug is what aiview shows as the project). */
export const docsDirFor = (projectSlug: string): string => path.join(DOCS_ROOT, projectSlug);

export function ensureHome(): void {
  fs.mkdirSync(DOCS_ROOT, { recursive: true });
}

/** One-time adoption of an index left next to the tool by a pre-appdata install. */
export function adoptLegacyIndex(toolRoot: string, sqlitePath: string): void {
  if (fs.existsSync(sqlitePath)) return;
  const legacy = path.join(toolRoot, "aiview.sqlite");
  if (!fs.existsSync(legacy)) return;
  fs.copyFileSync(legacy, sqlitePath);
  console.error(`aiview: adopted the index from ${legacy} (the original is left in place, unused)`);
}
