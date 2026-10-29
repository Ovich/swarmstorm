// D3: today's answers of join, thread, read, deliver, wait and done, pinned over role x situation. Each scene calls
// the verbs in this order, so a pinned answer is what that verb says after the ones before it in the same scene.
import { test } from "node:test";
import { pin, ROLES, scene, SITUATIONS } from "./golden.ts";

const RUN = "1";

for (const role of ROLES) {
  for (const situation of SITUATIONS) {
    test(`golden: ${role} ${situation}`, async () => {
      const s = await scene(role, situation);
      try {
        const seat = s.me.split("/")[1];
        const at = (verb: string) => `${verb}.${role}.${situation}`;
        pin(at("join"), s.call("join", "--run", RUN, "--seat", seat, "--doing", "x", "--as", s.me));
        pin(at("thread"), s.call("thread", "--as", s.me));
        pin(at("read"), s.call("read", "1", "--as", s.me));
        pin(at("deliver"), s.call("deliver", "--as", s.me));
        pin(at("wait"), s.call("wait", "--mentions", "--as", s.me, "--timeout", "1000"));
        pin(at("done"), s.call("done", "build", "--as", s.me));
      } finally {
        s.stop();
      }
    });
  }
}
