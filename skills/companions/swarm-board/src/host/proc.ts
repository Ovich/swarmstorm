// Every child process swarm starts goes through here (board-split#D39): it never opens a console window on the
// person's desktop, whatever the caller passed. tests/no-raw-spawn.test.ts keeps child_process out of the rest of src/.
import { spawn, spawnSync, type SpawnOptions, type SpawnSyncOptions, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from "node:child_process";

/** `spawn` with `windowsHide: true` forced. */
export const hiddenSpawn = (command: string, args: readonly string[], options: SpawnOptions = {}) => spawn(command, args, { ...options, windowsHide: true });

/** `spawnSync` with `windowsHide: true` forced. */
export function hiddenSpawnSync(command: string, args: readonly string[], options: SpawnSyncOptionsWithStringEncoding): SpawnSyncReturns<string>;
export function hiddenSpawnSync(command: string, args: readonly string[], options?: SpawnSyncOptions): SpawnSyncReturns<string | Buffer>;
export function hiddenSpawnSync(command: string, args: readonly string[], options: SpawnSyncOptions = {}): SpawnSyncReturns<string | Buffer> {
  return spawnSync(command, args, { ...options, windowsHide: true });
}
