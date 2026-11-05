// A folder reached under another spelling (an 8.3 short name, a junction or symlink, another case) is the same folder
// (trust-adaptations T16): two members joining from the checkout so spelled each get their own worktree, and the
// second is never refused as joining from the first one's folder (D23). The hosted Windows runner's temp folder is
// `C:\Users\RUNNER~1\...`, which is how this was found.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { canonicalPath } from "../src/place/place.ts";
import { makeRepo, type Repo } from "./fixtures/worktrees.ts";

let repos: Repo[] = [];
afterEach(() => {
  for (const r of repos) r.cleanup();
  repos = [];
});

/** The checkout reached through a junction (Windows) or a symlink: a path whose real path is the checkout. */
function aliasOf(r: Repo): string {
  const alias = path.join(r.home, "checkout-alias");
  fs.symlinkSync(r.repo, alias, process.platform === "win32" ? "junction" : "dir");
  return alias;
}

test("canonicalPath: an alias of a folder and the folder are one; so is another case where the file system ignores it", () => {
  const r = makeRepo("swarm-spelling-");
  repos.push(r);
  assert.equal(canonicalPath(aliasOf(r)), canonicalPath(r.repo));
  if (process.platform === "win32") assert.equal(canonicalPath(r.repo.toUpperCase()), canonicalPath(r.repo));
});

test("two members joining from the checkout under another spelling each get their own worktree, neither refused (D23)", () => {
  const r = makeRepo("swarm-spelling-");
  repos.push(r);
  const checkout = aliasOf(r);
  const seats = path.join(r.home, "seats.json");
  fs.writeFileSync(seats, JSON.stringify([{ id: "S3", blockers: [] }, { id: "S5", blockers: [] }]));
  const id = r.cli(checkout, "open", "--plan", "spelled", "--title", "T", "--seats", seats).split(/\r?\n/)[0].trim();
  const first = r.swarm(checkout, ["join", "--run", id, "--seat", "S3", "--doing", "x"]);
  assert.equal(first.status, 0, first.stderr);
  const second = r.swarm(checkout, ["join", "--run", id, "--seat", "S5", "--doing", "y"]);
  assert.equal(second.status, 0, second.stderr);
  for (const [joined, seat] of [[first, "S3"], [second, "S5"]] as const) {
    assert.match(joined.stdout, new RegExp(`your worktree: \\S+/swarm/worktrees/${id}/${seat} `), `${seat} gets its own worktree`);
  }
});
