// board-split D60, D61 goldens (break-flow T53): one gate before every member verb, core and code pack:
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

test("golden V-4, V-17: after close, every member verb answers the closed line first, code verbs included", async () => {
  const s = await scene("worker", "closed");
  try {
    for (const verb of [["merge-lock"], ["merged", "abc", "--report", "-"], ["doing", "x"]]) {
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
    for (const verb of [["merge-lock"], ["doing", "x"], ["post", "hi"], ["wait", "--mentions", "--timeout", "500"]]) {
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

// break-flow T58 (judged #1782): V-25, V-4 (lock, unlock), V-29, V-30, V-27
test("golden V-29, V-27: end --seat says the state its member was in and what it is told; one ended post; status reads ended", async () => {
  const s = await scene("orchestrator", "idle");
  try {
    const ended = s.call("end", "--seat", "w1", "--as", s.me);
    pin("gate.end-seat", ended);
    assert.match(ended.text, /^g\/w1 ended; it was \S+.*; its next call answers: you have ended in run 1/m);
    const raw = openRawStore(path.join(s.home, "swarm.sqlite"), { readOnly: true });
    try {
      const posts = raw.prepare("SELECT body FROM messages WHERE body LIKE '%ended%' AND author = (SELECT id FROM participants WHERE seat = 'w1')").all() as { body: string }[];
      assert.equal(posts.length, 1, JSON.stringify(posts));
    } finally {
      raw.close();
    }
    const status = s.call("status", "--as", s.me);
    assert.match(status.text, /^ {2}w1 ended/m, status.text);
  } finally {
    s.stop();
  }
});

test("golden V-30: a link started for a closed run says the closed line and exits 0", async () => {
  const s = await scene("worker", "closed");
  try {
    const a = s.call("link", "--run", "1", "--as", s.me);
    assert.equal(a.status, 0, a.text);
    assert.match(a.text, /^run 1 closed: run end and return your summary/m);
  } finally {
    s.stop();
  }
});

// break-flow T66 (judged #1898): V-38, V-46
test("golden V-38: end --seat orchestrator is refused while the run is open, naming close", async () => {
  const s = await scene("orchestrator", "idle");
  try {
    const a = s.call("end", "--seat", "orchestrator", "--as", s.me);
    pin("gate.end-seat-orchestrator", a);
    assert.equal(a.status, 1);
    assert.match(a.text, /end --seat orchestrator: refused, run 1 is open: .* close --run 1 --as g\/orchestrator/);
    // the orchestrator still answers
    assert.equal(s.call("post", "still here", "--as", s.me).status, 0);
  } finally {
    s.stop();
  }
});

test("golden V-46: a paused member's wake says the paused line once", async () => {
  for (const role of ["worker", "seat"] as const) {
    const s = await scene(role, "owes-again");
    try {
      s.must("pause", "hold on", "--as", "g/orchestrator");
      const a = s.call("wait", "--mentions", "--as", s.me, "--timeout", "2000");
      pin(`gate.paused-wake.${role}`, a);
      assert.equal(a.text.split("\n").filter((l) => /start nothing new and land nothing/.test(l)).length, 1, a.text);
    } finally {
      s.stop();
    }
  }
});

test("golden V-46: a second link of a member says its link already runs, exit 0", async () => {
  const s = await scene("worker", "idle");
  try {
    const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "cli", "index.ts");
    const env = { ...process.env, SWARM_ROOT: s.home, SWARMSTORM_HOME: s.home, SWARM_NO_POLLER: "1" };
    const first = spawn(process.execPath, [cli, "link", "--run", "1", "--as", s.me], { cwd: path.join(s.home, "repo"), env, stdio: "ignore" });
    const pidFile = path.join(s.home, "links", "1-g_w1.pid");
    for (let i = 0; i < 100 && !fs.existsSync(pidFile); i++) await new Promise((ok) => setTimeout(ok, 100));
    const second = s.call("link", "--run", "1", "--as", s.me);
    assert.equal(second.status, 0, second.text);
    assert.match(second.text, /^g\/w1's link already runs/m);
    first.kill();
  } finally {
    s.stop();
  }
});
