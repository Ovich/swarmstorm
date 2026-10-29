// Golden tests (board-rework D3): a verb's answer pinned byte for byte, after the parts that change from one run
// to the next (temporary paths, timestamps, seqs, funny names, ages) are normalised. A pinned answer lives in
// `pinned/<name>.txt`; `GOLDEN_UPDATE=1 npm test` writes them from today's answers instead of comparing.
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBoard } from "../../src/board/board.ts";
import { stopServerOf, untilGone } from "../fixtures/server.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, "..", "..", "src", "cli", "index.ts");
const PINNED = path.join(HERE, "pinned");
const UPDATING = process.env.GOLDEN_UPDATE === "1";

/** Who answers: the run's orchestrator, a worker of a task run (background listener, own worktree),
 *  a seat of a brainstorm run (foreground waits, shared checkout); beyond ROLES, a verifier seat of a task run
 *  (seat row role "verifier", busyMax 300000) and a brainstorm seat whose row has no role (board-split D11). */
export type Role = "orchestrator" | "worker" | "seat" | "verifier" | "seat-norole";
/** The member's situation when the verbs are called. */
export type Situation = "idle" | "owes-first" | "owes-again" | "paused" | "listening" | "closed";

export const ROLES: Role[] = ["orchestrator", "worker", "seat"];
export const SITUATIONS: Situation[] = ["idle", "owes-first", "owes-again", "paused", "listening", "closed"];

const GROUP = "g";
const SEAT_OF: Record<Exclude<Role, "orchestrator">, string> = { worker: "w1", seat: "s1", verifier: "v1", "seat-norole": "s1" };
/** The seat row each role's run is opened with, beyond its id and blockers. */
const SEAT_ROW_OF: Partial<Record<Role, object>> = { verifier: { role: "verifier", busyMax: 300000 } };
const isBrainstormRole = (role: Role) => role === "seat" || role === "seat-norole";

/** A verb's answer as pinned: the exit code, stdout, then stderr when there is any. */
export type Answer = { status: number | null; text: string };

export type Scene = {
  role: Role;
  /** The member the verbs are called as. */
  me: string;
  /** The run's other member, a worker or seat, so the orchestrator's phase has someone to owe it. */
  other: string;
  /** The verb's answer, normalised. */
  call: (...argv: string[]) => Answer;
  /** The CLI's stdout, exit 0 checked, not normalised. */
  must: (...argv: string[]) => string;
  /** A `wait --mentions` of `as` left pending in the background until `stop`. */
  listen: (as: string) => Promise<void>;
  stop: () => void;
};

/** Replaces what differs between runs of the same scene by a stable placeholder. */
export function normalise(text: string, home: string, nicks: Map<string, string>): string {
  const slashed = (p: string) => p.split("\\").join("/");
  let out = text.split("\r\n").join("\n");
  for (const p of [CLI, home]) {
    out = out.split(slashed(p)).join(p === CLI ? "<cli>" : "<home>").split(p).join(p === CLI ? "<cli>" : "<home>");
  }
  for (const [nick, seat] of nicks) out = out.split(nick).join(`<nick:${seat}>`).split(nick.replace(/\s+/g, "")).join(`<Nick:${seat}>`);
  return out
    .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z/g, "<ts>")
    .replace(/#\d+/g, "#<seq>")
    .replace(/\b\d+(s|m|h) ago\b/g, "<age> ago")
    // a roster row's unread count moves with the liveness events the board posts on its own clock
    .replace(/  \d+ unread  /g, "  <n> unread  ")
    // the idle event comes on the server's tick, before or after a verb: dropped, it is no answer's line
    .replace(/^#<seq> \S+ \(event\): idle .*\n/gm, "");
}

/** One scene: a fresh data home and repository, a run of the role's kind, its member joined, the situation set up. */
export async function scene(role: Role, situation: Situation): Promise<Scene> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-golden-"));
  const repo = path.join(home, "repo");
  fs.mkdirSync(repo, { recursive: true });
  const git = (...argv: string[]) => assert.equal(spawnSync("git", argv, { cwd: repo, encoding: "utf8" }).status, 0);
  git("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(repo, "a.ts"), "export {};\n");
  git("add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "root");
  const env = { ...process.env, SWARM_ROOT: home, SWARMSTORM_HOME: home, SWARM_NO_POLLER: "1" };
  const raw = (argv: string[]) => spawnSync(process.execPath, [CLI, ...argv], { cwd: repo, encoding: "utf8", env });
  const must = (...argv: string[]) => {
    const r = raw(argv);
    assert.equal(r.status, 0, `${argv.join(" ")}: ${r.stderr}${r.stdout}`);
    return r.stdout;
  };
  const kind = isBrainstormRole(role) ? "brainstorm" : "task";
  const seatId = role === "orchestrator" ? SEAT_OF.worker : SEAT_OF[role];
  const seats = path.join(home, "seats.json");
  fs.writeFileSync(seats, JSON.stringify([{ id: seatId, blockers: [], ...SEAT_ROW_OF[role] }]));
  const opened = raw(["open", "--kind", kind, "--group", GROUP, "--title", "T", "--seats", seats, "--onto", "main"]);
  assert.equal(opened.status, 0, opened.stderr);
  const runId = opened.stdout.split("\n")[0].trim();
  const orchestrator = `${GROUP}/orchestrator`;
  const member = `${GROUP}/${seatId}`;
  const joined = raw(["join", "--run", runId, "--seat", seatId, "--doing", "x", "--as", member]);
  assert.equal(joined.status, 0, joined.stderr);
  const me = role === "orchestrator" ? orchestrator : member;
  const nicks = new Map<string, string>();
  for (const r of (JSON.parse(must("roster", "--json")) as { roster: { nick: string; seat: string }[] }).roster) if (r.nick) nicks.set(r.nick, r.seat);
  const listeners: ChildProcess[] = [];
  const s: Scene = {
    role,
    me,
    other: member,
    must,
    call: (...argv) => {
      const r = raw(argv);
      return { status: r.status, text: normalise(r.stdout + (r.stderr ? `--- stderr\n${r.stderr}` : ""), home, nicks) };
    },
    listen: async (as) => {
      listeners.push(spawn(process.execPath, [CLI, "wait", "--mentions", "--as", as, "--timeout", "60000"], { cwd: repo, env, stdio: "ignore" }));
      // the listener is read off the store, as the CLI's own answers read it
      const store = await openBoard(path.join(home, "swarm.sqlite"));
      try {
        for (let i = 0; i < 100; i++) {
          if (store.participant(as)?.listening) return;
          await new Promise((ok) => setTimeout(ok, 100));
        }
      } finally {
        store.close();
      }
      assert.fail(`${as}: its listener never showed`);
    },
    stop: () => {
      // waited out, not only killed: on Windows a listener still exiting keeps its cwd, the temp repo, from removal (S31)
      for (const l of listeners) {
        l.kill();
        if (l.pid !== undefined) untilGone(l.pid);
      }
      stopServerOf(home);
      fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
  // the situation
  const phase = () => must("phase", "build", "build the thing", "--as", orchestrator);
  if (situation === "owes-first") phase();
  if (situation === "owes-again") {
    phase();
    must("deliver", "--as", me);
  }
  if (situation === "paused") {
    phase();
    must("pause", "hold on", "--as", orchestrator);
  }
  if (situation === "listening") {
    phase();
    // drained first: a listener started with the phase unread returns at once
    must("deliver", "--as", me);
    await s.listen(me);
    // every member now waits: the server's tick posts idle when it next runs; waited out and read, so no verb's
    // answer carries it or not by timing
    const store = await openBoard(path.join(home, "swarm.sqlite"));
    try {
      const repoKey = store.participant(me)!.repo;
      for (let i = 0; i < 100 && !store.snapshot(repoKey).events.some((e) => e.event === "idle"); i++) await new Promise((ok) => setTimeout(ok, 100));
    } finally {
      store.close();
    }
    must("deliver", "--as", me);
  }
  if (situation === "closed") must("close", "--run", runId, "--as", orchestrator);
  return s;
}

/** Compares `answer` with its pinned bytes, or writes them under GOLDEN_UPDATE=1. */
export function pin(name: string, answer: Answer): void {
  const text = `exit ${answer.status}\n${answer.text}`;
  const file = path.join(PINNED, `${name}.txt`);
  if (UPDATING) {
    fs.mkdirSync(PINNED, { recursive: true });
    fs.writeFileSync(file, text);
    return;
  }
  assert.equal(text, fs.readFileSync(file, "utf8"), `${name}: the answer moved from its pinned bytes (GOLDEN_UPDATE=1 rewrites them)`);
}

/** The pinned bytes of `name`, for a target test to start from. */
export const pinned = (name: string): string => fs.readFileSync(path.join(PINNED, `${name}.txt`), "utf8");
