// A scratch repository on `main` with its own board home, for golden tests that drive the CLI as a person would:
// `call` gives a verb's answer normalised, `must` the same with exit 0 checked, `openTask` opens a task run.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stopServerOf } from "../fixtures/server.ts";
import { normalise } from "./golden.ts";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "cli", "index.ts");

export type ScratchRepo = {
  home: string;
  repo: string;
  /** The seats file every open of this scene reads. */
  seatsFile: string;
  call: (...argv: string[]) => { status: number | null; text: string };
  must: (...argv: string[]) => string;
  done: () => void;
};

/** A scratch repository on `main`, its board home, and a seats file of `seats`. */
export function scratchRepo(seats: object[] = [{ id: "w1", blockers: [] }]): ScratchRepo {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-scratch-"));
  const repo = path.join(home, "repo");
  fs.mkdirSync(repo);
  const git = (...argv: string[]) => assert.equal(spawnSync("git", argv, { cwd: repo, encoding: "utf8" }).status, 0);
  git("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(repo, "a.ts"), "export {};\n");
  git("add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "root");
  const env = { ...process.env, SWARM_ROOT: home, SWARMSTORM_HOME: home, SWARM_NO_POLLER: "1" };
  const call = (...argv: string[]) => {
    const r = spawnSync(process.execPath, [CLI, ...argv], { cwd: repo, encoding: "utf8", env });
    return { status: r.status, text: normalise(`${r.stdout}${r.stderr}`, home, new Map()) };
  };
  const must = (...argv: string[]) => {
    const r = call(...argv);
    assert.equal(r.status, 0, `${argv.join(" ")}: ${r.text}`);
    return r.text;
  };
  const seatsFile = path.join(home, "seats.json");
  fs.writeFileSync(seatsFile, JSON.stringify(seats));
  return {
    home,
    repo,
    seatsFile,
    call,
    must,
    done: () => {
      stopServerOf(home);
      fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

/** Opens a task run of `group` onto `main`. */
export const openTask = (s: ScratchRepo, group: string, ...more: string[]) =>
  s.call("open", "--kind", "task", "--group", group, "--title", group, "--seats", s.seatsFile, "--onto", "main", ...more);
