// The board server a test's spawned CLI started on its temporary data home, stopped when the test
// ends (swarm-relay D27): its links exit with it, and no node process of the suite is left behind.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAlive, serverLockHolder, serverStartLock, serverStateFile } from "../../src/wire.ts";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "cli", "index.ts");
/** How many 50 ms polls a server stopped or killed here has to be gone: counted, not timed, as a test
 *  may have mocked Date. */
const GONE_POLLS = 200;

/** Waits until `pid` has exited, at most GONE_POLLS polls. On Windows a folder that a live process
 *  holds a file of cannot be removed: a test's cleanup waits for the process, not its state file. */
export function untilGone(pid: number): void {
  for (let i = 0; i < GONE_POLLS && isAlive(pid); i++) spawnSync(process.execPath, ["-e", "setTimeout(()=>{},50)"]);
}

/** The pid `home`'s state file names; null when there is none. */
function statePid(home: string): number | null {
  try {
    const pid = (JSON.parse(fs.readFileSync(serverStateFile(home), "utf8")) as { pid?: unknown }).pid;
    return typeof pid === "number" ? pid : null;
  } catch {
    return null;
  }
}

/** Every link `home`'s pid files name, killed and waited out. A verb outside a harness session spawns its member's link
 *  detached (D32); the link exits after its server, on its own clock, and on Windows its open pid file keeps the test's
 *  temporary home from being removed (EPERM, S31). */
function stopLinksOf(home: string): void {
  let pidFiles: string[];
  try {
    pidFiles = fs.readdirSync(path.join(home, "links")).filter((f) => f.endsWith(".pid"));
  } catch {
    return;
  }
  for (const f of pidFiles) {
    let pid = NaN;
    try {
      pid = Number(fs.readFileSync(path.join(home, "links", f), "utf8").trim());
    } catch {}
    if (!Number.isInteger(pid) || pid === process.pid || !isAlive(pid)) continue;
    try {
      process.kill(pid);
    } catch {}
    untilGone(pid);
  }
}

/** `swarm serve stop` on `home`, then its process gone; nothing to stop is no error. A server still
 *  holding the start lock after it (one that had not yet written its state file, a test failing while
 *  it started) is killed: whatever the test did, no `serve` of it outlives it (D40). */
export function stopServerOf(home: string): void {
  const running = statePid(home);
  spawnSync(process.execPath, [CLI, "serve", "stop"], { cwd: home, encoding: "utf8", env: { ...process.env, SWARM_ROOT: home, SWARMSTORM_HOME: home, SWARM_NO_POLLER: "1" } });
  // serve stop returns once the state file is gone; the process exits after it
  if (running !== null && running !== process.pid) untilGone(running);
  stopLinksOf(home);
  const holder = serverLockHolder(home);
  if (holder === null || holder === process.pid || !isAlive(holder)) return;
  try {
    process.kill(holder);
  } catch {}
  untilGone(holder);
  fs.rmSync(serverStartLock(home), { force: true });
}
