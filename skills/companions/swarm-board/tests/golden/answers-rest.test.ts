// D3 for build 3: the answers of the verbs moved onto the answer module after the wait cluster, pinned before the move:
// post, agree, endorse, claim, release, merge-lock, merged, lock, unlock, phase, pause, resume, end, open, and the
// argument errors V9 and V13 name. Pinned over role x situation; each scene calls the verbs in this order.
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pin, scene, type Role, type Situation } from "./golden.ts";

const ROLES_REST: Role[] = ["orchestrator", "worker", "seat"];
const SITUATIONS_REST: Situation[] = ["idle", "owes-first", "listening", "closed"];

for (const role of ROLES_REST) {
  for (const situation of SITUATIONS_REST) {
    test(`golden rest: ${role} ${situation}`, async () => {
      const s = await scene(role, situation);
      try {
        const at = (verb: string) => `rest.${verb}.${role}.${situation}`;
        const posted = s.call("post", "a note about a.ts", "--as", s.me);
        pin(at("post"), posted);
        pin(at("agree"), s.call("agree", "I change a.ts first", "--with", s.other.split("/")[1], "--as", s.me));
        pin(at("endorse"), s.call("endorse", "1", "--as", s.me));
        pin(at("claim"), s.call("claim", "a.ts", "--as", s.me));
        pin(at("release"), s.call("release", "a.ts", "--as", s.me));
        pin(at("lock"), s.call("lock", "port:59999", "--as", s.me));
        pin(at("unlock"), s.call("unlock", "port:59999", "--as", s.me));
        pin(at("merge-lock.no-onto"), s.call("merge-lock", "--as", s.me));
        pin(at("merged.unknown"), s.call("merged", "0000000", "--files", "a.ts", "--report", "-", "--as", s.me));
        if (role === "orchestrator") {
          pin(at("phase"), s.call("phase", "verify", "check it", "--as", s.me));
          pin(at("pause"), s.call("pause", "hold", "--as", s.me));
          pin(at("resume"), s.call("resume", "go on", "--as", s.me));
        }
        pin(at("end"), s.call("end", "--as", s.me));
      } finally {
        s.stop();
      }
    });
  }
}

test("golden rest: open, and its argument errors", async () => {
  const s = await scene("orchestrator", "idle");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-golden-seats-"));
  try {
    const seats = path.join(dir, "seats.json");
    fs.writeFileSync(seats, JSON.stringify([{ id: "w9", blockers: [] }]));
    const noId = path.join(dir, "no-id.json");
    fs.writeFileSync(noId, JSON.stringify([{ blockers: [] }]));
    const clean = (a: { status: number | null; text: string }) => ({ ...a, text: a.text.split(dir.split("\\").join("/")).join("<seats>").split(dir).join("<seats>") });
    pin("rest.open.task", clean(s.call("open", "--kind", "task", "--group", "h", "--title", "T", "--seats", seats, "--onto", "main")));
    pin("rest.open.no-id", clean(s.call("open", "--kind", "task", "--group", "h2", "--title", "T", "--seats", noId, "--onto", "main")));
    pin("rest.open.no-group", clean(s.call("open", "--kind", "task", "--title", "T", "--seats", seats)));
    pin("rest.done.no-phase-arg", s.call("done", "--as", s.me));
    pin("rest.seat.no-id", s.call("seat", "--as", s.me));
  } finally {
    s.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
