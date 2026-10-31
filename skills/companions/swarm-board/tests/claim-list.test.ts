// A claim names files, never a folder, and answers each path of its list on its own: claimed, held (exit 3), no such
// file, or a folder refused; a path that cannot be claimed never stops the rest. A holder is named once.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { makeRepo, openTwoRunners, type Repo } from "./fixtures/worktrees.ts";

let repos: Repo[] = [];
afterEach(() => {
  for (const r of repos) r.cleanup();
  repos = [];
});
const fresh = (): Repo => {
  const r = makeRepo("swarm-claim-");
  repos.push(r);
  openTwoRunners(r);
  return r;
};

test("a folder is refused: claim the files in it", () => {
  const r = fresh();
  const out = r.swarm(r.wtB, ["claim", "src"]);
  assert.equal(out.status, 1, out.stderr);
  assert.match(out.stdout, /^src is a folder: not claimed; claim the files in it you will change, each by its path$/m);
});

test("a list answers each path: claimed, held (exit 3), no such file, folder; none stops the rest", () => {
  const r = fresh();
  const out = r.swarm(r.wtB, ["claim", "src/gone.ts", "src", "src/a.ts", "src/c.ts"]);
  assert.equal(out.status, 3, out.stderr);
  assert.match(out.stdout, /^no such file: src\/gone\.ts: not claimed; pass --new if you are creating it$/m);
  assert.match(out.stdout, /^src is a folder: not claimed;/m);
  assert.match(out.stdout, /^src\/a\.ts is also held by review-tool\/S3 \(/m, "S3 holds src/a.ts from its join");
  assert.match(out.stdout, /^claimed src\/c\.ts$/m);
});

test("a holder is named once in the held line", () => {
  const r = fresh();
  r.cli(r.wtA, "claim", "src/a.ts");
  const out = r.swarm(r.wtB, ["claim", "src/a.ts"]);
  assert.equal(out.status, 3, out.stderr);
  const line = out.stdout.split(/\r?\n/).find((l) => l.startsWith("src/a.ts is also held by"))!;
  assert.equal(line.split("review-tool/S3 (").length - 1, 1, line);
});
