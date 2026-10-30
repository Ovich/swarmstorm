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
function scene(): { open: (group: string, authority: string | null) => string; status: () => string; home: string; done: () => void } {
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
    return normalise(r.stdout, home, new Map());
  };
  const seats = path.join(home, "seats.json");
  fs.writeFileSync(seats, "[]");
  return {
    home,
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
  const a = { id: 1, repo: "/r/.git", group: "a", authority: ["architect"] };
  assert.deepEqual(decisionsLines([a, { id: 2, repo: "/r/.git", group: "b", authority: ["reviewer", "moderator"] }], cli), []);
  assert.deepEqual(decisionsLines([a, { id: 2, repo: "/other/.git", group: "b", authority: ["architect"] }], cli), []);
  const b = { id: 2, repo: "/r/.git", group: "b", authority: ["devops"] };
  assert.equal(decisionsLines([a, b], cli, 3).length, 0, "an open of a run holding none says nothing");
  const withRun = decisionsLines([a, b, { id: 5, repo: "/r/.git", group: "decisions" }], cli);
  assert.equal(withRun.length, 1);
  assert.match(withRun[0], /decisions run, run 5; .* seat add <your seat> --run 5/);
});
