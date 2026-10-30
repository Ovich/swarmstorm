// T64 (break-fix 2, D58): `join --as <group>/<seat>` names the run's own group, or the join is refused, naming the run's
// group and the corrected line (V-42): the --as of another group never takes a member of the run joined.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pin } from "./golden.ts";
import { openTask, scratchRepo } from "./scratch-repo.ts";

test("V-42: join --as of another group is refused, naming the run's group and the corrected line; the run's own --as joins", () => {
  const s = scratchRepo([{ id: "w1", blockers: [] }]);
  try {
    openTask(s, "va");
    openTask(s, "vb");
    const refused = s.call("join", "--run", "2", "--seat", "w1", "--doing", "x", "--as", "va/w1");
    pin("join-as.other-group", refused);
    assert.notEqual(refused.status, 0);
    assert.match(refused.text, /run 2, whose group is vb/);
    assert.match(refused.text, /join --run 2 --seat w1 --doing x --as vb\/w1/);
    assert.match(s.must("join", "--run", "2", "--seat", "w1", "--doing", "x", "--as", "vb/w1"), /you are vb\/w1/);
  } finally {
    s.done();
  }
});
