import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openIndex, type Index } from "../src/core/db.ts";

let tmp: string;
let root: string;
let index: Index;

const write = (rel: string, content: string): string => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aiview-db-"));
  root = path.join(tmp, "repo");
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  index = openIndex(path.join(tmp, "test.sqlite"), root);
});

afterEach(() => {
  index.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("migration: an x.mockup.html registers as a prototype, its file never renamed", () => {
  const abs = write("docs/x.mockup.html", "<title>X</title>");
  assert.equal(index.register(abs).kind, "prototype");
  assert.equal(index.register(write("docs/y.md", "# Y"), { kind: "mockup" }).kind, "prototype");
  assert.ok(fs.existsSync(abs));
});

test("migration: a row of kind mockup reads as prototype once the index reopens", () => {
  const abs = write("docs/old.page.html", "<title>Old</title>");
  index.register(abs, { kind: "page" });
  index.close();
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
  const raw = new DatabaseSync(path.join(tmp, "test.sqlite"));
  raw.prepare("UPDATE documents SET kind = 'mockup'").run();
  raw.close();
  index = openIndex(path.join(tmp, "test.sqlite"), root);
  assert.equal(index.getByPath(abs)!.kind, "prototype");
});

test("register: kind from filename, stored path repo-relative, title from h1", () => {
  const abs = write("docs/x.brainstorm.md", "# Board X\n");
  const d = index.register(abs, { tags: ["proj"] });
  assert.equal(d.kind, "brainstorm");
  assert.equal(d.file_path, "docs/x.brainstorm.md");
  assert.equal(d.abs_path, abs);
  assert.equal(d.title, "Board X");
  assert.deepEqual(d.tags, ["proj"]);
});

test("register: kind is mandatory", () => {
  const abs = write("plain.md", "# T\n");
  assert.throws(() => index.register(abs), /kind is mandatory/);
});

test("register: missing file throws", () => {
  assert.throws(() => index.register(path.join(root, "nope.spec.md")), /no such file/);
});

test("register twice: upsert keeps created_at, merges tags, drops tag equal to kind", () => {
  const abs = write("x.spec.md", "# S\n");
  const first = index.register(abs, { tags: ["a"] });
  const second = index.register(abs, { tags: ["b", "spec"] });
  assert.equal(second.id, first.id);
  assert.equal(second.created_at, first.created_at);
  assert.deepEqual([...second.tags].sort(), ["a", "b"]);
});

test("register: --started overrides created_at", () => {
  const abs = write("x.spec.md", "# S\n");
  const d = index.register(abs, { started: "2026-08-01T10:00:00+02:00" });
  assert.equal(d.created_at, "2026-08-01T08:00:00.000Z");
});

test("register: pdf titles by filename, explicit kind", () => {
  const abs = write("out/cv-live.pdf", "%PDF-1.4 fake");
  const d = index.register(abs, { kind: "pdf" });
  assert.equal(d.kind, "pdf");
  assert.equal(d.title, "cv-live.pdf");
});

test("a swarm document lists with its kind and the swarm format, titled by its file", () => {
  const abs = write("docs/2026-10-09-plan-run-7.swarm.json", JSON.stringify({ run: "7", url: "http://127.0.0.1:4777/run/7" }));
  const d = index.register(abs);
  assert.equal(d.kind, "swarm");
  assert.equal(d.title, "2026-10-09-plan-run-7.swarm.json");
  const listed = index.all().find((x) => x.id === d.id)!;
  assert.equal(listed.kind, "swarm");
  assert.equal(listed.format, "swarm");
});

test("all: newest created_at first, exists + format computed", () => {
  const a = write("a.spec.md", "# A\n");
  const b = write("b.prototype.html", "<title>B</title>");
  index.register(a, { started: "2026-01-01T00:00:00Z" });
  index.register(b, { started: "2026-02-01T00:00:00Z" });
  const all = index.all();
  assert.deepEqual(all.map((d) => d.title), ["B", "A"]);
  assert.deepEqual(all.map((d) => d.format), ["html", "markdown"]);
  assert.ok(all.every((d) => d.exists));
  fs.rmSync(a);
  assert.equal(index.all().find((d) => d.title === "A")?.exists, false);
});

test("get / getByPath / remove / touch", () => {
  const abs = write("x.report.md", "# R\n");
  const d = index.register(abs);
  assert.equal(index.get(d.id)?.title, "R");
  assert.equal(index.getByPath(abs)?.id, d.id);
  index.touch(d.id);
  assert.ok(index.get(d.id)!.last_seen_at >= d.last_seen_at);
  assert.equal(index.remove(d.id), true);
  assert.equal(index.remove(d.id), false);
  assert.equal(index.get(d.id), undefined);
});

test("groups: register with --group creates the group, title optional then renamable", () => {
  const abs = write("g.spec.md", "# G\n");
  const d = index.register(abs, { group: "aiview-webapp" });
  assert.equal(d.group_slug, "aiview-webapp");
  assert.deepEqual(index.allGroups().map((g) => ({ ...g })), [{ slug: "aiview-webapp", title: null }]);
  index.register(abs, { group: "aiview-webapp", groupTitle: "aiview web app" });
  assert.deepEqual(index.allGroups().map((g) => ({ ...g })), [{ slug: "aiview-webapp", title: "aiview web app" }]);
  // re-register without group keeps membership
  const again = index.register(abs);
  assert.equal(again.group_slug, "aiview-webapp");
});

test("groups: ungrouped docs stay null", () => {
  const d = index.register(write("u.spec.md", "# U\n"));
  assert.equal(d.group_slug, null);
  assert.deepEqual(index.allGroups(), []);
});

test("migration: v1 schema (no kind/tags, revisions table) upgrades in place", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const dbPath = path.join(tmp, "v1.sqlite");
  const raw = new DatabaseSync(dbPath);
  raw.exec(`
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY,
      file_path TEXT NOT NULL UNIQUE,
      project TEXT NOT NULL,
      title TEXT,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE TABLE revisions (id INTEGER PRIMARY KEY);
    INSERT INTO documents VALUES (1, 'old.md', 'repo', 'Old', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
  `);
  raw.close();
  const upgraded = openIndex(dbPath, root);
  const d = upgraded.get(1);
  assert.equal(d?.title, "Old");
  assert.equal(d?.kind, "");
  assert.deepEqual(d?.tags, []);
  assert.equal(d?.group_slug, null);
  assert.deepEqual(upgraded.allGroups(), []);
  const check = new DatabaseSync(dbPath);
  const tables = (check.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(
    (t) => t.name,
  );
  assert.ok(!tables.includes("revisions"));
  check.close();
  upgraded.close();
});

test("projects: upsert creates, title renames, paths merge without duplicates", () => {
  const a = index.upsertProject("CIIP");
  assert.equal(a.slug, "CIIP");
  assert.equal(a.title, null); // falls back to the slug in the UI, as groups do
  assert.deepEqual(a.paths, []);

  index.upsertProject("CIIP", { title: "CIIP", addPaths: ["C:/CIIP"] });
  const b = index.upsertProject("CIIP", { addPaths: ["C:/CIIP", "C:/srv/ciip-legacy"] });
  assert.equal(b.title, "CIIP"); // an absent title never wipes the stored one
  assert.deepEqual(b.paths, ["C:/CIIP", "C:/srv/ciip-legacy"]);
});

test("projects: registering a document upserts its project so none is ever orphaned", () => {
  index.register(write("docs/x.spec.md", "# X\n"), { project: "Roster" });
  assert.deepEqual(index.allProjects().map((p) => p.slug), ["Roster"]);
});

test("projects: an explicit --project beats the derived fallback", () => {
  const d = index.register(write("docs/x.spec.md", "# X\n"), { project: "CIIP" });
  assert.equal(d.project, "CIIP");
  // re-registering without one keeps what the row already has
  assert.equal(index.register(d.abs_path).project, "CIIP");
});

test("removeProject: refused while documents reference it, allowed once empty", () => {
  const d = index.register(write("docs/x.spec.md", "# X\n"), { project: "CIIP" });
  assert.deepEqual(index.removeProject("CIIP"), { removed: false, documents: 1 });
  index.remove(d.id);
  assert.deepEqual(index.removeProject("CIIP"), { removed: true, documents: 0 });
  assert.deepEqual(index.allProjects(), []);
});

test("active project: defaults to All, round-trips, and never reads back as a ghost", () => {
  assert.equal(index.activeProject(), "*");
  index.upsertProject("CIIP");
  assert.equal(index.setActiveProject("CIIP"), "CIIP");
  assert.equal(index.activeProject(), "CIIP");
  // the project disappears behind the pointer -> All projects, not a stale name
  index.removeProject("CIIP");
  assert.equal(index.activeProject(), "*");
});

test("pending: added rows come back for that document only, in order", () => {
  const a = index.register(write("a.spec.md", "# A"));
  const b = index.register(write("b.spec.md", "# B"));
  const first = index.addPending(a.id, "Intent axis", "checks the diff against the PR's claims");
  index.addPending(a.id, "Blast-radius axis");
  index.addPending(b.id, "Elsewhere");

  const rows = index.pendingFor(a.id);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => r.label),
    ["Intent axis", "Blast-radius axis"],
  );
  assert.equal(rows[0].id, first);
  assert.equal(rows[0].note, "checks the diff against the PR's claims");
  assert.equal(rows[1].note, ""); // note is optional
  assert.ok(rows[0].started_at);
});

test("pending: done deletes the row and reports which document to refresh", () => {
  const doc = index.register(write("c.spec.md", "# C"));
  const id = index.addPending(doc.id, "Axis");

  assert.equal(index.donePending(id), doc.id);
  assert.deepEqual(index.pendingFor(doc.id), []);
  // Finishing is deleting, so a second call is a no-op rather than an error.
  assert.equal(index.donePending(id), null);
});

test("pending: clear empties one document without touching another", () => {
  const a = index.register(write("d.spec.md", "# D"));
  const b = index.register(write("e.spec.md", "# E"));
  index.addPending(a.id, "One");
  index.addPending(b.id, "Two");

  index.clearPending(a.id);
  assert.deepEqual(index.pendingFor(a.id), []);
  assert.equal(index.pendingFor(b.id).length, 1);
  assert.equal(index.allPending().length, 1);
});

test("pin: a document starts unpinned, pins and unpins, and keeps its pin when registered again", () => {
  const abs = write("docs/b.workbench.html", "<title>Bench</title>");
  const d = index.register(abs);
  assert.equal(d.pinned, false);
  assert.equal(index.setPinned(d.id, true), true);
  assert.equal(index.get(d.id)!.pinned, true);
  assert.equal(index.register(abs).pinned, true);
  assert.equal(index.setPinned(d.id, false), true);
  assert.equal(index.get(d.id)!.pinned, false);
  assert.equal(index.setPinned(9999, true), false);
});

test("boardReposInText: { repos }, a pre-merge { url }'s ?repo=, nothing for anything else", async () => {
  const { boardReposInText } = await import("../src/core/db.ts");
  assert.deepEqual(boardReposInText(JSON.stringify({ repos: ["/a/.git", "/b/.git", "/a/.git"] })), ["/a/.git", "/b/.git"]);
  assert.deepEqual(boardReposInText(JSON.stringify({ url: "http://h:4322/?repo=%2Fa%2F.git&repo=%2Fb%2F.git&run=7" })), ["/a/.git", "/b/.git"]);
  assert.deepEqual(boardReposInText(JSON.stringify({ run: "7" })), []);
  assert.deepEqual(boardReposInText("not json"), []);
});

test("migration: a project's swarm document gives its repositories to the project's board and leaves the index", () => {
  const [one, two, three] = ["one", "two", "three"].map((n) => {
    fs.mkdirSync(path.join(tmp, "r", n, ".git"), { recursive: true });
    return path.join(tmp, "r", n, ".git");
  });
  const board = write("docs/swarm.swarm.json",JSON.stringify({ repos: [one, two] }));
  const plan = write("docs/a.plan.md", "# A plan\n");
  const b = index.register(board, { project: "p" });
  index.register(plan, { project: "p" });
  assert.equal(b.kind, "swarm");
  index.close();
  index = openIndex(path.join(tmp, "test.sqlite"), root);
  assert.deepEqual(index.boardRepos("p"), [one, two]);
  assert.deepEqual(index.all().map((d) => d.kind), ["plan"]);
  assert.ok(fs.existsSync(board), "the file stays on disk");
  // a second open finds nothing to migrate and keeps the list
  index.close();
  index = openIndex(path.join(tmp, "test.sqlite"), root);
  assert.deepEqual(index.boardRepos("p"), [one, two]);
  assert.deepEqual(index.addBoardRepo("p", one), [one, two]);
  assert.deepEqual(index.addBoardRepo("p", three), [one, two, three]);
});

test("project add registers the .git of its paths as board repos, and a project never registered falls back to them (D12)", () => {
  const repo = path.join(tmp, "repo");
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  const plain = path.join(tmp, "plain");
  fs.mkdirSync(plain);
  const gitDir = path.join(repo, ".git").split("\\").join("/");
  index.upsertProject("p", { addPaths: [repo, plain] });
  assert.deepEqual(index.boardRepos("p"), [gitDir], "only a path that is a repository");
  // a record made before the repository existed: the empty list falls back to the .git on disk
  const early = path.join(tmp, "early");
  index.upsertProject("q", { addPaths: [early] });
  assert.deepEqual(index.boardRepos("q"), []);
  fs.mkdirSync(path.join(early, ".git"), { recursive: true });
  assert.deepEqual(index.boardRepos("q"), [path.join(early, ".git").split("\\").join("/")]);
  // a repository the board already lists is kept, and not doubled by the fallback
  index.addBoardRepo("p", path.join(tmp, "elsewhere", ".git"));
  index.upsertProject("p", { addPaths: [repo] });
  assert.equal(index.boardRepos("p").filter((r) => r === gitDir).length, 1);
});
