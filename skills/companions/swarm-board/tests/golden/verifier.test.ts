// board-split T1 (board-rework D3): today's answers of the core verbs pinned for the two members the split changes
// most, a verifier seat of a task run (today it gets a worktree, G20) and a brainstorm seat with no role (D11: core
// only), before any change, so later phases flip them on purpose. Each scene calls the verbs in this order.
import { test } from "node:test";
import { pin, scene, type Role, type Situation } from "./golden.ts";

const RUN = "1";
const MEMBERS: Role[] = ["verifier", "seat-norole"];
const SITUATIONS_SPLIT: Situation[] = ["idle", "owes-first", "closed"];

for (const role of MEMBERS) {
  for (const situation of SITUATIONS_SPLIT) {
    test(`golden split: ${role} ${situation}`, async () => {
      const s = await scene(role, situation);
      try {
        const seat = s.me.split("/")[1];
        const at = (verb: string) => `${role}.${verb}.${situation}`;
        pin(at("join"), s.call("join", "--run", RUN, "--seat", seat, "--doing", "x", "--as", s.me));
        pin(at("post"), s.call("post", "a note", "--as", s.me));
        pin(at("wait.empty"), s.call("wait", "--mentions", "--as", s.me, "--timeout", "1000"));
        if (situation !== "closed") s.must("post", `@${seat} a question for you`, "--as", "g/orchestrator");
        pin(at("wait.mention"), s.call("wait", "--mentions", "--as", s.me, "--timeout", "1000"));
        pin(at("done"), s.call("done", "build", "--as", s.me));
        pin(at("roster"), s.call("roster", "--as", s.me));
        pin(at("claim"), s.call("claim", "a.ts", "--as", s.me));
      } finally {
        s.stop();
      }
    });
  }
}
