// Pidfile, portfile and versionfile next to the sqlite in the data home: how `open` and
// `status` find a running server, and whether it is the installed one. One data home =
// one server, shared by every project.
import fs from "node:fs";
import path from "node:path";
import { DATA_ROOT, ensureHome } from "./home.ts";

export const PID_FILE = path.join(DATA_ROOT, "aiview.pid");
export const PORT_FILE = path.join(DATA_ROOT, "aiview.port");
export const VERSION_FILE = path.join(DATA_ROOT, "aiview.version");
/** The running server's token (trust-adaptations#D4): every POST carries it; the CLI reads it here. */
export const TOKEN_FILE = path.join(DATA_ROOT, "aiview.token");

export interface ServerStatus {
  running: boolean;
  pid: number | null;
  port: number | null;
  /** The collection version the running server started from; null when it recorded none
   *  (a server from before versions were recorded, or no manifest to read). */
  version: string | null;
  /** Files exist but the process is dead — safe to overwrite. */
  stale: boolean;
}

const readInt = (f: string): number | null => {
  try {
    const n = Number(fs.readFileSync(f, "utf8").trim());
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
};

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const readText = (f: string): string | null => {
  try {
    const t = fs.readFileSync(f, "utf8").trim();
    return t === "" ? null : t;
  } catch {
    return null;
  }
};

/** The version and the token are written first: a reader that finds this pid and port finds them too. */
export function writeServerFiles(port: number, version: string | null, token: string): void {
  ensureHome();
  if (version === null) fs.rmSync(VERSION_FILE, { force: true });
  else fs.writeFileSync(VERSION_FILE, version);
  fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
  fs.writeFileSync(PID_FILE, String(process.pid));
  fs.writeFileSync(PORT_FILE, String(port));
}

export function clearServerFiles(): void {
  // only clear our own files — a newer server may have overwritten them
  if (readInt(PID_FILE) === process.pid) {
    try {
      fs.rmSync(PID_FILE, { force: true });
      fs.rmSync(PORT_FILE, { force: true });
      fs.rmSync(VERSION_FILE, { force: true });
      fs.rmSync(TOKEN_FILE, { force: true });
    } catch {}
  }
}

/** The token of the server the files name; null when none was written. */
export const readServerToken = (): string | null => readText(TOKEN_FILE);

export function readServerStatus(): ServerStatus {
  const pid = readInt(PID_FILE);
  const port = readInt(PORT_FILE);
  if (pid === null || port === null)
    return { running: false, pid: null, port: null, version: null, stale: pid !== null || port !== null };
  const version = readText(VERSION_FILE);
  if (!alive(pid)) return { running: false, pid, port, version, stale: true };
  return { running: true, pid, port, version, stale: false };
}
