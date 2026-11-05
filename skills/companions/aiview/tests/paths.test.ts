import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatOf, kindFromName, repoRootOf, titleOf, toAbs, toStored } from "../src/core/paths.ts";

test("kindFromName follows <name>.<kind>.<ext>", () => {
  assert.equal(kindFromName("2026-08-23-topic.brainstorm.md"), "brainstorm");
  assert.equal(kindFromName("x.prototype.html"), "prototype");
  assert.equal(kindFromName("x.mockup.html"), "prototype"); // the migration: the old kind name reads as the new
  assert.equal(kindFromName("x.Spec.md"), "spec"); // lowercased
  assert.equal(kindFromName("plain.md"), "");
  assert.equal(kindFromName("cv-live.pdf"), "");
});

test("formatOf dispatches on extension", () => {
  assert.equal(formatOf("a.md"), "markdown");
  assert.equal(formatOf("a.prototype.html"), "html");
  assert.equal(formatOf("a.htm"), "html");
  assert.equal(formatOf("a.pdf"), "pdf");
  assert.equal(formatOf("a"), "markdown");
  assert.equal(formatOf("2026-10-09-p-run-1.swarm.json"), "swarm");
  assert.equal(kindFromName("2026-10-09-p-run-1.swarm.json"), "swarm");
  assert.equal(formatOf("other.json"), "markdown");
});

test("titleOf: md h1, html title, h1 fallback, filename fallback", () => {
  assert.equal(titleOf("# The Title\n\nbody", "a.md"), "The Title");
  assert.equal(titleOf("<title>Page</title><h1>H</h1>", "a.html"), "Page");
  assert.equal(titleOf("<h1>Only H1</h1>", "a.html"), "Only H1");
  assert.equal(titleOf("no heading here", "some.file.md"), "some.file.md");
});

test("toStored/toAbs round-trip inside the root, posix-stored", () => {
  const root = "C:\\repo";
  const abs = path.join(root, "docs", "specs", "x.spec.md");
  const stored = toStored(abs, root);
  assert.equal(stored, "docs/specs/x.spec.md"); // posix separators
  assert.equal(toAbs(stored, root), path.resolve(root, "docs", "specs", "x.spec.md"));
});

test("toStored keeps paths outside the root absolute", () => {
  // absolute on this OS: a Windows literal is a relative name on Linux
  const root = path.resolve(path.sep, "repo");
  const outside = path.resolve(path.sep, "elsewhere", "doc.md");
  assert.equal(toStored(outside, root), outside);
  assert.equal(toAbs(outside, root), outside);
});

test("repoRootOf finds nearest .git, else returns start", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aiview-paths-"));
  try {
    const repo = path.join(tmp, "repo");
    const deep = path.join(repo, "a", "b");
    fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
    fs.mkdirSync(deep, { recursive: true });
    assert.equal(repoRootOf(deep), repo);
    const loose = path.join(tmp, "loose");
    fs.mkdirSync(loose);
    assert.equal(repoRootOf(loose), loose);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
