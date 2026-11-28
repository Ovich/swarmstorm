import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { isInside, projectForCwd, projectFromDocsPath, resolveProject, type Project } from "../src/store/projects.ts";

const p = (slug: string, ...paths: string[]): Project => ({ slug, title: null, paths });
const abs = (...parts: string[]) => path.resolve(path.sep, ...parts);

test("isInside: self, child, and the near-miss sibling", () => {
  assert.equal(isInside(abs("CIIP"), abs("CIIP")), true);
  assert.equal(isInside(abs("CIIP", "portail"), abs("CIIP")), true);
  // the bug a naive startsWith would have: CIIP-old is not inside CIIP
  assert.equal(isInside(abs("CIIP-old"), abs("CIIP")), false);
  assert.equal(isInside(abs("JOBS"), abs("CIIP")), false);
  assert.equal(isInside(abs("CIIP"), ""), false);
});

test("isInside ignores trailing separators on either side", () => {
  assert.equal(isInside(abs("CIIP", "portail") + path.sep, abs("CIIP") + path.sep), true);
});

test("projectForCwd: longest prefix wins, so a sub-repo can be split out later", () => {
  const projects = [p("CIIP", abs("CIIP")), p("Portail", abs("CIIP", "portail"))];
  assert.equal(projectForCwd(abs("CIIP", "portail", "src"), projects)?.slug, "Portail");
  assert.equal(projectForCwd(abs("CIIP", "autre"), projects)?.slug, "CIIP");
});

test("projectForCwd: one project may cover several trees; unclaimed is null", () => {
  const projects = [p("CIIP", abs("CIIP"), abs("srv", "ciip-legacy")), p("JOBS", abs("JOBS"))];
  assert.equal(projectForCwd(abs("srv", "ciip-legacy", "api"), projects)?.slug, "CIIP");
  assert.equal(projectForCwd(abs("elsewhere"), projects), null);
  assert.equal(projectForCwd(abs("x"), []), null);
});

test("projectForCwd: a project with no paths never claims anything", () => {
  assert.equal(projectForCwd(abs("CIIP"), [p("Roster")]), null);
});

test("projectFromDocsPath: the folder is the project, nested files included", () => {
  const docs = abs("home", "swarmstorm_appdata", "docs");
  assert.equal(projectFromDocsPath(path.join(docs, "CIIP", "a.spec.md"), docs), "CIIP");
  assert.equal(projectFromDocsPath(path.join(docs, "CIIP", "sub", "a.spec.md"), docs), "CIIP");
  // loose in the docs root, or outside it entirely: not filed under a project
  assert.equal(projectFromDocsPath(path.join(docs, "a.spec.md"), docs), null);
  assert.equal(projectFromDocsPath(abs("JOBS", "a.spec.md"), docs), null);
});

test("resolveProject: explicit wins, then the folder, then the row, then the fallback", () => {
  const docs = abs("home", "swarmstorm_appdata", "docs");
  const inDocs = path.join(docs, "CIIP", "a.spec.md");
  const outside = abs("JOBS", "PROFILE.md");

  assert.equal(resolveProject({ explicit: "Roster", absFile: inDocs, docsRoot: docs, fallback: "X" }), "Roster");
  assert.equal(resolveProject({ absFile: inDocs, docsRoot: docs, existing: "JOBS", fallback: "X" }), "CIIP");
  assert.equal(resolveProject({ absFile: outside, docsRoot: docs, existing: "JOBS", fallback: "X" }), "JOBS");
  assert.equal(resolveProject({ absFile: outside, docsRoot: docs, fallback: "X" }), "X");
});

test("resolveProject never prefix-matches the document's own path against a project", () => {
  // A document sitting inside C:\CIIP must NOT come out as CIIP by path — that is the
  // coupling the design removes. Only its folder under <docs>/ or its existing row decide.
  const docs = abs("home", "swarmstorm_appdata", "docs");
  const insideRepo = abs("CIIP", "portail", "docs", "note.spec.md");
  assert.equal(resolveProject({ absFile: insideRepo, docsRoot: docs, fallback: "derived" }), "derived");
});
