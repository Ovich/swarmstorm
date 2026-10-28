import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "cli", "index.ts");

let toolRoot: string;

// AIVIEW_ROOT = where the code/dist would be; SWARMSTORM_HOME = where the data goes.
// The suite points both at one temp dir so a run leaves nothing in the real home.
const run = (...argv: string[]) =>
  spawnSync(process.execPath, [CLI, ...argv], {
    encoding: "utf8",
    env: { ...process.env, AIVIEW_ROOT: toolRoot, SWARMSTORM_HOME: toolRoot },
  });

const write = (rel: string, content: string): string => {
  const abs = path.join(toolRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
};

beforeEach(() => {
  toolRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aiview-cli-"));
});

afterEach(() => {
  // Windows may briefly hold handles of a just-killed child; a leaked temp dir
  // must not fail the suite.
  for (let i = 0; ; i++) {
    try {
      fs.rmSync(toolRoot, { recursive: true, force: true });
      return;
    } catch {
      if (i >= 5) {
        console.warn(`cleanup: temp dir left behind: ${toolRoot}`);
        return;
      }
      spawnSync(process.execPath, ["-e", "setTimeout(()=>{},200)"]);
    }
  }
});

/** Stop the detached server a test started, and wait for it to be gone so afterEach can
 *  delete the temp dir. */
const stopServer = (): void => {
  const pid = Number(fs.readFileSync(path.join(toolRoot, "aiview.pid"), "utf8"));
  try {
    process.kill(pid);
  } catch {}
  const t0 = Date.now();
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch {
      break; // gone
    }
    if (Date.now() - t0 > 5000) break;
    spawnSync(process.execPath, ["-e", "setTimeout(()=>{},100)"]);
  }
};

test("status --json reports sqlite path and count", () => {
  const r = run("status", "--json");
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.sqlite, path.join(toolRoot, "aiview.sqlite"));
  assert.equal(out.documents, 0);
});

test("add registers, list shows it, remove drops it", () => {
  const f = write("docs/x.brainstorm.md", "# Board X\n");
  const added = run("add", f, "--tag", "proj");
  assert.equal(added.status, 0, added.stderr);
  assert.match(added.stdout, /#1 {2}brainstorm \[proj\]/);
  assert.match(added.stdout, /Board X/);

  const listed = run("list");
  assert.match(listed.stdout, /Board X/);

  const filtered = run("list", "--kind", "spec");
  assert.equal(filtered.stdout.trim(), "");

  const removed = run("remove", "#1");
  assert.match(removed.stdout, /removed #1/);
  assert.equal(JSON.parse(run("status", "--json").stdout).documents, 0);
});

test("add --group registers membership and shows it", () => {
  const board = write("docs/x.brainstorm.md", "# Board\n");
  const spec = write("docs/x.spec.md", "# Spec\n");
  const r1 = run("add", board, "--group", "topic", "--group-title", "The Topic");
  assert.equal(r1.status, 0, r1.stderr);
  assert.match(r1.stdout, /group:topic/);
  const r2 = run("add", spec, "--group", "topic");
  assert.match(r2.stdout, /group:topic/);
});

test("add without kind fails with the mandatory-kind message", () => {
  const f = write("plain.md", "# T\n");
  const r = run("add", f);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /kind is mandatory/);
});

test("remove of unknown ref reports, exits 0", () => {
  const r = run("remove", "#99");
  assert.equal(r.status, 0);
  assert.match(r.stderr, /not in index/);
});

test("update: kind, tags, group round-trip without remove/re-add", () => {
  const f = write("docs/x.preview.md", "# X\n");
  run("add", f);
  const updated = run("update", "#1", "--kind", "pdf", "--tag", "extra", "--group", "g1", "--group-title", "Group One", "--json");
  assert.equal(updated.status, 0, updated.stderr);
  const d = JSON.parse(updated.stdout);
  assert.equal(d.kind, "pdf");
  assert.ok(d.tags.includes("extra"));
  assert.equal(d.group_slug, "g1");
  const ungrouped = JSON.parse(run("update", "#1", "--untag", "extra", "--ungroup", "--json").stdout);
  assert.equal(ungrouped.group_slug, null);
  assert.ok(!ungrouped.tags.includes("extra"));
});

test("status --json: down, then stale pidfile detected", () => {
  const down = JSON.parse(run("status", "--json").stdout);
  assert.equal(down.server.running, false);
  assert.equal(down.server.stale, false);
  // stale: a pidfile pointing at a dead pid
  fs.writeFileSync(path.join(toolRoot, "aiview.pid"), "999999");
  fs.writeFileSync(path.join(toolRoot, "aiview.port"), "4599");
  const stale = JSON.parse(run("status", "--json").stdout);
  assert.equal(stale.server.running, false);
  assert.equal(stale.server.stale, true);
});

test("open: registers, starts a detached server, second open reuses it", () => {
  const f = write("docs/o.spec.md", "# O\n");
  const first = run("open", f, "--port", "0", "--json");
  assert.equal(first.status, 0, first.stderr);
  const r1 = JSON.parse(first.stdout);
  assert.match(r1.url, /^http:\/\/localhost:\d+\/#doc=1$/);
  assert.equal(r1.server.running, true);
  try {
    const second = run("open", f, "--json");
    const r2 = JSON.parse(second.stdout);
    assert.equal(r2.url, r1.url); // idempotent: same server, same doc, same URL
  } finally {
    stopServer();
  }
});

// The installed collection: a skill folder under a plugin whose manifest carries the
// version, inside the suite's temp dir so no test reads a real manifest.
const installedSkill = (): string => path.join(toolRoot, "plugin", "skills", "companions", "aiview");
const install = (version: string): void => {
  write("plugin/.claude-plugin/plugin.json", JSON.stringify({ version }));
  fs.mkdirSync(installedSkill(), { recursive: true });
};
const runInstalled = (...argv: string[]) =>
  spawnSync(process.execPath, [CLI, ...argv], {
    encoding: "utf8",
    env: { ...process.env, AIVIEW_ROOT: installedSkill(), SWARMSTORM_HOME: toolRoot },
  });
const openJson = (...argv: string[]) => {
  const r = runInstalled("open", ...argv, "--json");
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout) as { url: string; server: { pid: number; port: number; version: string | null } };
};
const isGone = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
};

test("a server records its version", () => {
  install("1.0.0");
  const f = write("docs/v.spec.md", "# V\n");
  try {
    const r = openJson(f, "--port", "0");
    assert.equal(r.server.version, "1.0.0");
    assert.equal(fs.readFileSync(path.join(toolRoot, "aiview.version"), "utf8"), "1.0.0");
  } finally {
    stopServer();
  }
});

test("open reuses a server of the same version", () => {
  install("1.0.0");
  const f = write("docs/v.spec.md", "# V\n");
  try {
    const first = openJson(f, "--port", "0");
    const second = openJson(f);
    assert.equal(second.server.pid, first.server.pid);
    assert.equal(second.url, first.url);
  } finally {
    stopServer();
  }
});

test("open replaces a server of another version", () => {
  install("1.0.0");
  const f = write("docs/v.spec.md", "# V\n");
  try {
    const old = openJson(f, "--port", "0");
    install("1.1.0");
    const current = openJson(f);
    assert.notEqual(current.server.pid, old.server.pid);
    assert.ok(isGone(old.server.pid), "the older server is stopped");
    assert.equal(current.server.port, old.server.port, "the installed one takes its port");
    assert.equal(current.server.version, "1.1.0");
    assert.equal(current.url, old.url);
  } finally {
    stopServer();
  }
});

test("open replaces a server with no version recorded", () => {
  install("1.0.0");
  const f = write("docs/v.spec.md", "# V\n");
  try {
    const old = openJson(f, "--port", "0");
    fs.rmSync(path.join(toolRoot, "aiview.version")); // a server from before versions were recorded
    const current = openJson(f);
    assert.notEqual(current.server.pid, old.server.pid);
    assert.ok(isGone(old.server.pid), "the unversioned server is stopped");
    assert.equal(current.server.version, "1.0.0");
  } finally {
    stopServer();
  }
});

test("serve --detach replaces a server of another version", () => {
  install("1.0.0");
  const f = write("docs/v.spec.md", "# V\n");
  try {
    const old = openJson(f, "--port", "0");
    install("2.0.0");
    const r = runInstalled("serve", "--detach", "--json");
    assert.equal(r.status, 0, r.stderr);
    const server = (JSON.parse(r.stdout) as { server: { pid: number; version: string } }).server;
    assert.notEqual(server.pid, old.server.pid);
    assert.ok(isGone(old.server.pid), "the older server is stopped");
    assert.equal(server.version, "2.0.0");
  } finally {
    stopServer();
  }
});

test("status reports the version", () => {
  install("1.0.0");
  const f = write("docs/v.spec.md", "# V\n");
  try {
    openJson(f, "--port", "0");
    const json = runInstalled("status", "--json");
    assert.equal(json.status, 0, json.stderr);
    assert.equal(JSON.parse(json.stdout).server.version, "1.0.0");
    assert.match(runInstalled("status").stdout, /up \(pid \d+, port \d+, version 1\.0\.0\)/);
  } finally {
    stopServer();
  }
});

test("show: names are held to the page the person sees, and the link is the pointer", () => {
  write("docs/tools.prototype.html", `<!doctype html><html><body><span data-component="Pill">v1</span></body></html>`);
  const host = write(
    "docs/host.prototype.html",
    `<!doctype html><html><head><title>Host</title></head><body>` +
      `<div data-component="PrototypeBar"><button data-aiview-variant="empty" aria-pressed="true">Empty</button><button data-aiview-variant="step-2">Step 2</button></div>` +
      `<header data-component="ApplicationStrip">strip</header><div data-bind="tools.prototype.html#Pill"></div></body></html>`,
  );

  const unregistered = run("show", host, "--component", "ApplicationStrip");
  assert.equal(unregistered.status, 1);
  assert.match(unregistered.stderr, /not registered/);

  const first = run("open", host, "--port", "0", "--json");
  assert.equal(first.status, 0, first.stderr);
  try {
    const listed = JSON.parse(run("components", host, "--json").stdout);
    assert.deepEqual(listed.page, ["PrototypeBar", "ApplicationStrip", "Pill"], "the names show accepts, the bound one included");
    assert.deepEqual(listed.variants, ["empty", "step-2"]);

    const invented = run("show", host, "--component", "ShellMiddle");
    assert.equal(invented.status, 1);
    assert.match(invented.stderr, /no component named ShellMiddle in this prototype; it has: .*ApplicationStrip.*Pill/);

    const variant = run("show", host, "--component", "Pill", "--variant", "loading");
    assert.equal(variant.status, 1);
    assert.match(variant.stderr, /no variant named loading in this prototype; it has: empty, step-2/);

    const shown = run("show", "#1", "--component", "ApplicationStrip", "--component", "Pill", "--variant", "step-2", "--json");
    assert.equal(shown.status, 0, shown.stderr);
    const r = JSON.parse(shown.stdout);
    assert.match(r.url, /^http:\/\/localhost:\d+\/#doc=1&show=ApplicationStrip,Pill&variant=step-2$/);
    assert.equal(r.tabs, 0, "nobody is looking: the agent hands over the link");

    const done = run("show", "--done", "--json");
    assert.equal(done.status, 0, done.stderr);
    assert.deepEqual(JSON.parse(done.stdout), { done: true, tabs: 0 });
  } finally {
    stopServer();
  }
});

test("unknown verb prints usage and fails", () => {
  const r = run("frobnicate");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /usage: aiview/);
});

test("project add creates the record and its docs directory; list shows it", () => {
  const covered = path.join("C:", path.sep, "CIIP");
  const added = run("project", "add", "CIIP", "--title", "CIIP", "--path", covered, "--json");
  assert.equal(added.status, 0, added.stderr);
  const p = JSON.parse(added.stdout);
  assert.equal(p.slug, "CIIP");
  assert.deepEqual(p.paths, [covered]);
  assert.ok(fs.existsSync(path.join(toolRoot, "docs", "CIIP")), "project add makes <docs>/<slug>/");

  const listed = run("project", "list", "--json");
  assert.deepEqual(JSON.parse(listed.stdout).map((x: { slug: string }) => x.slug), ["CIIP"]);
});

test("a document filed under <docs>/<slug>/ takes that project, no flag needed", () => {
  const f = write("docs/CIIP/a.spec.md", "# A\n");
  const d = JSON.parse(run("add", f, "--json").stdout);
  assert.equal(d.project, "CIIP");
});

test("--project overrides where the file sits", () => {
  const f = write("docs/CIIP/b.spec.md", "# B\n");
  assert.equal(JSON.parse(run("add", f, "--project", "Roster", "--json").stdout).project, "Roster");
});

test("use: sets the active project, refuses an unknown one", () => {
  run("project", "add", "CIIP");
  const ok = run("use", "CIIP", "--json");
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).project, "CIIP");
  assert.equal(JSON.parse(run("status", "--json").stdout).project, "CIIP");

  const bad = run("use", "Nope");
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /no such project: Nope/);
  assert.match(bad.stderr, /known: CIIP/);
  // the refusal changed nothing
  assert.equal(JSON.parse(run("status", "--json").stdout).project, "CIIP");
});

test("list scopes to the active project; --all and --project override", () => {
  run("add", write("docs/CIIP/a.spec.md", "# A\n"));
  run("add", write("docs/JOBS/b.spec.md", "# B\n"));
  run("use", "CIIP");

  assert.equal(JSON.parse(run("list", "--json").stdout).length, 1);
  assert.equal(JSON.parse(run("list", "--all", "--json").stdout).length, 2);
  assert.equal(JSON.parse(run("list", "--project", "JOBS", "--json").stdout).length, 1);
});

test("status --json reports where to write, and which project the cwd is in", () => {
  run("project", "add", "CIIP", "--path", toolRoot);
  run("use", "CIIP");
  const s = JSON.parse(run("status", "--json").stdout);
  assert.equal(s.project, "CIIP");
  assert.equal(s.projectDocs, path.join(toolRoot, "docs", "CIIP"));
  // '*' means All projects: write to the docs root itself
  run("use", "*");
  const all = JSON.parse(run("status", "--json").stdout);
  assert.equal(all.project, "*");
  assert.equal(all.projectDocs, path.join(toolRoot, "docs"));
});

test("project rm is refused while documents reference it", () => {
  run("add", write("docs/CIIP/a.spec.md", "# A\n"));
  const refused = run("project", "rm", "CIIP");
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /still has 1 document\./);

  run("remove", "#1");
  const gone = run("project", "rm", "CIIP");
  assert.equal(gone.status, 0, gone.stderr);
  assert.deepEqual(JSON.parse(run("project", "list", "--json").stdout), []);
});

test("move --project refiles a document into another project, file and row together", () => {
  run("project", "add", "CIIP");
  run("project", "add", "Swarmstorm");
  const f = write("docs/CIIP/a.spec.md", "# A\n");
  run("add", f, "--tag", "keep", "--group", "g", "--group-title", "Group G");

  const moved = JSON.parse(run("move", "#1", "--project", "Swarmstorm", "--json").stdout).moved[0];
  assert.equal(moved.project, "Swarmstorm");
  assert.equal(moved.file_path, "docs/Swarmstorm/a.spec.md");
  assert.ok(fs.existsSync(path.join(toolRoot, "docs", "Swarmstorm", "a.spec.md")), "the file moved");
  assert.ok(!fs.existsSync(f), "the original is gone");
  // reclassifying must not cost the metadata that made the document findable
  assert.equal(moved.id, 1);
  assert.ok(moved.tags.includes("keep"));
  assert.equal(moved.group_slug, "g");
});

test("move --project refuses an unknown project rather than inventing one", () => {
  run("project", "add", "CIIP");
  const f = write("docs/CIIP/a.spec.md", "# A\n");
  run("add", f);
  const r = run("move", "#1", "--project", "Ghost");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /no such project: Ghost/);
  assert.ok(fs.existsSync(f), "a refused move leaves the file alone");
  assert.equal(JSON.parse(run("list", "--all", "--json").stdout)[0].project, "CIIP");
});

test("bare move pulls a stray back into its own project's directory", () => {
  run("project", "add", "CIIP");
  const stray = write("elsewhere/a.spec.md", "# A\n");
  run("add", stray, "--project", "CIIP");
  const moved = JSON.parse(run("move", "#1", "--json").stdout).moved[0];
  assert.equal(moved.file_path, "docs/CIIP/a.spec.md");
});

describe("move a workbench", () => {
  const runWith = (preload: string[], ...argv: string[]) =>
    spawnSync(process.execPath, [...preload, CLI, ...argv], {
      encoding: "utf8",
      env: { ...process.env, AIVIEW_ROOT: toolRoot, SWARMSTORM_HOME: toolRoot },
    });
  const at = (...p: string[]) => path.join(toolRoot, "docs", ...p);
  const bench = (name: string, withSidecar: boolean) => {
    run("project", "add", "A");
    run("project", "add", "B");
    const page = write(`docs/A/${name}.workbench.html`, "<title>b</title>");
    if (withSidecar) {
      write(`docs/A/${name}.workbench/manifest.json`, "{}");
      write(`docs/A/${name}.workbench/data/t/r/x.json`, "1");
    }
    run("add", page);
    return page;
  };

  test("the page and its sidecar move together", () => {
    const page = bench("one", true);
    assert.equal(run("move", "#1", "--project", "B").status, 0);
    assert.ok(fs.existsSync(at("B", "one.workbench.html")));
    assert.ok(fs.existsSync(at("B", "one.workbench", "data", "t", "r", "x.json")));
    assert.ok(!fs.existsSync(page));
    assert.ok(!fs.existsSync(at("A", "one.workbench")));
  });

  test("without a sidecar, the page alone moves", () => {
    bench("two", false);
    assert.equal(run("move", "#1", "--project", "B").status, 0);
    assert.ok(fs.existsSync(at("B", "two.workbench.html")));
    assert.ok(!fs.existsSync(at("B", "two.workbench")));
  });

  test("a destination taken: nothing moves", () => {
    const page = bench("three", true);
    fs.mkdirSync(at("B", "three.workbench"), { recursive: true });
    run("move", "#1", "--project", "B");
    assert.ok(fs.existsSync(page));
    assert.ok(fs.existsSync(at("A", "three.workbench", "manifest.json")));
    assert.ok(!fs.existsSync(at("B", "three.workbench.html")));
    assert.equal(JSON.parse(run("list", "--all", "--json").stdout)[0].project, "A");
  });

  test("across volumes (EXDEV): copied, then the source removed", () => {
    const page = bench("four", true);
    const exdev = `data:text/javascript,${encodeURIComponent(
      'import fs from "node:fs"; fs.renameSync = () => { const e = new Error("EXDEV"); e.code = "EXDEV"; throw e; };',
    )}`;
    assert.equal(runWith(["--import", exdev], "move", "#1", "--project", "B").status, 0);
    assert.ok(fs.existsSync(at("B", "four.workbench.html")));
    assert.ok(fs.existsSync(at("B", "four.workbench", "data", "t", "r", "x.json")));
    assert.ok(!fs.existsSync(page));
    assert.ok(!fs.existsSync(at("A", "four.workbench")));
  });

  test("an orphan (moved on disk, the row stale) is re-pointed", () => {
    const page = bench("five", true);
    fs.mkdirSync(at("B"), { recursive: true });
    fs.renameSync(page, at("B", "five.workbench.html"));
    fs.renameSync(at("A", "five.workbench"), at("B", "five.workbench"));
    const moved = JSON.parse(run("move", "#1", "--project", "B", "--json").stdout).moved[0];
    assert.equal(moved.abs_path, at("B", "five.workbench.html"));
    assert.ok(fs.existsSync(at("B", "five.workbench", "manifest.json")));
  });
});

test("update --project points at move instead of silently doing nothing", () => {
  run("project", "add", "CIIP");
  run("add", write("docs/CIIP/a.spec.md", "# A\n"));
  const r = run("update", "#1", "--project", "Swarmstorm");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /use: aiview move #1 --project <slug>/);
});

test("path: the tool joins the location, so no caller ever builds one", () => {
  run("project", "add", "CIIP");
  run("use", "CIIP");

  const p = run("path", "2026-08-25-topic.spec.md", "--json");
  assert.equal(p.status, 0, p.stderr);
  const out = JSON.parse(p.stdout);
  // joined with THIS platform's separator, under THIS machine's home
  assert.equal(out.path, path.join(toolRoot, "docs", "CIIP", "2026-08-25-topic.spec.md"));
  assert.equal(out.dir, path.join(toolRoot, "docs", "CIIP"));
  assert.equal(out.project, "CIIP");
  assert.ok(fs.existsSync(out.dir), "the directory is ready to be written into");

  // a caller that passes a path by mistake still gets a correctly located file
  assert.equal(
    JSON.parse(run("path", "some/wrong/place/2026-08-25-topic.spec.md", "--json").stdout).path,
    out.path,
  );

  // --project targets another project without switching the active one
  run("project", "add", "JOBS");
  assert.equal(
    JSON.parse(run("path", "x.spec.md", "--project", "JOBS", "--json").stdout).dir,
    path.join(toolRoot, "docs", "JOBS"),
  );
  assert.equal(JSON.parse(run("status", "--json").stdout).project, "CIIP");
});

test("path: the project the cwd is in wins over the active one", () => {
  const ciipRepo = path.join(toolRoot, "repos", "ciip");
  fs.mkdirSync(path.join(ciipRepo, "sub"), { recursive: true });
  run("project", "add", "CIIP", "--path", ciipRepo);
  run("project", "add", "JOBS");
  run("use", "JOBS");
  const inCiip = spawnSync(process.execPath, [CLI, "path", "x.spec.md", "--json"], {
    encoding: "utf8",
    cwd: path.join(ciipRepo, "sub"),
    env: { ...process.env, AIVIEW_ROOT: toolRoot, SWARMSTORM_HOME: toolRoot },
  });
  assert.equal(inCiip.status, 0, inCiip.stderr);
  assert.equal(JSON.parse(inCiip.stdout).project, "CIIP");
  // outside any project's path, the active one
  assert.equal(JSON.parse(run("path", "x.spec.md", "--json").stdout).project, "JOBS");
});

test("a verb's user error is one line, no stack", () => {
  for (const r of [run("open", path.join(toolRoot, "missing.md")), run("add", write("plain.md", "# T\n"))]) {
    assert.equal(r.status, 1);
    assert.equal(r.stderr.trim().split(/\r?\n/).length, 1, r.stderr);
    assert.doesNotMatch(r.stderr, /\n\s+at /);
  }
});

test("path refuses when there is nothing to resolve against", () => {
  const noActive = run("path", "x.spec.md");
  assert.notEqual(noActive.status, 0);
  assert.match(noActive.stderr, /no active project/);

  run("project", "add", "CIIP");
  const ghost = run("path", "x.spec.md", "--project", "Ghost");
  assert.notEqual(ghost.status, 0);
  assert.match(ghost.stderr, /no such project: Ghost/);
});

test("components: what a prototype offers and pulls; check: whether a host resolves", () => {
  const tools = write(
    "docs/JOBS/tools.prototype.html",
    `<html><body><div data-component="Pill" onclick="x()">p</div><span data-component="Dot">.</span><div data-bind="other.html#Thing"></div></body></html>`,
  );
  const r = run("components", tools, "--json");
  assert.equal(r.status, 0, r.stderr);
  const c = JSON.parse(r.stdout);
  assert.deepEqual(c.offers.map((o: { name: string }) => o.name), ["Pill", "Dot"]);
  assert.deepEqual(c.offers[0].warnings, ["root carries inline handler onclick"]);
  assert.deepEqual(c.pulls, [{ ref: "other.html#Thing", file: "other.html", name: "Thing" }]);
  const text = run("components", tools).stdout;
  assert.match(text, /offers\s+Pill\s+<div>\s+!! root carries inline handler onclick/);
  assert.match(text, /pulls\s+Thing\s+from other\.html/);

  const good = write("docs/JOBS/host.prototype.html", `<html><body><div data-bind="tools.prototype.html#Dot"></div></body></html>`);
  const ok = run("check", good, "--json");
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout), { file: "host.prototype.html", bound: 1, sources: ["tools.prototype.html"], errors: [], warnings: [] });
  assert.match(run("check", good).stdout, /1 bound from 1 source: tools\.prototype\.html\s+ok/);

  const bad = write("docs/JOBS/bad.prototype.html", `<html><body><div data-bind="tools.prototype.html#Nope"></div><div data-bind="missing.html#A"></div></body></html>`);
  const fail = run("check", bad);
  assert.equal(fail.status, 1);
  assert.match(fail.stdout, /error\s+tools\.prototype\.html#Nope: Component Nope not in tools\.prototype\.html/);
  assert.match(fail.stdout, /error\s+missing\.html#A: Not found: missing\.html/);

  assert.equal(run("check", path.join(toolRoot, "nope.html")).status, 1);
  assert.equal(run("components", write("docs/x.md", "# md")).status, 1);
});

test("mermaid-check: every block of a document parsed, failures with their line, exit 1", () => {
  const md = write(
    "docs/JOBS/plan.plan.md",
    "# Plan\n\n```mermaid\nflowchart TB\n  A --> B\n```\n\ntext\n\n```mermaid\nsequenceDiagram\n  A->>B: hi\n```\n\n```mermaid\nflowchart TB\n  A --->> B[[\n```\n",
  );
  const r = run("mermaid-check", md);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /ok\s+line 3\s+flowchart-v2/);
  assert.match(r.stdout, /ok\s+line 10\s+sequence/);
  assert.match(r.stdout, /FAIL\s+line 15\s+Parse error/);
  assert.match(r.stdout, /3 blocks, 1 failed/);
  const j = JSON.parse(run("mermaid-check", md, "--json").stdout);
  assert.equal(j.blocks, 3);
  assert.equal(j.failed, 1);
  assert.deepEqual(j.results.map((x: { ok: boolean }) => x.ok), [true, true, false]);

  const good = write("docs/JOBS/ok.spec.md", "```mermaid\nstateDiagram-v2\n  [*] --> S\n```\n");
  assert.equal(run("mermaid-check", good).status, 0);
  const bare = write("docs/JOBS/d.mmd", "classDiagram\n  A <|-- B\n");
  assert.match(run("mermaid-check", bare).stdout, /ok\s+line 1\s+classDiagram/);
  assert.match(run("mermaid-check", write("docs/JOBS/none.md", "# nothing\n")).stdout, /no mermaid block/);
});

test("mermaid-check: discipline warnings do not fail the run", () => {
  const md = write("docs/JOBS/warn.plan.md", "# Plan\n\n```mermaid\nflowchart TB\n  A --> B\n  A --> C\n```\n\nPhasing: what ships first.\n\n```mermaid\nflowchart TB\n  A -->|x| B\n  A -->|y| C\n```\n");
  const r = run("mermaid-check", md);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /warn\s+line 3\s+no caption above the fence/);
  assert.match(r.stdout, /warn\s+line 3\s+A branches \(2 arrows\) and none carries a label/);
  assert.doesNotMatch(r.stdout, /warn\s+line 11/);
  assert.match(r.stdout, /2 blocks, 0 failed, 2 warnings/);
  const j = JSON.parse(run("mermaid-check", md, "--json").stdout);
  assert.equal(j.warnings, 2);
  assert.equal(j.results[1].warnings.length, 0);
});

test("plan check: warns on unconfirmed agent defaults, never fails the run", () => {
  const head = (status: string) =>
    `# p, plan\n\n> **Status**: ${status}\n\n## 8. Decisions\n| id | Kind | Decision | Status | Source | Slice |\n|---|---|---|---|---|---|\n| D1 | contract | x | agreed | agent default | 1 |\n`;
  const md = write("docs/JOBS/p.plan.md", head(`approved: Ada, 2026-10-14, "yes"`));
  const r = run("plan", "check", md);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /warn\s+line 3\s+approved, but 1 agent default\(s\) were never confirmed: D1 \(contract\)/);
  const j = JSON.parse(run("plan", "check", md, "--json").stdout);
  assert.equal(j.findings.length, 1);
  assert.deepEqual(j.defaults.map((d: { id: string }) => d.id), ["D1"]);

  const ok = write("docs/JOBS/q.plan.md", head(`approved: Ada, 2026-10-14, "yes"; defaults confirmed: D1`));
  assert.match(run("plan", "check", ok).stdout, /ok\s+approved, 1 decisions, 1 agent default\(s\), all confirmed/);
  assert.match(run("plan", "check", write("docs/JOBS/r.plan.md", head("draft"))).stdout, /to list at approval: D1/);
});

test("board --repo adds the repository to the project's board once, makes the project active and prints the /board link", () => {
  assert.equal(run("project", "add", "p", "--path", toolRoot).status, 0);
  const [one, two] = ["one", "two"].map((n) => {
    fs.mkdirSync(path.join(toolRoot, "r", n, ".git"), { recursive: true });
    return path.join(toolRoot, "r", n, ".git").split("\\").join("/");
  });
  const first = run("board", "--repo", one, "--project", "p", "--port", "0", "--json");
  try {
    assert.equal(first.status, 0, first.stderr);
    const out = JSON.parse(first.stdout) as { project: string; repos: string[]; url: string };
    assert.equal(out.project, "p");
    assert.deepEqual(out.repos, [one]);
    assert.match(out.url, /^http:\/\/localhost:\d+\/board$/);
    const again = JSON.parse(run("board", "--repo", one, "--project", "p", "--json").stdout) as { repos: string[] };
    assert.deepEqual(again.repos, [one]);
    const second = JSON.parse(run("board", "--repo", two, "--project", "p", "--json").stdout) as { repos: string[] };
    assert.deepEqual(second.repos, [one, two]);
    assert.equal((JSON.parse(run("status", "--json").stdout) as { project: string }).project, "p");
    // no document stands for the board
    assert.deepEqual(JSON.parse(run("list", "--all", "--json").stdout), []);
  } finally {
    stopServer();
  }
});

test("board with no project for the directory and none named exits 1 saying how to declare one", () => {
  const r = spawnSync(process.execPath, [CLI, "board", "--repo", "C:/r/.git"], {
    encoding: "utf8",
    cwd: os.tmpdir(),
    env: { ...process.env, AIVIEW_ROOT: toolRoot, SWARMSTORM_HOME: toolRoot },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no aiview project for .*aiview project add/);
});
