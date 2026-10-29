// Finding and reading a member's transcript (link/transcripts.ts): one case per S14 criterion,
// against fixture sessions under SWARM_TRANSCRIPTS_ROOT.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { commandActsAsOther, locate, observe } from "../src/link/transcripts.ts";
import { claudeCodeJsonl } from "../src/board/liveness.ts";
import { bashCall, jsonl, prompt, textLine, toolCall, toolResult, writeMain, writeSubagent } from "./fixtures/transcripts.ts";

const SESSION = "11111111-aaaa-bbbb-cccc-000000000001";
const OTHER = "22222222-aaaa-bbbb-cccc-000000000002";
const PROJECT = "C--repos-one";
let root: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-transcripts-"));
  env = { CLAUDE_CODE_SESSION_ID: SESSION, SWARM_TRANSCRIPTS_ROOT: root };
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

const join = (seat: string, run = 68) => ({ verb: "join" as const, run, seat });

test("locate finds the subagent whose Bash ran join, flags in any order, quoted or not, ended by ; && or the end", () => {
  const forms = [
    `node swarm.mjs join --run 68 --seat S11 --doing "x"`,
    `$S join --seat 'S11' --run "68"; echo hi`,
    `node /p/swarm.mjs join --doing y --seat=S11 --run=68&& git status`,
    `swarm join --run 68 --seat S11`,
  ];
  forms.forEach((command, i) => {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-transcripts-form-"));
    try {
      const file = writeSubagent(r, PROJECT, SESSION, `a${i}`, [prompt("brief"), bashCall(command)], {});
      assert.equal(locate(join("S11"), { ...env, SWARM_TRANSCRIPTS_ROOT: r }), file, command);
    } finally {
      fs.rmSync(r, { recursive: true, force: true });
    }
  });
});

test("locate finds the main transcript for open with that group", () => {
  const file = writeMain(root, PROJECT, SESSION, [bashCall(`node swarm.mjs open --group swarm-link --kind plan`)]);
  assert.equal(locate({ verb: "open", group: "swarm-link" }, env), file);
});

test("locate returns null for a mention in text, another session, another seat or run, and S1 when S11 is asked", () => {
  writeSubagent(root, PROJECT, SESSION, "text", [prompt("run `swarm join --run 68 --seat S11` first"), textLine("I will run swarm join --run 68 --seat S11")], {});
  writeSubagent(root, PROJECT, OTHER, "other", [bashCall("swarm join --run 68 --seat S11")], {});
  writeSubagent(root, PROJECT, SESSION, "seat", [bashCall("swarm join --run 68 --seat S12")], {});
  writeSubagent(root, PROJECT, SESSION, "run", [bashCall("swarm join --run 67 --seat S11")], {});
  assert.equal(locate(join("S11"), env), null);
  const short = writeSubagent(root, PROJECT, SESSION, "short", [bashCall("swarm join --run 68 --seat S1")], {});
  assert.equal(locate(join("S11"), env), null);
  assert.equal(locate(join("S1"), env), short);
});

test("two transcripts holding the same join: the newest not finished", () => {
  const older = writeSubagent(root, PROJECT, SESSION, "old", [bashCall("swarm join --run 68 --seat S11")], {}, 1_700_000_000);
  writeSubagent(root, PROJECT, SESSION, "done", [bashCall("swarm join --run 68 --seat S11")], { finished: true }, 1_700_000_200);
  const newer = writeSubagent(root, PROJECT, SESSION, "new", [bashCall("swarm join --run 68 --seat S11")], {}, 1_700_000_100);
  assert.equal(locate(join("S11"), env), newer);
  fs.utimesSync(older, 1_700_000_300, 1_700_000_300);
  assert.equal(locate(join("S11"), env), older);
});

test("observe on a growing file reads only the appended lines, moves grewAt, and counts tokens as liveness.ts does", () => {
  const u = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000 };
  const file = writeMain(root, PROJECT, SESSION, [textLine("a", u)]);
  fs.utimesSync(file, 1_700_000_000, 1_700_000_000);
  const first = observe(file, null);
  assert.equal(first.activity.grewAt, 1_700_000_000_000);
  const size = fs.statSync(file).size;
  assert.equal(first.cursor.offset, size);
  fs.appendFileSync(file, jsonl([textLine("b", u)]));
  fs.utimesSync(file, 1_700_000_050, 1_700_000_050);
  const second = observe(file, first.cursor);
  assert.equal(second.activity.grewAt, 1_700_000_050_000);
  assert.equal(second.cursor.offset, fs.statSync(file).size);
  const whole = claudeCodeJsonl.read(fs.readFileSync(file), { offset: 0, tokens: 0 })!;
  assert.equal(second.activity.tokens, whole.tokens);
  assert.equal(second.activity.tokens, 2230);
  // nothing appended: grewAt stays
  assert.equal(observe(file, second.cursor).activity.grewAt, 1_700_000_050_000);
});

test("observe reports the open tool call with its name, a 50-character target and its start; null once its result is written", () => {
  const command = "x".repeat(80);
  const file = writeMain(root, PROJECT, SESSION, [toolCall("Bash", { command }, "toolu_open", "2026-10-22T10:00:00.000Z")]);
  const a = observe(file, null);
  assert.deepEqual(a.activity.openTool, { name: "Bash", target: "x".repeat(50), since: Date.parse("2026-10-22T10:00:00.000Z"), shell: true, label: null, command });
  fs.appendFileSync(file, jsonl([toolResult("toolu_open")]));
  assert.equal(observe(file, a.cursor).activity.openTool, null);
});

test("context is the last assistant line's input + cache_creation + cache_read tokens", () => {
  const file = writeMain(root, PROJECT, SESSION, [
    textLine("a", { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 1, cache_read_input_tokens: 1 }),
    textLine("b", { input_tokens: 3, output_tokens: 999, cache_creation_input_tokens: 20, cache_read_input_tokens: 400 }),
  ]);
  assert.equal(observe(file, null).activity.context, 423);
});

test("finished follows meta.json; no meta.json at all: the locator reports null", async () => {
  const { LOCATORS } = await import("../src/link/transcripts.ts");
  const done = writeSubagent(root, PROJECT, SESSION, "done", [textLine("a")], { finished: true });
  const running = writeSubagent(root, PROJECT, SESSION, "running", [textLine("a")], {});
  const bare = writeSubagent(root, PROJECT, SESSION, "bare", [textLine("a")], null);
  assert.equal(observe(done, null).activity.finished, true);
  assert.equal(observe(running, null).activity.finished, false);
  assert.equal(LOCATORS[0].finished(bare), null);
});

test("no CLAUDE_CODE_SESSION_ID: locate returns null without reading", () => {
  writeMain(root, PROJECT, SESSION, [bashCall("swarm join --run 68 --seat S11")]);
  const readdir = fs.readdirSync;
  let reads = 0;
  (fs as { readdirSync: unknown }).readdirSync = (...a: unknown[]) => {
    reads++;
    return (readdir as (...x: unknown[]) => unknown)(...a);
  };
  try {
    assert.equal(locate(join("S11"), { SWARM_TRANSCRIPTS_ROOT: root }), null);
  } finally {
    (fs as { readdirSync: unknown }).readdirSync = readdir;
  }
  assert.equal(reads, 0);
});

test("observe reports a background wait --mentions as a running listener until its notification, then when it ended (D4)", () => {
  const listen = "node swarm.mjs wait --mentions --as p/S1";
  const file = writeMain(root, PROJECT, SESSION, [
    toolCall("Bash", { command: "node swarm.mjs wait --as p/S1" }, "toolu_fg", "2026-10-22T10:00:00.000Z"),
    toolResult("toolu_fg"),
    toolCall("Bash", { command: listen, run_in_background: true }, "toolu_listen", "2026-10-22T10:00:02.000Z"),
  ]);
  const first = observe(file, null);
  assert.deepEqual(first.activity.listener, { running: true, endedAt: null });
  const notified = "<task-notification>\n<task-id>x</task-id>\n<tool-use-id>toolu_listen</tool-use-id>\n<status>completed</status>\n</task-notification>";
  fs.appendFileSync(file, jsonl([{ type: "user", timestamp: "2026-10-22T10:01:00.000Z", message: { role: "user", content: notified } }]));
  const second = observe(file, first.cursor);
  assert.deepEqual(second.activity.listener, { running: false, endedAt: Date.parse("2026-10-22T10:01:00.000Z") });
  // a foreground wait --mentions is no listener
  const fg = writeMain(root, PROJECT, OTHER, [toolCall("Bash", { command: listen }, "toolu_fg2", "2026-10-22T10:00:00.000Z")]);
  assert.deepEqual(observe(fg, null).activity.listener, { running: false, endedAt: null });
});

test("S27 (board-split D25): a wait run --as another member is that member's: plain work for this link, never its wait or listener", () => {
  const binding = { verb: "join" as const, run: 3, seat: "v1" };
  const file = writeMain(root, PROJECT, SESSION, [
    toolCall("Bash", { command: "swarm wait --mentions --as vb4/s1" }, "toolu_other", "2026-10-22T10:00:00.000Z"),
  ]);
  const other = observe(file, null, binding).activity.openTool!;
  assert.equal(other.boardWait, undefined, "another seat's wait is work");
  fs.appendFileSync(file, jsonl([toolResult("toolu_other"), toolCall("Bash", { command: "swarm wait --mentions --as g/v1" }, "toolu_own", "2026-10-22T10:01:00.000Z")]));
  assert.equal(observe(file, null, binding).activity.openTool!.boardWait, true, "its own seat's wait is waiting");
  assert.equal(commandActsAsOther("swarm wait --as g/orchestrator", { verb: "open", group: "g" }), false);
  assert.equal(commandActsAsOther("swarm wait --as h/orchestrator", { verb: "open", group: "g" }), true);
  assert.equal(commandActsAsOther("swarm wait --mentions", binding), false);
});

test("S22 (board-split D25): a joining subagent's transcript, written after the link first looks, is found on a later look", () => {
  assert.equal(locate(join("S22"), env), null);
  writeSubagent(root, PROJECT, SESSION, "late", [bashCall("swarm join --run 68 --seat S22 --doing x --as g/S22")], {}, 1_700_000_000);
  assert.ok(locate(join("S22"), env)?.endsWith("agent-late.jsonl"));
});

test("D45: observe carries a call's own description and whole command, for the open call and the background task", () => {
  const long = `cd app && CI=1 npm run build -- --mode production ${"x".repeat(60)}`;
  const file = writeMain(root, PROJECT, SESSION, [
    toolCall("Bash", { command: "npm test", description: "Run the  suite", run_in_background: true }, "toolu_bg", "2026-10-22T10:00:00.000Z"),
    toolResult("toolu_bg"),
    toolCall("Bash", { command: long, description: "Build the viewer" }, "toolu_fg", "2026-10-22T10:00:01.000Z"),
  ]);
  const { activity } = observe(file, null);
  assert.equal(activity.openTool!.label, "Build the viewer");
  assert.equal(activity.openTool!.command, long);
  assert.equal(activity.background!.label, "Run the suite");
  assert.equal(activity.background!.command, "npm test");
  // a call with no description has no label: the card makes its short form
  const bare = writeMain(root, PROJECT, OTHER, [toolCall("Read", { file_path: "/r/src/a.ts" }, "toolu_r", "2026-10-22T10:00:00.000Z")]);
  assert.equal(observe(bare, null).activity.openTool!.label, null);
  assert.equal(observe(bare, null).activity.openTool!.command, "/r/src/a.ts");
});
