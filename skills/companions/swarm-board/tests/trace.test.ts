// The board's trace: the server writes logs/<day>/events.jsonl (debug) and, at debug-extended, each post's text
// in logs/<day>/messages/run-<n>.jsonl; log-level sets it.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeRepo, openTwoRunners, type Repo } from "./fixtures/worktrees.ts";

let repos: Repo[] = [];
afterEach(() => {
  for (const r of repos) r.cleanup();
  repos = [];
});
const day = () => new Date().toISOString().slice(0, 10);
const events = (r: Repo) => {
  const f = path.join(r.home, "logs", day(), "events.jsonl");
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
};

test("debug: calls, posts, deliveries and the lock are traced, no message text", async () => {
  const r = makeRepo();
  repos.push(r);
  r.cli(r.repo, "log-level", "debug");
  openTwoRunners(r);
  r.cli(r.wtA, "post", "@S5 hello there");
  r.cli(r.wtB, "wait", "--mentions", "--timeout", "2000");
  r.cli(r.wtB, "merge-lock", "--onto", "main");
  const e = events(r);
  const kinds = new Set(e.map((x) => x.kind));
  for (const k of ["call", "post", "delivered", "lock"]) assert.ok(kinds.has(k), `no ${k} in the trace: ${[...kinds]}`);
  const delivered = e.find((x) => x.kind === "delivered" && x.member === "review-tool/S5");
  assert.ok(delivered && typeof delivered.waitedMs === "number");
  assert.ok(e.some((x) => x.kind === "lock" && x.action === "granted" && x.member === "review-tool/S5"));
  assert.ok(!e.some((x) => "body" in x), "message text at debug");
  assert.ok(!fs.existsSync(path.join(r.home, "logs", day(), "messages")));
});

test("debug-extended: each post's text in messages/run-<n>.jsonl; off: nothing more", async () => {
  const r = makeRepo();
  repos.push(r);
  assert.match(r.cli(r.repo, "log-level", "debug-extended"), /^log level debug-extended/);
  openTwoRunners(r);
  r.cli(r.wtA, "post", "@S5 the whole text");
  const dir = path.join(r.home, "logs", day(), "messages");
  const lines = fs.readdirSync(dir).flatMap((f) => fs.readFileSync(path.join(dir, f), "utf8").trim().split("\n").map((l) => JSON.parse(l)));
  assert.ok(lines.some((l) => l.body === "@S5 the whole text"));
  r.cli(r.repo, "log-level", "off");
  const before = events(r).length;
  r.cli(r.wtA, "post", "@S5 again");
  assert.equal(events(r).length, before);
});

/** A logfmt line's keys and values, a quoted value JSON-read. */
const logfmt = (line: string): Record<string, string> =>
  Object.fromEntries([...line.matchAll(/([\w-]+)=("(?:[^"\\]|\\.)*"|\S+)/g)].map((m) => [m[1], m[2].startsWith('"') ? JSON.parse(m[2]) : m[2]]));

test("info (the default): logfmt lines in the server log, no day folder", () => {
  const r = makeRepo();
  repos.push(r);
  assert.match(r.cli(r.repo, "log-level"), /^log level info/);
  openTwoRunners(r);
  r.cli(r.wtB, "merge-lock", "--onto", "main");
  const lines = fs
    .readFileSync(path.join(r.home, "swarm-server.log"), "utf8")
    .split("\n")
    .filter((l) => l.startsWith("at="))
    .map(logfmt);
  assert.ok(lines.some((p) => p.level === "info" && p.event === "server"));
  assert.ok(lines.some((p) => p.event === "joined" && p.member === "review-tool/S5"));
  assert.ok(lines.some((p) => p.event === "lock-granted" && p.member === "review-tool/S5" && p.waited === "0s"));
  assert.ok(!fs.existsSync(path.join(r.home, "logs", new Date().toISOString().slice(0, 10))));
});
