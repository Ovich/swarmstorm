// A member's link as other processes see it (codebase-rework#D3): the pid file it writes under its data home, and the
// stop of those links before their worktrees go. node:* and host/ only, so the code pack's worktrees reach it without
// the link.
import fs from "node:fs";
import path from "node:path";
import { DATA_ROOT } from "./home.ts";
import { hiddenSpawnSync, isAlive } from "./proc.ts";

/** Where a live link writes its pid: under its data home, so a stop never reaches another home's link. */
export function linkPidFile(dataRoot: string, run: number, member: string): string {
  return path.join(dataRoot, "links", `${run}-${member.replace(/[^A-Za-z0-9_-]/g, "_")}.pid`);
}

/** A value that may enter a process query as a pid: a positive whole number, nothing else (trust-adaptations#D8). */
export const isProcessId = (pid: unknown): pid is number => typeof pid === "number" && Number.isInteger(pid) && pid > 0;

/** The command line of a live process; null when it is gone or cannot be read, and for anything but a pid, which
 *  never reaches the PowerShell command (trust-adaptations#D8). */
export function commandLine(pid: number): string | null {
  if (!isProcessId(pid)) return null;
  const r =
    process.platform === "win32"
      ? hiddenSpawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`], { encoding: "utf8", windowsHide: true })
      : hiddenSpawnSync("ps", ["-o", "args=", "-p", String(pid)], { encoding: "utf8" });
  return (r.stdout ?? "").trim() || null;
}

/** How long `stopLinks` lets a link the server already told (its run closed, its member ended) exit on its own. */
const OWN_EXIT_GRACE_MS = 3000;

/** Stops the members' links before their worktrees go (Windows refuses to remove a folder a live process holds):
 *  only the pid each link wrote under this data home, and only while that process is still a link. The server has
 *  told each its run closed or its member ended, so each is given its grace to exit 0 on its own (V-17); a kill, exit 1
 *  on Windows, is the fallback for one still there. */
export function stopLinks(runId: number, members: string[]): void {
  const pids: number[] = [];
  for (const member of members) {
    const file = linkPidFile(DATA_ROOT, runId, member);
    let pid: number;
    try {
      pid = Number(fs.readFileSync(file, "utf8").trim());
    } catch {
      continue;
    }
    if (isProcessId(pid) && pid !== process.pid && isAlive(pid) && /\slink(\s|$)/.test(commandLine(pid) ?? "")) pids.push(pid);
    try {
      fs.rmSync(file);
    } catch {}
  }
  const pauseSync = (ms: number) => hiddenSpawnSync(process.execPath, ["-e", `setTimeout(()=>{},${ms})`]);
  for (const end = Date.now() + OWN_EXIT_GRACE_MS; Date.now() < end && pids.some(isAlive); ) pauseSync(100);
  const left = pids.filter(isAlive);
  for (const pid of left) {
    try {
      process.kill(pid);
    } catch {}
  }
  for (let i = 0; i < 40 && left.some(isAlive); i++) pauseSync(50);
}
