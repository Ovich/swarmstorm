// T51 (board-split#D58, D66): open and the run's identity. A group names one open run per project (V-1); `open` says
// how each seat joins (V-16) and, on a code run, the detach a checked-out target needs (V-20); a seat standing for a
// closed run reads ended (V-16); the help states the real stall default and worktree place (V-14); a run with no pack
// carries no code figures and no claims (V-19).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { STALL_MS_DEFAULT } from "../../src/board/liveness.ts";
import { pin } from "./golden.ts";
import { openTask, scratchRepo as scene } from "./scratch-repo.ts";

test("V-1: a second open of a group open on the project is refused, naming the open run and how to go on", () => {
  const s = scene();
  try {
    assert.equal(openTask(s, "vt").status, 0);
    const second = openTask(s, "vt");
    pin("open-identity.group-open", second);
    assert.notEqual(second.status, 0);
    assert.match(second.text, /group vt already has run 1 open/);
    assert.match(second.text, /close --run 1/);
    // another group opens; once the first is closed, the group opens again
    assert.equal(openTask(s, "other").status, 0);
    s.must("close", "--run", "1");
    assert.equal(openTask(s, "vt").status, 0);
  } finally {
    s.done();
  }
});

test("V-1: --as <group>/<seat> binds to the group's open run, never a newer closed one's member", () => {
  const s = scene();
  try {
    openTask(s, "vt");
    s.must("close", "--run", "1");
    openTask(s, "vt"); // run 2, open
    const status = s.must("doing", "x", "--as", "vt/orchestrator", "--json");
    assert.match(status, /vt\/orchestrator/);
    const roster = JSON.parse(s.must("roster", "--json")) as { roster: { name: string; run: number; doing: string }[] };
    assert.equal(roster.roster.find((r) => r.name === "vt/orchestrator" && r.doing === "x")?.run, 2);
  } finally {
    s.done();
  }
});

test("V-16, V-20: open names how each seat joins and, its target checked out, the detach command", () => {
  const s = scene([{ id: "w1", blockers: [] }, { id: "v1", role: "verifier", blockers: [] }]);
  try {
    const opened = openTask(s, "vt");
    const lines = opened.text.split("\n").filter((l) => l.startsWith("each seat joins") || l.includes("is checked out at"));
    pin("open-identity.open-lines", { status: opened.status, text: lines.join("\n") });
    assert.match(opened.text, /join --run 1 --seat <seat> --doing "waiting for a task" --as vt\/<seat>/);
    assert.match(opened.text, /main is checked out at .*: .*switch --detach/);
  } finally {
    s.done();
  }
});

test("V-20: a brainswarm opens with no detach line; its seats' join line still shows", () => {
  const s = scene([{ id: "s1", blockers: [] }]);
  try {
    const opened = s.call("open", "--kind", "brainstorm", "--group", "bs", "--title", "bs", "--seats", s.seatsFile);
    assert.equal(opened.status, 0, opened.text);
    assert.doesNotMatch(opened.text, /checked out/);
    assert.match(opened.text, /each seat joins/);
  } finally {
    s.done();
  }
});

test("V-16: an orchestrators-board seat standing for a run that closed reads ended in status and in its composition (V-29: one word)", () => {
  const s = scene([]);
  try {
    openTask(s, "alpha", "--authority", "architect");
    const seats = path.join(s.home, "orchestrators.json");
    fs.writeFileSync(seats, JSON.stringify([{ id: "alpha", role: "architect", blockers: [] }]));
    s.must("open", "--kind", "brainstorm", "--group", "orchestrators", "--title", "Orchestrators", "--seats", seats);
    s.must("close", "--run", "1");
    const status = s.must("status");
    const seat = status.split("\n").filter((l) => /^\s+alpha /.test(l));
    pin("open-identity.closed-seat", { status: 0, text: seat.join("\n") });
    assert.match(seat.join("\n"), /alpha ended/);
    // its composition (roster, join) says the same
    const roster = JSON.parse(s.must("roster", "--json")) as { compositions: { entries: { seat: string; state: string }[] }[] };
    assert.equal(roster.compositions.flatMap((c) => c.entries).find((e) => e.seat === "alpha")?.state, "ended");
  } finally {
    s.done();
  }
});

test("V-14: help states the real stall default and where a worktree is made", () => {
  const s = scene();
  try {
    const help = s.call("--help").text;
    assert.match(help, new RegExp(`--stall-ms: .*default and floor ${STALL_MS_DEFAULT}`));
    assert.doesNotMatch(help, /default 60000/);
    assert.match(help, /<git dir>\/swarm\/worktrees\/<run>\/<seat>/);
    assert.doesNotMatch(help, /worktree under the data home/);
  } finally {
    s.done();
  }
});

test("V-19: a brainswarm run carries no code figures in stats", () => {
  const s = scene([{ id: "s1", blockers: [] }]);
  try {
    s.must("open", "--kind", "brainstorm", "--group", "bs", "--title", "bs", "--seats", s.seatsFile);
    openTask(s, "vt");
    const stats = JSON.parse(s.must("stats", "--json")) as { runs: Record<string, unknown>[] };
    const brainswarm = stats.runs.find((r) => r.kind === "brainstorm")!;
    const task = stats.runs.find((r) => r.kind === "task")!;
    assert.equal("racesLost" in brainswarm, false, "no merge-lock figure on a brainswarm");
    assert.equal("firstMergeAtMs" in brainswarm, false);
    assert.equal("racesLost" in task, true, "a code run keeps its figures");
  } finally {
    s.done();
  }
});
