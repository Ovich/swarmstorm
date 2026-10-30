// board-split D30, D34 goldens: the orchestrator's park and unpark answers, the parked worker's wake line, its roster
// row "dormant until <phase>", and all-done counting the others alone.
import { test } from "node:test";
import { pin, scene } from "./golden.ts";

test("golden: park, the parked member's wake, dormant until, all-done without it, unpark", async () => {
  const s = await scene("orchestrator", "owes-first");
  try {
    const orch = s.me;
    const worker = s.other;
    const seat = worker.split("/")[1];
    pin("park.orchestrator.park", s.call("park", seat, "--until", "verify", "--as", orch));
    pin("park.orchestrator.roster", s.call("roster", "--as", orch));
    pin("park.orchestrator.unpark", s.call("unpark", seat, "--as", orch));
    s.call("park", seat, "--as", orch);
    // board-split D49 (A1-1): the parked member's own call (its wait on the park) leaves it parked; only unpark lifts it
    pin("park.worker.wait", s.call("wait", "--mentions", "--as", worker, "--timeout", "1000"));
    pin("park.orchestrator.roster-after", s.call("roster", "--as", orch));
    pin("park.orchestrator.park-refused", s.call("park", "nobody", "--as", orch));
  } finally {
    s.stop();
  }
});
