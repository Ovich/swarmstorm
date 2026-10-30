// The decisions run (board-split D28, D29): two open runs on one project, each holding a decision-authority role, are
// told so by the second's `open` and by `status`, in one line naming both runs and their roles, with the command
// opening the decisions run (group `decisions`). One run alone, or two with no authority, hear nothing of it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decisionsLines } from "../../src/cli/answer/decisions.ts";
import { stopServerOf } from "../fixtures/server.ts";
import { normalise, pin } from "./golden.ts";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "cli", "index.ts");

/** A scratch project with its board home; `open` opens a task run of `group`, its authority given when not null. */
function scene(): { open: (group: string, authority: string | null) => string; status: () => string; raw: (...argv: string[]) => string; home: string; done: () => void } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-decisions-"));
  const repo = path.join(home, "repo");
  fs.mkdirSync(repo);
  const git = (...argv: string[]) => assert.equal(spawnSync("git", argv, { cwd: repo, encoding: "utf8" }).status, 0);
  git("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(repo, "a.ts"), "export {};\n");
  git("add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "root");
  const env = { ...process.env, SWARM_ROOT: home, SWARMSTORM_HOME: home, SWARM_NO_POLLER: "1" };
  const must = (...argv: string[]): string => {
    const r = spawnSync(process.execPath, [CLI, ...argv], { cwd: repo, encoding: "utf8", env });
    assert.equal(r.status, 0, `${argv.join(" ")}: ${r.stderr}${r.stdout}`);
    // the seats file is named by a hash of the scratch repository's path: masked, as the home is
    return normalise(r.stdout, home, new Map()).replace(/-[0-9a-f]{8}.seats.json/g, "-<hash>.seats.json");
  };
  const seats = path.join(home, "seats.json");
  fs.writeFileSync(seats, "[]");
  return {
    home,
    raw: (...argv) => {
      const r = spawnSync(process.execPath, [CLI, ...argv], { cwd: repo, encoding: "utf8", env });
      assert.equal(r.status, 0, `${argv.join(" ")}: ${r.stderr}${r.stdout}`);
      return r.stdout;
    },
    open: (group, authority) => must("open", "--kind", "task", "--group", group, "--title", group, "--seats", seats, "--onto", "main", ...(authority ? ["--authority", authority] : [])),
    // status's own lines past the store's paths and the runs: the decisions line, or none
    status: () => must("status").split("\n").filter((l) => l.startsWith("decision authority")).join("\n"),
    done: () => {
      stopServerOf(home);
      fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

test("two runs opened --authority architect: the second's open and status give the decisions-run line; the first's open none", () => {
  const s = scene();
  try {
    const first = s.open("alpha", "architect");
    assert.doesNotMatch(first, /decision authority/, "one run alone opens nothing");
    const second = s.open("beta", "architect,tech-lead");
    pin("decisions-run.second-open", { status: 0, text: second.split("\n").filter((l) => l.startsWith("decision authority")).join("\n") });
    pin("decisions-run.status", { status: 0, text: s.status() });
    assert.match(second, /run \d+ alpha \(architect\) and run \d+ beta \(architect, tech-lead\)/);
    assert.match(second, /open --kind brainstorm --group decisions/);
    // F18, F19 (AGENTS rule 10): the printed open runs as printed, its seats the two runs; once open, status names no missing seat
    const line = s.raw("status").split("\n").find((l) => l.startsWith("decision authority"))!;
    const [written] = fs.readdirSync(path.join(s.home, "decisions"));
    const seatsFile = path.join(s.home, "decisions", written);
    assert.ok(line.includes(path.basename(seatsFile)), "the line prints the file the board wrote");
    assert.deepEqual(JSON.parse(fs.readFileSync(seatsFile, "utf8")).map((x: { id: string; role: string }) => [x.id, x.role]), [["alpha", "architect"], ["beta", "architect,tech-lead"]]);
    s.raw("open", "--kind", "brainstorm", "--group", "decisions", "--title", "Decisions", "--seats", seatsFile);
    assert.match(s.status(), /decisions run, run \d+$/);
  } finally {
    s.done();
  }
});

test("one run with authority alone: neither open nor status says anything of the decisions run", () => {
  const s = scene();
  try {
    assert.doesNotMatch(s.open("alpha", "architect"), /decision authority/);
    assert.equal(s.status(), "");
  } finally {
    s.done();
  }
});

test("two runs with no authority: neither open nor status says anything of the decisions run", () => {
  const s = scene();
  try {
    s.open("alpha", null);
    assert.doesNotMatch(s.open("beta", null), /decision authority/);
    assert.equal(s.status(), "");
  } finally {
    s.done();
  }
});

test("the rule: run-level roles are no decision authority; another project's run counts not; an open decisions run is named", () => {
  const cli = "swarm";
  const written: { repo: string; seats: unknown }[] = [];
  const writeSeats = (repo: string, seats: unknown) => (written.push({ repo, seats }), "/home/decisions/r.seats.json");
  const a = { id: 1, repo: "/r/.git", group: "a", authority: ["architect"] };
  assert.deepEqual(decisionsLines([a, { id: 2, repo: "/r/.git", group: "b", authority: ["reviewer", "moderator"] }], cli, writeSeats), []);
  assert.deepEqual(decisionsLines([a, { id: 2, repo: "/other/.git", group: "b", authority: ["architect"] }], cli, writeSeats), []);
  const b = { id: 2, repo: "/r/.git", group: "b", authority: ["devops"] };
  assert.equal(decisionsLines([a, b], cli, writeSeats, 3).length, 0, "an open of a run holding none says nothing");
  const withRun = decisionsLines([a, b, { id: 5, repo: "/r/.git", group: "decisions" }], cli, writeSeats);
  assert.equal(withRun.length, 1);
  // F19: each missing seat its own command, filled in; a seated run is not asked again
  assert.match(withRun[0], /decisions run, run 5; add the missing seats: swarm seat add a --run 5 --role architect ; swarm seat add b --run 5 --role devops$/);
  const oneSeated = decisionsLines([a, b, { id: 5, repo: "/r/.git", group: "decisions", seats: [{ id: "a" }] }], cli, writeSeats);
  assert.match(oneSeated[0], /add the missing seat: swarm seat add b --run 5 --role devops$/);
  // F18: no decisions run yet: the board writes the seats file and prints its real path
  const needed = decisionsLines([a, b], cli, writeSeats);
  assert.ok(needed[0].endsWith("--seats /home/decisions/r.seats.json"), needed[0]);
  assert.deepEqual(written.at(-1), { repo: "/r/.git", seats: [{ id: "a", role: "architect", blockers: [] }, { id: "b", role: "devops", blockers: [] }] });
});
