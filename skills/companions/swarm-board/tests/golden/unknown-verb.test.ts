// T70 (break-fix 3, V-48): a word that is no verb of this CLI answers `<word>: no such verb` with where the verbs are,
// the same for every caller, never the whole usage; a code verb from a member without the code pack keeps its D12 line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pin } from "./golden.ts";
import { scratchRepo } from "./scratch-repo.ts";

test("V-48: flag, conflicts, unclaimed and guides are no verbs: one line naming the word and the help, from a seat too", () => {
  const s = scratchRepo([{ id: "s1", blockers: [] }]);
  try {
    s.must("open", "--kind", "brainstorm", "--group", "bs", "--title", "bs", "--seats", s.seatsFile);
    s.must("join", "--run", "1", "--seat", "s1", "--doing", "x", "--as", "bs/s1");
    const flag = s.call("flag", "--as", "bs/s1");
    pin("unknown-verb.flag", flag);
    for (const word of ["flag", "conflicts", "unclaimed", "guides"]) {
      const r = s.call(word, "--as", "bs/s1");
      assert.notEqual(r.status, 0);
      assert.match(r.text, new RegExp(`^${word}: no such verb`, "m"));
      assert.doesNotMatch(r.text, /^usage:/m, "the line, not the whole usage");
    }
    // a code verb keeps its D12 refusal
    assert.match(s.call("merge-lock", "--as", "bs/s1").text, /merge-lock is a worker's verb/);
  } finally {
    s.done();
  }
});
