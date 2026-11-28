// Where the user's data lives — deliberately NOT where the code lives.
//
// Two roots, one rule: the checkout holds what `npm run build` can recreate
// (app/, dist/, dist-cli/, node_modules/); the data home holds what it can't
// (the index, the server files, the documents). Delete the checkout, clone it
// again, rebuild — nothing of the user's is lost, because none of it was there.
import fs from "node:fs";
import path from "node:path";
import { DATA_ROOT, NEW_HOME, OLD_HOME } from "../../../swarm-board/src/host/home.ts";
import { hiddenSpawnSync } from "../../../swarm-board/src/host/proc.ts";

/** Data home: swarm-board's host/home.ts, the one copy both companions read (codebase-rework#D17). */
export { DATA_ROOT };
/** Whether `root` is the person's own data home (either default name), not a scratch, test or dev one. */
export const isPersonHome = (root: string): boolean => {
  const fold = (p: string) => (process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p));
  return fold(root) === fold(NEW_HOME) || fold(root) === fold(OLD_HOME);
};

/** The default home's port; another data home gets its own, so two homes' servers never clash (G22). */
const HOME_PORT = 4321;

/** The port aiview serves on when none is asked: 4321 for the default home, else one in 4400–4899 derived from the home's path. */
export function defaultPort(root: string = DATA_ROOT): number {
  const home = normalHome(root);
  if (home === normalHome(NEW_HOME) || home === normalHome(OLD_HOME)) return HOME_PORT;
  let hash = 2166136261;
  for (const ch of home) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  return 4400 + (hash % 500);
}

/** V2: a home as one string whatever its spelling: its real path when it exists, forward slashes, no trailing slash,
 *  lower case (the homes compared live on case-insensitive disks as often as not). */
function normalHome(root: string): string {
  let p = path.resolve(root);
  try {
    p = fs.realpathSync.native(p);
  } catch {
    // not made yet: its resolved spelling
  }
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** The first port from `from` (up to 20 on) nothing listens on at 127.0.0.1, asked of a child since the CLI is synchronous;
 *  `from` itself when none is free or the check fails, the server then saying the port is in use. */
export function firstFreePort(from: number): number {
  const probe = `const net=require("net");const f=(p,n)=>{if(n===0){console.log(${from});return}const s=net.createServer();s.once("error",()=>f(p+1,n-1));s.listen(p,"127.0.0.1",()=>{s.close(()=>console.log(p))})};f(${from},20)`;
  const r = hiddenSpawnSync(process.execPath, ["-e", probe], { encoding: "utf8" });
  const port = Number(r.stdout?.trim());
  return Number.isInteger(port) && port > 0 ? port : from;
}

/** Documents live here, one directory per project. Never inside a project repo. */
export const DOCS_ROOT = path.join(DATA_ROOT, "docs");

/** The document directory for a project slug (the slug is what aiview shows as the project). */
export const docsDirFor = (projectSlug: string): string => path.join(DOCS_ROOT, projectSlug);

export function ensureHome(): void {
  fs.mkdirSync(DOCS_ROOT, { recursive: true });
}

