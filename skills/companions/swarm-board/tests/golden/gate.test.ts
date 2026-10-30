// board-split D60, D61 goldens (break-flow T53): one gate before every member verb, core and code pack. A parked
// member is answered parked first, refused claim, merge-lock and doing, its post accepted with the parked line (V-3);
// a closed run's or an ended member's verbs answer the closed or ended line first, never a flag or a git error, the
// ended line ending on the summary to return (V-4, V-17); a re-join posts one `<seat> back` line, never another joined
// (V-15); the lost alarm prints the end verb as it runs (V-17); a link of a closed run exits 0 (V-17).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pin, scene } from "./golden.ts";
import { eventStep } from "../../src/cli/answer/rules.ts";
import type { Message, Participant } from "../../src/board/board.ts";
import { openRawStore } from "../fixtures/raw-store.ts";

const PARKED = "you are parked: end your turn now, without end; the orchestrator resumes you at your next task";

test("golden V-3: a parked worker is answered parked first; claim, merge-lock, doing refused; post accepted", async () => {
  const s = await scene("orchestrator", "owes-first");
  try {
    const worker = s.other;
    s.must("park", worker.split("/")[1], "--as", s.me);
    s.must("deliver", "--as", worker);
    for (const verb of [["doing", "x"], ["claim", "a.ts"], ["merge-lock", "--onto", "main"]]) {
      const a = s.call(...verb, "--as", worker);
      pin(`gate.parked.${verb[0]}`, a);
      assert.equal(a.status, 4, `${verb[0]}: ${a.text}`);
      assert.match(a.text, new RegExp(`^${verb[0]} refused: ${PARKED}`), verb[0]);
    }
    const post = s.call("post", "hello", "--as", worker);
    pin("gate.parked.post", post);
    assert.equal(post.status, 0);
    assert.ok(post.text.includes(PARKED), post.text);
    assert.ok(!/owe|listener/.test(post.text), post.text);
    const wait = s.call("wait", "--mentions", "--as", worker, "--timeout", "500");
    pin("gate.parked.wait", wait);
    assert.equal(wait.text.trim(), PARKED);
  } finally {
    s.stop();
  }
});

test("golden V-4, V-17: after close, every member verb answers the closed line first, code verbs included", async () => {
  const s = await scene("worker", "closed");
  try {
    for (const verb of [["merge-lock"], ["claim", "a.ts"], ["release", "a.ts"], ["merged", "abc", "--report", "-"], ["doing", "x"]]) {
      const a = s.call(...verb, "--as", s.me);
      pin(`gate.closed.${verb[0]}`, a);
      assert.equal(a.status, 0, `${verb[0]}: ${a.text}`);
      assert.match(a.text, /^run \d+ closed: run end and return your summary/, verb[0]);
    }
  } finally {
    s.stop();
  }
});

test("golden V-4, V-17: an ended member's verbs answer the ended line, ending on its summary", async () => {
  const s = await scene("orchestrator", "idle");
  try {
    const worker = s.other;
    s.must("end", "--seat", worker.split("/")[1], "--as", s.me);
    for (const verb of [["merge-lock"], ["claim", "a.ts"], ["doing", "x"], ["post", "hi"], ["wait", "--mentions", "--timeout", "500"]]) {
      const a = s.call(...verb, "--as", worker);
      pin(`gate.ended.${verb[0]}`, a);
      assert.equal(a.status, 0, `${verb[0]}: ${a.text}`);
      assert.match(a.text, /^you have ended in run \d+: .*return your summary/, verb[0]);
    }
  } finally {
    s.stop();
  }
});

test("golden V-15: a re-join posts one `<seat> back` line, never another joined", async () => {
  const s = await scene("orchestrator", "idle");
  try {
    const worker = s.other;
    const seat = worker.split("/")[1];
    const run = JSON.parse(s.must("roster", "--json")).roster.find((r: { name: string }) => r.name === worker).run;
    s.must("join", "--run", String(run), "--seat", seat, "--doing", "again", "--as", worker);
    s.must("end", "--seat", seat, "--as", s.me);
    s.must("join", "--run", String(run), "--seat", seat, "--doing", "back", "--as", worker);
    const raw = openRawStore(path.join(s.home, "swarm.sqlite"), { readOnly: true });
    try {
      const joins = raw.prepare("SELECT body FROM messages WHERE event = 'joined' ORDER BY seq").all() as { body: string }[];
      assert.deepEqual(joins.map((e) => e.body.replace(/:.*/, "").replace(/ [A-Z][a-z]+ [A-Z][a-z]+ /, " ")), ["joined", "+ w1 back"]);
    } finally {
      raw.close();
    }
  } finally {
    s.stop();
  }
});

test("V-17: the lost alarm prints end --seat as it runs", () => {
  const lost = { seq: 1, run: 1, from: "g/orchestrator", body: "lost g/a: its link was lost", mentions: [], meta: null, event: "lost" } as unknown as Message;
  const orch = { name: "g/orchestrator", seat: "orchestrator", kind: "task" } as Participant;
  const line = eventStep(lost, orch, "swarm", "lost")!;
  assert.ok(line.includes("swarm end --seat a --as g/orchestrator"), line);
  assert.ok(!line.includes("close its seat"), line);
});

for (const how of ["close", "end --seat"] as const)
  test(`V-17: a member's link exits 0 at its ${how}`, async () => {
    const s = await scene("worker", "idle");
    try {
      const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "cli", "index.ts");
      const env = { ...process.env, SWARM_ROOT: s.home, SWARMSTORM_HOME: s.home, SWARM_NO_POLLER: "1" };
      // a fresh data home: the scene's run is run 1
      const link = spawn(process.execPath, [cli, "link", "--run", "1", "--as", s.me], { cwd: path.join(s.home, "repo"), env, stdio: "ignore" });
      const exited = new Promise<number | null>((ok) => link.once("exit", (code) => ok(code)));
      const pidFile = path.join(s.home, "links", "1-g_w1.pid");
      for (let i = 0; i < 100 && !fs.existsSync(pidFile); i++) await new Promise((ok) => setTimeout(ok, 100));
      if (how === "close") s.must("close", "--run", "1", "--as", "g/orchestrator");
      else s.must("end", "--seat", "w1", "--as", "g/orchestrator");
      assert.equal(await exited, 0);
    } finally {
      s.stop();
    }
  });
