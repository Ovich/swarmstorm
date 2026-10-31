// T56 (break-fix 1): the stats line of a run that never merges carries no conflicts (V-19, D66); stats' last line runs
// as printed (V-31, AGENTS rule 10).
import { test } from "node:test";
import assert from "node:assert/strict";
import { pin } from "./golden.ts";
import { openTask, scratchRepo } from "./scratch-repo.ts";

test("V-19: a brainswarm's stats line has no conflicts part; a task run's keeps it", () => {
  const s = scratchRepo([{ id: "s1", blockers: [] }]);
  try {
    s.must("open", "--kind", "brainstorm", "--group", "bs", "--title", "bs", "--seats", s.seatsFile);
    openTask(s, "vt");
    const lines = s.must("stats").split("\n");
    const brainswarm = lines.find((l) => l.includes("· brainstorm ·"))!;
    const task = lines.find((l) => l.includes("· task ·"))!;
    assert.doesNotMatch(brainswarm, /conflicts/);
    assert.match(task, /· conflicts /);
  } finally {
    s.done();
  }
});

test("V-31: stats ends on the --json command as this CLI runs, its home prefix as every other command line carries it", () => {
  const s = scratchRepo();
  try {
    // the open's link line is how this CLI prints itself (the home prefix included where the home is not the default)
    const linkLine = openTask(s, "vt").text.split("\n").find((l) => l.includes(" link --run "))!;
    const cli = linkLine.replace(/^.*\): (.*) link --run .*$/, "$1");
    const last = s.must("stats").trimEnd().split("\n").at(-1)!;
    pin("stats-task-lines.stats-json-line", { status: 0, text: last });
    assert.equal(last, `${cli} stats --json for every figure`);
  } finally {
    s.done();
  }
});

