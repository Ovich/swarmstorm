var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/proc.ts
import { spawn, spawnSync } from "node:child_process";
function hiddenSpawnSync(command, args2, options = {}) {
  return spawnSync(command, args2, { ...options, windowsHide: true });
}
var hiddenSpawn;
var init_proc = __esm({
  "src/proc.ts"() {
    "use strict";
    hiddenSpawn = (command, args2, options = {}) => spawn(command, args2, { ...options, windowsHide: true });
  }
});

// ../swarm-board/src/proc.ts
import { spawn as spawn2, spawnSync as spawnSync2 } from "node:child_process";
var hiddenSpawn2;
var init_proc2 = __esm({
  "../swarm-board/src/proc.ts"() {
    "use strict";
    hiddenSpawn2 = (command, args2, options = {}) => spawn2(command, args2, { ...options, windowsHide: true });
  }
});

// ../swarm-board/src/place/place.ts
import fs from "node:fs";
import path from "node:path";
function commonGitDir(dotGit) {
  if (!fs.statSync(dotGit).isFile()) return dotGit;
  const own = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, "utf8"))?.[1]?.trim();
  if (!own) return dotGit;
  const dir = path.resolve(path.dirname(dotGit), own);
  const common = path.join(dir, "commondir");
  return fs.existsSync(common) ? path.resolve(dir, fs.readFileSync(common, "utf8").trim()) : dir;
}
var init_place = __esm({
  "../swarm-board/src/place/place.ts"() {
    "use strict";
    init_proc2();
  }
});

// src/core/home.ts
import fs2 from "node:fs";
import os from "node:os";
import path2 from "node:path";
function defaultPort(root = DATA_ROOT) {
  const home = normalHome(root);
  if (home === normalHome(NEW_HOME) || home === normalHome(OLD_HOME)) return HOME_PORT;
  let hash = 2166136261;
  for (const ch of home) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  return 4400 + hash % 500;
}
function normalHome(root) {
  let p = path2.resolve(root);
  try {
    p = fs2.realpathSync.native(p);
  } catch {
  }
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}
function firstFreePort(from) {
  const probe = `const net=require("net");const f=(p,n)=>{if(n===0){console.log(${from});return}const s=net.createServer();s.once("error",()=>f(p+1,n-1));s.listen(p,"127.0.0.1",()=>{s.close(()=>console.log(p))})};f(${from},20)`;
  const r = hiddenSpawnSync(process.execPath, ["-e", probe], { encoding: "utf8" });
  const port = Number(r.stdout?.trim());
  return Number.isInteger(port) && port > 0 ? port : from;
}
function ensureHome() {
  fs2.mkdirSync(DOCS_ROOT, { recursive: true });
}
function adoptLegacyIndex(toolRoot, sqlitePath) {
  if (fs2.existsSync(sqlitePath)) return;
  const legacy = path2.join(toolRoot, "aiview.sqlite");
  if (!fs2.existsSync(legacy)) return;
  fs2.copyFileSync(legacy, sqlitePath);
  console.error(`aiview: adopted the index from ${legacy} (the original is left in place, unused)`);
}
var homeFromEnv, NEW_HOME, OLD_HOME, DATA_ROOT, HOME_PORT, DOCS_ROOT, docsDirFor;
var init_home = __esm({
  "src/core/home.ts"() {
    "use strict";
    init_proc();
    homeFromEnv = process.env.SWARMSTORM_HOME ?? process.env.CHARRETTE_HOME;
    NEW_HOME = path2.join(os.homedir(), "swarmstorm_appdata");
    OLD_HOME = path2.join(os.homedir(), "charrette_appdata");
    DATA_ROOT = homeFromEnv ? path2.resolve(homeFromEnv) : !fs2.existsSync(NEW_HOME) && fs2.existsSync(OLD_HOME) ? OLD_HOME : NEW_HOME;
    HOME_PORT = 4321;
    DOCS_ROOT = path2.join(DATA_ROOT, "docs");
    docsDirFor = (projectSlug) => path2.join(DOCS_ROOT, projectSlug);
  }
});

// src/core/projects.ts
import path3 from "node:path";
function isInside(child, parent) {
  if (!parent) return false;
  const c = norm(child);
  const p = norm(parent);
  return c === p || c.startsWith(p + path3.sep);
}
function projectForCwd(dir, projects) {
  let best = null;
  let bestLen = -1;
  for (const project of projects) {
    for (const prefix of project.paths) {
      if (!isInside(dir, prefix)) continue;
      const len = norm(prefix).length;
      if (len > bestLen) {
        bestLen = len;
        best = project;
      }
    }
  }
  return best;
}
function projectFromDocsPath(absFile, docsRoot) {
  if (!isInside(path3.dirname(absFile), docsRoot)) return null;
  const [first, ...rest] = path3.relative(docsRoot, absFile).split(/[\\/]/);
  return rest.length > 0 && first ? first : null;
}
function resolveProject({ explicit, absFile, docsRoot, existing, fallback }) {
  if (explicit) return explicit;
  return projectFromDocsPath(absFile, docsRoot) ?? existing ?? fallback;
}
var norm;
var init_projects = __esm({
  "src/core/projects.ts"() {
    "use strict";
    norm = (p) => {
      const unified = p.replace(/[\\/]+$/, "").split(/[\\/]/).join(path3.sep);
      return process.platform === "win32" ? unified.toLowerCase() : unified;
    };
  }
});

// src/core/paths.ts
import fs3 from "node:fs";
import path4 from "node:path";
function repoRootOf(start) {
  let dir = start;
  for (; ; ) {
    if (fs3.existsSync(path4.join(dir, ".git"))) return dir;
    const parent = path4.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}
function sidecarOf(absPath) {
  return /\.workbench\.html$/i.test(absPath) ? absPath.replace(/\.html$/i, "") : null;
}
function kindFromName(file) {
  const parts = path4.basename(file).split(".");
  return parts.length >= 3 ? currentKind(parts[parts.length - 2]) : "";
}
function titleOf(text, file) {
  if (isSwarm(file)) return path4.basename(file);
  const m = isHtml(file) ? text.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? text.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1] : text.match(/^#\s+(.+)$/m)?.[1];
  return (m ?? path4.basename(file)).trim();
}
function toStored(abs, root) {
  const rel = path4.relative(root, abs);
  return rel && !rel.startsWith("..") && !path4.isAbsolute(rel) ? rel.split(path4.sep).join("/") : abs;
}
var isHtml, isPdf, isSwarm, formatOf, RENAMED_KINDS, currentKind, projectRoot, readDoc, toAbs;
var init_paths = __esm({
  "src/core/paths.ts"() {
    "use strict";
    isHtml = (file) => /\.html?$/i.test(file);
    isPdf = (file) => /\.pdf$/i.test(file);
    isSwarm = (file) => /\.swarm\.json$/i.test(file);
    formatOf = (file) => isHtml(file) ? "html" : isPdf(file) ? "pdf" : isSwarm(file) ? "swarm" : "markdown";
    RENAMED_KINDS = { mockup: "prototype" };
    currentKind = (kind) => RENAMED_KINDS[kind.toLowerCase()] ?? kind.toLowerCase();
    projectRoot = (file) => path4.basename(repoRootOf(path4.dirname(file)));
    readDoc = (p) => fs3.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
    toAbs = (stored, root) => path4.isAbsolute(stored) ? stored : path4.resolve(root, ...stored.split("/"));
  }
});

// src/core/db.ts
import fs4 from "node:fs";
import path5 from "node:path";
import { fileURLToPath } from "node:url";
function findToolRoot() {
  if (process.env.AIVIEW_ROOT) return process.env.AIVIEW_ROOT;
  let dir = path5.dirname(fileURLToPath(import.meta.url));
  for (; ; ) {
    if (fs4.existsSync(path5.join(dir, "package.json"))) return dir;
    const parent = path5.dirname(dir);
    if (parent === dir) return dir;
    dir = parent;
  }
}
function boardReposInText(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (Array.isArray(parsed.repos)) return [...new Set(parsed.repos.filter((x) => typeof x === "string"))];
  if (typeof parsed.url === "string") {
    try {
      return [...new Set(new URL(parsed.url).searchParams.getAll("repo"))];
    } catch {
      return [];
    }
  }
  return [];
}
function openIndex(dbPath = SQLITE_PATH, root = STORE_ROOT) {
  if (dbPath === SQLITE_PATH) {
    ensureHome();
    adoptLegacyIndex(TOOL_ROOT, SQLITE_PATH);
  }
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = DELETE;
    -- The server writes on every file change while the CLI writes too; without a
    -- busy timeout a concurrent verb fails outright with SQLITE_BUSY.
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY,
      file_path TEXT NOT NULL UNIQUE,
      project TEXT NOT NULL,
      title TEXT,
      kind TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
  `);
  const cols = db.prepare("PRAGMA table_info(documents)").all().map((c) => c.name);
  if (!cols.includes("tags")) db.exec("ALTER TABLE documents ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'");
  if (!cols.includes("kind")) db.exec("ALTER TABLE documents ADD COLUMN kind TEXT NOT NULL DEFAULT ''");
  if (!cols.includes("group_slug")) db.exec("ALTER TABLE documents ADD COLUMN group_slug TEXT");
  if (!cols.includes("pinned")) db.exec("ALTER TABLE documents ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
  db.exec("CREATE TABLE IF NOT EXISTS groups (slug TEXT PRIMARY KEY, title TEXT)");
  db.exec(
    "CREATE TABLE IF NOT EXISTS projects (slug TEXT PRIMARY KEY, title TEXT, paths TEXT NOT NULL DEFAULT '[]')"
  );
  db.exec("CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const projectCols = db.prepare("PRAGMA table_info(projects)").all().map((c) => c.name);
  if (!projectCols.includes("board_repos")) db.exec("ALTER TABLE projects ADD COLUMN board_repos TEXT NOT NULL DEFAULT '[]'");
  const gitDirsOf = (pathsJson) => JSON.parse(pathsJson).map((p) => path5.join(path5.resolve(p), ".git")).filter((g) => fs4.existsSync(g)).map((g) => commonGitDir(g).split("\\").join("/"));
  const boardReposOf = (slug) => {
    const row = db.prepare("SELECT board_repos, paths FROM projects WHERE slug = ?").get(slug);
    if (!row) return [];
    const seen = /* @__PURE__ */ new Set();
    const repos = [];
    const keyed = (r) => {
      const g = /[\\/]\.git$/i.test(r) ? r : path5.join(r, ".git");
      return fs4.existsSync(g) && fs4.statSync(g).isFile() ? commonGitDir(g).split("\\").join("/") : r;
    };
    for (const r of [...JSON.parse(row.board_repos).map(keyed), ...JSON.parse(row.board_repos).length === 0 ? gitDirsOf(row.paths) : []]) {
      const folder = path5.resolve(r).replace(/[\\/]\.git$/i, "");
      const key = process.platform === "win32" ? folder.toLowerCase() : folder;
      if (seen.has(key) || !fs4.existsSync(folder)) continue;
      seen.add(key);
      repos.push(r);
    }
    return repos;
  };
  const addRepo = (slug, repo) => {
    db.prepare("INSERT INTO projects (slug, title, paths) VALUES (?, NULL, '[]') ON CONFLICT(slug) DO NOTHING").run(slug);
    const repos = boardReposOf(slug);
    if (!repos.includes(repo)) repos.push(repo);
    db.prepare("UPDATE projects SET board_repos = ? WHERE slug = ?").run(JSON.stringify(repos), slug);
    return repos;
  };
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending (
      id INTEGER PRIMARY KEY,
      document_id INTEGER NOT NULL,
      label TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL
    )
  `);
  db.exec("DROP TABLE IF EXISTS revisions");
  for (const row of db.prepare("SELECT id, file_path, project FROM documents WHERE kind = 'swarm'").all()) {
    let text = "";
    try {
      text = fs4.readFileSync(toAbs(row.file_path, root), "utf8");
    } catch {
    }
    for (const repo of boardReposInText(text)) addRepo(row.project, repo);
    db.prepare("DELETE FROM pending WHERE document_id = ?").run(row.id);
    db.prepare("DELETE FROM documents WHERE id = ?").run(row.id);
  }
  db.prepare("UPDATE documents SET kind = 'prototype' WHERE kind = 'mockup'").run();
  const parse2 = (row) => ({
    ...row,
    tags: JSON.parse(row.tags),
    pinned: row.pinned === 1,
    abs_path: toAbs(row.file_path, root)
  });
  const parseProject = (row) => ({
    slug: row.slug,
    title: row.title,
    paths: JSON.parse(row.paths)
  });
  const upsertProject = (slug, patch = {}) => {
    const existing = db.prepare("SELECT * FROM projects WHERE slug = ?").get(slug);
    const paths = [.../* @__PURE__ */ new Set([...existing ? JSON.parse(existing.paths) : [], ...patch.addPaths ?? []])];
    const title = patch.title || existing?.title || null;
    db.prepare(
      `INSERT INTO projects (slug, title, paths) VALUES (?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET title = excluded.title, paths = excluded.paths`
    ).run(slug, title, JSON.stringify(paths));
    for (const g of gitDirsOf(JSON.stringify(paths))) addRepo(slug, g);
    return parseProject(db.prepare("SELECT * FROM projects WHERE slug = ?").get(slug));
  };
  const upsertGroup = (slug, title) => {
    db.prepare(
      `INSERT INTO groups (slug, title) VALUES (?, ?)
       ON CONFLICT(slug) DO UPDATE SET title = CASE WHEN excluded.title IS NOT NULL THEN excluded.title ELSE groups.title END`
    ).run(slug, title ?? null);
    return db.prepare("SELECT * FROM groups WHERE slug = ?").get(slug);
  };
  return {
    register(absFile, { kind = "", tags: extraTags = [], started = "", group = "", groupTitle = "", project = "" } = {}) {
      if (!fs4.existsSync(absFile)) throw new Error(`no such file: ${absFile}`);
      const file = toStored(absFile, root);
      const content = isPdf(absFile) ? "" : readDoc(absFile);
      const existing = db.prepare("SELECT * FROM documents WHERE file_path = ?").get(file);
      const finalKind = currentKind(kind || existing?.kind || kindFromName(file));
      if (!finalKind)
        throw new Error(
          "kind is mandatory: name the file <name>.<kind>.md or pass --kind <kind> (e.g. brainstorm, prototype, pr-analysis)"
        );
      const tags = [.../* @__PURE__ */ new Set([...existing ? JSON.parse(existing.tags) : [], ...extraTags])].filter(
        (t2) => t2 !== finalKind
      );
      const t = now();
      const startedAt = started ? new Date(started).toISOString() : existing?.created_at ?? t;
      const groupSlug = group || existing?.group_slug || null;
      if (group) upsertGroup(group, groupTitle || void 0);
      const proj = resolveProject({
        explicit: project,
        absFile,
        docsRoot: DOCS_ROOT,
        existing: existing?.project,
        fallback: projectRoot(absFile)
      });
      upsertProject(proj);
      db.prepare(
        `INSERT INTO documents (file_path, project, title, kind, tags, group_slug, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(file_path) DO UPDATE SET last_seen_at = excluded.last_seen_at, title = excluded.title,
           kind = excluded.kind, tags = excluded.tags, group_slug = excluded.group_slug,
           project = excluded.project, created_at = excluded.created_at`
      ).run(file, proj, titleOf(content, absFile), finalKind, JSON.stringify(tags), groupSlug, startedAt, t);
      return parse2(db.prepare("SELECT * FROM documents WHERE file_path = ?").get(file));
    },
    update(id, patch) {
      const row = db.prepare("SELECT * FROM documents WHERE id = ?").get(Number(id));
      if (!row) return void 0;
      const kind = patch.kind ? currentKind(patch.kind) : row.kind;
      const tags = [
        .../* @__PURE__ */ new Set([...JSON.parse(row.tags), ...patch.addTags ?? []])
      ].filter((t) => t !== kind && !(patch.removeTags ?? []).includes(t));
      const group = patch.group === void 0 ? row.group_slug : patch.group;
      if (patch.group) upsertGroup(patch.group, patch.groupTitle || void 0);
      else if (patch.groupTitle && row.group_slug) upsertGroup(row.group_slug, patch.groupTitle);
      const createdAt = patch.started ? new Date(patch.started).toISOString() : row.created_at;
      db.prepare(
        "UPDATE documents SET kind = ?, tags = ?, group_slug = ?, created_at = ?, last_seen_at = ? WHERE id = ?"
      ).run(kind, JSON.stringify(tags), group, createdAt, now(), row.id);
      return parse2(db.prepare("SELECT * FROM documents WHERE id = ?").get(row.id));
    },
    move(id, newAbs) {
      const row = db.prepare("SELECT * FROM documents WHERE id = ?").get(Number(id));
      if (!row) return void 0;
      const proj = resolveProject({
        absFile: newAbs,
        docsRoot: DOCS_ROOT,
        existing: row.project,
        fallback: projectRoot(newAbs)
      });
      upsertProject(proj);
      db.prepare("UPDATE documents SET file_path = ?, project = ?, last_seen_at = ? WHERE id = ?").run(
        toStored(newAbs, root),
        proj,
        now(),
        row.id
      );
      return parse2(db.prepare("SELECT * FROM documents WHERE id = ?").get(row.id));
    },
    get(id) {
      const row = db.prepare("SELECT * FROM documents WHERE id = ?").get(Number(id));
      return row ? parse2(row) : void 0;
    },
    getByPath(absFile) {
      const row = db.prepare("SELECT * FROM documents WHERE file_path = ?").get(toStored(absFile, root));
      return row ? parse2(row) : void 0;
    },
    all() {
      return db.prepare("SELECT * FROM documents ORDER BY created_at DESC, id DESC").all().map(parse2).map((d) => {
        let stat = null;
        try {
          stat = fs4.statSync(d.abs_path);
        } catch {
          stat = null;
        }
        return {
          ...d,
          exists: stat !== null,
          updated_at: stat ? new Date(stat.mtimeMs).toISOString() : null,
          format: formatOf(d.file_path)
        };
      });
    },
    allGroups() {
      return db.prepare("SELECT * FROM groups ORDER BY slug").all();
    },
    upsertGroup,
    boardRepos(slug) {
      return boardReposOf(slug);
    },
    addBoardRepo(slug, repo) {
      return addRepo(slug, repo);
    },
    allProjects() {
      return db.prepare("SELECT * FROM projects ORDER BY slug").all().map(parseProject);
    },
    upsertProject,
    removeProject(slug) {
      const { n } = db.prepare("SELECT COUNT(*) AS n FROM documents WHERE project = ?").get(slug);
      if (n > 0) return { removed: false, documents: n };
      const info = db.prepare("DELETE FROM projects WHERE slug = ?").run(slug);
      return { removed: info.changes > 0, documents: 0 };
    },
    recentProject() {
      const row = db.prepare("SELECT value FROM state WHERE key = 'active_project'").get();
      if (!row) return null;
      return db.prepare("SELECT 1 FROM projects WHERE slug = ?").get(row.value) ? row.value : null;
    },
    recordRecentProject(slug) {
      db.prepare(
        "INSERT INTO state (key, value) VALUES ('active_project', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      ).run(slug);
    },
    addPending(documentId, label, note = "") {
      const started = (/* @__PURE__ */ new Date()).toISOString();
      db.prepare("INSERT INTO pending (document_id, label, note, started_at) VALUES (?, ?, ?, ?)").run(
        documentId,
        label,
        note,
        started
      );
      return Number(db.prepare("SELECT last_insert_rowid() AS id").get().id);
    },
    donePending(id) {
      const row = db.prepare("SELECT document_id FROM pending WHERE id = ?").get(id);
      if (!row) return null;
      db.prepare("DELETE FROM pending WHERE id = ?").run(id);
      return row.document_id;
    },
    clearPending(documentId) {
      db.prepare("DELETE FROM pending WHERE document_id = ?").run(documentId);
    },
    pendingFor(documentId) {
      return db.prepare("SELECT id, document_id, label, note, started_at FROM pending WHERE document_id = ? ORDER BY id").all(documentId);
    },
    allPending() {
      return db.prepare("SELECT id, document_id, label, note, started_at FROM pending ORDER BY document_id, id").all();
    },
    remove(id) {
      const row = db.prepare("SELECT id FROM documents WHERE id = ?").get(Number(id));
      if (!row) return false;
      db.prepare("DELETE FROM documents WHERE id = ?").run(row.id);
      return true;
    },
    setPinned(id, pinned) {
      return db.prepare("UPDATE documents SET pinned = ? WHERE id = ?").run(pinned ? 1 : 0, Number(id)).changes > 0;
    },
    touch(id) {
      db.prepare("UPDATE documents SET last_seen_at = ? WHERE id = ?").run(now(), id);
    },
    close() {
      db.close();
    }
  };
}
var DatabaseSync, TOOL_ROOT, SQLITE_PATH, STORE_ROOT, now;
var init_db = __esm({
  async "src/core/db.ts"() {
    "use strict";
    init_place();
    init_home();
    init_projects();
    init_paths();
    process.removeAllListeners("warning");
    process.on("warning", (w) => {
      if (w.name !== "ExperimentalWarning") console.warn(w);
    });
    ({ DatabaseSync } = await import("node:sqlite"));
    TOOL_ROOT = findToolRoot();
    SQLITE_PATH = path5.join(DATA_ROOT, "aiview.sqlite");
    STORE_ROOT = DATA_ROOT;
    now = () => (/* @__PURE__ */ new Date()).toISOString();
  }
});

// node_modules/parse5/dist/common/unicode.js
function isSurrogate(cp) {
  return cp >= 55296 && cp <= 57343;
}
function isSurrogatePair(cp) {
  return cp >= 56320 && cp <= 57343;
}
function getSurrogatePairCodePoint(cp1, cp2) {
  return (cp1 - 55296) * 1024 + 9216 + cp2;
}
function isControlCodePoint(cp) {
  return cp !== 32 && cp !== 10 && cp !== 13 && cp !== 9 && cp !== 12 && cp >= 1 && cp <= 31 || cp >= 127 && cp <= 159;
}
function isUndefinedCodePoint(cp) {
  return cp >= 64976 && cp <= 65007 || UNDEFINED_CODE_POINTS.has(cp);
}
var UNDEFINED_CODE_POINTS, REPLACEMENT_CHARACTER, CODE_POINTS, SEQUENCES;
var init_unicode = __esm({
  "node_modules/parse5/dist/common/unicode.js"() {
    UNDEFINED_CODE_POINTS = /* @__PURE__ */ new Set([
      65534,
      65535,
      131070,
      131071,
      196606,
      196607,
      262142,
      262143,
      327678,
      327679,
      393214,
      393215,
      458750,
      458751,
      524286,
      524287,
      589822,
      589823,
      655358,
      655359,
      720894,
      720895,
      786430,
      786431,
      851966,
      851967,
      917502,
      917503,
      983038,
      983039,
      1048574,
      1048575,
      1114110,
      1114111
    ]);
    REPLACEMENT_CHARACTER = "\uFFFD";
    (function(CODE_POINTS2) {
      CODE_POINTS2[CODE_POINTS2["EOF"] = -1] = "EOF";
      CODE_POINTS2[CODE_POINTS2["NULL"] = 0] = "NULL";
      CODE_POINTS2[CODE_POINTS2["TABULATION"] = 9] = "TABULATION";
      CODE_POINTS2[CODE_POINTS2["CARRIAGE_RETURN"] = 13] = "CARRIAGE_RETURN";
      CODE_POINTS2[CODE_POINTS2["LINE_FEED"] = 10] = "LINE_FEED";
      CODE_POINTS2[CODE_POINTS2["FORM_FEED"] = 12] = "FORM_FEED";
      CODE_POINTS2[CODE_POINTS2["SPACE"] = 32] = "SPACE";
      CODE_POINTS2[CODE_POINTS2["EXCLAMATION_MARK"] = 33] = "EXCLAMATION_MARK";
      CODE_POINTS2[CODE_POINTS2["QUOTATION_MARK"] = 34] = "QUOTATION_MARK";
      CODE_POINTS2[CODE_POINTS2["AMPERSAND"] = 38] = "AMPERSAND";
      CODE_POINTS2[CODE_POINTS2["APOSTROPHE"] = 39] = "APOSTROPHE";
      CODE_POINTS2[CODE_POINTS2["HYPHEN_MINUS"] = 45] = "HYPHEN_MINUS";
      CODE_POINTS2[CODE_POINTS2["SOLIDUS"] = 47] = "SOLIDUS";
      CODE_POINTS2[CODE_POINTS2["DIGIT_0"] = 48] = "DIGIT_0";
      CODE_POINTS2[CODE_POINTS2["DIGIT_9"] = 57] = "DIGIT_9";
      CODE_POINTS2[CODE_POINTS2["SEMICOLON"] = 59] = "SEMICOLON";
      CODE_POINTS2[CODE_POINTS2["LESS_THAN_SIGN"] = 60] = "LESS_THAN_SIGN";
      CODE_POINTS2[CODE_POINTS2["EQUALS_SIGN"] = 61] = "EQUALS_SIGN";
      CODE_POINTS2[CODE_POINTS2["GREATER_THAN_SIGN"] = 62] = "GREATER_THAN_SIGN";
      CODE_POINTS2[CODE_POINTS2["QUESTION_MARK"] = 63] = "QUESTION_MARK";
      CODE_POINTS2[CODE_POINTS2["LATIN_CAPITAL_A"] = 65] = "LATIN_CAPITAL_A";
      CODE_POINTS2[CODE_POINTS2["LATIN_CAPITAL_Z"] = 90] = "LATIN_CAPITAL_Z";
      CODE_POINTS2[CODE_POINTS2["RIGHT_SQUARE_BRACKET"] = 93] = "RIGHT_SQUARE_BRACKET";
      CODE_POINTS2[CODE_POINTS2["GRAVE_ACCENT"] = 96] = "GRAVE_ACCENT";
      CODE_POINTS2[CODE_POINTS2["LATIN_SMALL_A"] = 97] = "LATIN_SMALL_A";
      CODE_POINTS2[CODE_POINTS2["LATIN_SMALL_Z"] = 122] = "LATIN_SMALL_Z";
    })(CODE_POINTS || (CODE_POINTS = {}));
    SEQUENCES = {
      DASH_DASH: "--",
      CDATA_START: "[CDATA[",
      DOCTYPE: "doctype",
      SCRIPT: "script",
      PUBLIC: "public",
      SYSTEM: "system"
    };
  }
});

// node_modules/parse5/dist/common/error-codes.js
var ERR;
var init_error_codes = __esm({
  "node_modules/parse5/dist/common/error-codes.js"() {
    (function(ERR2) {
      ERR2["controlCharacterInInputStream"] = "control-character-in-input-stream";
      ERR2["noncharacterInInputStream"] = "noncharacter-in-input-stream";
      ERR2["surrogateInInputStream"] = "surrogate-in-input-stream";
      ERR2["nonVoidHtmlElementStartTagWithTrailingSolidus"] = "non-void-html-element-start-tag-with-trailing-solidus";
      ERR2["endTagWithAttributes"] = "end-tag-with-attributes";
      ERR2["endTagWithTrailingSolidus"] = "end-tag-with-trailing-solidus";
      ERR2["unexpectedSolidusInTag"] = "unexpected-solidus-in-tag";
      ERR2["unexpectedNullCharacter"] = "unexpected-null-character";
      ERR2["unexpectedQuestionMarkInsteadOfTagName"] = "unexpected-question-mark-instead-of-tag-name";
      ERR2["invalidFirstCharacterOfTagName"] = "invalid-first-character-of-tag-name";
      ERR2["unexpectedEqualsSignBeforeAttributeName"] = "unexpected-equals-sign-before-attribute-name";
      ERR2["missingEndTagName"] = "missing-end-tag-name";
      ERR2["unexpectedCharacterInAttributeName"] = "unexpected-character-in-attribute-name";
      ERR2["unknownNamedCharacterReference"] = "unknown-named-character-reference";
      ERR2["missingSemicolonAfterCharacterReference"] = "missing-semicolon-after-character-reference";
      ERR2["unexpectedCharacterAfterDoctypeSystemIdentifier"] = "unexpected-character-after-doctype-system-identifier";
      ERR2["unexpectedCharacterInUnquotedAttributeValue"] = "unexpected-character-in-unquoted-attribute-value";
      ERR2["eofBeforeTagName"] = "eof-before-tag-name";
      ERR2["eofInTag"] = "eof-in-tag";
      ERR2["missingAttributeValue"] = "missing-attribute-value";
      ERR2["missingWhitespaceBetweenAttributes"] = "missing-whitespace-between-attributes";
      ERR2["missingWhitespaceAfterDoctypePublicKeyword"] = "missing-whitespace-after-doctype-public-keyword";
      ERR2["missingWhitespaceBetweenDoctypePublicAndSystemIdentifiers"] = "missing-whitespace-between-doctype-public-and-system-identifiers";
      ERR2["missingWhitespaceAfterDoctypeSystemKeyword"] = "missing-whitespace-after-doctype-system-keyword";
      ERR2["missingQuoteBeforeDoctypePublicIdentifier"] = "missing-quote-before-doctype-public-identifier";
      ERR2["missingQuoteBeforeDoctypeSystemIdentifier"] = "missing-quote-before-doctype-system-identifier";
      ERR2["missingDoctypePublicIdentifier"] = "missing-doctype-public-identifier";
      ERR2["missingDoctypeSystemIdentifier"] = "missing-doctype-system-identifier";
      ERR2["abruptDoctypePublicIdentifier"] = "abrupt-doctype-public-identifier";
      ERR2["abruptDoctypeSystemIdentifier"] = "abrupt-doctype-system-identifier";
      ERR2["cdataInHtmlContent"] = "cdata-in-html-content";
      ERR2["incorrectlyOpenedComment"] = "incorrectly-opened-comment";
      ERR2["eofInScriptHtmlCommentLikeText"] = "eof-in-script-html-comment-like-text";
      ERR2["eofInDoctype"] = "eof-in-doctype";
      ERR2["nestedComment"] = "nested-comment";
      ERR2["abruptClosingOfEmptyComment"] = "abrupt-closing-of-empty-comment";
      ERR2["eofInComment"] = "eof-in-comment";
      ERR2["incorrectlyClosedComment"] = "incorrectly-closed-comment";
      ERR2["eofInCdata"] = "eof-in-cdata";
      ERR2["absenceOfDigitsInNumericCharacterReference"] = "absence-of-digits-in-numeric-character-reference";
      ERR2["nullCharacterReference"] = "null-character-reference";
      ERR2["surrogateCharacterReference"] = "surrogate-character-reference";
      ERR2["characterReferenceOutsideUnicodeRange"] = "character-reference-outside-unicode-range";
      ERR2["controlCharacterReference"] = "control-character-reference";
      ERR2["noncharacterCharacterReference"] = "noncharacter-character-reference";
      ERR2["missingWhitespaceBeforeDoctypeName"] = "missing-whitespace-before-doctype-name";
      ERR2["missingDoctypeName"] = "missing-doctype-name";
      ERR2["invalidCharacterSequenceAfterDoctypeName"] = "invalid-character-sequence-after-doctype-name";
      ERR2["duplicateAttribute"] = "duplicate-attribute";
      ERR2["nonConformingDoctype"] = "non-conforming-doctype";
      ERR2["missingDoctype"] = "missing-doctype";
      ERR2["misplacedDoctype"] = "misplaced-doctype";
      ERR2["endTagWithoutMatchingOpenElement"] = "end-tag-without-matching-open-element";
      ERR2["closingOfElementWithOpenChildElements"] = "closing-of-element-with-open-child-elements";
      ERR2["disallowedContentInNoscriptInHead"] = "disallowed-content-in-noscript-in-head";
      ERR2["openElementsLeftAfterEof"] = "open-elements-left-after-eof";
      ERR2["abandonedHeadElementChild"] = "abandoned-head-element-child";
      ERR2["misplacedStartTagForHeadElement"] = "misplaced-start-tag-for-head-element";
      ERR2["nestedNoscriptInHead"] = "nested-noscript-in-head";
      ERR2["eofInElementThatCanContainOnlyText"] = "eof-in-element-that-can-contain-only-text";
    })(ERR || (ERR = {}));
  }
});

// node_modules/parse5/dist/tokenizer/preprocessor.js
var DEFAULT_BUFFER_WATERLINE, Preprocessor;
var init_preprocessor = __esm({
  "node_modules/parse5/dist/tokenizer/preprocessor.js"() {
    init_unicode();
    init_error_codes();
    DEFAULT_BUFFER_WATERLINE = 1 << 16;
    Preprocessor = class {
      constructor(handler) {
        this.handler = handler;
        this.html = "";
        this.pos = -1;
        this.lastGapPos = -2;
        this.gapStack = [];
        this.skipNextNewLine = false;
        this.lastChunkWritten = false;
        this.endOfChunkHit = false;
        this.bufferWaterline = DEFAULT_BUFFER_WATERLINE;
        this.isEol = false;
        this.lineStartPos = 0;
        this.droppedBufferSize = 0;
        this.line = 1;
        this.lastErrOffset = -1;
      }
      /** The column on the current line. If we just saw a gap (eg. a surrogate pair), return the index before. */
      get col() {
        return this.pos - this.lineStartPos + Number(this.lastGapPos !== this.pos);
      }
      get offset() {
        return this.droppedBufferSize + this.pos;
      }
      getError(code, cpOffset) {
        const { line, col, offset } = this;
        const startCol = col + cpOffset;
        const startOffset = offset + cpOffset;
        return {
          code,
          startLine: line,
          endLine: line,
          startCol,
          endCol: startCol,
          startOffset,
          endOffset: startOffset
        };
      }
      _err(code) {
        if (this.handler.onParseError && this.lastErrOffset !== this.offset) {
          this.lastErrOffset = this.offset;
          this.handler.onParseError(this.getError(code, 0));
        }
      }
      _addGap() {
        this.gapStack.push(this.lastGapPos);
        this.lastGapPos = this.pos;
      }
      _processSurrogate(cp) {
        if (this.pos !== this.html.length - 1) {
          const nextCp = this.html.charCodeAt(this.pos + 1);
          if (isSurrogatePair(nextCp)) {
            this.pos++;
            this._addGap();
            return getSurrogatePairCodePoint(cp, nextCp);
          }
        } else if (!this.lastChunkWritten) {
          this.endOfChunkHit = true;
          return CODE_POINTS.EOF;
        }
        this._err(ERR.surrogateInInputStream);
        return cp;
      }
      willDropParsedChunk() {
        return this.pos > this.bufferWaterline;
      }
      dropParsedChunk() {
        if (this.willDropParsedChunk()) {
          this.html = this.html.substring(this.pos);
          this.lineStartPos -= this.pos;
          this.droppedBufferSize += this.pos;
          this.pos = 0;
          this.lastGapPos = -2;
          this.gapStack.length = 0;
        }
      }
      write(chunk, isLastChunk) {
        if (this.html.length > 0) {
          this.html += chunk;
        } else {
          this.html = chunk;
        }
        this.endOfChunkHit = false;
        this.lastChunkWritten = isLastChunk;
      }
      insertHtmlAtCurrentPos(chunk) {
        this.html = this.html.substring(0, this.pos + 1) + chunk + this.html.substring(this.pos + 1);
        this.endOfChunkHit = false;
      }
      startsWith(pattern, caseSensitive) {
        if (this.pos + pattern.length > this.html.length) {
          this.endOfChunkHit = !this.lastChunkWritten;
          return false;
        }
        if (caseSensitive) {
          return this.html.startsWith(pattern, this.pos);
        }
        for (let i = 0; i < pattern.length; i++) {
          const cp = this.html.charCodeAt(this.pos + i) | 32;
          if (cp !== pattern.charCodeAt(i)) {
            return false;
          }
        }
        return true;
      }
      peek(offset) {
        const pos = this.pos + offset;
        if (pos >= this.html.length) {
          this.endOfChunkHit = !this.lastChunkWritten;
          return CODE_POINTS.EOF;
        }
        const code = this.html.charCodeAt(pos);
        return code === CODE_POINTS.CARRIAGE_RETURN ? CODE_POINTS.LINE_FEED : code;
      }
      advance() {
        this.pos++;
        if (this.isEol) {
          this.isEol = false;
          this.line++;
          this.lineStartPos = this.pos;
        }
        if (this.pos >= this.html.length) {
          this.endOfChunkHit = !this.lastChunkWritten;
          return CODE_POINTS.EOF;
        }
        let cp = this.html.charCodeAt(this.pos);
        if (cp === CODE_POINTS.CARRIAGE_RETURN) {
          this.isEol = true;
          this.skipNextNewLine = true;
          return CODE_POINTS.LINE_FEED;
        }
        if (cp === CODE_POINTS.LINE_FEED) {
          this.isEol = true;
          if (this.skipNextNewLine) {
            this.line--;
            this.skipNextNewLine = false;
            this._addGap();
            return this.advance();
          }
        }
        this.skipNextNewLine = false;
        if (isSurrogate(cp)) {
          cp = this._processSurrogate(cp);
        }
        const isCommonValidRange = this.handler.onParseError === null || cp > 31 && cp < 127 || cp === CODE_POINTS.LINE_FEED || cp === CODE_POINTS.CARRIAGE_RETURN || cp > 159 && cp < 64976;
        if (!isCommonValidRange) {
          this._checkForProblematicCharacters(cp);
        }
        return cp;
      }
      _checkForProblematicCharacters(cp) {
        if (isControlCodePoint(cp)) {
          this._err(ERR.controlCharacterInInputStream);
        } else if (isUndefinedCodePoint(cp)) {
          this._err(ERR.noncharacterInInputStream);
        }
      }
      retreat(count) {
        this.pos -= count;
        while (this.pos < this.lastGapPos) {
          this.lastGapPos = this.gapStack.pop();
          this.pos--;
        }
        this.isEol = false;
      }
    };
  }
});

// node_modules/parse5/dist/common/token.js
function getTokenAttr(token, attrName) {
  for (let i = token.attrs.length - 1; i >= 0; i--) {
    if (token.attrs[i].name === attrName) {
      return token.attrs[i].value;
    }
  }
  return null;
}
var TokenType;
var init_token = __esm({
  "node_modules/parse5/dist/common/token.js"() {
    (function(TokenType2) {
      TokenType2[TokenType2["CHARACTER"] = 0] = "CHARACTER";
      TokenType2[TokenType2["NULL_CHARACTER"] = 1] = "NULL_CHARACTER";
      TokenType2[TokenType2["WHITESPACE_CHARACTER"] = 2] = "WHITESPACE_CHARACTER";
      TokenType2[TokenType2["START_TAG"] = 3] = "START_TAG";
      TokenType2[TokenType2["END_TAG"] = 4] = "END_TAG";
      TokenType2[TokenType2["COMMENT"] = 5] = "COMMENT";
      TokenType2[TokenType2["DOCTYPE"] = 6] = "DOCTYPE";
      TokenType2[TokenType2["EOF"] = 7] = "EOF";
      TokenType2[TokenType2["HIBERNATION"] = 8] = "HIBERNATION";
    })(TokenType || (TokenType = {}));
  }
});

// node_modules/entities/dist/decode-codepoint.js
function replaceCodePoint(codePoint) {
  if (codePoint >= 55296 && codePoint <= 57343 || codePoint > 1114111) {
    return 65533;
  }
  return decodeMap.get(codePoint) ?? codePoint;
}
var decodeMap;
var init_decode_codepoint = __esm({
  "node_modules/entities/dist/decode-codepoint.js"() {
    decodeMap = /* @__PURE__ */ new Map([
      [0, 65533],
      // C1 Unicode control character reference replacements
      [128, 8364],
      [130, 8218],
      [131, 402],
      [132, 8222],
      [133, 8230],
      [134, 8224],
      [135, 8225],
      [136, 710],
      [137, 8240],
      [138, 352],
      [139, 8249],
      [140, 338],
      [142, 381],
      [145, 8216],
      [146, 8217],
      [147, 8220],
      [148, 8221],
      [149, 8226],
      [150, 8211],
      [151, 8212],
      [152, 732],
      [153, 8482],
      [154, 353],
      [155, 8250],
      [156, 339],
      [158, 382],
      [159, 376]
    ]);
  }
});

// node_modules/entities/dist/internal/decode-shared.js
function decodeBase64(input) {
  const binary = atob(input);
  const evenLength = binary.length & ~1;
  const out = new Uint16Array(evenLength / 2);
  for (let index = 0, outIndex = 0; index < evenLength; index += 2) {
    const lo = binary.charCodeAt(index);
    const hi = binary.charCodeAt(index + 1);
    out[outIndex++] = lo | hi << 8;
  }
  return out;
}
var init_decode_shared = __esm({
  "node_modules/entities/dist/internal/decode-shared.js"() {
  }
});

// node_modules/entities/dist/generated/decode-data-html.js
var htmlDecodeTree;
var init_decode_data_html = __esm({
  "node_modules/entities/dist/generated/decode-data-html.js"() {
    init_decode_shared();
    htmlDecodeTree = /* @__PURE__ */ decodeBase64("QR08ALkAAgH6AYsDNQR2BO0EPgXZBQEGLAbdBxMISQrvCmQLfQurDKQNLw4fD4YPpA+6D/IPAAAAAAAAAAAAAAAAKhBMEY8TmxUWF2EYLBkxGuAa3RsJHDscWR8YIC8jSCSIJcMl6ie3Ku8rEC0CLjoupS7kLgAIRU1hYmNmZ2xtbm9wcnN0dVQAWgBeAGUAaQBzAHcAfgCBAIQAhwCSAJoAoACsALMAbABpAGcAO4DGAMZAUAA7gCYAJkBjAHUAdABlADuAwQDBQHIiZXZlAAJhAAFpeW0AcgByAGMAO4DCAMJAEGRyAADgNdgE3XIAYQB2AGUAO4DAAMBA8CFoYZFj4SFjcgBhZAAAoFMqAAFncIsAjgBvAG4ABGFmAADgNdg43fAlbHlGdW5jdGlvbgCgYSBpAG4AZwA7gMUAxUAAAWNzpACoAHIAAOA12Jzc6SFnbgCgVCJpAGwAZABlADuAwwDDQG0AbAA7gMQAxEAABGFjZWZvcnN1xQDYANoA7QDxAPYA+QD8AAABY3LJAM8AayNzbGFzaAAAoBYidgHTANUAAKDnKmUAZAAAoAYjeQARZIABY3J0AOAA5QDrAGEidXNlAACgNSLuI291bGxpcwCgLCFhAJJjcgAA4DXYBd1wAGYAAOA12Dnd5SF2ZdhiYwDyAOoAbSJwZXEAAKBOIgAHSE9hY2RlZmhpbG9yc3UXARoBHwE6AVIBVQFiAWQBZgGCAakB6QHtAfIBYwB5ACdkUABZADuAqQCpQIABY3B5ACUBKAE1AfUhdGUGYWmg0iJ0KGFsRGlmZmVyZW50aWFsRAAAoEUhbCJleXMAAKAtIQACYWVpb0EBRAFKAU0B8iFvbgxhZABpAGwAO4DHAMdAcgBjAAhhbiJpbnQAAKAwIm8AdAAKYQABZG5ZAV0BaSJsbGEAuGB0I2VyRG90ALdg8gA5AWkAp2NyImNsZQAAAkRNUFRwAXQBeQF9AW8AdAAAoJkiaSJudXMAAKCWIuwhdXMAoJUiaSJtZXMAAKCXIm8AAAFjc4cBlAFrKndpc2VDb250b3VySW50ZWdyYWwAAKAyImUjQ3VybHkAAAFEUZwBpAFvJXVibGVRdW90ZQAAoB0gdSJvdGUAAKAZIAACbG5wdbABtgHNAdgBbwBuAGWgNyIAoHQqgAFnaXQAvAHBAcUB8iJ1ZW50AKBhIm4AdAAAoC8i7yV1ckludGVncmFsAKAuIgABZnLRAdMBAKACIe8iZHVjdACgECJuLnRlckNsb2Nrd2lzZUNvbnRvdXJJbnRlZ3JhbAAAoDMi7yFzcwCgLypjAHIAAOA12J7ccABDoNMiYQBwAACgTSKABURKU1phY2VmaW9zAAsCEgIVAhgCGwIsAjQCOQI9AnMCfwNvoEUh9CJyYWhkAKARKWMAeQACZGMAeQAFZGMAeQAPZIABZ3JzACECJQIoAuchZXIAoCEgcgAAoKEhaAB2AACg5CoAAWF5MAIzAvIhb24OYRRkbAB0oAciYQCUY3IAAOA12AfdAAFhZkECawIAAWNtRQJnAvIjaXRpY2FsAAJBREdUUAJUAl8CYwJjInV0ZQC0YG8AdAFZAloC2WJiJGxlQWN1dGUA3WJyImF2ZQBgYGkibGRlANxi7yFuZACgxCJmJWVyZW50aWFsRAAAoEYhcAR9AgAAAAAAAIECjgIAABoDZgAA4DXYO91EoagAhQKJAm8AdAAAoNwgcSJ1YWwAAKBQIuIhbGUAA0NETFJVVpkCqAK1Au8C/wIRA28AbgB0AG8AdQByAEkAbgB0AGUAZwByAGEA7ADEAW8AdAKvAgAAAACwAqhgbiNBcnJvdwAAoNMhAAFlb7kC0AJmAHQAgAFBUlQAwQLGAs0CciJyb3cAAKDQIekkZ2h0QXJyb3cAoNQhZQDlACsCbgBnAAABTFLWAugC5SFmdAABQVLcAuECciJyb3cAAKD4J+kkZ2h0QXJyb3cAoPon6SRnaHRBcnJvdwCg+SdpImdodAAAAUFU9gL7AnIicm93AACg0iFlAGUAAKCoInAAQQIGAwAAAAALA3Iicm93AACg0SFvJHduQXJyb3cAAKDVIWUlcnRpY2FsQmFyAACgJSJuAAADQUJMUlRhJAM2AzoDWgNxA3oDciJyb3cAAKGTIUJVLAMwA2EAcgAAoBMpcCNBcnJvdwAAoPUhciJldmUAEWPlIWZ00gJDAwAASwMAAFIDaSVnaHRWZWN0b3IAAKBQKWUkZVZlY3RvcgAAoF4p5SJjdG9yQqC9IWEAcgAAoFYpaSJnaHQA1AFiAwAAaQNlJGVWZWN0b3IAAKBfKeUiY3RvckKgwSFhAHIAAKBXKWUAZQBBoKQiciJyb3cAAKCnIXIAcgBvAPcAtAIAAWN0gwOHA3IA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YwAAoN8i4SFycnCgtiEAoD0pgKIqImJjZG9zACsVMBU6FT4VQRVyImNhcAAAoEgqAAFhdTQVNxVwAACgRipwAACgSipvAHQAAKCNInIAAKBFKgDgKiIA/gACYWxydksVURVuFXMVcgByAG2gtyEAoDwpeQCAAWV2dwBYFWUVaRVxAHACXxUAAAAAYxVyAGUA4wAXFXUA4wAZFWUAZQAAoM4iZSJkZ2UAAKDPImUAbgA7gKQApEBlI2Fycm93AAABbHJ7FX8V5SFmdACgtiFpImdodAAAoLchZQDkAG0VAAFjaYsVkRVvAG4AaQBuAPQAkwFuAHQAAKAxImwiY3R5AACgLSOACUFIYWJjZGVmaGlqbG9yc3R1d3oAuBW7Fb8V1RXgFegV+RUKFhUWHxZUFlcWZRbFFtsW7xb7FgUXChdyAPIAtAJhAHIAAKBlKQACZ2xyc8YVyhXOFdAV5yFlcgCgICDlIXRoAKA4IfIA9QxoAHagECAAoKMiawHZFd4VYSJyb3cAAKAPKWEA4wBfAgABYXnkFecV8iFvbg9hNGQAoUYhYW/tFfQVAAFnciEC8RVyAACgyiF0InNlcQAAoHcqgAFnbG0A/xUCFgUWO4CwALBAdABhALRjcCJ0eXYAAKCxKQABaXIOFhIW8yFodACgfykA4DXYId1hAHIAAAFschsWHRYAoMMhAKDCIYACYWVnc3YAKBauAjYWOhY+Fm0AAKHEIm9zLhY0Fm4AZABzoMQi9SFpdACgZiZhIm1tYQDdY2kAbgAAoPIiAKH3AGlvQxZRFmQAZQAAgfcAO29KFksW90BuI3RpbWVzAACgxyJuAPgAUBZjAHkAUmRjAG8CXhYAAAAAYhZyAG4AAKAeI28AcAAAoA0jgAJscHR1dwBuFnEWdRaSFp4W7CFhciRgZgAA4DXYVd0AotkCZW1wc30WhBaJFo0WcQBkoFAibwB0AACgUSJpIm51cwAAoDgi7CF1cwCgFCLxInVhcmUAoKEiYgBsAGUAYgBhAHIAdwBlAGQAZwDlANcAbgCAAWFkaAClFqoWtBZyAHIAbwD3APUMbwB3AG4AYQByAHIAbwB3APMA8xVhI3Jwb29uAAABbHK8FsAWZQBmAPQAHBZpAGcAaAD0AB4WYgHJFs8WawBhAHIAbwD3AJILbwLUFgAAAADYFnIAbgAAoB8jbwBwAACgDCOAAWNvdADhFukW7BYAAXJ55RboFgDgNdi53FVkbAAAoPYp8iFvaxFhAAFkcvMW9xZvAHQAAKDxImkA5qC/JVsSAAFhaP8WAhdyAPIANQNhAPIA1wvhIm5nbGUAoKYpAAFjaQ4XEBd5AF9k5yJyYXJyAKD/JwAJRGFjZGVmZ2xtbm9wcXJzdHV4MRc4F0YXWxcyBF4XaRd5F40XrBe0F78X2RcVGCEYLRg1GEAYAAFEbzUXgRZvAPQA+BUAAWNzPBdCF3UAdABlADuA6QDpQPQhZXIAoG4qAAJhaW95TRdQF1YXWhfyIW9uG2FyAGOgViI7gOoA6kDsIW9uAKBVIk1kbwB0ABdhAAFEcmIXZhdvAHQAAKBSIgDgNdgi3XKhmipuF3QXYQB2AGUAO4DoAOhAZKCWKm8AdAAAoJgqgKGZKmlscwCAF4UXhxfuInRlcnMAoOcjAKATIWSglSpvAHQAAKCXKoABYXBzAJMXlheiF2MAcgATYXQAeQBzogUinxcAAAAAoRdlAHQAAKAFInAAMaADIDMBqRerFwCgBCAAoAUgAAFnc7AXsRdLYXAAAKACIAABZ3C4F7sXbwBuABlhZgAA4DXYVt2AAWFscwDFF8sXzxdyAHOg1SJsAACg4yl1AHMAAKBxKmkAAKG1A2x21RfYF28AbgC1Y/VjAAJjc3V24BfoF/0XEBgAAWlv5BdWF3IAYwAAoFYiaQLuFwAAAADwF+0ADQThIW50AAFnbPUX+Rd0AHIAAKCWKuUhc3MAoJUqgAFhZWkAAxgGGAoYbABzAD1gcwB0AACgXyJ2AESgYSJEAACgeCrwImFyc2wAoOUpAAFEYRkYHRhvAHQAAKBTInIAcgAAoHEpgAFjZGkAJxgqGO0XcgAAoC8hbwD0AIwCAAFhaDEYMhi3YzuA8ADwQAABbXI5GD0YbAA7gOsA60BvAACgrCCAAWNpcABGGEgYSxhsACFgcwD0ACwEAAFlb08YVxhjAHQAYQB0AGkAbwDuABoEbgBlAG4AdABpAGEAbADlADME4Ql1GAAAgRgAAIMYiBgAAAAAoRilGAAAqhgAALsYvhjRGAAA1xgnGWwAbABpAG4AZwBkAG8AdABzAGUA8QBlF3kARGRtImFsZQAAoEAmgAFpbHIAjRiRGJ0Y7CFpZwCgA/tpApcYAAAAAJoYZwAAoAD7aQBnAACgBPsA4DXYI93sIWlnAKAB++whaWcA4GYAagCAAWFsdACvGLIYthh0AACgbSZpAGcAAKAC+24AcwAAoLElbwBmAJJh8AHCGAAAxhhmAADgNdhX3QABYWvJGMwYbADsAGsEdqDUIgCg2SphI3J0aW50AACgDSoAAWFv2hgiGQABY3PeGB8ZsQPnGP0YBRkSGRUZAAAdGbID7xjyGPQY9xj5GAAA+xg7gL0AvUAAoFMhO4C8ALxAAKBVIQCgWSEAoFshswEBGQAAAxkAoFQhAKBWIbQCCxkOGQAAAAAQGTuAvgC+QACgVyEAoFwhNQAAoFghtgEZGQAAGxkAoFohAKBdITgAAKBeIWwAAKBEIHcAbgAAoCIjYwByAADgNdi73IAIRWFiY2RlZmdpamxub3JzdHYARhlKGVoZXhlmGWkZkhmWGZkZnRmgGa0ZxhnLGc8Z4BkjGmygZyIAoIwqgAFjbXAAUBlTGVgZ9SF0ZfVhbQBhAOSgswM6FgCghipyImV2ZQAfYQABaXliGWUZcgBjAB1hM2RvAHQAIWGAoWUibHFzAMYEcBl6GfGhZSLOBAAAdhlsAGEAbgD0AN8EgKF+KmNkbACBGYQZjBljAACgqSpvAHQAb6CAKmyggioAoIQqZeDbIgD+cwAAoJQqcgAA4DXYJN3noGsirATtIWVsAKA3IWMAeQBTZIChdyJFYWoApxmpGasZAKCSKgCgpSoAoKQqAAJFYWVztBm2Gb0ZwhkAoGkicABwoIoq8iFveACgiipxoIgq8aCIKrUZaQBtAACg5yJwAGYAAOA12FjdYQB2AOUAYwIAAWNp0xnWGXIAAKAKIW0AAKFzImVs3BneGQCgjioAoJAqAIM+ADtjZGxxco0E6xn0GfgZ/BkBGgABY2nvGfEZAKCnKnIAAKB6Km8AdAAAoNci0CFhcgCglSl1ImVzdAAAoHwqgAJhZGVscwAKGvQZFhrVBCAa8AEPGgAAFBpwAHIAbwD4AFkZcgAAoHgpcQAAAWxxxAQbGmwAZQBzAPMASRlpAO0A5AQAAWVuJxouGnIjdG5lcXEAAOBpIgD+xQAsGgAFQWFiY2Vma29zeUAaQxpmGmoabRqDGocalhrCGtMacgDyAMwCAAJpbG1yShpOGlAaVBpyAHMA8ABxD2YAvWBpAGwA9AASBQABZHJYGlsaYwB5AEpkAKGUIWN3YBpkGmkAcgAAoEgpAKCtIWEAcgAAoA8h6SFyYyVhgAFhbHIAcxp7Gn8a8iF0c3WgZSZpAHQAAKBlJuwhaXAAoCYg4yFvbgCguSJyAADgNdgl3XMAAAFld4wakRphInJvdwAAoCUpYSJyb3cAAKAmKYACYW1vcHIAnxqjGqcauhq+GnIAcgAAoP8h9CFodACgOyJrAAABbHKsGrMaZSRmdGFycm93AACgqSHpJGdodGFycm93AKCqIWYAAOA12Fnd4iFhcgCgFSCAAWNsdADIGswa0BpyAADgNdi93GEAcwDoAGka8iFvaydhAAFicNca2xr1IWxsAKBDIOghZW4AoBAg4Qr2GgAA/RoAAAgbExsaGwAAIRs7GwAAAAA+G2IbmRuVG6sbAACyG80b0htjAHUAdABlADuA7QDtQAChYyBpeQEbBhtyAGMAO4DuAO5AOGQAAWN4CxsNG3kANWRjAGwAO4ChAKFAAAFmcssCFhsA4DXYJt1yAGEAdgBlADuA7ADsQIChSCFpbm8AJxsyGzYbAAFpbisbLxtuAHQAAKAMKnQAAKAtIuYhaW4AoNwpdABhAACgKSHsIWlnM2GAAWFvcABDG1sbXhuAAWNndABJG0sbWRtyACthgAFlbHAAcQVRG1UbaQBuAOUAyAVhAHIA9AByBWgAMWFmAACgtyJlAGQAtWEAoggiY2ZvdGkbbRt1G3kb4SFyZQCgBSFpAG4AdKAeImkAZQAAoN0pZABvAPQAWxsAoisiY2VscIEbhRuPG5QbYQBsAACguiIAAWdyiRuNG2UAcgDzACMQ4wCCG2EicmhrAACgFyryIW9kAKA8KgACY2dwdJ8boRukG6gbeQBRZG8AbgAvYWYAAOA12FrdYQC5Y3UAZQBzAHQAO4C/AL9AAAFjabUbuRtyAADgNdi+3G4AAKIIIkVkc3bCG8QbyBvQAwCg+SJvAHQAAKD1Inag9CIAoPMiaaBiIOwhZGUpYesB1hsAANkbYwB5AFZkbAA7gO8A70AAA2NmbW9zdeYb7hvyG/Ub+hsFHAABaXnqG+0bcgBjADVhOWRyAADgNdgn3eEhdGg3YnAAZgAA4DXYW93jAf8bAAADHHIAAOA12L/c8iFjeVhk6yFjeVRkAARhY2ZnaGpvcxUcGhwiHCYcKhwtHDAcNRzwIXBhdqC6A/BjAAFleR4cIRzkIWls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ZmdobG1vcHJzdHV3CiwNLBEsHSwnLDEsQCxLLFIsYix6LIQsjyzLLOgs7Sz/LAotcgDyAAkDYQByAACgYykAAWNyFSwbLHUAdABlADuA+gD6QPIACQ1yAOMBIywAACUseQBeZHYAZQBtYQABaXkrLDAscgBjADuA+wD7QENkgAFhYmgANyw6LD0scgDyANEO7CFhY3FhYQDyAOAOAAFpckQsSCzzIWh0AKB+KQDgNdgy3XIAYQB2AGUAO4D5APlAYQFWLF8scgAAAWxyWixcLACgvyEAoL4hbABrAACggCUAAWN0Zix2LG8CbCwAAAAAcyxyAG4AZaAcI3IAAKAcI28AcAAAoA8jcgBpAACg+CUAAWFsfiyBLGMAcgBrYTuAqACoQAABZ3CILIssbwBuAHNhZgAA4DXYZt0AA2FkaGxzdZksniynLLgsuyzFLHIAcgBvAPcACQ1vAHcAbgBhAHIAcgBvAPcA2A5hI3Jwb29uAAABbHKvLLMsZQBmAPQAWyxpAGcAaAD0AF0sdQDzAKYOaQAAocUDaGzBLMIs0mNvAG4AxWPwI2Fycm93cwCgyCGAAWNpdADRLOEs5CxvAtcsAAAAAN4scgBuAGWgHSNyAACgHSNvAHAAAKAOI24AZwBvYXIAaQAAoPklYwByAADgNdjK3IABZGlyAPMs9yz6LG8AdAAAoPAi7CFkZWlhaQBmoLUlAKC0JQABYW0DLQYtcgDyAMosbAA7gPwA/EDhIm5nbGUAoKcpgAdBQkRhY2RlZmxub3Byc3oAJy0qLTAtNC2bLZ0toS2/LcMtxy3TLdgt3C3gLfwtcgDyABADYQByAHag6CoAoOkqYQBzAOgA/gIAAW5yOC08LechcnQAoJwpgANla25wcnN0AJkpSC1NLVQtXi1iLYItYQBwAHAA4QAaHG8AdABoAGkAbgDnAKEXgAFoaXIAoSmzJFotbwBwAPQAdCVooJUh7wD4JgABaXVmLWotZwBtAOEAuygAAWJwbi14LXMjZXRuZXEAceCKIgD+AODLKgD+cyNldG5lcQBx4IsiAP4A4MwqAP4AAWhyhi2KLWUAdADhABIraSNhbmdsZQAAAWxyki2WLeUhZnQAoLIiaSJnaHQAAKCzInkAMmThIXNoAKCiIoABZWxyAKcttC24LWKiKCKuLQAAAACyLWEAcgAAoLsicQAAoFoi7CFpcACg7iIAAWJ0vC1eD2EA8gBfD3IAAOA12DPddAByAOkAlS1zAHUAAAFicM0t0C0A4IIi0iAA4IMi0iBwAGYAAOA12GfdcgBvAPAAWQt0AHIA6QCaLQABY3XkLegtcgAA4DXYy9wAAWJw7C30LW4AAAFFZXUt8S0A4IoiAP5uAAABRWV/LfktAOCLIgD+6SJnemFnAKCaKYADY2Vmb3BycwANLhAuJS4pLiMuLi40LukhcmN1YQABZGkULiEuAAFiZxguHC5hAHIAAKBfKmUAcaAnIgCgWSLlIXJwAKAYIXIAAOA12DTdcABmAADgNdho3WWgQCJhAHQA6ABqD2MAcgAA4DXYzNzjCuQRUC4AAFQuAABYLmIuAAAAAGMubS5wLnQuAAAAAIguki4AAJouJxIqEnQAcgDpAB0ScgAA4DXYNd0AAUFhWy5eLnIA8gDnAnIA8gCTB75jAAFBYWYuaS5yAPIA4AJyAPIAjAdhAPAAeh5pAHMAAKD7IoABZHB0APgReS6DLgABZmx9LoAuAOA12GnddQDzAP8RaQBtAOUABBIAAUFhiy6OLnIA8gDuAnIA8gCaBwABY3GVLgoScgAA4DXYzdwAAXB0nS6hLmwAdQDzACUScgDpACASAARhY2VmaW9zdbEuvC7ELsguzC7PLtQu2S5jAAABdXm2LrsudABlADuA/QD9QE9kAAFpecAuwy5yAGMAd2FLZG4AO4ClAKVAcgAA4DXYNt1jAHkAV2RwAGYAAOA12GrdYwByAADgNdjO3AABY23dLt8ueQBOZGwAO4D/AP9AAAVhY2RlZmhpb3N38y73Lv8uAi8MLxAvEy8YLx0vIi9jInV0ZQB6YQABYXn7Lv4u8iFvbn5hN2RvAHQAfGEAAWV0Bi8KL3QAcgDmAB8QYQC2Y3IAAOA12DfdYwB5ADZk5yJyYXJyAKDdIXAAZgAA4DXYa91jAHIAAOA12M/cAAFqbiYvKC8AoA0gagAAoAwg");
  }
});

// node_modules/entities/dist/internal/bin-trie-flags.js
var BinTrieFlags;
var init_bin_trie_flags = __esm({
  "node_modules/entities/dist/internal/bin-trie-flags.js"() {
    (function(BinTrieFlags2) {
      BinTrieFlags2[BinTrieFlags2["VALUE_LENGTH"] = 49152] = "VALUE_LENGTH";
      BinTrieFlags2[BinTrieFlags2["FLAG13"] = 8192] = "FLAG13";
      BinTrieFlags2[BinTrieFlags2["BRANCH_LENGTH"] = 8064] = "BRANCH_LENGTH";
      BinTrieFlags2[BinTrieFlags2["JUMP_TABLE"] = 127] = "JUMP_TABLE";
    })(BinTrieFlags || (BinTrieFlags = {}));
  }
});

// node_modules/entities/dist/decode.js
function isNumber(code) {
  return code >= CharCodes.ZERO && code <= CharCodes.NINE;
}
function isHexadecimalCharacter(code) {
  return code >= CharCodes.UPPER_A && code <= CharCodes.UPPER_F || code >= CharCodes.LOWER_A && code <= CharCodes.LOWER_F;
}
function isAsciiAlphaNumeric(code) {
  return code >= CharCodes.UPPER_A && code <= CharCodes.UPPER_Z || code >= CharCodes.LOWER_A && code <= CharCodes.LOWER_Z || isNumber(code);
}
function isEntityInAttributeInvalidEnd(code) {
  return code === CharCodes.EQUALS || isAsciiAlphaNumeric(code);
}
function determineBranch(decodeTree, current, nodeIndex, char) {
  const branchCount = (current & BinTrieFlags.BRANCH_LENGTH) >> 7;
  const jumpOffset = current & BinTrieFlags.JUMP_TABLE;
  if (branchCount === 0) {
    return jumpOffset !== 0 && char === jumpOffset ? nodeIndex : -1;
  }
  if (jumpOffset) {
    const value = char - jumpOffset;
    return value < 0 || value >= branchCount ? -1 : decodeTree[nodeIndex + value] - 1;
  }
  const packedKeySlots = branchCount + 1 >> 1;
  let lo = 0;
  let hi = branchCount - 1;
  while (lo <= hi) {
    const mid = lo + hi >>> 1;
    const slot = mid >> 1;
    const packed = decodeTree[nodeIndex + slot];
    const midKey = packed >> (mid & 1) * 8 & 255;
    if (midKey < char) {
      lo = mid + 1;
    } else if (midKey > char) {
      hi = mid - 1;
    } else {
      return decodeTree[nodeIndex + packedKeySlots + mid];
    }
  }
  return -1;
}
var CharCodes, TO_LOWER_BIT, EntityDecoderState, DecodingMode, EntityDecoder;
var init_decode = __esm({
  "node_modules/entities/dist/decode.js"() {
    init_decode_codepoint();
    init_bin_trie_flags();
    init_decode_data_html();
    (function(CharCodes2) {
      CharCodes2[CharCodes2["NUM"] = 35] = "NUM";
      CharCodes2[CharCodes2["SEMI"] = 59] = "SEMI";
      CharCodes2[CharCodes2["EQUALS"] = 61] = "EQUALS";
      CharCodes2[CharCodes2["ZERO"] = 48] = "ZERO";
      CharCodes2[CharCodes2["NINE"] = 57] = "NINE";
      CharCodes2[CharCodes2["LOWER_A"] = 97] = "LOWER_A";
      CharCodes2[CharCodes2["LOWER_F"] = 102] = "LOWER_F";
      CharCodes2[CharCodes2["LOWER_X"] = 120] = "LOWER_X";
      CharCodes2[CharCodes2["LOWER_Z"] = 122] = "LOWER_Z";
      CharCodes2[CharCodes2["UPPER_A"] = 65] = "UPPER_A";
      CharCodes2[CharCodes2["UPPER_F"] = 70] = "UPPER_F";
      CharCodes2[CharCodes2["UPPER_Z"] = 90] = "UPPER_Z";
    })(CharCodes || (CharCodes = {}));
    TO_LOWER_BIT = 32;
    (function(EntityDecoderState2) {
      EntityDecoderState2[EntityDecoderState2["EntityStart"] = 0] = "EntityStart";
      EntityDecoderState2[EntityDecoderState2["NumericStart"] = 1] = "NumericStart";
      EntityDecoderState2[EntityDecoderState2["NumericDecimal"] = 2] = "NumericDecimal";
      EntityDecoderState2[EntityDecoderState2["NumericHex"] = 3] = "NumericHex";
      EntityDecoderState2[EntityDecoderState2["NamedEntity"] = 4] = "NamedEntity";
    })(EntityDecoderState || (EntityDecoderState = {}));
    (function(DecodingMode2) {
      DecodingMode2[DecodingMode2["Legacy"] = 0] = "Legacy";
      DecodingMode2[DecodingMode2["Strict"] = 1] = "Strict";
      DecodingMode2[DecodingMode2["Attribute"] = 2] = "Attribute";
    })(DecodingMode || (DecodingMode = {}));
    EntityDecoder = class {
      decodeTree;
      emitCodePoint;
      errors;
      constructor(decodeTree, emitCodePoint, errors) {
        this.decodeTree = decodeTree;
        this.emitCodePoint = emitCodePoint;
        this.errors = errors;
      }
      /** The current state of the decoder. */
      state = EntityDecoderState.EntityStart;
      /** Characters that were consumed while parsing an entity. */
      consumed = 1;
      /**
       * The result of the entity.
       *
       * Either the result index of a numeric entity, or the codepoint of a
       * numeric entity.
       */
      result = 0;
      /** The current index in the decode tree. */
      treeIndex = 0;
      /** The number of characters that were consumed in excess. */
      excess = 1;
      /** The mode in which the decoder is operating. */
      decodeMode = DecodingMode.Strict;
      /** The number of characters that have been consumed in the current run. */
      runConsumed = 0;
      /**
       * Resets the instance to make it reusable.
       * @param decodeMode Entity decoding mode to use.
       */
      startEntity(decodeMode) {
        this.decodeMode = decodeMode;
        this.state = EntityDecoderState.EntityStart;
        this.result = 0;
        this.treeIndex = 0;
        this.excess = 1;
        this.consumed = 1;
        this.runConsumed = 0;
      }
      /**
       * Write an entity to the decoder. This can be called multiple times with partial entities.
       * If the entity is incomplete, the decoder will return -1.
       *
       * Mirrors the implementation of `getDecoder`, but with the ability to stop decoding if the
       * entity is incomplete, and resume when the next string is written.
       * @param input The string containing the entity (or a continuation of the entity).
       * @param offset The offset at which the entity begins. Should be 0 if this is not the first call.
       * @returns The number of characters that were consumed, or -1 if the entity is incomplete.
       */
      write(input, offset) {
        switch (this.state) {
          case EntityDecoderState.EntityStart: {
            if (input.charCodeAt(offset) === CharCodes.NUM) {
              this.state = EntityDecoderState.NumericStart;
              this.consumed += 1;
              return this.stateNumericStart(input, offset + 1);
            }
            this.state = EntityDecoderState.NamedEntity;
            return this.stateNamedEntity(input, offset);
          }
          case EntityDecoderState.NumericStart: {
            return this.stateNumericStart(input, offset);
          }
          case EntityDecoderState.NumericDecimal: {
            return this.stateNumericDecimal(input, offset);
          }
          case EntityDecoderState.NumericHex: {
            return this.stateNumericHex(input, offset);
          }
          case EntityDecoderState.NamedEntity: {
            return this.stateNamedEntity(input, offset);
          }
        }
      }
      /**
       * Switches between the numeric decimal and hexadecimal states.
       *
       * Equivalent to the `Numeric character reference state` in the HTML spec.
       * @param input The string containing the entity (or a continuation of the entity).
       * @param offset The current offset.
       * @returns The number of characters that were consumed, or -1 if the entity is incomplete.
       */
      stateNumericStart(input, offset) {
        if (offset >= input.length) {
          return -1;
        }
        if ((input.charCodeAt(offset) | TO_LOWER_BIT) === CharCodes.LOWER_X) {
          this.state = EntityDecoderState.NumericHex;
          this.consumed += 1;
          return this.stateNumericHex(input, offset + 1);
        }
        this.state = EntityDecoderState.NumericDecimal;
        return this.stateNumericDecimal(input, offset);
      }
      /**
       * Parses a hexadecimal numeric entity.
       *
       * Equivalent to the `Hexademical character reference state` in the HTML spec.
       * @param input The string containing the entity (or a continuation of the entity).
       * @param offset The current offset.
       * @returns The number of characters that were consumed, or -1 if the entity is incomplete.
       */
      stateNumericHex(input, offset) {
        while (offset < input.length) {
          const char = input.charCodeAt(offset);
          if (isNumber(char) || isHexadecimalCharacter(char)) {
            const digit = char <= CharCodes.NINE ? char - CharCodes.ZERO : (char | TO_LOWER_BIT) - CharCodes.LOWER_A + 10;
            this.result = this.result * 16 + digit;
            this.consumed++;
            offset++;
          } else {
            return this.emitNumericEntity(char, 3);
          }
        }
        return -1;
      }
      /**
       * Parses a decimal numeric entity.
       *
       * Equivalent to the `Decimal character reference state` in the HTML spec.
       * @param input The string containing the entity (or a continuation of the entity).
       * @param offset The current offset.
       * @returns The number of characters that were consumed, or -1 if the entity is incomplete.
       */
      stateNumericDecimal(input, offset) {
        while (offset < input.length) {
          const char = input.charCodeAt(offset);
          if (isNumber(char)) {
            this.result = this.result * 10 + (char - CharCodes.ZERO);
            this.consumed++;
            offset++;
          } else {
            return this.emitNumericEntity(char, 2);
          }
        }
        return -1;
      }
      /**
       * Validate and emit a numeric entity.
       *
       * Implements the logic from the `Hexademical character reference start
       * state` and `Numeric character reference end state` in the HTML spec.
       * @param lastCp The last code point of the entity. Used to see if the
       *               entity was terminated with a semicolon.
       * @param expectedLength The minimum number of characters that should be
       *                       consumed. Used to validate that at least one digit
       *                       was consumed.
       * @returns The number of characters that were consumed.
       */
      emitNumericEntity(lastCp, expectedLength) {
        if (this.consumed <= expectedLength) {
          this.errors?.absenceOfDigitsInNumericCharacterReference(this.consumed);
          return 0;
        }
        if (lastCp === CharCodes.SEMI) {
          this.consumed += 1;
        } else if (this.decodeMode === DecodingMode.Strict) {
          return 0;
        }
        this.emitCodePoint(replaceCodePoint(this.result), this.consumed);
        if (this.errors) {
          if (lastCp !== CharCodes.SEMI) {
            this.errors.missingSemicolonAfterCharacterReference();
          }
          this.errors.validateNumericCharacterReference(this.result);
        }
        return this.consumed;
      }
      /**
       * Parses a named entity.
       *
       * Equivalent to the `Named character reference state` in the HTML spec.
       * @param input The string containing the entity (or a continuation of the entity).
       * @param offset The current offset.
       * @returns The number of characters that were consumed, or -1 if the entity is incomplete.
       */
      stateNamedEntity(input, offset) {
        const { decodeTree } = this;
        let current = decodeTree[this.treeIndex];
        let valueLength = (current & BinTrieFlags.VALUE_LENGTH) >> 14;
        while (offset < input.length) {
          if (valueLength === 0 && (current & BinTrieFlags.FLAG13) !== 0) {
            const runLength = (current & BinTrieFlags.BRANCH_LENGTH) >> 7;
            if (this.runConsumed === 0) {
              const firstChar = current & BinTrieFlags.JUMP_TABLE;
              if (input.charCodeAt(offset) !== firstChar) {
                return this.result === 0 ? 0 : this.emitNotTerminatedNamedEntity();
              }
              offset++;
              this.excess++;
              this.runConsumed++;
            }
            while (this.runConsumed < runLength) {
              if (offset >= input.length) {
                return -1;
              }
              const charIndexInPacked = this.runConsumed - 1;
              const packedWord = decodeTree[this.treeIndex + 1 + (charIndexInPacked >> 1)];
              const expectedChar = charIndexInPacked % 2 === 0 ? packedWord & 255 : packedWord >> 8 & 255;
              if (input.charCodeAt(offset) !== expectedChar) {
                this.runConsumed = 0;
                return this.result === 0 ? 0 : this.emitNotTerminatedNamedEntity();
              }
              offset++;
              this.excess++;
              this.runConsumed++;
            }
            this.runConsumed = 0;
            this.treeIndex += 1 + (runLength >> 1);
            current = decodeTree[this.treeIndex];
            valueLength = (current & BinTrieFlags.VALUE_LENGTH) >> 14;
          }
          if (offset >= input.length)
            break;
          const char = input.charCodeAt(offset);
          if (char === CharCodes.SEMI && valueLength !== 0 && (current & BinTrieFlags.FLAG13) !== 0) {
            return this.emitNamedEntityData(this.treeIndex, valueLength, this.consumed + this.excess);
          }
          this.treeIndex = determineBranch(decodeTree, current, this.treeIndex + Math.max(1, valueLength), char);
          if (this.treeIndex < 0) {
            return this.result === 0 || // If we are parsing an attribute
            this.decodeMode === DecodingMode.Attribute && // We shouldn't have consumed any characters after the entity,
            (valueLength === 0 || // And there should be no invalid characters.
            isEntityInAttributeInvalidEnd(char)) ? 0 : this.emitNotTerminatedNamedEntity();
          }
          current = decodeTree[this.treeIndex];
          valueLength = (current & BinTrieFlags.VALUE_LENGTH) >> 14;
          if (valueLength !== 0) {
            if (char === CharCodes.SEMI) {
              return this.emitNamedEntityData(this.treeIndex, valueLength, this.consumed + this.excess);
            }
            if (this.decodeMode !== DecodingMode.Strict && (current & BinTrieFlags.FLAG13) === 0) {
              this.result = this.treeIndex;
              this.consumed += this.excess;
              this.excess = 0;
            }
          }
          offset++;
          this.excess++;
        }
        return -1;
      }
      /**
       * Emit a named entity that was not terminated with a semicolon.
       * @returns The number of characters consumed.
       */
      emitNotTerminatedNamedEntity() {
        const { result, decodeTree } = this;
        const valueLength = (decodeTree[result] & BinTrieFlags.VALUE_LENGTH) >> 14;
        this.emitNamedEntityData(result, valueLength, this.consumed);
        this.errors?.missingSemicolonAfterCharacterReference();
        return this.consumed;
      }
      /**
       * Emit a named entity.
       * @param result The index of the entity in the decode tree.
       * @param valueLength The number of bytes in the entity.
       * @param consumed The number of characters consumed.
       * @returns The number of characters consumed.
       */
      emitNamedEntityData(result, valueLength, consumed) {
        const { decodeTree } = this;
        this.emitCodePoint(valueLength === 1 ? decodeTree[result] & ~(BinTrieFlags.VALUE_LENGTH | BinTrieFlags.FLAG13) : decodeTree[result + 1], consumed);
        if (valueLength === 3) {
          this.emitCodePoint(decodeTree[result + 2], consumed);
        }
        return consumed;
      }
      /**
       * Signal to the parser that the end of the input was reached.
       *
       * Remaining data will be emitted and relevant errors will be produced.
       * @returns The number of characters consumed.
       */
      end() {
        switch (this.state) {
          case EntityDecoderState.NamedEntity: {
            return this.result !== 0 && (this.decodeMode !== DecodingMode.Attribute || this.result === this.treeIndex) ? this.emitNotTerminatedNamedEntity() : 0;
          }
          // Otherwise, emit a numeric entity if we have one.
          case EntityDecoderState.NumericDecimal: {
            return this.emitNumericEntity(0, 2);
          }
          case EntityDecoderState.NumericHex: {
            return this.emitNumericEntity(0, 3);
          }
          case EntityDecoderState.NumericStart: {
            this.errors?.absenceOfDigitsInNumericCharacterReference(this.consumed);
            return 0;
          }
          case EntityDecoderState.EntityStart: {
            return 0;
          }
        }
      }
    };
  }
});

// node_modules/parse5/dist/common/html.js
var html_exports = {};
__export(html_exports, {
  ATTRS: () => ATTRS,
  DOCUMENT_MODE: () => DOCUMENT_MODE,
  NS: () => NS,
  NUMBERED_HEADERS: () => NUMBERED_HEADERS,
  SPECIAL_ELEMENTS: () => SPECIAL_ELEMENTS,
  TAG_ID: () => TAG_ID,
  TAG_NAMES: () => TAG_NAMES,
  getTagID: () => getTagID,
  hasUnescapedText: () => hasUnescapedText
});
function getTagID(tagName) {
  var _a;
  return (_a = TAG_NAME_TO_ID.get(tagName)) !== null && _a !== void 0 ? _a : TAG_ID.UNKNOWN;
}
function hasUnescapedText(tn, scriptingEnabled) {
  return UNESCAPED_TEXT.has(tn) || scriptingEnabled && tn === TAG_NAMES.NOSCRIPT;
}
var NS, ATTRS, DOCUMENT_MODE, TAG_NAMES, TAG_ID, TAG_NAME_TO_ID, $, SPECIAL_ELEMENTS, NUMBERED_HEADERS, UNESCAPED_TEXT;
var init_html = __esm({
  "node_modules/parse5/dist/common/html.js"() {
    (function(NS2) {
      NS2["HTML"] = "http://www.w3.org/1999/xhtml";
      NS2["MATHML"] = "http://www.w3.org/1998/Math/MathML";
      NS2["SVG"] = "http://www.w3.org/2000/svg";
      NS2["XLINK"] = "http://www.w3.org/1999/xlink";
      NS2["XML"] = "http://www.w3.org/XML/1998/namespace";
      NS2["XMLNS"] = "http://www.w3.org/2000/xmlns/";
    })(NS || (NS = {}));
    (function(ATTRS2) {
      ATTRS2["TYPE"] = "type";
      ATTRS2["ACTION"] = "action";
      ATTRS2["ENCODING"] = "encoding";
      ATTRS2["PROMPT"] = "prompt";
      ATTRS2["NAME"] = "name";
      ATTRS2["COLOR"] = "color";
      ATTRS2["FACE"] = "face";
      ATTRS2["SIZE"] = "size";
    })(ATTRS || (ATTRS = {}));
    (function(DOCUMENT_MODE2) {
      DOCUMENT_MODE2["NO_QUIRKS"] = "no-quirks";
      DOCUMENT_MODE2["QUIRKS"] = "quirks";
      DOCUMENT_MODE2["LIMITED_QUIRKS"] = "limited-quirks";
    })(DOCUMENT_MODE || (DOCUMENT_MODE = {}));
    (function(TAG_NAMES2) {
      TAG_NAMES2["A"] = "a";
      TAG_NAMES2["ADDRESS"] = "address";
      TAG_NAMES2["ANNOTATION_XML"] = "annotation-xml";
      TAG_NAMES2["APPLET"] = "applet";
      TAG_NAMES2["AREA"] = "area";
      TAG_NAMES2["ARTICLE"] = "article";
      TAG_NAMES2["ASIDE"] = "aside";
      TAG_NAMES2["B"] = "b";
      TAG_NAMES2["BASE"] = "base";
      TAG_NAMES2["BASEFONT"] = "basefont";
      TAG_NAMES2["BGSOUND"] = "bgsound";
      TAG_NAMES2["BIG"] = "big";
      TAG_NAMES2["BLOCKQUOTE"] = "blockquote";
      TAG_NAMES2["BODY"] = "body";
      TAG_NAMES2["BR"] = "br";
      TAG_NAMES2["BUTTON"] = "button";
      TAG_NAMES2["CAPTION"] = "caption";
      TAG_NAMES2["CENTER"] = "center";
      TAG_NAMES2["CODE"] = "code";
      TAG_NAMES2["COL"] = "col";
      TAG_NAMES2["COLGROUP"] = "colgroup";
      TAG_NAMES2["DD"] = "dd";
      TAG_NAMES2["DESC"] = "desc";
      TAG_NAMES2["DETAILS"] = "details";
      TAG_NAMES2["DIALOG"] = "dialog";
      TAG_NAMES2["DIR"] = "dir";
      TAG_NAMES2["DIV"] = "div";
      TAG_NAMES2["DL"] = "dl";
      TAG_NAMES2["DT"] = "dt";
      TAG_NAMES2["EM"] = "em";
      TAG_NAMES2["EMBED"] = "embed";
      TAG_NAMES2["FIELDSET"] = "fieldset";
      TAG_NAMES2["FIGCAPTION"] = "figcaption";
      TAG_NAMES2["FIGURE"] = "figure";
      TAG_NAMES2["FONT"] = "font";
      TAG_NAMES2["FOOTER"] = "footer";
      TAG_NAMES2["FOREIGN_OBJECT"] = "foreignObject";
      TAG_NAMES2["FORM"] = "form";
      TAG_NAMES2["FRAME"] = "frame";
      TAG_NAMES2["FRAMESET"] = "frameset";
      TAG_NAMES2["H1"] = "h1";
      TAG_NAMES2["H2"] = "h2";
      TAG_NAMES2["H3"] = "h3";
      TAG_NAMES2["H4"] = "h4";
      TAG_NAMES2["H5"] = "h5";
      TAG_NAMES2["H6"] = "h6";
      TAG_NAMES2["HEAD"] = "head";
      TAG_NAMES2["HEADER"] = "header";
      TAG_NAMES2["HGROUP"] = "hgroup";
      TAG_NAMES2["HR"] = "hr";
      TAG_NAMES2["HTML"] = "html";
      TAG_NAMES2["I"] = "i";
      TAG_NAMES2["IMG"] = "img";
      TAG_NAMES2["IMAGE"] = "image";
      TAG_NAMES2["INPUT"] = "input";
      TAG_NAMES2["IFRAME"] = "iframe";
      TAG_NAMES2["KEYGEN"] = "keygen";
      TAG_NAMES2["LABEL"] = "label";
      TAG_NAMES2["LI"] = "li";
      TAG_NAMES2["LINK"] = "link";
      TAG_NAMES2["LISTING"] = "listing";
      TAG_NAMES2["MAIN"] = "main";
      TAG_NAMES2["MALIGNMARK"] = "malignmark";
      TAG_NAMES2["MARQUEE"] = "marquee";
      TAG_NAMES2["MATH"] = "math";
      TAG_NAMES2["MENU"] = "menu";
      TAG_NAMES2["META"] = "meta";
      TAG_NAMES2["MGLYPH"] = "mglyph";
      TAG_NAMES2["MI"] = "mi";
      TAG_NAMES2["MO"] = "mo";
      TAG_NAMES2["MN"] = "mn";
      TAG_NAMES2["MS"] = "ms";
      TAG_NAMES2["MTEXT"] = "mtext";
      TAG_NAMES2["NAV"] = "nav";
      TAG_NAMES2["NOBR"] = "nobr";
      TAG_NAMES2["NOFRAMES"] = "noframes";
      TAG_NAMES2["NOEMBED"] = "noembed";
      TAG_NAMES2["NOSCRIPT"] = "noscript";
      TAG_NAMES2["OBJECT"] = "object";
      TAG_NAMES2["OL"] = "ol";
      TAG_NAMES2["OPTGROUP"] = "optgroup";
      TAG_NAMES2["OPTION"] = "option";
      TAG_NAMES2["P"] = "p";
      TAG_NAMES2["PARAM"] = "param";
      TAG_NAMES2["PLAINTEXT"] = "plaintext";
      TAG_NAMES2["PRE"] = "pre";
      TAG_NAMES2["RB"] = "rb";
      TAG_NAMES2["RP"] = "rp";
      TAG_NAMES2["RT"] = "rt";
      TAG_NAMES2["RTC"] = "rtc";
      TAG_NAMES2["RUBY"] = "ruby";
      TAG_NAMES2["S"] = "s";
      TAG_NAMES2["SCRIPT"] = "script";
      TAG_NAMES2["SEARCH"] = "search";
      TAG_NAMES2["SECTION"] = "section";
      TAG_NAMES2["SELECT"] = "select";
      TAG_NAMES2["SOURCE"] = "source";
      TAG_NAMES2["SMALL"] = "small";
      TAG_NAMES2["SPAN"] = "span";
      TAG_NAMES2["STRIKE"] = "strike";
      TAG_NAMES2["STRONG"] = "strong";
      TAG_NAMES2["STYLE"] = "style";
      TAG_NAMES2["SUB"] = "sub";
      TAG_NAMES2["SUMMARY"] = "summary";
      TAG_NAMES2["SUP"] = "sup";
      TAG_NAMES2["TABLE"] = "table";
      TAG_NAMES2["TBODY"] = "tbody";
      TAG_NAMES2["TEMPLATE"] = "template";
      TAG_NAMES2["TEXTAREA"] = "textarea";
      TAG_NAMES2["TFOOT"] = "tfoot";
      TAG_NAMES2["TD"] = "td";
      TAG_NAMES2["TH"] = "th";
      TAG_NAMES2["THEAD"] = "thead";
      TAG_NAMES2["TITLE"] = "title";
      TAG_NAMES2["TR"] = "tr";
      TAG_NAMES2["TRACK"] = "track";
      TAG_NAMES2["TT"] = "tt";
      TAG_NAMES2["U"] = "u";
      TAG_NAMES2["UL"] = "ul";
      TAG_NAMES2["SVG"] = "svg";
      TAG_NAMES2["VAR"] = "var";
      TAG_NAMES2["WBR"] = "wbr";
      TAG_NAMES2["XMP"] = "xmp";
    })(TAG_NAMES || (TAG_NAMES = {}));
    (function(TAG_ID2) {
      TAG_ID2[TAG_ID2["UNKNOWN"] = 0] = "UNKNOWN";
      TAG_ID2[TAG_ID2["A"] = 1] = "A";
      TAG_ID2[TAG_ID2["ADDRESS"] = 2] = "ADDRESS";
      TAG_ID2[TAG_ID2["ANNOTATION_XML"] = 3] = "ANNOTATION_XML";
      TAG_ID2[TAG_ID2["APPLET"] = 4] = "APPLET";
      TAG_ID2[TAG_ID2["AREA"] = 5] = "AREA";
      TAG_ID2[TAG_ID2["ARTICLE"] = 6] = "ARTICLE";
      TAG_ID2[TAG_ID2["ASIDE"] = 7] = "ASIDE";
      TAG_ID2[TAG_ID2["B"] = 8] = "B";
      TAG_ID2[TAG_ID2["BASE"] = 9] = "BASE";
      TAG_ID2[TAG_ID2["BASEFONT"] = 10] = "BASEFONT";
      TAG_ID2[TAG_ID2["BGSOUND"] = 11] = "BGSOUND";
      TAG_ID2[TAG_ID2["BIG"] = 12] = "BIG";
      TAG_ID2[TAG_ID2["BLOCKQUOTE"] = 13] = "BLOCKQUOTE";
      TAG_ID2[TAG_ID2["BODY"] = 14] = "BODY";
      TAG_ID2[TAG_ID2["BR"] = 15] = "BR";
      TAG_ID2[TAG_ID2["BUTTON"] = 16] = "BUTTON";
      TAG_ID2[TAG_ID2["CAPTION"] = 17] = "CAPTION";
      TAG_ID2[TAG_ID2["CENTER"] = 18] = "CENTER";
      TAG_ID2[TAG_ID2["CODE"] = 19] = "CODE";
      TAG_ID2[TAG_ID2["COL"] = 20] = "COL";
      TAG_ID2[TAG_ID2["COLGROUP"] = 21] = "COLGROUP";
      TAG_ID2[TAG_ID2["DD"] = 22] = "DD";
      TAG_ID2[TAG_ID2["DESC"] = 23] = "DESC";
      TAG_ID2[TAG_ID2["DETAILS"] = 24] = "DETAILS";
      TAG_ID2[TAG_ID2["DIALOG"] = 25] = "DIALOG";
      TAG_ID2[TAG_ID2["DIR"] = 26] = "DIR";
      TAG_ID2[TAG_ID2["DIV"] = 27] = "DIV";
      TAG_ID2[TAG_ID2["DL"] = 28] = "DL";
      TAG_ID2[TAG_ID2["DT"] = 29] = "DT";
      TAG_ID2[TAG_ID2["EM"] = 30] = "EM";
      TAG_ID2[TAG_ID2["EMBED"] = 31] = "EMBED";
      TAG_ID2[TAG_ID2["FIELDSET"] = 32] = "FIELDSET";
      TAG_ID2[TAG_ID2["FIGCAPTION"] = 33] = "FIGCAPTION";
      TAG_ID2[TAG_ID2["FIGURE"] = 34] = "FIGURE";
      TAG_ID2[TAG_ID2["FONT"] = 35] = "FONT";
      TAG_ID2[TAG_ID2["FOOTER"] = 36] = "FOOTER";
      TAG_ID2[TAG_ID2["FOREIGN_OBJECT"] = 37] = "FOREIGN_OBJECT";
      TAG_ID2[TAG_ID2["FORM"] = 38] = "FORM";
      TAG_ID2[TAG_ID2["FRAME"] = 39] = "FRAME";
      TAG_ID2[TAG_ID2["FRAMESET"] = 40] = "FRAMESET";
      TAG_ID2[TAG_ID2["H1"] = 41] = "H1";
      TAG_ID2[TAG_ID2["H2"] = 42] = "H2";
      TAG_ID2[TAG_ID2["H3"] = 43] = "H3";
      TAG_ID2[TAG_ID2["H4"] = 44] = "H4";
      TAG_ID2[TAG_ID2["H5"] = 45] = "H5";
      TAG_ID2[TAG_ID2["H6"] = 46] = "H6";
      TAG_ID2[TAG_ID2["HEAD"] = 47] = "HEAD";
      TAG_ID2[TAG_ID2["HEADER"] = 48] = "HEADER";
      TAG_ID2[TAG_ID2["HGROUP"] = 49] = "HGROUP";
      TAG_ID2[TAG_ID2["HR"] = 50] = "HR";
      TAG_ID2[TAG_ID2["HTML"] = 51] = "HTML";
      TAG_ID2[TAG_ID2["I"] = 52] = "I";
      TAG_ID2[TAG_ID2["IMG"] = 53] = "IMG";
      TAG_ID2[TAG_ID2["IMAGE"] = 54] = "IMAGE";
      TAG_ID2[TAG_ID2["INPUT"] = 55] = "INPUT";
      TAG_ID2[TAG_ID2["IFRAME"] = 56] = "IFRAME";
      TAG_ID2[TAG_ID2["KEYGEN"] = 57] = "KEYGEN";
      TAG_ID2[TAG_ID2["LABEL"] = 58] = "LABEL";
      TAG_ID2[TAG_ID2["LI"] = 59] = "LI";
      TAG_ID2[TAG_ID2["LINK"] = 60] = "LINK";
      TAG_ID2[TAG_ID2["LISTING"] = 61] = "LISTING";
      TAG_ID2[TAG_ID2["MAIN"] = 62] = "MAIN";
      TAG_ID2[TAG_ID2["MALIGNMARK"] = 63] = "MALIGNMARK";
      TAG_ID2[TAG_ID2["MARQUEE"] = 64] = "MARQUEE";
      TAG_ID2[TAG_ID2["MATH"] = 65] = "MATH";
      TAG_ID2[TAG_ID2["MENU"] = 66] = "MENU";
      TAG_ID2[TAG_ID2["META"] = 67] = "META";
      TAG_ID2[TAG_ID2["MGLYPH"] = 68] = "MGLYPH";
      TAG_ID2[TAG_ID2["MI"] = 69] = "MI";
      TAG_ID2[TAG_ID2["MO"] = 70] = "MO";
      TAG_ID2[TAG_ID2["MN"] = 71] = "MN";
      TAG_ID2[TAG_ID2["MS"] = 72] = "MS";
      TAG_ID2[TAG_ID2["MTEXT"] = 73] = "MTEXT";
      TAG_ID2[TAG_ID2["NAV"] = 74] = "NAV";
      TAG_ID2[TAG_ID2["NOBR"] = 75] = "NOBR";
      TAG_ID2[TAG_ID2["NOFRAMES"] = 76] = "NOFRAMES";
      TAG_ID2[TAG_ID2["NOEMBED"] = 77] = "NOEMBED";
      TAG_ID2[TAG_ID2["NOSCRIPT"] = 78] = "NOSCRIPT";
      TAG_ID2[TAG_ID2["OBJECT"] = 79] = "OBJECT";
      TAG_ID2[TAG_ID2["OL"] = 80] = "OL";
      TAG_ID2[TAG_ID2["OPTGROUP"] = 81] = "OPTGROUP";
      TAG_ID2[TAG_ID2["OPTION"] = 82] = "OPTION";
      TAG_ID2[TAG_ID2["P"] = 83] = "P";
      TAG_ID2[TAG_ID2["PARAM"] = 84] = "PARAM";
      TAG_ID2[TAG_ID2["PLAINTEXT"] = 85] = "PLAINTEXT";
      TAG_ID2[TAG_ID2["PRE"] = 86] = "PRE";
      TAG_ID2[TAG_ID2["RB"] = 87] = "RB";
      TAG_ID2[TAG_ID2["RP"] = 88] = "RP";
      TAG_ID2[TAG_ID2["RT"] = 89] = "RT";
      TAG_ID2[TAG_ID2["RTC"] = 90] = "RTC";
      TAG_ID2[TAG_ID2["RUBY"] = 91] = "RUBY";
      TAG_ID2[TAG_ID2["S"] = 92] = "S";
      TAG_ID2[TAG_ID2["SCRIPT"] = 93] = "SCRIPT";
      TAG_ID2[TAG_ID2["SEARCH"] = 94] = "SEARCH";
      TAG_ID2[TAG_ID2["SECTION"] = 95] = "SECTION";
      TAG_ID2[TAG_ID2["SELECT"] = 96] = "SELECT";
      TAG_ID2[TAG_ID2["SOURCE"] = 97] = "SOURCE";
      TAG_ID2[TAG_ID2["SMALL"] = 98] = "SMALL";
      TAG_ID2[TAG_ID2["SPAN"] = 99] = "SPAN";
      TAG_ID2[TAG_ID2["STRIKE"] = 100] = "STRIKE";
      TAG_ID2[TAG_ID2["STRONG"] = 101] = "STRONG";
      TAG_ID2[TAG_ID2["STYLE"] = 102] = "STYLE";
      TAG_ID2[TAG_ID2["SUB"] = 103] = "SUB";
      TAG_ID2[TAG_ID2["SUMMARY"] = 104] = "SUMMARY";
      TAG_ID2[TAG_ID2["SUP"] = 105] = "SUP";
      TAG_ID2[TAG_ID2["TABLE"] = 106] = "TABLE";
      TAG_ID2[TAG_ID2["TBODY"] = 107] = "TBODY";
      TAG_ID2[TAG_ID2["TEMPLATE"] = 108] = "TEMPLATE";
      TAG_ID2[TAG_ID2["TEXTAREA"] = 109] = "TEXTAREA";
      TAG_ID2[TAG_ID2["TFOOT"] = 110] = "TFOOT";
      TAG_ID2[TAG_ID2["TD"] = 111] = "TD";
      TAG_ID2[TAG_ID2["TH"] = 112] = "TH";
      TAG_ID2[TAG_ID2["THEAD"] = 113] = "THEAD";
      TAG_ID2[TAG_ID2["TITLE"] = 114] = "TITLE";
      TAG_ID2[TAG_ID2["TR"] = 115] = "TR";
      TAG_ID2[TAG_ID2["TRACK"] = 116] = "TRACK";
      TAG_ID2[TAG_ID2["TT"] = 117] = "TT";
      TAG_ID2[TAG_ID2["U"] = 118] = "U";
      TAG_ID2[TAG_ID2["UL"] = 119] = "UL";
      TAG_ID2[TAG_ID2["SVG"] = 120] = "SVG";
      TAG_ID2[TAG_ID2["VAR"] = 121] = "VAR";
      TAG_ID2[TAG_ID2["WBR"] = 122] = "WBR";
      TAG_ID2[TAG_ID2["XMP"] = 123] = "XMP";
    })(TAG_ID || (TAG_ID = {}));
    TAG_NAME_TO_ID = /* @__PURE__ */ new Map([
      [TAG_NAMES.A, TAG_ID.A],
      [TAG_NAMES.ADDRESS, TAG_ID.ADDRESS],
      [TAG_NAMES.ANNOTATION_XML, TAG_ID.ANNOTATION_XML],
      [TAG_NAMES.APPLET, TAG_ID.APPLET],
      [TAG_NAMES.AREA, TAG_ID.AREA],
      [TAG_NAMES.ARTICLE, TAG_ID.ARTICLE],
      [TAG_NAMES.ASIDE, TAG_ID.ASIDE],
      [TAG_NAMES.B, TAG_ID.B],
      [TAG_NAMES.BASE, TAG_ID.BASE],
      [TAG_NAMES.BASEFONT, TAG_ID.BASEFONT],
      [TAG_NAMES.BGSOUND, TAG_ID.BGSOUND],
      [TAG_NAMES.BIG, TAG_ID.BIG],
      [TAG_NAMES.BLOCKQUOTE, TAG_ID.BLOCKQUOTE],
      [TAG_NAMES.BODY, TAG_ID.BODY],
      [TAG_NAMES.BR, TAG_ID.BR],
      [TAG_NAMES.BUTTON, TAG_ID.BUTTON],
      [TAG_NAMES.CAPTION, TAG_ID.CAPTION],
      [TAG_NAMES.CENTER, TAG_ID.CENTER],
      [TAG_NAMES.CODE, TAG_ID.CODE],
      [TAG_NAMES.COL, TAG_ID.COL],
      [TAG_NAMES.COLGROUP, TAG_ID.COLGROUP],
      [TAG_NAMES.DD, TAG_ID.DD],
      [TAG_NAMES.DESC, TAG_ID.DESC],
      [TAG_NAMES.DETAILS, TAG_ID.DETAILS],
      [TAG_NAMES.DIALOG, TAG_ID.DIALOG],
      [TAG_NAMES.DIR, TAG_ID.DIR],
      [TAG_NAMES.DIV, TAG_ID.DIV],
      [TAG_NAMES.DL, TAG_ID.DL],
      [TAG_NAMES.DT, TAG_ID.DT],
      [TAG_NAMES.EM, TAG_ID.EM],
      [TAG_NAMES.EMBED, TAG_ID.EMBED],
      [TAG_NAMES.FIELDSET, TAG_ID.FIELDSET],
      [TAG_NAMES.FIGCAPTION, TAG_ID.FIGCAPTION],
      [TAG_NAMES.FIGURE, TAG_ID.FIGURE],
      [TAG_NAMES.FONT, TAG_ID.FONT],
      [TAG_NAMES.FOOTER, TAG_ID.FOOTER],
      [TAG_NAMES.FOREIGN_OBJECT, TAG_ID.FOREIGN_OBJECT],
      [TAG_NAMES.FORM, TAG_ID.FORM],
      [TAG_NAMES.FRAME, TAG_ID.FRAME],
      [TAG_NAMES.FRAMESET, TAG_ID.FRAMESET],
      [TAG_NAMES.H1, TAG_ID.H1],
      [TAG_NAMES.H2, TAG_ID.H2],
      [TAG_NAMES.H3, TAG_ID.H3],
      [TAG_NAMES.H4, TAG_ID.H4],
      [TAG_NAMES.H5, TAG_ID.H5],
      [TAG_NAMES.H6, TAG_ID.H6],
      [TAG_NAMES.HEAD, TAG_ID.HEAD],
      [TAG_NAMES.HEADER, TAG_ID.HEADER],
      [TAG_NAMES.HGROUP, TAG_ID.HGROUP],
      [TAG_NAMES.HR, TAG_ID.HR],
      [TAG_NAMES.HTML, TAG_ID.HTML],
      [TAG_NAMES.I, TAG_ID.I],
      [TAG_NAMES.IMG, TAG_ID.IMG],
      [TAG_NAMES.IMAGE, TAG_ID.IMAGE],
      [TAG_NAMES.INPUT, TAG_ID.INPUT],
      [TAG_NAMES.IFRAME, TAG_ID.IFRAME],
      [TAG_NAMES.KEYGEN, TAG_ID.KEYGEN],
      [TAG_NAMES.LABEL, TAG_ID.LABEL],
      [TAG_NAMES.LI, TAG_ID.LI],
      [TAG_NAMES.LINK, TAG_ID.LINK],
      [TAG_NAMES.LISTING, TAG_ID.LISTING],
      [TAG_NAMES.MAIN, TAG_ID.MAIN],
      [TAG_NAMES.MALIGNMARK, TAG_ID.MALIGNMARK],
      [TAG_NAMES.MARQUEE, TAG_ID.MARQUEE],
      [TAG_NAMES.MATH, TAG_ID.MATH],
      [TAG_NAMES.MENU, TAG_ID.MENU],
      [TAG_NAMES.META, TAG_ID.META],
      [TAG_NAMES.MGLYPH, TAG_ID.MGLYPH],
      [TAG_NAMES.MI, TAG_ID.MI],
      [TAG_NAMES.MO, TAG_ID.MO],
      [TAG_NAMES.MN, TAG_ID.MN],
      [TAG_NAMES.MS, TAG_ID.MS],
      [TAG_NAMES.MTEXT, TAG_ID.MTEXT],
      [TAG_NAMES.NAV, TAG_ID.NAV],
      [TAG_NAMES.NOBR, TAG_ID.NOBR],
      [TAG_NAMES.NOFRAMES, TAG_ID.NOFRAMES],
      [TAG_NAMES.NOEMBED, TAG_ID.NOEMBED],
      [TAG_NAMES.NOSCRIPT, TAG_ID.NOSCRIPT],
      [TAG_NAMES.OBJECT, TAG_ID.OBJECT],
      [TAG_NAMES.OL, TAG_ID.OL],
      [TAG_NAMES.OPTGROUP, TAG_ID.OPTGROUP],
      [TAG_NAMES.OPTION, TAG_ID.OPTION],
      [TAG_NAMES.P, TAG_ID.P],
      [TAG_NAMES.PARAM, TAG_ID.PARAM],
      [TAG_NAMES.PLAINTEXT, TAG_ID.PLAINTEXT],
      [TAG_NAMES.PRE, TAG_ID.PRE],
      [TAG_NAMES.RB, TAG_ID.RB],
      [TAG_NAMES.RP, TAG_ID.RP],
      [TAG_NAMES.RT, TAG_ID.RT],
      [TAG_NAMES.RTC, TAG_ID.RTC],
      [TAG_NAMES.RUBY, TAG_ID.RUBY],
      [TAG_NAMES.S, TAG_ID.S],
      [TAG_NAMES.SCRIPT, TAG_ID.SCRIPT],
      [TAG_NAMES.SEARCH, TAG_ID.SEARCH],
      [TAG_NAMES.SECTION, TAG_ID.SECTION],
      [TAG_NAMES.SELECT, TAG_ID.SELECT],
      [TAG_NAMES.SOURCE, TAG_ID.SOURCE],
      [TAG_NAMES.SMALL, TAG_ID.SMALL],
      [TAG_NAMES.SPAN, TAG_ID.SPAN],
      [TAG_NAMES.STRIKE, TAG_ID.STRIKE],
      [TAG_NAMES.STRONG, TAG_ID.STRONG],
      [TAG_NAMES.STYLE, TAG_ID.STYLE],
      [TAG_NAMES.SUB, TAG_ID.SUB],
      [TAG_NAMES.SUMMARY, TAG_ID.SUMMARY],
      [TAG_NAMES.SUP, TAG_ID.SUP],
      [TAG_NAMES.TABLE, TAG_ID.TABLE],
      [TAG_NAMES.TBODY, TAG_ID.TBODY],
      [TAG_NAMES.TEMPLATE, TAG_ID.TEMPLATE],
      [TAG_NAMES.TEXTAREA, TAG_ID.TEXTAREA],
      [TAG_NAMES.TFOOT, TAG_ID.TFOOT],
      [TAG_NAMES.TD, TAG_ID.TD],
      [TAG_NAMES.TH, TAG_ID.TH],
      [TAG_NAMES.THEAD, TAG_ID.THEAD],
      [TAG_NAMES.TITLE, TAG_ID.TITLE],
      [TAG_NAMES.TR, TAG_ID.TR],
      [TAG_NAMES.TRACK, TAG_ID.TRACK],
      [TAG_NAMES.TT, TAG_ID.TT],
      [TAG_NAMES.U, TAG_ID.U],
      [TAG_NAMES.UL, TAG_ID.UL],
      [TAG_NAMES.SVG, TAG_ID.SVG],
      [TAG_NAMES.VAR, TAG_ID.VAR],
      [TAG_NAMES.WBR, TAG_ID.WBR],
      [TAG_NAMES.XMP, TAG_ID.XMP]
    ]);
    $ = TAG_ID;
    SPECIAL_ELEMENTS = {
      [NS.HTML]: /* @__PURE__ */ new Set([
        $.ADDRESS,
        $.APPLET,
        $.AREA,
        $.ARTICLE,
        $.ASIDE,
        $.BASE,
        $.BASEFONT,
        $.BGSOUND,
        $.BLOCKQUOTE,
        $.BODY,
        $.BR,
        $.BUTTON,
        $.CAPTION,
        $.CENTER,
        $.COL,
        $.COLGROUP,
        $.DD,
        $.DETAILS,
        $.DIR,
        $.DIV,
        $.DL,
        $.DT,
        $.EMBED,
        $.FIELDSET,
        $.FIGCAPTION,
        $.FIGURE,
        $.FOOTER,
        $.FORM,
        $.FRAME,
        $.FRAMESET,
        $.H1,
        $.H2,
        $.H3,
        $.H4,
        $.H5,
        $.H6,
        $.HEAD,
        $.HEADER,
        $.HGROUP,
        $.HR,
        $.HTML,
        $.IFRAME,
        $.IMG,
        $.INPUT,
        $.LI,
        $.LINK,
        $.LISTING,
        $.MAIN,
        $.MARQUEE,
        $.MENU,
        $.META,
        $.NAV,
        $.NOEMBED,
        $.NOFRAMES,
        $.NOSCRIPT,
        $.OBJECT,
        $.OL,
        $.P,
        $.PARAM,
        $.PLAINTEXT,
        $.PRE,
        $.SCRIPT,
        $.SECTION,
        $.SELECT,
        $.SOURCE,
        $.STYLE,
        $.SUMMARY,
        $.TABLE,
        $.TBODY,
        $.TD,
        $.TEMPLATE,
        $.TEXTAREA,
        $.TFOOT,
        $.TH,
        $.THEAD,
        $.TITLE,
        $.TR,
        $.TRACK,
        $.UL,
        $.WBR,
        $.XMP
      ]),
      [NS.MATHML]: /* @__PURE__ */ new Set([$.MI, $.MO, $.MN, $.MS, $.MTEXT, $.ANNOTATION_XML]),
      [NS.SVG]: /* @__PURE__ */ new Set([$.TITLE, $.FOREIGN_OBJECT, $.DESC]),
      [NS.XLINK]: /* @__PURE__ */ new Set(),
      [NS.XML]: /* @__PURE__ */ new Set(),
      [NS.XMLNS]: /* @__PURE__ */ new Set()
    };
    NUMBERED_HEADERS = /* @__PURE__ */ new Set([$.H1, $.H2, $.H3, $.H4, $.H5, $.H6]);
    UNESCAPED_TEXT = /* @__PURE__ */ new Set([
      TAG_NAMES.STYLE,
      TAG_NAMES.SCRIPT,
      TAG_NAMES.XMP,
      TAG_NAMES.IFRAME,
      TAG_NAMES.NOEMBED,
      TAG_NAMES.NOFRAMES,
      TAG_NAMES.PLAINTEXT
    ]);
  }
});

// node_modules/parse5/dist/tokenizer/index.js
function isAsciiDigit(cp) {
  return cp >= CODE_POINTS.DIGIT_0 && cp <= CODE_POINTS.DIGIT_9;
}
function isAsciiUpper(cp) {
  return cp >= CODE_POINTS.LATIN_CAPITAL_A && cp <= CODE_POINTS.LATIN_CAPITAL_Z;
}
function isAsciiLower(cp) {
  return cp >= CODE_POINTS.LATIN_SMALL_A && cp <= CODE_POINTS.LATIN_SMALL_Z;
}
function isAsciiLetter(cp) {
  return isAsciiLower(cp) || isAsciiUpper(cp);
}
function isAsciiAlphaNumeric2(cp) {
  return isAsciiLetter(cp) || isAsciiDigit(cp);
}
function toAsciiLower(cp) {
  return cp + 32;
}
function isWhitespace(cp) {
  return cp === CODE_POINTS.SPACE || cp === CODE_POINTS.LINE_FEED || cp === CODE_POINTS.TABULATION || cp === CODE_POINTS.FORM_FEED;
}
function isScriptDataDoubleEscapeSequenceEnd(cp) {
  return isWhitespace(cp) || cp === CODE_POINTS.SOLIDUS || cp === CODE_POINTS.GREATER_THAN_SIGN;
}
function getErrorForNumericCharacterReference(code) {
  if (code === CODE_POINTS.NULL) {
    return ERR.nullCharacterReference;
  } else if (code > 1114111) {
    return ERR.characterReferenceOutsideUnicodeRange;
  } else if (isSurrogate(code)) {
    return ERR.surrogateCharacterReference;
  } else if (isUndefinedCodePoint(code)) {
    return ERR.noncharacterCharacterReference;
  } else if (isControlCodePoint(code) || code === CODE_POINTS.CARRIAGE_RETURN) {
    return ERR.controlCharacterReference;
  }
  return null;
}
var State, TokenizerMode, Tokenizer;
var init_tokenizer = __esm({
  "node_modules/parse5/dist/tokenizer/index.js"() {
    init_preprocessor();
    init_unicode();
    init_token();
    init_decode();
    init_error_codes();
    init_html();
    (function(State2) {
      State2[State2["DATA"] = 0] = "DATA";
      State2[State2["RCDATA"] = 1] = "RCDATA";
      State2[State2["RAWTEXT"] = 2] = "RAWTEXT";
      State2[State2["SCRIPT_DATA"] = 3] = "SCRIPT_DATA";
      State2[State2["PLAINTEXT"] = 4] = "PLAINTEXT";
      State2[State2["TAG_OPEN"] = 5] = "TAG_OPEN";
      State2[State2["END_TAG_OPEN"] = 6] = "END_TAG_OPEN";
      State2[State2["TAG_NAME"] = 7] = "TAG_NAME";
      State2[State2["RCDATA_LESS_THAN_SIGN"] = 8] = "RCDATA_LESS_THAN_SIGN";
      State2[State2["RCDATA_END_TAG_OPEN"] = 9] = "RCDATA_END_TAG_OPEN";
      State2[State2["RCDATA_END_TAG_NAME"] = 10] = "RCDATA_END_TAG_NAME";
      State2[State2["RAWTEXT_LESS_THAN_SIGN"] = 11] = "RAWTEXT_LESS_THAN_SIGN";
      State2[State2["RAWTEXT_END_TAG_OPEN"] = 12] = "RAWTEXT_END_TAG_OPEN";
      State2[State2["RAWTEXT_END_TAG_NAME"] = 13] = "RAWTEXT_END_TAG_NAME";
      State2[State2["SCRIPT_DATA_LESS_THAN_SIGN"] = 14] = "SCRIPT_DATA_LESS_THAN_SIGN";
      State2[State2["SCRIPT_DATA_END_TAG_OPEN"] = 15] = "SCRIPT_DATA_END_TAG_OPEN";
      State2[State2["SCRIPT_DATA_END_TAG_NAME"] = 16] = "SCRIPT_DATA_END_TAG_NAME";
      State2[State2["SCRIPT_DATA_ESCAPE_START"] = 17] = "SCRIPT_DATA_ESCAPE_START";
      State2[State2["SCRIPT_DATA_ESCAPE_START_DASH"] = 18] = "SCRIPT_DATA_ESCAPE_START_DASH";
      State2[State2["SCRIPT_DATA_ESCAPED"] = 19] = "SCRIPT_DATA_ESCAPED";
      State2[State2["SCRIPT_DATA_ESCAPED_DASH"] = 20] = "SCRIPT_DATA_ESCAPED_DASH";
      State2[State2["SCRIPT_DATA_ESCAPED_DASH_DASH"] = 21] = "SCRIPT_DATA_ESCAPED_DASH_DASH";
      State2[State2["SCRIPT_DATA_ESCAPED_LESS_THAN_SIGN"] = 22] = "SCRIPT_DATA_ESCAPED_LESS_THAN_SIGN";
      State2[State2["SCRIPT_DATA_ESCAPED_END_TAG_OPEN"] = 23] = "SCRIPT_DATA_ESCAPED_END_TAG_OPEN";
      State2[State2["SCRIPT_DATA_ESCAPED_END_TAG_NAME"] = 24] = "SCRIPT_DATA_ESCAPED_END_TAG_NAME";
      State2[State2["SCRIPT_DATA_DOUBLE_ESCAPE_START"] = 25] = "SCRIPT_DATA_DOUBLE_ESCAPE_START";
      State2[State2["SCRIPT_DATA_DOUBLE_ESCAPED"] = 26] = "SCRIPT_DATA_DOUBLE_ESCAPED";
      State2[State2["SCRIPT_DATA_DOUBLE_ESCAPED_DASH"] = 27] = "SCRIPT_DATA_DOUBLE_ESCAPED_DASH";
      State2[State2["SCRIPT_DATA_DOUBLE_ESCAPED_DASH_DASH"] = 28] = "SCRIPT_DATA_DOUBLE_ESCAPED_DASH_DASH";
      State2[State2["SCRIPT_DATA_DOUBLE_ESCAPED_LESS_THAN_SIGN"] = 29] = "SCRIPT_DATA_DOUBLE_ESCAPED_LESS_THAN_SIGN";
      State2[State2["SCRIPT_DATA_DOUBLE_ESCAPE_END"] = 30] = "SCRIPT_DATA_DOUBLE_ESCAPE_END";
      State2[State2["BEFORE_ATTRIBUTE_NAME"] = 31] = "BEFORE_ATTRIBUTE_NAME";
      State2[State2["ATTRIBUTE_NAME"] = 32] = "ATTRIBUTE_NAME";
      State2[State2["AFTER_ATTRIBUTE_NAME"] = 33] = "AFTER_ATTRIBUTE_NAME";
      State2[State2["BEFORE_ATTRIBUTE_VALUE"] = 34] = "BEFORE_ATTRIBUTE_VALUE";
      State2[State2["ATTRIBUTE_VALUE_DOUBLE_QUOTED"] = 35] = "ATTRIBUTE_VALUE_DOUBLE_QUOTED";
      State2[State2["ATTRIBUTE_VALUE_SINGLE_QUOTED"] = 36] = "ATTRIBUTE_VALUE_SINGLE_QUOTED";
      State2[State2["ATTRIBUTE_VALUE_UNQUOTED"] = 37] = "ATTRIBUTE_VALUE_UNQUOTED";
      State2[State2["AFTER_ATTRIBUTE_VALUE_QUOTED"] = 38] = "AFTER_ATTRIBUTE_VALUE_QUOTED";
      State2[State2["SELF_CLOSING_START_TAG"] = 39] = "SELF_CLOSING_START_TAG";
      State2[State2["BOGUS_COMMENT"] = 40] = "BOGUS_COMMENT";
      State2[State2["MARKUP_DECLARATION_OPEN"] = 41] = "MARKUP_DECLARATION_OPEN";
      State2[State2["COMMENT_START"] = 42] = "COMMENT_START";
      State2[State2["COMMENT_START_DASH"] = 43] = "COMMENT_START_DASH";
      State2[State2["COMMENT"] = 44] = "COMMENT";
      State2[State2["COMMENT_LESS_THAN_SIGN"] = 45] = "COMMENT_LESS_THAN_SIGN";
      State2[State2["COMMENT_LESS_THAN_SIGN_BANG"] = 46] = "COMMENT_LESS_THAN_SIGN_BANG";
      State2[State2["COMMENT_LESS_THAN_SIGN_BANG_DASH"] = 47] = "COMMENT_LESS_THAN_SIGN_BANG_DASH";
      State2[State2["COMMENT_LESS_THAN_SIGN_BANG_DASH_DASH"] = 48] = "COMMENT_LESS_THAN_SIGN_BANG_DASH_DASH";
      State2[State2["COMMENT_END_DASH"] = 49] = "COMMENT_END_DASH";
      State2[State2["COMMENT_END"] = 50] = "COMMENT_END";
      State2[State2["COMMENT_END_BANG"] = 51] = "COMMENT_END_BANG";
      State2[State2["DOCTYPE"] = 52] = "DOCTYPE";
      State2[State2["BEFORE_DOCTYPE_NAME"] = 53] = "BEFORE_DOCTYPE_NAME";
      State2[State2["DOCTYPE_NAME"] = 54] = "DOCTYPE_NAME";
      State2[State2["AFTER_DOCTYPE_NAME"] = 55] = "AFTER_DOCTYPE_NAME";
      State2[State2["AFTER_DOCTYPE_PUBLIC_KEYWORD"] = 56] = "AFTER_DOCTYPE_PUBLIC_KEYWORD";
      State2[State2["BEFORE_DOCTYPE_PUBLIC_IDENTIFIER"] = 57] = "BEFORE_DOCTYPE_PUBLIC_IDENTIFIER";
      State2[State2["DOCTYPE_PUBLIC_IDENTIFIER_DOUBLE_QUOTED"] = 58] = "DOCTYPE_PUBLIC_IDENTIFIER_DOUBLE_QUOTED";
      State2[State2["DOCTYPE_PUBLIC_IDENTIFIER_SINGLE_QUOTED"] = 59] = "DOCTYPE_PUBLIC_IDENTIFIER_SINGLE_QUOTED";
      State2[State2["AFTER_DOCTYPE_PUBLIC_IDENTIFIER"] = 60] = "AFTER_DOCTYPE_PUBLIC_IDENTIFIER";
      State2[State2["BETWEEN_DOCTYPE_PUBLIC_AND_SYSTEM_IDENTIFIERS"] = 61] = "BETWEEN_DOCTYPE_PUBLIC_AND_SYSTEM_IDENTIFIERS";
      State2[State2["AFTER_DOCTYPE_SYSTEM_KEYWORD"] = 62] = "AFTER_DOCTYPE_SYSTEM_KEYWORD";
      State2[State2["BEFORE_DOCTYPE_SYSTEM_IDENTIFIER"] = 63] = "BEFORE_DOCTYPE_SYSTEM_IDENTIFIER";
      State2[State2["DOCTYPE_SYSTEM_IDENTIFIER_DOUBLE_QUOTED"] = 64] = "DOCTYPE_SYSTEM_IDENTIFIER_DOUBLE_QUOTED";
      State2[State2["DOCTYPE_SYSTEM_IDENTIFIER_SINGLE_QUOTED"] = 65] = "DOCTYPE_SYSTEM_IDENTIFIER_SINGLE_QUOTED";
      State2[State2["AFTER_DOCTYPE_SYSTEM_IDENTIFIER"] = 66] = "AFTER_DOCTYPE_SYSTEM_IDENTIFIER";
      State2[State2["BOGUS_DOCTYPE"] = 67] = "BOGUS_DOCTYPE";
      State2[State2["CDATA_SECTION"] = 68] = "CDATA_SECTION";
      State2[State2["CDATA_SECTION_BRACKET"] = 69] = "CDATA_SECTION_BRACKET";
      State2[State2["CDATA_SECTION_END"] = 70] = "CDATA_SECTION_END";
      State2[State2["CHARACTER_REFERENCE"] = 71] = "CHARACTER_REFERENCE";
      State2[State2["AMBIGUOUS_AMPERSAND"] = 72] = "AMBIGUOUS_AMPERSAND";
    })(State || (State = {}));
    TokenizerMode = {
      DATA: State.DATA,
      RCDATA: State.RCDATA,
      RAWTEXT: State.RAWTEXT,
      SCRIPT_DATA: State.SCRIPT_DATA,
      PLAINTEXT: State.PLAINTEXT,
      CDATA_SECTION: State.CDATA_SECTION
    };
    Tokenizer = class {
      constructor(options, handler) {
        this.options = options;
        this.handler = handler;
        this.paused = false;
        this.inLoop = false;
        this.inForeignNode = false;
        this.lastStartTagName = "";
        this.active = false;
        this.state = State.DATA;
        this.returnState = State.DATA;
        this.entityStartPos = 0;
        this.consumedAfterSnapshot = -1;
        this.currentCharacterToken = null;
        this.currentToken = null;
        this.currentAttr = { name: "", value: "" };
        this.preprocessor = new Preprocessor(handler);
        this.currentLocation = this.getCurrentLocation(-1);
        this.entityDecoder = new EntityDecoder(htmlDecodeTree, (cp, consumed) => {
          this.preprocessor.pos = this.entityStartPos + consumed - 1;
          this._flushCodePointConsumedAsCharacterReference(cp);
        }, handler.onParseError ? {
          missingSemicolonAfterCharacterReference: () => {
            this._err(ERR.missingSemicolonAfterCharacterReference, 1);
          },
          absenceOfDigitsInNumericCharacterReference: (consumed) => {
            this._err(ERR.absenceOfDigitsInNumericCharacterReference, this.entityStartPos - this.preprocessor.pos + consumed);
          },
          validateNumericCharacterReference: (code) => {
            const error = getErrorForNumericCharacterReference(code);
            if (error)
              this._err(error, 1);
          }
        } : void 0);
      }
      //Errors
      _err(code, cpOffset = 0) {
        var _a, _b;
        (_b = (_a = this.handler).onParseError) === null || _b === void 0 ? void 0 : _b.call(_a, this.preprocessor.getError(code, cpOffset));
      }
      // NOTE: `offset` may never run across line boundaries.
      getCurrentLocation(offset) {
        if (!this.options.sourceCodeLocationInfo) {
          return null;
        }
        return {
          startLine: this.preprocessor.line,
          startCol: this.preprocessor.col - offset,
          startOffset: this.preprocessor.offset - offset,
          endLine: -1,
          endCol: -1,
          endOffset: -1
        };
      }
      _runParsingLoop() {
        if (this.inLoop)
          return;
        this.inLoop = true;
        while (this.active && !this.paused) {
          this.consumedAfterSnapshot = 0;
          const cp = this._consume();
          if (!this._ensureHibernation()) {
            this._callState(cp);
          }
        }
        this.inLoop = false;
      }
      //API
      pause() {
        this.paused = true;
      }
      resume(writeCallback) {
        if (!this.paused) {
          throw new Error("Parser was already resumed");
        }
        this.paused = false;
        if (this.inLoop)
          return;
        this._runParsingLoop();
        if (!this.paused) {
          writeCallback === null || writeCallback === void 0 ? void 0 : writeCallback();
        }
      }
      write(chunk, isLastChunk, writeCallback) {
        this.active = true;
        this.preprocessor.write(chunk, isLastChunk);
        this._runParsingLoop();
        if (!this.paused) {
          writeCallback === null || writeCallback === void 0 ? void 0 : writeCallback();
        }
      }
      insertHtmlAtCurrentPos(chunk) {
        this.active = true;
        this.preprocessor.insertHtmlAtCurrentPos(chunk);
        this._runParsingLoop();
      }
      //Hibernation
      _ensureHibernation() {
        if (this.preprocessor.endOfChunkHit) {
          this.preprocessor.retreat(this.consumedAfterSnapshot);
          this.consumedAfterSnapshot = 0;
          this.active = false;
          return true;
        }
        return false;
      }
      //Consumption
      _consume() {
        this.consumedAfterSnapshot++;
        return this.preprocessor.advance();
      }
      _advanceBy(count) {
        this.consumedAfterSnapshot += count;
        for (let i = 0; i < count; i++) {
          this.preprocessor.advance();
        }
      }
      _consumeSequenceIfMatch(pattern, caseSensitive) {
        if (this.preprocessor.startsWith(pattern, caseSensitive)) {
          this._advanceBy(pattern.length - 1);
          return true;
        }
        return false;
      }
      //Token creation
      _createStartTagToken() {
        this.currentToken = {
          type: TokenType.START_TAG,
          tagName: "",
          tagID: TAG_ID.UNKNOWN,
          selfClosing: false,
          ackSelfClosing: false,
          attrs: [],
          location: this.getCurrentLocation(1)
        };
      }
      _createEndTagToken() {
        this.currentToken = {
          type: TokenType.END_TAG,
          tagName: "",
          tagID: TAG_ID.UNKNOWN,
          selfClosing: false,
          ackSelfClosing: false,
          attrs: [],
          location: this.getCurrentLocation(2)
        };
      }
      _createCommentToken(offset) {
        this.currentToken = {
          type: TokenType.COMMENT,
          data: "",
          location: this.getCurrentLocation(offset)
        };
      }
      _createDoctypeToken(initialName) {
        this.currentToken = {
          type: TokenType.DOCTYPE,
          name: initialName,
          forceQuirks: false,
          publicId: null,
          systemId: null,
          location: this.currentLocation
        };
      }
      _createCharacterToken(type, chars) {
        this.currentCharacterToken = {
          type,
          chars,
          location: this.currentLocation
        };
      }
      //Tag attributes
      _createAttr(attrNameFirstCh) {
        this.currentAttr = {
          name: attrNameFirstCh,
          value: ""
        };
        this.currentLocation = this.getCurrentLocation(0);
      }
      _leaveAttrName() {
        var _a;
        var _b;
        const token = this.currentToken;
        if (getTokenAttr(token, this.currentAttr.name) === null) {
          token.attrs.push(this.currentAttr);
          if (token.location && this.currentLocation) {
            const attrLocations = (_a = (_b = token.location).attrs) !== null && _a !== void 0 ? _a : _b.attrs = /* @__PURE__ */ Object.create(null);
            attrLocations[this.currentAttr.name] = this.currentLocation;
            this._leaveAttrValue();
          }
        } else {
          this._err(ERR.duplicateAttribute);
        }
      }
      _leaveAttrValue() {
        if (this.currentLocation) {
          this.currentLocation.endLine = this.preprocessor.line;
          this.currentLocation.endCol = this.preprocessor.col;
          this.currentLocation.endOffset = this.preprocessor.offset;
        }
      }
      //Token emission
      prepareToken(ct) {
        this._emitCurrentCharacterToken(ct.location);
        this.currentToken = null;
        if (ct.location) {
          ct.location.endLine = this.preprocessor.line;
          ct.location.endCol = this.preprocessor.col + 1;
          ct.location.endOffset = this.preprocessor.offset + 1;
        }
        this.currentLocation = this.getCurrentLocation(-1);
      }
      emitCurrentTagToken() {
        const ct = this.currentToken;
        this.prepareToken(ct);
        ct.tagID = getTagID(ct.tagName);
        if (ct.type === TokenType.START_TAG) {
          this.lastStartTagName = ct.tagName;
          this.handler.onStartTag(ct);
        } else {
          if (ct.attrs.length > 0) {
            this._err(ERR.endTagWithAttributes);
          }
          if (ct.selfClosing) {
            this._err(ERR.endTagWithTrailingSolidus);
          }
          this.handler.onEndTag(ct);
        }
        this.preprocessor.dropParsedChunk();
      }
      emitCurrentComment(ct) {
        this.prepareToken(ct);
        this.handler.onComment(ct);
        this.preprocessor.dropParsedChunk();
      }
      emitCurrentDoctype(ct) {
        this.prepareToken(ct);
        this.handler.onDoctype(ct);
        this.preprocessor.dropParsedChunk();
      }
      _emitCurrentCharacterToken(nextLocation) {
        if (this.currentCharacterToken) {
          if (nextLocation && this.currentCharacterToken.location) {
            this.currentCharacterToken.location.endLine = nextLocation.startLine;
            this.currentCharacterToken.location.endCol = nextLocation.startCol;
            this.currentCharacterToken.location.endOffset = nextLocation.startOffset;
          }
          switch (this.currentCharacterToken.type) {
            case TokenType.CHARACTER: {
              this.handler.onCharacter(this.currentCharacterToken);
              break;
            }
            case TokenType.NULL_CHARACTER: {
              this.handler.onNullCharacter(this.currentCharacterToken);
              break;
            }
            case TokenType.WHITESPACE_CHARACTER: {
              this.handler.onWhitespaceCharacter(this.currentCharacterToken);
              break;
            }
          }
          this.currentCharacterToken = null;
        }
      }
      _emitEOFToken() {
        const location = this.getCurrentLocation(0);
        if (location) {
          location.endLine = location.startLine;
          location.endCol = location.startCol;
          location.endOffset = location.startOffset;
        }
        this._emitCurrentCharacterToken(location);
        this.handler.onEof({ type: TokenType.EOF, location });
        this.active = false;
      }
      //Characters emission
      //OPTIMIZATION: The specification uses only one type of character token (one token per character).
      //This causes a huge memory overhead and a lot of unnecessary parser loops. parse5 uses 3 groups of characters.
      //If we have a sequence of characters that belong to the same group, the parser can process it
      //as a single solid character token.
      //So, there are 3 types of character tokens in parse5:
      //1)TokenType.NULL_CHARACTER - \u0000-character sequences (e.g. '\u0000\u0000\u0000')
      //2)TokenType.WHITESPACE_CHARACTER - any whitespace/new-line character sequences (e.g. '\n  \r\t   \f')
      //3)TokenType.CHARACTER - any character sequence which don't belong to groups 1 and 2 (e.g. 'abcdef1234@@#$%^')
      _appendCharToCurrentCharacterToken(type, ch) {
        if (this.currentCharacterToken) {
          if (this.currentCharacterToken.type === type) {
            this.currentCharacterToken.chars += ch;
            return;
          } else {
            this.currentLocation = this.getCurrentLocation(0);
            this._emitCurrentCharacterToken(this.currentLocation);
            this.preprocessor.dropParsedChunk();
          }
        }
        this._createCharacterToken(type, ch);
      }
      _emitCodePoint(cp) {
        const type = isWhitespace(cp) ? TokenType.WHITESPACE_CHARACTER : cp === CODE_POINTS.NULL ? TokenType.NULL_CHARACTER : TokenType.CHARACTER;
        this._appendCharToCurrentCharacterToken(type, cp < 65536 ? String.fromCharCode(cp) : String.fromCodePoint(cp));
      }
      //NOTE: used when we emit characters explicitly.
      //This is always for non-whitespace and non-null characters, which allows us to avoid additional checks.
      _emitChars(ch) {
        this._appendCharToCurrentCharacterToken(TokenType.CHARACTER, ch);
      }
      // Character reference helpers
      _startCharacterReference() {
        this.returnState = this.state;
        this.state = State.CHARACTER_REFERENCE;
        this.entityStartPos = this.preprocessor.pos;
        this.entityDecoder.startEntity(this._isCharacterReferenceInAttribute() ? DecodingMode.Attribute : DecodingMode.Legacy);
      }
      _isCharacterReferenceInAttribute() {
        return this.returnState === State.ATTRIBUTE_VALUE_DOUBLE_QUOTED || this.returnState === State.ATTRIBUTE_VALUE_SINGLE_QUOTED || this.returnState === State.ATTRIBUTE_VALUE_UNQUOTED;
      }
      _flushCodePointConsumedAsCharacterReference(cp) {
        if (this._isCharacterReferenceInAttribute()) {
          this.currentAttr.value += String.fromCodePoint(cp);
        } else {
          this._emitCodePoint(cp);
        }
      }
      // Calling states this way turns out to be much faster than any other approach.
      _callState(cp) {
        switch (this.state) {
          case State.DATA: {
            this._stateData(cp);
            break;
          }
          case State.RCDATA: {
            this._stateRcdata(cp);
            break;
          }
          case State.RAWTEXT: {
            this._stateRawtext(cp);
            break;
          }
          case State.SCRIPT_DATA: {
            this._stateScriptData(cp);
            break;
          }
          case State.PLAINTEXT: {
            this._statePlaintext(cp);
            break;
          }
          case State.TAG_OPEN: {
            this._stateTagOpen(cp);
            break;
          }
          case State.END_TAG_OPEN: {
            this._stateEndTagOpen(cp);
            break;
          }
          case State.TAG_NAME: {
            this._stateTagName(cp);
            break;
          }
          case State.RCDATA_LESS_THAN_SIGN: {
            this._stateRcdataLessThanSign(cp);
            break;
          }
          case State.RCDATA_END_TAG_OPEN: {
            this._stateRcdataEndTagOpen(cp);
            break;
          }
          case State.RCDATA_END_TAG_NAME: {
            this._stateRcdataEndTagName(cp);
            break;
          }
          case State.RAWTEXT_LESS_THAN_SIGN: {
            this._stateRawtextLessThanSign(cp);
            break;
          }
          case State.RAWTEXT_END_TAG_OPEN: {
            this._stateRawtextEndTagOpen(cp);
            break;
          }
          case State.RAWTEXT_END_TAG_NAME: {
            this._stateRawtextEndTagName(cp);
            break;
          }
          case State.SCRIPT_DATA_LESS_THAN_SIGN: {
            this._stateScriptDataLessThanSign(cp);
            break;
          }
          case State.SCRIPT_DATA_END_TAG_OPEN: {
            this._stateScriptDataEndTagOpen(cp);
            break;
          }
          case State.SCRIPT_DATA_END_TAG_NAME: {
            this._stateScriptDataEndTagName(cp);
            break;
          }
          case State.SCRIPT_DATA_ESCAPE_START: {
            this._stateScriptDataEscapeStart(cp);
            break;
          }
          case State.SCRIPT_DATA_ESCAPE_START_DASH: {
            this._stateScriptDataEscapeStartDash(cp);
            break;
          }
          case State.SCRIPT_DATA_ESCAPED: {
            this._stateScriptDataEscaped(cp);
            break;
          }
          case State.SCRIPT_DATA_ESCAPED_DASH: {
            this._stateScriptDataEscapedDash(cp);
            break;
          }
          case State.SCRIPT_DATA_ESCAPED_DASH_DASH: {
            this._stateScriptDataEscapedDashDash(cp);
            break;
          }
          case State.SCRIPT_DATA_ESCAPED_LESS_THAN_SIGN: {
            this._stateScriptDataEscapedLessThanSign(cp);
            break;
          }
          case State.SCRIPT_DATA_ESCAPED_END_TAG_OPEN: {
            this._stateScriptDataEscapedEndTagOpen(cp);
            break;
          }
          case State.SCRIPT_DATA_ESCAPED_END_TAG_NAME: {
            this._stateScriptDataEscapedEndTagName(cp);
            break;
          }
          case State.SCRIPT_DATA_DOUBLE_ESCAPE_START: {
            this._stateScriptDataDoubleEscapeStart(cp);
            break;
          }
          case State.SCRIPT_DATA_DOUBLE_ESCAPED: {
            this._stateScriptDataDoubleEscaped(cp);
            break;
          }
          case State.SCRIPT_DATA_DOUBLE_ESCAPED_DASH: {
            this._stateScriptDataDoubleEscapedDash(cp);
            break;
          }
          case State.SCRIPT_DATA_DOUBLE_ESCAPED_DASH_DASH: {
            this._stateScriptDataDoubleEscapedDashDash(cp);
            break;
          }
          case State.SCRIPT_DATA_DOUBLE_ESCAPED_LESS_THAN_SIGN: {
            this._stateScriptDataDoubleEscapedLessThanSign(cp);
            break;
          }
          case State.SCRIPT_DATA_DOUBLE_ESCAPE_END: {
            this._stateScriptDataDoubleEscapeEnd(cp);
            break;
          }
          case State.BEFORE_ATTRIBUTE_NAME: {
            this._stateBeforeAttributeName(cp);
            break;
          }
          case State.ATTRIBUTE_NAME: {
            this._stateAttributeName(cp);
            break;
          }
          case State.AFTER_ATTRIBUTE_NAME: {
            this._stateAfterAttributeName(cp);
            break;
          }
          case State.BEFORE_ATTRIBUTE_VALUE: {
            this._stateBeforeAttributeValue(cp);
            break;
          }
          case State.ATTRIBUTE_VALUE_DOUBLE_QUOTED: {
            this._stateAttributeValueDoubleQuoted(cp);
            break;
          }
          case State.ATTRIBUTE_VALUE_SINGLE_QUOTED: {
            this._stateAttributeValueSingleQuoted(cp);
            break;
          }
          case State.ATTRIBUTE_VALUE_UNQUOTED: {
            this._stateAttributeValueUnquoted(cp);
            break;
          }
          case State.AFTER_ATTRIBUTE_VALUE_QUOTED: {
            this._stateAfterAttributeValueQuoted(cp);
            break;
          }
          case State.SELF_CLOSING_START_TAG: {
            this._stateSelfClosingStartTag(cp);
            break;
          }
          case State.BOGUS_COMMENT: {
            this._stateBogusComment(cp);
            break;
          }
          case State.MARKUP_DECLARATION_OPEN: {
            this._stateMarkupDeclarationOpen(cp);
            break;
          }
          case State.COMMENT_START: {
            this._stateCommentStart(cp);
            break;
          }
          case State.COMMENT_START_DASH: {
            this._stateCommentStartDash(cp);
            break;
          }
          case State.COMMENT: {
            this._stateComment(cp);
            break;
          }
          case State.COMMENT_LESS_THAN_SIGN: {
            this._stateCommentLessThanSign(cp);
            break;
          }
          case State.COMMENT_LESS_THAN_SIGN_BANG: {
            this._stateCommentLessThanSignBang(cp);
            break;
          }
          case State.COMMENT_LESS_THAN_SIGN_BANG_DASH: {
            this._stateCommentLessThanSignBangDash(cp);
            break;
          }
          case State.COMMENT_LESS_THAN_SIGN_BANG_DASH_DASH: {
            this._stateCommentLessThanSignBangDashDash(cp);
            break;
          }
          case State.COMMENT_END_DASH: {
            this._stateCommentEndDash(cp);
            break;
          }
          case State.COMMENT_END: {
            this._stateCommentEnd(cp);
            break;
          }
          case State.COMMENT_END_BANG: {
            this._stateCommentEndBang(cp);
            break;
          }
          case State.DOCTYPE: {
            this._stateDoctype(cp);
            break;
          }
          case State.BEFORE_DOCTYPE_NAME: {
            this._stateBeforeDoctypeName(cp);
            break;
          }
          case State.DOCTYPE_NAME: {
            this._stateDoctypeName(cp);
            break;
          }
          case State.AFTER_DOCTYPE_NAME: {
            this._stateAfterDoctypeName(cp);
            break;
          }
          case State.AFTER_DOCTYPE_PUBLIC_KEYWORD: {
            this._stateAfterDoctypePublicKeyword(cp);
            break;
          }
          case State.BEFORE_DOCTYPE_PUBLIC_IDENTIFIER: {
            this._stateBeforeDoctypePublicIdentifier(cp);
            break;
          }
          case State.DOCTYPE_PUBLIC_IDENTIFIER_DOUBLE_QUOTED: {
            this._stateDoctypePublicIdentifierDoubleQuoted(cp);
            break;
          }
          case State.DOCTYPE_PUBLIC_IDENTIFIER_SINGLE_QUOTED: {
            this._stateDoctypePublicIdentifierSingleQuoted(cp);
            break;
          }
          case State.AFTER_DOCTYPE_PUBLIC_IDENTIFIER: {
            this._stateAfterDoctypePublicIdentifier(cp);
            break;
          }
          case State.BETWEEN_DOCTYPE_PUBLIC_AND_SYSTEM_IDENTIFIERS: {
            this._stateBetweenDoctypePublicAndSystemIdentifiers(cp);
            break;
          }
          case State.AFTER_DOCTYPE_SYSTEM_KEYWORD: {
            this._stateAfterDoctypeSystemKeyword(cp);
            break;
          }
          case State.BEFORE_DOCTYPE_SYSTEM_IDENTIFIER: {
            this._stateBeforeDoctypeSystemIdentifier(cp);
            break;
          }
          case State.DOCTYPE_SYSTEM_IDENTIFIER_DOUBLE_QUOTED: {
            this._stateDoctypeSystemIdentifierDoubleQuoted(cp);
            break;
          }
          case State.DOCTYPE_SYSTEM_IDENTIFIER_SINGLE_QUOTED: {
            this._stateDoctypeSystemIdentifierSingleQuoted(cp);
            break;
          }
          case State.AFTER_DOCTYPE_SYSTEM_IDENTIFIER: {
            this._stateAfterDoctypeSystemIdentifier(cp);
            break;
          }
          case State.BOGUS_DOCTYPE: {
            this._stateBogusDoctype(cp);
            break;
          }
          case State.CDATA_SECTION: {
            this._stateCdataSection(cp);
            break;
          }
          case State.CDATA_SECTION_BRACKET: {
            this._stateCdataSectionBracket(cp);
            break;
          }
          case State.CDATA_SECTION_END: {
            this._stateCdataSectionEnd(cp);
            break;
          }
          case State.CHARACTER_REFERENCE: {
            this._stateCharacterReference();
            break;
          }
          case State.AMBIGUOUS_AMPERSAND: {
            this._stateAmbiguousAmpersand(cp);
            break;
          }
          default: {
            throw new Error("Unknown state");
          }
        }
      }
      // State machine
      // Data state
      //------------------------------------------------------------------
      _stateData(cp) {
        switch (cp) {
          case CODE_POINTS.LESS_THAN_SIGN: {
            this.state = State.TAG_OPEN;
            break;
          }
          case CODE_POINTS.AMPERSAND: {
            this._startCharacterReference();
            break;
          }
          case CODE_POINTS.NULL: {
            this._err(ERR.unexpectedNullCharacter);
            this._emitCodePoint(cp);
            break;
          }
          case CODE_POINTS.EOF: {
            this._emitEOFToken();
            break;
          }
          default: {
            this._emitCodePoint(cp);
          }
        }
      }
      //  RCDATA state
      //------------------------------------------------------------------
      _stateRcdata(cp) {
        switch (cp) {
          case CODE_POINTS.AMPERSAND: {
            this._startCharacterReference();
            break;
          }
          case CODE_POINTS.LESS_THAN_SIGN: {
            this.state = State.RCDATA_LESS_THAN_SIGN;
            break;
          }
          case CODE_POINTS.NULL: {
            this._err(ERR.unexpectedNullCharacter);
            this._emitChars(REPLACEMENT_CHARACTER);
            break;
          }
          case CODE_POINTS.EOF: {
            this._emitEOFToken();
            break;
          }
          default: {
            this._emitCodePoint(cp);
          }
        }
      }
      // RAWTEXT state
      //------------------------------------------------------------------
      _stateRawtext(cp) {
        switch (cp) {
          case CODE_POINTS.LESS_THAN_SIGN: {
            this.state = State.RAWTEXT_LESS_THAN_SIGN;
            break;
          }
          case CODE_POINTS.NULL: {
            this._err(ERR.unexpectedNullCharacter);
            this._emitChars(REPLACEMENT_CHARACTER);
            break;
          }
          case CODE_POINTS.EOF: {
            this._emitEOFToken();
            break;
          }
          default: {
            this._emitCodePoint(cp);
          }
        }
      }
      // Script data state
      //------------------------------------------------------------------
      _stateScriptData(cp) {
        switch (cp) {
          case CODE_POINTS.LESS_THAN_SIGN: {
            this.state = State.SCRIPT_DATA_LESS_THAN_SIGN;
            break;
          }
          case CODE_POINTS.NULL: {
            this._err(ERR.unexpectedNullCharacter);
            this._emitChars(REPLACEMENT_CHARACTER);
            break;
          }
          case CODE_POINTS.EOF: {
            this._emitEOFToken();
            break;
          }
          default: {
            this._emitCodePoint(cp);
          }
        }
      }
      // PLAINTEXT state
      //------------------------------------------------------------------
      _statePlaintext(cp) {
        switch (cp) {
          case CODE_POINTS.NULL: {
            this._err(ERR.unexpectedNullCharacter);
            this._emitChars(REPLACEMENT_CHARACTER);
            break;
          }
          case CODE_POINTS.EOF: {
            this._emitEOFToken();
            break;
          }
          default: {
            this._emitCodePoint(cp);
          }
        }
      }
      // Tag open state
      //------------------------------------------------------------------
      _stateTagOpen(cp) {
        if (isAsciiLetter(cp)) {
          this._createStartTagToken();
          this.state = State.TAG_NAME;
          this._stateTagName(cp);
        } else
          switch (cp) {
            case CODE_POINTS.EXCLAMATION_MARK: {
              this.state = State.MARKUP_DECLARATION_OPEN;
              break;
            }
            case CODE_POINTS.SOLIDUS: {
              this.state = State.END_TAG_OPEN;
              break;
            }
            case CODE_POINTS.QUESTION_MARK: {
              this._err(ERR.unexpectedQuestionMarkInsteadOfTagName);
              this._createCommentToken(1);
              this.state = State.BOGUS_COMMENT;
              this._stateBogusComment(cp);
              break;
            }
            case CODE_POINTS.EOF: {
              this._err(ERR.eofBeforeTagName);
              this._emitChars("<");
              this._emitEOFToken();
              break;
            }
            default: {
              this._err(ERR.invalidFirstCharacterOfTagName);
              this._emitChars("<");
              this.state = State.DATA;
              this._stateData(cp);
            }
          }
      }
      // End tag open state
      //------------------------------------------------------------------
      _stateEndTagOpen(cp) {
        if (isAsciiLetter(cp)) {
          this._createEndTagToken();
          this.state = State.TAG_NAME;
          this._stateTagName(cp);
        } else
          switch (cp) {
            case CODE_POINTS.GREATER_THAN_SIGN: {
              this._err(ERR.missingEndTagName);
              this.state = State.DATA;
              break;
            }
            case CODE_POINTS.EOF: {
              this._err(ERR.eofBeforeTagName);
              this._emitChars("</");
              this._emitEOFToken();
              break;
            }
            default: {
              this._err(ERR.invalidFirstCharacterOfTagName);
              this._createCommentToken(2);
              this.state = State.BOGUS_COMMENT;
              this._stateBogusComment(cp);
            }
          }
      }
      // Tag name state
      //------------------------------------------------------------------
      _stateTagName(cp) {
        const token = this.currentToken;
        switch (cp) {
          case CODE_POINTS.SPACE:
          case CODE_POINTS.LINE_FEED:
          case CODE_POINTS.TABULATION:
          case CODE_POINTS.FORM_FEED: {
            this.state = State.BEFORE_ATTRIBUTE_NAME;
            break;
          }
          case CODE_POINTS.SOLIDUS: {
            this.state = State.SELF_CLOSING_START_TAG;
            break;
          }
          case CODE_POINTS.GREATER_THAN_SIGN: {
            this.state = State.DATA;
            this.emitCurrentTagToken();
            break;
          }
          case CODE_POINTS.NULL: {
            this._err(ERR.unexpectedNullCharacter);
            token.tagName += REPLACEMENT_CHARACTER;
            break;
          }
          case CODE_POINTS.EOF: {
            this._err(ERR.eofInTag);
            this._emitEOFToken();
            break;
          }
          default: {
            token.tagName += String.fromCodePoint(isAsciiUpper(cp) ? toAsciiLower(cp) : cp);
          }
        }
      }
      // RCDATA less-than sign state
      //------------------------------------------------------------------
      _stateRcdataLessThanSign(cp) {
        if (cp === CODE_POINTS.SOLIDUS) {
          this.state = State.RCDATA_END_TAG_OPEN;
        } else {
          this._emitChars("<");
          this.state = State.RCDATA;
          this._stateRcdata(cp);
        }
      }
      // RCDATA end tag open state
      //------------------------------------------------------------------
      _stateRcdataEndTagOpen(cp) {
        if (isAsciiLetter(cp)) {
          this.state = State.RCDATA_END_TAG_NAME;
          this._stateRcdataEndTagName(cp);
        } else {
          this._emitChars("</");
          this.state = State.RCDATA;
          this._stateRcdata(cp);
        }
      }
      handleSpecialEndTag(_cp) {
        if (!this.preprocessor.startsWith(this.lastStartTagName, false)) {
          return !this._ensureHibernation();
        }
        this._createEndTagToken();
        const token = this.currentToken;
        token.tagName = this.lastStartTagName;
        const cp = this.preprocessor.peek(this.lastStartTagName.length);
        switch (cp) {
          case CODE_POINTS.SPACE:
          case CODE_POINTS.LINE_FEED:
          case CODE_POINTS.TABULATION:
          case CODE_POINTS.FORM_FEED: {
            this._advanceBy(this.lastStartTagName.length);
            this.state = State.BEFORE_ATTRIBUTE_NAME;
            return false;
          }
          case CODE_POINTS.SOLIDUS: {
            this._advanceBy(this.lastStartTagName.length);
            this.state = State.SELF_CLOSING_START_TAG;
            return false;
          }
          case CODE_POINTS.GREATER_THAN_SIGN: {
            this._advanceBy(this.lastStartTagName.length);
            this.emitCurrentTagToken();
            this.state = State.DATA;
            return false;
          }
          default: {
            return !this._ensureHibernation();
          }
        }
      }
      // RCDATA end tag name state
      //------------------------------------------------------------------
      _stateRcdataEndTagName(cp) {
        if (this.handleSpecialEndTag(cp)) {
          this._emitChars("</");
          this.state = State.RCDATA;
          this._stateRcdata(cp);
        }
      }
      // RAWTEXT less-than sign state
      //------------------------------------------------------------------
      _stateRawtextLessThanSign(cp) {
        if (cp === CODE_POINTS.SOLIDUS) {
          this.state = State.RAWTEXT_END_TAG_OPEN;
        } else {
          this._emitChars("<");
          this.state = State.RAWTEXT;
          this._stateRawtext(cp);
        }
      }
      // RAWTEXT end tag open state
      //------------------------------------------------------------------
      _stateRawtextEndTagOpen(cp) {
        if (isAsciiLetter(cp)) {
          this.state = State.RAWTEXT_END_TAG_NAME;
          this._stateRawtextEndTagName(cp);
        } else {
          this._emitChars("</");
          this.state = State.RAWTEXT;
          this._stateRawtext(cp);
        }
      }
      // RAWTEXT end tag name state
      //------------------------------------------------------------------
      _stateRawtextEndTagName(cp) {
        if (this.handleSpecialEndTag(cp)) {
          this._emitChars("</");
          this.state = State.RAWTEXT;
          this._stateRawtext(cp);
        }
      }
      // Script data less-than sign state
      //------------------------------------------------------------------
      _stateScriptDataLessThanSign(cp) {
        switch (cp) {
          case CODE_POINTS.SOLIDUS: {
            this.state = State.SCRIPT_DATA_END_TAG_OPEN;
            break;
          }
          case CODE_POINTS.EXCLAMATION_MARK: {
            this.state = State.SCRIPT_DATA_ESCAPE_START;
            this._emitChars("<!");
            break;
          }
          default: {
            this._emitChars("<");
            this.state = State.SCRIPT_DATA;
            this._stateScriptData(cp);
          }
        }
      }
      // Script data end tag open state
      //------------------------------------------------------------------
      _stateScriptDataEndTagOpen(cp) {
        if (isAsciiLetter(cp)) {
          this.state = State.SCRIPT_DATA_END_TAG_NAME;
          this._stateScriptDataEndTagName(cp);
        } else {
          this._emitChars("</");
          this.state = State.SCRIPT_DATA;
          this._stateScriptData(cp);
        }
      }
      // Script data end tag name state
      //------------------------------------------------------------------
      _stateScriptDataEndTagName(cp) {
        if (this.handleSpecialEndTag(cp)) {
          this._emitChars("</");
          this.state = State.SCRIPT_DATA;
          this._stateScriptData(cp);
        }
      }
      // Script data escape start state
      //------------------------------------------------------------------
      _stateScriptDataEscapeStart(cp) {
        if (cp === CODE_POINTS.HYPHEN_MINUS) {
          this.state = State.SCRIPT_DATA_ESCAPE_START_DASH;
          this._emitChars("-");
        } else {
          this.state = State.SCRIPT_DATA;
          this._stateScriptData(cp);
        }
      }
      // Script data escape start dash state
      //------------------------------------------------------------------
      _stateScriptDataEscapeStartDash(cp) {
        if (cp === CODE_POINTS.HYPHEN_MINUS) {
          this.state = State.SCRIPT_DATA_ESCAPED_DASH_DASH;
          this._emitChars("-");
        } else {
          this.state = State.SCRIPT_DATA;
          this._stateScriptData(cp);
        }
      }
      // Script data escaped state
      //------------------------------------------------------------------
      _stateScriptDataEscaped(cp) {
        switch (cp) {
          case CODE_POINTS.HYPHEN_MINUS: {
            this.state = State.SCRIPT_DATA_ESCAPED_DASH;
            this._emitChars("-");
            break;
          }
          case CODE_POINTS.LESS_THAN_SIGN: {
            this.state = State.SCRIPT_DATA_ESCAPED_LESS_THAN_SIGN;
            break;
          }
          case CODE_POINTS.NULL: {
            this._err(ERR.unexpectedNullCharacter);
            this._emitChars(REPLACEMENT_CHARACTER);
            break;
          }
          case CODE_POINTS.EOF: {
            this._err(ERR.eofInScriptHtmlCommentLikeText);
            this._emitEOFToken();
            break;
          }
          default: {
            this._emitCodePoint(cp);
          }
        }
      }
      // Script data escaped dash state
      //------------------------------------------------------------------
      _stateScriptDataEscapedDash(cp) {
        switch (cp) {
          case CODE_POINTS.HYPHEN_MINUS: {
            this.state = State.SCRIPT_DATA_ESCAPED_DASH_DASH;
            this._emitChars("-");
            break;
          }
          case CODE_POINTS.LESS_THAN_SIGN: {
            this.state = State.SCRIPT_DATA_ESCAPED_LESS_THAN_SIGN;
            break;
          }
          case CODE_POINTS.NULL: {
            this._err(ERR.unexpectedNullCharacter);
            this.state = State.SCRIPT_DATA_ESCAPED;
            this._emitChars(REPLACEMENT_CHARACTER);
            break;
          }
          case CODE_POINTS.EOF: {
            this._err(ERR.eofInScriptHtmlCommentLikeText);
            this._emitEOFToken();
            break;
          }
          default: {
            this.state = State.SCRIPT_DATA_ESCAPED;
            this._emitCodePoint(cp);
          }
        }
      }
      // Script data escaped dash dash state
      //------------------------------------------------------------------
      _stateScriptDataEscapedDashDash(cp) {
        switch (cp) {
          case CODE_POINTS.HYPHEN_MINUS: {
            this._emitChars("-");
            break;
          }
          case CODE_POINTS.LESS_THAN_SIGN: {
            this.state = State.SCRIPT_DATA_ESCAPED_LESS_THAN_SIGN;
            break;
          }
          case CODE_POINTS.GREATER_THAN_SIGN: {
            this.state = State.SCRIPT_DATA;
            this._emitChars(">");
            break;
          }
          case CODE_POINTS.NULL: {
            this._err(ERR.unexpectedNullCharacter);
            this.state = State.SCRIPT_DATA_ESCAPED;
            this._emitChars(REPLACEMENT_CHARACTER);
            break;
          }
          case CODE_POINTS.EOF: {
            this._err(ERR.eofInScriptHtmlCommentLikeText);
            this._emitEOFToken();
            break;
          }
          default: {
            this.state = State.SCRIPT_DATA_ESCAPED;
            this._emitCodePoint(cp);
          }
        }
      }
      // Script data escaped less-than sign state
      //------------------------------------------------------------------
      _stateScriptDataEscapedLessThanSign(cp) {
        if (cp === CODE_POINTS.SOLIDUS) {
          this.state = State.SCRIPT_DATA_ESCAPED_END_TAG_OPEN;
        } else if (isAsciiLetter(cp)) {
          this._emitChars("<");
          this.state = State.SCRIPT_DATA_DOUBLE_ESCAPE_START;
          this._stateScriptDataDoubleEscapeStart(cp);
        } else {
          this._emitChars("<");
          this.state = State.SCRIPT_DATA_ESCAPED;
          this._stateScriptDataEscaped(cp);
        }
      }
      // Script data escaped end tag open state
      //------------------------------------------------------------------
      _stateScriptDataEscapedEndTagOpen(cp) {
        if (isAsciiLetter(cp)) {
          this.state = State.SCRIPT_DATA_ESCAPED_END_TAG_NAME;
          this._stateScriptDataEscapedEndTagName(cp);
        } else {
          this._emitChars("</");
          this.state = State.SCRIPT_DATA_ESCAPED;
          this._stateScriptDataEscaped(cp);
        }
      }
      // Script data escaped end tag name state
      //------------------------------------------------------------------
      _stateScriptDataEscapedEndTagName(cp) {
        if (this.handleSpecialEndTag(cp)) {
          this._emitChars("</");
          this.state = State.SCRIPT_DATA_ESCAPED;
          this._stateScriptDataEscaped(cp);
        }
      }
      // Script data double escape start state
      //------------------------------------------------------------------
      _stateScriptDataDoubleEscapeStart(cp) {
        if (this.preprocessor.startsWith(SEQUENCES.SCRIPT, false) && isScriptDataDoubleEscapeSequenceEnd(this.preprocessor.peek(SEQUENCES.SCRIPT.length))) {
          this._emitCodePoint(cp);
          for (let i = 0; i < SEQUENCES.SCRIPT.length; i++) {
            this._emitCodePoint(this._consume());
          }
          this.state = State.SCRIPT_DATA_DOUBLE_ESCAPED;
        } else if (!this._ensureHibernation()) {
          this.state = State.SCRIPT_DATA_ESCAPED;
          this._stateScriptDataEscaped(cp);
        }
      }
      // Script data double escaped state
      //------------------------------------------------------------------
      _stateScriptDataDoubleEscaped(cp) {
        switch (cp) {
          case CODE_POINTS.HYPHEN_MINUS: {
            this.state = State.SCRIPT_DATA_DOUBLE_ESCAPED_DASH;
            this._emitChars("-");
            break;
          }
          case CODE_POINTS.LESS_THAN_SIGN: {
            this.state = State.SCRIPT_DATA_DOUBLE_ESCAPED_LESS_THAN_SIGN;
            this._emitChars("<");
            break;
          }
          case CODE_POINTS.NULL: {
            this._err(ERR.unexpectedNullCharacter);
            this._emitChars(REPLACEMENT_CHARACTER);
            break;
          }
          case CODE_POINTS.EOF: {
            this._err(ERR.eofInScriptHtmlCommentLikeText);
            this._emitEOFToken();
            break;
          }
          default: {
            this._emitCodePoint(cp);
          }
        }
      }
      // Script data double escaped dash state
      //------------------------------------------------------------------
      _stateScriptDataDoubleEscapedDash(cp) {
        switch (cp) {
          case CODE_POINTS.HYPHEN_MINUS: {
            this.state = State.SCRIPT_DATA_DOUBLE_ESCAPED_DASH_DASH;
            this._emitChars("-");
            break;
          }
          case CODE_POINTS.LESS_THAN_SIGN: {
            this.state = State.SCRIPT_DATA_DOUBLE_ESCAPED_LESS_THAN_SIGN;
            this._emitChars("<");
            break;
          }
          case CODE_POINTS.NULL: {
            this._err(ERR.unexpectedNullCharacter);
            this.state = State.SCRIPT_DATA_DOUBLE_ESCAPED;
            this._emitChars(REPLACEMENT_CHARACTER);
            break;
          }
          case CODE_POINTS.EOF: {
            this._err(ERR.eofInScriptHtmlCommentLikeText);
            this._emitEOFToken();
            break;
          }
          default: {
            this.state = State.SCRIPT_DATA_DOUBLE_ESCAPED;
            this._emitCodePoint(cp);
          }
        }
      }
      // Script data double escaped dash dash state
      //------------------------------------------------------------------
      _stateScriptDataDoubleEscapedDashDash(cp) {
        switch (cp) {
          case CODE_POINTS.HYPHEN_MINUS: {
            this._emitChars("-");
            break;
          }
          case CODE_POINTS.LESS_THAN_SIGN: {
            this.state = State.SCRIPT_DATA_DOUBLE_ESCAPED_LESS_THAN_SIGN;
            this._emitChars("<");
            break;
          }
          case CODE_POINTS.GREATER_THAN_SIGN: {
            this.state = State.SCRIPT_DATA;
            this._emitChars(">");
            break;
          }
          case CODE_POINTS.NULL: {
            this._err(ERR.unexpectedNullCharacter);
            this.state = State.SCRIPT_DATA_DOUBLE_ESCAPED;
            this._emitChars(REPLACEMENT_CHARACTER);
            break;
          }
          case CODE_POINTS.EOF: {
            this._err(ERR.eofInScriptHtmlCommentLikeText);
            this._emitEOFToken();
            break;
          }
          default: {
            this.state = State.SCRIPT_DATA_DOUBLE_ESCAPED;
            this._emitCodePoint(cp);
          }
        }
      }
      // Script data double escaped less-than sign state
      //------------------------------------------------------------------
      _stateScriptDataDoubleEscapedLessThanSign(cp) {
        if (cp === CODE_POINTS.SOLIDUS) {
          this.state = State.SCRIPT_DATA_DOUBLE_ESCAPE_END;
          this._emitChars("/");
        } else {
          this.state = State.SCRIPT_DATA_DOUBLE_ESCAPED;
          this._stateScriptDataDoubleEscaped(cp);
        }
      }
      // Script data double escape end state
      //------------------------------------------------------------------
      _stateScriptDataDoubleEscapeEnd(cp) {
        if (this.preprocessor.startsWith(SEQUENCES.SCRIPT, false) && isScriptDataDoubleEscapeSequenceEnd(this.preprocessor.peek(SEQUENCES.SCRIPT.length))) {
          this._emitCodePoint(cp);
          for (let i = 0; i < SEQUENCES.SCRIPT.length; i++) {
            this._emitCodePoint(this._consume());
          }
          this.state = State.SCRIPT_DATA_ESCAPED;
        } else if (!this._ensureHibernation()) {
          this.state = State.SCRIPT_DATA_DOUBLE_ESCAPED;
          this._stateScriptDataDoubleEscaped(cp);
        }
      }
      // Before attribute name state
      //------------------------------------------------------------------
      _stateBeforeAttributeName(cp) {
        switch (cp) {
          case CODE_POINTS.SPACE:
          case CODE_POINTS.LINE_FEED:
          case CODE_POINTS.TABULATION:
          case CODE_POINTS.FORM_FEED: {
            break;
          }
          case CODE_POINTS.SOLIDUS:
          case CODE_POINTS.GREATER_THAN_SIGN:
          case CODE_POINTS.EOF: {
            this.state = State.AFTER_ATTRIBUTE_NAME;
            this._stateAfterAttributeName(cp);
            break;
          }
          case CODE_POINTS.EQUALS_SIGN: {
            this._err(ERR.unexpectedEqualsSignBeforeAttributeName);
            this._createAttr("=");
            this.state = State.ATTRIBUTE_NAME;
            break;
          }
          default: {
            this._createAttr("");
            this.state = State.ATTRIBUTE_NAME;
            this._stateAttributeName(cp);
          }
        }
      }
      // Attribute name state
      //------------------------------------------------------------------
      _stateAttributeName(cp) {
        switch (cp) {
          case CODE_POINTS.SPACE:
          case CODE_POINTS.LINE_FEED:
          case CODE_POINTS.TABULATION:
          case CODE_POINTS.FORM_FEED:
          case CODE_POINTS.SOLIDUS:
          case CODE_POINTS.GREATER_THAN_SIGN:
          case CODE_POINTS.EOF: {
            this._leaveAttrName();
            this.state = State.AFTER_ATTRIBUTE_NAME;
            this._stateAfterAttributeName(cp);
            break;
          }
          case CODE_POINTS.EQUALS_SIGN: {
            this._leaveAttrName();
            this.state = State.BEFORE_ATTRIBUTE_VALUE;
            break;
          }
          case CODE_POINTS.QUOTATION_MARK:
          case CODE_POINTS.APOSTROPHE:
          case CODE_POINTS.LESS_THAN_SIGN: {
            this._err(ERR.unexpectedCharacterInAttributeName);
            this.currentAttr.name += String.fromCodePoint(cp);
            break;
          }
          case CODE_POINTS.NULL: {
            this._err(ERR.unexpectedNullCharacter);
            this.currentAttr.name += REPLACEMENT_CHARACTER;
            break;
          }
          default: {
            this.currentAttr.name += String.fromCodePoint(isAsciiUpper(cp) ? toAsciiLower(cp) : cp);
          }
        }
      }
      // After attribute name state
      //------------------------------------------------------------------
      _stateAfterAttributeName(cp) {
        switch (cp) {
          case CODE_POINTS.SPACE:
          case CODE_POINTS.LINE_FEED:
          case CODE_POINTS.TABULATION:
          case CODE_POINTS.FORM_FEED: {
            break;
          }
          case CODE_POINTS.SOLIDUS: {
            this.state = State.SELF_CLOSING_START_TAG;
            break;
          }
          case CODE_POINTS.EQUALS_SIGN: {
            this.state = State.BEFORE_ATTRIBUTE_VALUE;
            break;
          }
          case CODE_POINTS.GREATER_THAN_SIGN: {
            this.state = State.DATA;
            this.emitCurrentTagToken();
            break;
          }
          case CODE_POINTS.EOF: {
            this._err(ERR.eofInTag);
            this._emitEOFToken();
            break;
          }
          default: {
            this._createAttr("");
            this.state = State.ATTRIBUTE_NAME;
            this._stateAttributeName(cp);
          }
        }
      }
      // Before attribute value state
      //------------------------------------------------------------------
      _stateBeforeAttributeValue(cp) {
        switch (cp) {
          case CODE_POINTS.SPACE:
          case CODE_POINTS.LINE_FEED:
          case CODE_POINTS.TABULATION:
          case CODE_POINTS.FORM_FEED: {
            break;
          }
          case CODE_POINTS.QUOTATION_MARK: {
            this.state = State.ATTRIBUTE_VALUE_DOUBLE_QUOTED;
            break;
          }
          case CODE_POINTS.APOSTROPHE: {
            this.state = State.ATTRIBUTE_VALUE_SINGLE_QUOTED;
            break;
          }
          case CODE_POINTS.GREATER_THAN_SIGN: {
            this._err(ERR.missingAttributeValue);
            this.state = State.DATA;
            this.emitCurrentTagToken();
            break;
          }
          default: {
            this.state = State.ATTRIBUTE_VALUE_UNQUOTED;
            this._stateAttributeValueUnquoted(cp);
          }
        }
      }
      // Attribute value (double-quoted) state
      //------------------------------------------------------------------
      _stateAttributeValueDoubleQuoted(cp) {
        switch (cp) {
          case CODE_POINTS.QUOTATION_MARK: {
            this.state = State.AFTER_ATTRIBUTE_VALUE_QUOTED;
            break;
          }
          case CODE_POINTS.AMPERSAND: {
            this._startCharacterReference();
            break;
          }
          case CODE_POINTS.NULL: {
            this._err(ERR.unexpectedNullCharacter);
            this.currentAttr.value += REPLACEMENT_CHARACTER;
            break;
          }
          case CODE_POINTS.EOF: {
            this._err(ERR.eofInTag);
            this._emitEOFToken();
            break;
          }
          default: {
            this.currentAttr.value += String.fromCodePoint(cp);
          }
        }
      }
      // Attribute value (single-quoted) state
      //------------------------------------------------------------------
      _stateAttributeValueSingleQuoted(cp) {
        switch (cp) {
          case CODE_POINTS.APOSTROPHE: {
            this.state = State.AFTER_ATTRIBUTE_VALUE_QUOTED;
            break;
          }
          case CODE_POINTS.AMPERSAND: {
            this._startCharacterReference();
            break;
          }
          case CODE_POINTS.NULL: {
            this._err(ERR.unexpectedNullCharacter);
            this.currentAttr.value += REPLACEMENT_CHARACTER;
            break;
          }
          case CODE_POINTS.EOF: {
            this._err(ERR.eofInTag);
            this._emitEOFToken();
            break;
          }
          default: {
            this.currentAttr.value += String.fromCodePoint(cp);
          }
        }
      }
      // Attribute value (unquoted) state
      //------------------------------------------------------------------
      _stateAttributeValueUnquoted(cp) {
        switch (cp) {
          case CODE_POINTS.SPACE:
          case CODE_POINTS.LINE_FEED:
          case CODE_POINTS.TABULATION:
          case CODE_POINTS.FORM_FEED: {
            this._leaveAttrValue();
            this.state = State.BEFORE_ATTRIBUTE_NAME;
            break;
          }
          case CODE_POINTS.AMPERSAND: {
            this._startCharacterReference();
            break;
          }
          case CODE_POINTS.GREATER_THAN_SIGN: {
            this._leaveAttrValue();
            this.state = State.DATA;
            this.emitCurrentTagToken();
            break;
          }
          case CODE_POINTS.NULL: {
            this._err(ERR.unexpectedNullCharacter);
            this.currentAttr.value += REPLACEMENT_CHARACTER;
            break;
          }
          case CODE_POINTS.QUOTATION_MARK:
          case CODE_POINTS.APOSTROPHE:
          case CODE_POINTS.LESS_THAN_SIGN:
          case CODE_POINTS.EQUALS_SIGN:
          case CODE_POINTS.GRAVE_ACCENT: {
            this._err(ERR.unexpectedCharacterInUnquotedAttributeValue);
            this.currentAttr.value += String.fromCodePoint(cp);
            break;
          }
          case CODE_POINTS.EOF: {
            this._err(ERR.eofInTag);
            this._emitEOFToken();
            break;
          }
          default: {
            this.currentAttr.value += String.fromCodePoint(cp);
          }
        }
      }
      // After attribute value (quoted) state
      //------------------------------------------------------------------
      _stateAfterAttributeValueQuoted(cp) {
        switch (cp) {
          case CODE_POINTS.SPACE:
          case CODE_POINTS.LINE_FEED:
          case CODE_POINTS.TABULATION:
          case CODE_POINTS.FORM_FEED: {
            this._leaveAttrValue();
            this.state = State.BEFORE_ATTRIBUTE_NAME;
            break;
          }
          case CODE_POINTS.SOLIDUS: {
            this._leaveAttrValue();
            this.state = State.SELF_CLOSING_START_TAG;
            break;
          }
          case CODE_POINTS.GREATER_THAN_SIGN: {
            this._leaveAttrValue();
            this.state = State.DATA;
            this.emitCurrentTagToken();
            break;
          }
          case CODE_POINTS.EOF: {
            this._err(ERR.eofInTag);
            this._emitEOFToken();
            break;
          }
          default: {
            this._err(ERR.missingWhitespaceBetweenAttributes);
            this.state = State.BEFORE_ATTRIBUTE_NAME;
            this._stateBeforeAttributeName(cp);
          }
        }
      }
      // Self-closing start tag state
      //------------------------------------------------------------------
      _stateSelfClosingStartTag(cp) {
        switch (cp) {
          case CODE_POINTS.GREATER_THAN_SIGN: {
            const token = this.currentToken;
            token.selfClosing = true;
            this.state = State.DATA;
            this.emitCurrentTagToken();
            break;
          }
          case CODE_POINTS.EOF: {
            this._err(ERR.eofInTag);
            this._emitEOFToken();
            break;
          }
          default: {
            this._err(ERR.unexpectedSolidusInTag);
            this.state = State.BEFORE_ATTRIBUTE_NAME;
            this._stateBeforeAttributeName(cp);
          }
        }
      }
      // Bogus comment state
      //------------------------------------------------------------------
      _stateBogusComment(cp) {
        const token = this.currentToken;
        switch (cp) {
          case CODE_POINTS.GREATER_THAN_SIGN: {
            this.state = State.DATA;
            this.emitCurrentComment(token);
            break;
          }
          case CODE_POINTS.EOF: {
            this.emitCurrentComment(token);
            this._emitEOFToken();
            break;
          }
          case CODE_POINTS.NULL: {
            this._err(ERR.unexpectedNullCharacter);
            token.data += REPLACEMENT_CHARACTER;
            break;
          }
          default: {
            token.data += String.fromCodePoint(cp);
          }
        }
      }
      // Markup declaration open state
      //------------------------------------------------------------------
      _stateMarkupDeclarationOpen(cp) {
        if (this._consumeSequenceIfMatch(SEQUENCES.DASH_DASH, true)) {
          this._createCommentToken(SEQUENCES.DASH_DASH.length + 1);
          this.state = State.COMMENT_START;
        } else if (this._consumeSequenceIfMatch(SEQUENCES.DOCTYPE, false)) {
          this.currentLocation = this.getCurrentLocation(SEQUENCES.DOCTYPE.length + 1);
          this.state = State.DOCTYPE;
        } else if (this._consumeSequenceIfMatch(SEQUENCES.CDATA_START, true)) {
          if (this.inForeignNode) {
            this.state = State.CDATA_SECTION;
          } else {
            this._err(ERR.cdataInHtmlContent);
            this._createCommentToken(SEQUENCES.CDATA_START.length + 1);
            this.currentToken.data = "[CDATA[";
            this.state = State.BOGUS_COMMENT;
          }
        } else if (!this._ensureHibernation()) {
          this._err(ERR.incorrectlyOpenedComment);
          this._createCommentToken(2);
          this.state = State.BOGUS_COMMENT;
          this._stateBogusComment(cp);
        }
      }
      // Comment start state
      //------------------------------------------------------------------
      _stateCommentStart(cp) {
        switch (cp) {
          case CODE_POINTS.HYPHEN_MINUS: {
            this.state = State.COMMENT_START_DASH;
            break;
          }
          case CODE_POINTS.GREATER_THAN_SIGN: {
            this._err(ERR.abruptClosingOfEmptyComment);
            this.state = State.DATA;
            const token = this.currentToken;
            this.emitCurrentComment(token);
            break;
          }
          default: {
            this.state = State.COMMENT;
            this._stateComment(cp);
          }
        }
      }
      // Comment start dash state
      //------------------------------------------------------------------
      _stateCommentStartDash(cp) {
        const token = this.currentToken;
        switch (cp) {
          case CODE_POINTS.HYPHEN_MINUS: {
            this.state = State.COMMENT_END;
            break;
          }
          case CODE_POINTS.GREATER_THAN_SIGN: {
            this._err(ERR.abruptClosingOfEmptyComment);
            this.state = State.DATA;
            this.emitCurrentComment(token);
            break;
          }
          case CODE_POINTS.EOF: {
            this._err(ERR.eofInComment);
            this.emitCurrentComment(token);
            this._emitEOFToken();
            break;
          }
          default: {
            token.data += "-";
            this.state = State.COMMENT;
            this._stateComment(cp);
          }
        }
      }
      // Comment state
      //------------------------------------------------------------------
      _stateComment(cp) {
        const token = this.currentToken;
        switch (cp) {
          case CODE_POINTS.HYPHEN_MINUS: {
            this.state = State.COMMENT_END_DASH;
            break;
          }
          case CODE_POINTS.LESS_THAN_SIGN: {
            token.data += "<";
            this.state = State.COMMENT_LESS_THAN_SIGN;
            break;
          }
          case CODE_POINTS.NULL: {
            this._err(ERR.unexpectedNullCharacter);
            token.data += REPLACEMENT_CHARACTER;
            break;
          }
          case CODE_POINTS.EOF: {
            this._err(ERR.eofInComment);
            this.emitCurrentComment(token);
            this._emitEOFToken();
            break;
          }
          default: {
            token.data += String.fromCodePoint(cp);
          }
        }
      }
      // Comment less-than sign state
      //------------------------------------------------------------------
      _stateCommentLessThanSign(cp) {
        const token = this.currentToken;
        switch (cp) {
          case CODE_POINTS.EXCLAMATION_MARK: {
            token.data += "!";
            this.state = State.COMMENT_LESS_THAN_SIGN_BANG;
            break;
          }
          case CODE_POINTS.LESS_THAN_SIGN: {
            token.data += "<";
            break;
          }
          default: {
            this.state = State.COMMENT;
            this._stateComment(cp);
          }
        }
      }
      // Comment less-than sign bang state
      //------------------------------------------------------------------
      _stateCommentLessThanSignBang(cp) {
        if (cp === CODE_POINTS.HYPHEN_MINUS) {
          this.state = State.COMMENT_LESS_THAN_SIGN_BANG_DASH;
        } else {
          this.state = State.COMMENT;
          this._stateComment(cp);
        }
      }
      // Comment less-than sign bang dash state
      //------------------------------------------------------------------
      _stateCommentLessThanSignBangDash(cp) {
        if (cp === CODE_POINTS.HYPHEN_MINUS) {
          this.state = State.COMMENT_LESS_THAN_SIGN_BANG_DASH_DASH;
        } else {
          this.state = State.COMMENT_END_DASH;
          this._stateCommentEndDash(cp);
        }
      }
      // Comment less-than sign bang dash dash state
      //------------------------------------------------------------------
      _stateCommentLessThanSignBangDashDash(cp) {
        if (cp !== CODE_POINTS.GREATER_THAN_SIGN && cp !== CODE_POINTS.EOF) {
          this._err(ERR.nestedComment);
        }
        this.state = State.COMMENT_END;
        this._stateCommentEnd(cp);
      }
      // Comment end dash state
      //------------------------------------------------------------------
      _stateCommentEndDash(cp) {
        const token = this.currentToken;
        switch (cp) {
          case CODE_POINTS.HYPHEN_MINUS: {
            this.state = State.COMMENT_END;
            break;
          }
          case CODE_POINTS.EOF: {
            this._err(ERR.eofInComment);
            this.emitCurrentComment(token);
            this._emitEOFToken();
            break;
          }
          default: {
            token.data += "-";
            this.state = State.COMMENT;
            this._stateComment(cp);
          }
        }
      }
      // Comment end state
      //------------------------------------------------------------------
      _stateCommentEnd(cp) {
        const token = this.currentToken;
        switch (cp) {
          case CODE_POINTS.GREATER_THAN_SIGN: {
            this.state = State.DATA;
            this.emitCurrentComment(token);
            break;
          }
          case CODE_POINTS.EXCLAMATION_MARK: {
            this.state = State.COMMENT_END_BANG;
            break;
          }
          case CODE_POINTS.HYPHEN_MINUS: {
            token.data += "-";
            break;
          }
          case CODE_POINTS.EOF: {
            this._err(ERR.eofInComment);
            this.emitCurrentComment(token);
            this._emitEOFToken();
            break;
          }
          default: {
            token.data += "--";
            this.state = State.COMMENT;
            this._stateComment(cp);
          }
        }
      }
      // Comment end bang state
      //------------------------------------------------------------------
      _stateCommentEndBang(cp) {
        const token = this.currentToken;
        switch (cp) {
          case CODE_POINTS.HYPHEN_MINUS: {
            token.data += "--!";
            this.state = State.COMMENT_END_DASH;
            break;
          }
          case CODE_POINTS.GREATER_THAN_SIGN: {
            this._err(ERR.incorrectlyClosedComment);
            this.state = State.DATA;
            this.emitCurrentComment(token);
            break;
          }
          case CODE_POINTS.EOF: {
            this._err(ERR.eofInComment);
            this.emitCurrentComment(token);
            this._emitEOFToken();
            break;
          }
          default: {
            token.data += "--!";
            this.state = State.COMMENT;
            this._stateComment(cp);
          }
        }
      }
      // DOCTYPE state
      //------------------------------------------------------------------
      _stateDoctype(cp) {
        switch (cp) {
          case CODE_POINTS.SPACE:
          case CODE_POINTS.LINE_FEED:
          case CODE_POINTS.TABULATION:
          case CODE_POINTS.FORM_FEED: {
            this.state = State.BEFORE_DOCTYPE_NAME;
            break;
          }
          case CODE_POINTS.GREATER_THAN_SIGN: {
            this.state = State.BEFORE_DOCTYPE_NAME;
            this._stateBeforeDoctypeName(cp);
            break;
          }
          case CODE_POINTS.EOF: {
            this._err(ERR.eofInDoctype);
            this._createDoctypeToken(null);
            const token = this.currentToken;
            token.forceQuirks = true;
            this.emitCurrentDoctype(token);
            this._emitEOFToken();
            break;
          }
          default: {
            this._err(ERR.missingWhitespaceBeforeDoctypeName);
            this.state = State.BEFORE_DOCTYPE_NAME;
            this._stateBeforeDoctypeName(cp);
          }
        }
      }
      // Before DOCTYPE name state
      //------------------------------------------------------------------
      _stateBeforeDoctypeName(cp) {
        if (isAsciiUpper(cp)) {
          this._createDoctypeToken(String.fromCharCode(toAsciiLower(cp)));
          this.state = State.DOCTYPE_NAME;
        } else
          switch (cp) {
            case CODE_POINTS.SPACE:
            case CODE_POINTS.LINE_FEED:
            case CODE_POINTS.TABULATION:
            case CODE_POINTS.FORM_FEED: {
              break;
            }
            case CODE_POINTS.NULL: {
              this._err(ERR.unexpectedNullCharacter);
              this._createDoctypeToken(REPLACEMENT_CHARACTER);
              this.state = State.DOCTYPE_NAME;
              break;
            }
            case CODE_POINTS.GREATER_THAN_SIGN: {
              this._err(ERR.missingDoctypeName);
              this._createDoctypeToken(null);
              const token = this.currentToken;
              token.forceQuirks = true;
              this.emitCurrentDoctype(token);
              this.state = State.DATA;
              break;
            }
            case CODE_POINTS.EOF: {
              this._err(ERR.eofInDoctype);
              this._createDoctypeToken(null);
              const token = this.currentToken;
              token.forceQuirks = true;
              this.emitCurrentDoctype(token);
              this._emitEOFToken();
              break;
            }
            default: {
              this._createDoctypeToken(String.fromCodePoint(cp));
              this.state = State.DOCTYPE_NAME;
            }
          }
      }
      // DOCTYPE name state
      //------------------------------------------------------------------
      _stateDoctypeName(cp) {
        const token = this.currentToken;
        switch (cp) {
          case CODE_POINTS.SPACE:
          case CODE_POINTS.LINE_FEED:
          case CODE_POINTS.TABULATION:
          case CODE_POINTS.FORM_FEED: {
            this.state = State.AFTER_DOCTYPE_NAME;
            break;
          }
          case CODE_POINTS.GREATER_THAN_SIGN: {
            this.state = State.DATA;
            this.emitCurrentDoctype(token);
            break;
          }
          case CODE_POINTS.NULL: {
            this._err(ERR.unexpectedNullCharacter);
            token.name += REPLACEMENT_CHARACTER;
            break;
          }
          case CODE_POINTS.EOF: {
            this._err(ERR.eofInDoctype);
            token.forceQuirks = true;
            this.emitCurrentDoctype(token);
            this._emitEOFToken();
            break;
          }
          default: {
            token.name += String.fromCodePoint(isAsciiUpper(cp) ? toAsciiLower(cp) : cp);
          }
        }
      }
      // After DOCTYPE name state
      //------------------------------------------------------------------
      _stateAfterDoctypeName(cp) {
        const token = this.currentToken;
        switch (cp) {
          case CODE_POINTS.SPACE:
          case CODE_POINTS.LINE_FEED:
          case CODE_POINTS.TABULATION:
          case CODE_POINTS.FORM_FEED: {
            break;
          }
          case CODE_POINTS.GREATER_THAN_SIGN: {
            this.state = State.DATA;
            this.emitCurrentDoctype(token);
            break;
          }
          case CODE_POINTS.EOF: {
            this._err(ERR.eofInDoctype);
            token.forceQuirks = true;
            this.emitCurrentDoctype(token);
            this._emitEOFToken();
            break;
          }
          default: {
            if (this._consumeSequenceIfMatch(SEQUENCES.PUBLIC, false)) {
              this.state = State.AFTER_DOCTYPE_PUBLIC_KEYWORD;
            } else if (this._consumeSequenceIfMatch(SEQUENCES.SYSTEM, false)) {
              this.state = State.AFTER_DOCTYPE_SYSTEM_KEYWORD;
            } else if (!this._ensureHibernation()) {
              this._err(ERR.invalidCharacterSequenceAfterDoctypeName);
              token.forceQuirks = true;
              this.state = State.BOGUS_DOCTYPE;
              this._stateBogusDoctype(cp);
            }
          }
        }
      }
      // After DOCTYPE public keyword state
      //------------------------------------------------------------------
      _stateAfterDoctypePublicKeyword(cp) {
        const token = this.currentToken;
        switch (cp) {
          case CODE_POINTS.SPACE:
          case CODE_POINTS.LINE_FEED:
          case CODE_POINTS.TABULATION:
          case CODE_POINTS.FORM_FEED: {
            this.state = State.BEFORE_DOCTYPE_PUBLIC_IDENTIFIER;
            break;
          }
          case CODE_POINTS.QUOTATION_MARK: {
            this._err(ERR.missingWhitespaceAfterDoctypePublicKeyword);
            token.publicId = "";
            this.state = State.DOCTYPE_PUBLIC_IDENTIFIER_DOUBLE_QUOTED;
            break;
          }
          case CODE_POINTS.APOSTROPHE: {
            this._err(ERR.missingWhitespaceAfterDoctypePublicKeyword);
            token.publicId = "";
            this.state = State.DOCTYPE_PUBLIC_IDENTIFIER_SINGLE_QUOTED;
            break;
          }
          case CODE_POINTS.GREATER_THAN_SIGN: {
            this._err(ERR.missingDoctypePublicIdentifier);
            token.forceQuirks = true;
            this.state = State.DATA;
            this.emitCurrentDoctype(token);
            break;
          }
          case CODE_POINTS.EOF: {
            this._err(ERR.eofInDoctype);
            token.forceQuirks = true;
            this.emitCurrentDoctype(token);
            this._emitEOFToken();
            break;
          }
          default: {
            this._err(ERR.missingQuoteBeforeDoctypePublicIdentifier);
            token.forceQuirks = true;
            this.state = State.BOGUS_DOCTYPE;
            this._stateBogusDoctype(cp);
          }
        }
      }
      // Before DOCTYPE public identifier state
      //------------------------------------------------------------------
      _stateBeforeDoctypePublicIdentifier(cp) {
        const token = this.currentToken;
        switch (cp) {
          case CODE_POINTS.SPACE:
          case CODE_POINTS.LINE_FEED:
          case CODE_POINTS.TABULATION:
          case CODE_POINTS.FORM_FEED: {
            break;
          }
          case CODE_POINTS.QUOTATION_MARK: {
            token.publicId = "";
            this.state = State.DOCTYPE_PUBLIC_IDENTIFIER_DOUBLE_QUOTED;
            break;
          }
          case CODE_POINTS.APOSTROPHE: {
            token.publicId = "";
            this.state = State.DOCTYPE_PUBLIC_IDENTIFIER_SINGLE_QUOTED;
            break;
          }
          case CODE_POINTS.GREATER_THAN_SIGN: {
            this._err(ERR.missingDoctypePublicIdentifier);
            token.forceQuirks = true;
            this.state = State.DATA;
            this.emitCurrentDoctype(token);
            break;
          }
          case CODE_POINTS.EOF: {
            this._err(ERR.eofInDoctype);
            token.forceQuirks = true;
            this.emitCurrentDoctype(token);
            this._emitEOFToken();
            break;
          }
          default: {
            this._err(ERR.missingQuoteBeforeDoctypePublicIdentifier);
            token.forceQuirks = true;
            this.state = State.BOGUS_DOCTYPE;
            this._stateBogusDoctype(cp);
          }
        }
      }
      // DOCTYPE public identifier (double-quoted) state
      //------------------------------------------------------------------
      _stateDoctypePublicIdentifierDoubleQuoted(cp) {
        const token = this.currentToken;
        switch (cp) {
          case CODE_POINTS.QUOTATION_MARK: {
            this.state = State.AFTER_DOCTYPE_PUBLIC_IDENTIFIER;
            break;
          }
          case CODE_POINTS.NULL: {
            this._err(ERR.unexpectedNullCharacter);
            token.publicId += REPLACEMENT_CHARACTER;
            break;
          }
          case CODE_POINTS.GREATER_THAN_SIGN: {
            this._err(ERR.abruptDoctypePublicIdentifier);
            token.forceQuirks = true;
            this.emitCurrentDoctype(token);
            this.state = State.DATA;
            break;
          }
          case CODE_POINTS.EOF: {
            this._err(ERR.eofInDoctype);
            token.forceQuirks = true;
            this.emitCurrentDoctype(token);
            this._emitEOFToken();
            break;
          }
          default: {
            token.publicId += String.fromCodePoint(cp);
          }
        }
      }
      // DOCTYPE public identifier (single-quoted) state
      //------------------------------------------------------------------
      _stateDoctypePublicIdentifierSingleQuoted(cp) {
        const token = this.currentToken;
        switch (cp) {
          case CODE_POINTS.APOSTROPHE: {
            this.state = State.AFTER_DOCTYPE_PUBLIC_IDENTIFIER;
            break;
          }
          case CODE_POINTS.NULL: {
            this._err(ERR.unexpectedNullCharacter);
            token.publicId += REPLACEMENT_CHARACTER;
            break;
          }
          case CODE_POINTS.GREATER_THAN_SIGN: {
            this._err(ERR.abruptDoctypePublicIdentifier);
            token.forceQuirks = true;
            this.emitCurrentDoctype(token);
            this.state = State.DATA;
            break;
          }
          case CODE_POINTS.EOF: {
            this._err(ERR.eofInDoctype);
            token.forceQuirks = true;
            this.emitCurrentDoctype(token);
            this._emitEOFToken();
            break;
          }
          default: {
            token.publicId += String.fromCodePoint(cp);
          }
        }
      }
      // After DOCTYPE public identifier state
      //------------------------------------------------------------------
      _stateAfterDoctypePublicIdentifier(cp) {
        const token = this.currentToken;
        switch (cp) {
          case CODE_POINTS.SPACE:
          case CODE_POINTS.LINE_FEED:
          case CODE_POINTS.TABULATION:
          case CODE_POINTS.FORM_FEED: {
            this.state = State.BETWEEN_DOCTYPE_PUBLIC_AND_SYSTEM_IDENTIFIERS;
            break;
          }
          case CODE_POINTS.GREATER_THAN_SIGN: {
            this.state = State.DATA;
            this.emitCurrentDoctype(token);
            break;
          }
          case CODE_POINTS.QUOTATION_MARK: {
            this._err(ERR.missingWhitespaceBetweenDoctypePublicAndSystemIdentifiers);
            token.systemId = "";
            this.state = State.DOCTYPE_SYSTEM_IDENTIFIER_DOUBLE_QUOTED;
            break;
          }
          case CODE_POINTS.APOSTROPHE: {
            this._err(ERR.missingWhitespaceBetweenDoctypePublicAndSystemIdentifiers);
            token.systemId = "";
            this.state = State.DOCTYPE_SYSTEM_IDENTIFIER_SINGLE_QUOTED;
            break;
          }
          case CODE_POINTS.EOF: {
            this._err(ERR.eofInDoctype);
            token.forceQuirks = true;
            this.emitCurrentDoctype(token);
            this._emitEOFToken();
            break;
          }
          default: {
            this._err(ERR.missingQuoteBeforeDoctypeSystemIdentifier);
            token.forceQuirks = true;
            this.state = State.BOGUS_DOCTYPE;
            this._stateBogusDoctype(cp);
          }
        }
      }
      // Between DOCTYPE public and system identifiers state
      //------------------------------------------------------------------
      _stateBetweenDoctypePublicAndSystemIdentifiers(cp) {
        const token = this.currentToken;
        switch (cp) {
          case CODE_POINTS.SPACE:
          case CODE_POINTS.LINE_FEED:
          case CODE_POINTS.TABULATION:
          case CODE_POINTS.FORM_FEED: {
            break;
          }
          case CODE_POINTS.GREATER_THAN_SIGN: {
            this.emitCurrentDoctype(token);
            this.state = State.DATA;
            break;
          }
          case CODE_POINTS.QUOTATION_MARK: {
            token.systemId = "";
            this.state = State.DOCTYPE_SYSTEM_IDENTIFIER_DOUBLE_QUOTED;
            break;
          }
          case CODE_POINTS.APOSTROPHE: {
            token.systemId = "";
            this.state = State.DOCTYPE_SYSTEM_IDENTIFIER_SINGLE_QUOTED;
            break;
          }
          case CODE_POINTS.EOF: {
            this._err(ERR.eofInDoctype);
            token.forceQuirks = true;
            this.emitCurrentDoctype(token);
            this._emitEOFToken();
            break;
          }
          default: {
            this._err(ERR.missingQuoteBeforeDoctypeSystemIdentifier);
            token.forceQuirks = true;
            this.state = State.BOGUS_DOCTYPE;
            this._stateBogusDoctype(cp);
          }
        }
      }
      // After DOCTYPE system keyword state
      //------------------------------------------------------------------
      _stateAfterDoctypeSystemKeyword(cp) {
        const token = this.currentToken;
        switch (cp) {
          case CODE_POINTS.SPACE:
          case CODE_POINTS.LINE_FEED:
          case CODE_POINTS.TABULATION:
          case CODE_POINTS.FORM_FEED: {
            this.state = State.BEFORE_DOCTYPE_SYSTEM_IDENTIFIER;
            break;
          }
          case CODE_POINTS.QUOTATION_MARK: {
            this._err(ERR.missingWhitespaceAfterDoctypeSystemKeyword);
            token.systemId = "";
            this.state = State.DOCTYPE_SYSTEM_IDENTIFIER_DOUBLE_QUOTED;
            break;
          }
          case CODE_POINTS.APOSTROPHE: {
            this._err(ERR.missingWhitespaceAfterDoctypeSystemKeyword);
            token.systemId = "";
            this.state = State.DOCTYPE_SYSTEM_IDENTIFIER_SINGLE_QUOTED;
            break;
          }
          case CODE_POINTS.GREATER_THAN_SIGN: {
            this._err(ERR.missingDoctypeSystemIdentifier);
            token.forceQuirks = true;
            this.state = State.DATA;
            this.emitCurrentDoctype(token);
            break;
          }
          case CODE_POINTS.EOF: {
            this._err(ERR.eofInDoctype);
            token.forceQuirks = true;
            this.emitCurrentDoctype(token);
            this._emitEOFToken();
            break;
          }
          default: {
            this._err(ERR.missingQuoteBeforeDoctypeSystemIdentifier);
            token.forceQuirks = true;
            this.state = State.BOGUS_DOCTYPE;
            this._stateBogusDoctype(cp);
          }
        }
      }
      // Before DOCTYPE system identifier state
      //------------------------------------------------------------------
      _stateBeforeDoctypeSystemIdentifier(cp) {
        const token = this.currentToken;
        switch (cp) {
          case CODE_POINTS.SPACE:
          case CODE_POINTS.LINE_FEED:
          case CODE_POINTS.TABULATION:
          case CODE_POINTS.FORM_FEED: {
            break;
          }
          case CODE_POINTS.QUOTATION_MARK: {
            token.systemId = "";
            this.state = State.DOCTYPE_SYSTEM_IDENTIFIER_DOUBLE_QUOTED;
            break;
          }
          case CODE_POINTS.APOSTROPHE: {
            token.systemId = "";
            this.state = State.DOCTYPE_SYSTEM_IDENTIFIER_SINGLE_QUOTED;
            break;
          }
          case CODE_POINTS.GREATER_THAN_SIGN: {
            this._err(ERR.missingDoctypeSystemIdentifier);
            token.forceQuirks = true;
            this.state = State.DATA;
            this.emitCurrentDoctype(token);
            break;
          }
          case CODE_POINTS.EOF: {
            this._err(ERR.eofInDoctype);
            token.forceQuirks = true;
            this.emitCurrentDoctype(token);
            this._emitEOFToken();
            break;
          }
          default: {
            this._err(ERR.missingQuoteBeforeDoctypeSystemIdentifier);
            token.forceQuirks = true;
            this.state = State.BOGUS_DOCTYPE;
            this._stateBogusDoctype(cp);
          }
        }
      }
      // DOCTYPE system identifier (double-quoted) state
      //------------------------------------------------------------------
      _stateDoctypeSystemIdentifierDoubleQuoted(cp) {
        const token = this.currentToken;
        switch (cp) {
          case CODE_POINTS.QUOTATION_MARK: {
            this.state = State.AFTER_DOCTYPE_SYSTEM_IDENTIFIER;
            break;
          }
          case CODE_POINTS.NULL: {
            this._err(ERR.unexpectedNullCharacter);
            token.systemId += REPLACEMENT_CHARACTER;
            break;
          }
          case CODE_POINTS.GREATER_THAN_SIGN: {
            this._err(ERR.abruptDoctypeSystemIdentifier);
            token.forceQuirks = true;
            this.emitCurrentDoctype(token);
            this.state = State.DATA;
            break;
          }
          case CODE_POINTS.EOF: {
            this._err(ERR.eofInDoctype);
            token.forceQuirks = true;
            this.emitCurrentDoctype(token);
            this._emitEOFToken();
            break;
          }
          default: {
            token.systemId += String.fromCodePoint(cp);
          }
        }
      }
      // DOCTYPE system identifier (single-quoted) state
      //------------------------------------------------------------------
      _stateDoctypeSystemIdentifierSingleQuoted(cp) {
        const token = this.currentToken;
        switch (cp) {
          case CODE_POINTS.APOSTROPHE: {
            this.state = State.AFTER_DOCTYPE_SYSTEM_IDENTIFIER;
            break;
          }
          case CODE_POINTS.NULL: {
            this._err(ERR.unexpectedNullCharacter);
            token.systemId += REPLACEMENT_CHARACTER;
            break;
          }
          case CODE_POINTS.GREATER_THAN_SIGN: {
            this._err(ERR.abruptDoctypeSystemIdentifier);
            token.forceQuirks = true;
            this.emitCurrentDoctype(token);
            this.state = State.DATA;
            break;
          }
          case CODE_POINTS.EOF: {
            this._err(ERR.eofInDoctype);
            token.forceQuirks = true;
            this.emitCurrentDoctype(token);
            this._emitEOFToken();
            break;
          }
          default: {
            token.systemId += String.fromCodePoint(cp);
          }
        }
      }
      // After DOCTYPE system identifier state
      //------------------------------------------------------------------
      _stateAfterDoctypeSystemIdentifier(cp) {
        const token = this.currentToken;
        switch (cp) {
          case CODE_POINTS.SPACE:
          case CODE_POINTS.LINE_FEED:
          case CODE_POINTS.TABULATION:
          case CODE_POINTS.FORM_FEED: {
            break;
          }
          case CODE_POINTS.GREATER_THAN_SIGN: {
            this.emitCurrentDoctype(token);
            this.state = State.DATA;
            break;
          }
          case CODE_POINTS.EOF: {
            this._err(ERR.eofInDoctype);
            token.forceQuirks = true;
            this.emitCurrentDoctype(token);
            this._emitEOFToken();
            break;
          }
          default: {
            this._err(ERR.unexpectedCharacterAfterDoctypeSystemIdentifier);
            this.state = State.BOGUS_DOCTYPE;
            this._stateBogusDoctype(cp);
          }
        }
      }
      // Bogus DOCTYPE state
      //------------------------------------------------------------------
      _stateBogusDoctype(cp) {
        const token = this.currentToken;
        switch (cp) {
          case CODE_POINTS.GREATER_THAN_SIGN: {
            this.emitCurrentDoctype(token);
            this.state = State.DATA;
            break;
          }
          case CODE_POINTS.NULL: {
            this._err(ERR.unexpectedNullCharacter);
            break;
          }
          case CODE_POINTS.EOF: {
            this.emitCurrentDoctype(token);
            this._emitEOFToken();
            break;
          }
          default:
        }
      }
      // CDATA section state
      //------------------------------------------------------------------
      _stateCdataSection(cp) {
        switch (cp) {
          case CODE_POINTS.RIGHT_SQUARE_BRACKET: {
            this.state = State.CDATA_SECTION_BRACKET;
            break;
          }
          case CODE_POINTS.EOF: {
            this._err(ERR.eofInCdata);
            this._emitEOFToken();
            break;
          }
          default: {
            this._emitCodePoint(cp);
          }
        }
      }
      // CDATA section bracket state
      //------------------------------------------------------------------
      _stateCdataSectionBracket(cp) {
        if (cp === CODE_POINTS.RIGHT_SQUARE_BRACKET) {
          this.state = State.CDATA_SECTION_END;
        } else {
          this._emitChars("]");
          this.state = State.CDATA_SECTION;
          this._stateCdataSection(cp);
        }
      }
      // CDATA section end state
      //------------------------------------------------------------------
      _stateCdataSectionEnd(cp) {
        switch (cp) {
          case CODE_POINTS.GREATER_THAN_SIGN: {
            this.state = State.DATA;
            break;
          }
          case CODE_POINTS.RIGHT_SQUARE_BRACKET: {
            this._emitChars("]");
            break;
          }
          default: {
            this._emitChars("]]");
            this.state = State.CDATA_SECTION;
            this._stateCdataSection(cp);
          }
        }
      }
      // Character reference state
      //------------------------------------------------------------------
      _stateCharacterReference() {
        let length = this.entityDecoder.write(this.preprocessor.html, this.preprocessor.pos);
        if (length < 0) {
          if (this.preprocessor.lastChunkWritten) {
            length = this.entityDecoder.end();
          } else {
            this.active = false;
            this.preprocessor.pos = this.preprocessor.html.length - 1;
            this.consumedAfterSnapshot = 0;
            this.preprocessor.endOfChunkHit = true;
            return;
          }
        }
        if (length === 0) {
          this.preprocessor.pos = this.entityStartPos;
          this._flushCodePointConsumedAsCharacterReference(CODE_POINTS.AMPERSAND);
          this.state = !this._isCharacterReferenceInAttribute() && isAsciiAlphaNumeric2(this.preprocessor.peek(1)) ? State.AMBIGUOUS_AMPERSAND : this.returnState;
        } else {
          this.state = this.returnState;
        }
      }
      // Ambiguos ampersand state
      //------------------------------------------------------------------
      _stateAmbiguousAmpersand(cp) {
        if (isAsciiAlphaNumeric2(cp)) {
          this._flushCodePointConsumedAsCharacterReference(cp);
        } else {
          if (cp === CODE_POINTS.SEMICOLON) {
            this._err(ERR.unknownNamedCharacterReference);
          }
          this.state = this.returnState;
          this._callState(cp);
        }
      }
    };
  }
});

// node_modules/parse5/dist/parser/open-element-stack.js
var IMPLICIT_END_TAG_REQUIRED, IMPLICIT_END_TAG_REQUIRED_THOROUGHLY, SCOPING_ELEMENTS_HTML, SCOPING_ELEMENTS_HTML_LIST, SCOPING_ELEMENTS_HTML_BUTTON, SCOPING_ELEMENTS_MATHML, SCOPING_ELEMENTS_SVG, TABLE_ROW_CONTEXT, TABLE_BODY_CONTEXT, TABLE_CONTEXT, TABLE_CELLS, OpenElementStack;
var init_open_element_stack = __esm({
  "node_modules/parse5/dist/parser/open-element-stack.js"() {
    init_html();
    IMPLICIT_END_TAG_REQUIRED = /* @__PURE__ */ new Set([TAG_ID.DD, TAG_ID.DT, TAG_ID.LI, TAG_ID.OPTGROUP, TAG_ID.OPTION, TAG_ID.P, TAG_ID.RB, TAG_ID.RP, TAG_ID.RT, TAG_ID.RTC]);
    IMPLICIT_END_TAG_REQUIRED_THOROUGHLY = /* @__PURE__ */ new Set([
      ...IMPLICIT_END_TAG_REQUIRED,
      TAG_ID.CAPTION,
      TAG_ID.COLGROUP,
      TAG_ID.TBODY,
      TAG_ID.TD,
      TAG_ID.TFOOT,
      TAG_ID.TH,
      TAG_ID.THEAD,
      TAG_ID.TR
    ]);
    SCOPING_ELEMENTS_HTML = /* @__PURE__ */ new Set([
      TAG_ID.APPLET,
      TAG_ID.CAPTION,
      TAG_ID.HTML,
      TAG_ID.MARQUEE,
      TAG_ID.OBJECT,
      TAG_ID.TABLE,
      TAG_ID.TD,
      TAG_ID.TEMPLATE,
      TAG_ID.TH
    ]);
    SCOPING_ELEMENTS_HTML_LIST = /* @__PURE__ */ new Set([...SCOPING_ELEMENTS_HTML, TAG_ID.OL, TAG_ID.UL]);
    SCOPING_ELEMENTS_HTML_BUTTON = /* @__PURE__ */ new Set([...SCOPING_ELEMENTS_HTML, TAG_ID.BUTTON]);
    SCOPING_ELEMENTS_MATHML = /* @__PURE__ */ new Set([TAG_ID.ANNOTATION_XML, TAG_ID.MI, TAG_ID.MN, TAG_ID.MO, TAG_ID.MS, TAG_ID.MTEXT]);
    SCOPING_ELEMENTS_SVG = /* @__PURE__ */ new Set([TAG_ID.DESC, TAG_ID.FOREIGN_OBJECT, TAG_ID.TITLE]);
    TABLE_ROW_CONTEXT = /* @__PURE__ */ new Set([TAG_ID.TR, TAG_ID.TEMPLATE, TAG_ID.HTML]);
    TABLE_BODY_CONTEXT = /* @__PURE__ */ new Set([TAG_ID.TBODY, TAG_ID.TFOOT, TAG_ID.THEAD, TAG_ID.TEMPLATE, TAG_ID.HTML]);
    TABLE_CONTEXT = /* @__PURE__ */ new Set([TAG_ID.TABLE, TAG_ID.TEMPLATE, TAG_ID.HTML]);
    TABLE_CELLS = /* @__PURE__ */ new Set([TAG_ID.TD, TAG_ID.TH]);
    OpenElementStack = class {
      get currentTmplContentOrNode() {
        return this._isInTemplate() ? this.treeAdapter.getTemplateContent(this.current) : this.current;
      }
      constructor(document, treeAdapter, handler) {
        this.treeAdapter = treeAdapter;
        this.handler = handler;
        this.items = [];
        this.tagIDs = [];
        this.stackTop = -1;
        this.tmplCount = 0;
        this.currentTagId = TAG_ID.UNKNOWN;
        this.current = document;
      }
      //Index of element
      _indexOf(element) {
        return this.items.lastIndexOf(element, this.stackTop);
      }
      //Update current element
      _isInTemplate() {
        return this.currentTagId === TAG_ID.TEMPLATE && this.treeAdapter.getNamespaceURI(this.current) === NS.HTML;
      }
      _updateCurrentElement() {
        this.current = this.items[this.stackTop];
        this.currentTagId = this.tagIDs[this.stackTop];
      }
      //Mutations
      push(element, tagID) {
        this.stackTop++;
        this.items[this.stackTop] = element;
        this.current = element;
        this.tagIDs[this.stackTop] = tagID;
        this.currentTagId = tagID;
        if (this._isInTemplate()) {
          this.tmplCount++;
        }
        this.handler.onItemPush(element, tagID, true);
      }
      pop() {
        const popped = this.current;
        if (this.tmplCount > 0 && this._isInTemplate()) {
          this.tmplCount--;
        }
        this.stackTop--;
        this._updateCurrentElement();
        this.handler.onItemPop(popped, true);
      }
      replace(oldElement, newElement) {
        const idx = this._indexOf(oldElement);
        this.items[idx] = newElement;
        if (idx === this.stackTop) {
          this.current = newElement;
        }
      }
      insertAfter(referenceElement, newElement, newElementID) {
        const insertionIdx = this._indexOf(referenceElement) + 1;
        this.items.splice(insertionIdx, 0, newElement);
        this.tagIDs.splice(insertionIdx, 0, newElementID);
        this.stackTop++;
        if (insertionIdx === this.stackTop) {
          this._updateCurrentElement();
        }
        if (this.current && this.currentTagId !== void 0) {
          this.handler.onItemPush(this.current, this.currentTagId, insertionIdx === this.stackTop);
        }
      }
      popUntilTagNamePopped(tagName) {
        let targetIdx = this.stackTop + 1;
        do {
          targetIdx = this.tagIDs.lastIndexOf(tagName, targetIdx - 1);
        } while (targetIdx > 0 && this.treeAdapter.getNamespaceURI(this.items[targetIdx]) !== NS.HTML);
        this.shortenToLength(Math.max(targetIdx, 0));
      }
      shortenToLength(idx) {
        while (this.stackTop >= idx) {
          const popped = this.current;
          if (this.tmplCount > 0 && this._isInTemplate()) {
            this.tmplCount -= 1;
          }
          this.stackTop--;
          this._updateCurrentElement();
          this.handler.onItemPop(popped, this.stackTop < idx);
        }
      }
      popUntilElementPopped(element) {
        const idx = this._indexOf(element);
        this.shortenToLength(Math.max(idx, 0));
      }
      popUntilPopped(tagNames, targetNS) {
        const idx = this._indexOfTagNames(tagNames, targetNS);
        this.shortenToLength(Math.max(idx, 0));
      }
      popUntilNumberedHeaderPopped() {
        this.popUntilPopped(NUMBERED_HEADERS, NS.HTML);
      }
      popUntilTableCellPopped() {
        this.popUntilPopped(TABLE_CELLS, NS.HTML);
      }
      popAllUpToHtmlElement() {
        this.tmplCount = 0;
        this.shortenToLength(1);
      }
      _indexOfTagNames(tagNames, namespace) {
        for (let i = this.stackTop; i >= 0; i--) {
          if (tagNames.has(this.tagIDs[i]) && this.treeAdapter.getNamespaceURI(this.items[i]) === namespace) {
            return i;
          }
        }
        return -1;
      }
      clearBackTo(tagNames, targetNS) {
        const idx = this._indexOfTagNames(tagNames, targetNS);
        this.shortenToLength(idx + 1);
      }
      clearBackToTableContext() {
        this.clearBackTo(TABLE_CONTEXT, NS.HTML);
      }
      clearBackToTableBodyContext() {
        this.clearBackTo(TABLE_BODY_CONTEXT, NS.HTML);
      }
      clearBackToTableRowContext() {
        this.clearBackTo(TABLE_ROW_CONTEXT, NS.HTML);
      }
      remove(element) {
        const idx = this._indexOf(element);
        if (idx >= 0) {
          if (idx === this.stackTop) {
            this.pop();
          } else {
            this.items.splice(idx, 1);
            this.tagIDs.splice(idx, 1);
            this.stackTop--;
            this._updateCurrentElement();
            this.handler.onItemPop(element, false);
          }
        }
      }
      //Search
      tryPeekProperlyNestedBodyElement() {
        return this.stackTop >= 1 && this.tagIDs[1] === TAG_ID.BODY ? this.items[1] : null;
      }
      contains(element) {
        return this._indexOf(element) > -1;
      }
      getCommonAncestor(element) {
        const elementIdx = this._indexOf(element) - 1;
        return elementIdx >= 0 ? this.items[elementIdx] : null;
      }
      isRootHtmlElementCurrent() {
        return this.stackTop === 0 && this.tagIDs[0] === TAG_ID.HTML;
      }
      //Element in scope
      hasInDynamicScope(tagName, htmlScope) {
        for (let i = this.stackTop; i >= 0; i--) {
          const tn = this.tagIDs[i];
          switch (this.treeAdapter.getNamespaceURI(this.items[i])) {
            case NS.HTML: {
              if (tn === tagName)
                return true;
              if (htmlScope.has(tn))
                return false;
              break;
            }
            case NS.SVG: {
              if (SCOPING_ELEMENTS_SVG.has(tn))
                return false;
              break;
            }
            case NS.MATHML: {
              if (SCOPING_ELEMENTS_MATHML.has(tn))
                return false;
              break;
            }
          }
        }
        return true;
      }
      hasInScope(tagName) {
        return this.hasInDynamicScope(tagName, SCOPING_ELEMENTS_HTML);
      }
      hasInListItemScope(tagName) {
        return this.hasInDynamicScope(tagName, SCOPING_ELEMENTS_HTML_LIST);
      }
      hasInButtonScope(tagName) {
        return this.hasInDynamicScope(tagName, SCOPING_ELEMENTS_HTML_BUTTON);
      }
      hasNumberedHeaderInScope() {
        for (let i = this.stackTop; i >= 0; i--) {
          const tn = this.tagIDs[i];
          switch (this.treeAdapter.getNamespaceURI(this.items[i])) {
            case NS.HTML: {
              if (NUMBERED_HEADERS.has(tn))
                return true;
              if (SCOPING_ELEMENTS_HTML.has(tn))
                return false;
              break;
            }
            case NS.SVG: {
              if (SCOPING_ELEMENTS_SVG.has(tn))
                return false;
              break;
            }
            case NS.MATHML: {
              if (SCOPING_ELEMENTS_MATHML.has(tn))
                return false;
              break;
            }
          }
        }
        return true;
      }
      hasInTableScope(tagName) {
        for (let i = this.stackTop; i >= 0; i--) {
          if (this.treeAdapter.getNamespaceURI(this.items[i]) !== NS.HTML) {
            continue;
          }
          switch (this.tagIDs[i]) {
            case tagName: {
              return true;
            }
            case TAG_ID.TABLE:
            case TAG_ID.HTML: {
              return false;
            }
          }
        }
        return true;
      }
      hasTableBodyContextInTableScope() {
        for (let i = this.stackTop; i >= 0; i--) {
          if (this.treeAdapter.getNamespaceURI(this.items[i]) !== NS.HTML) {
            continue;
          }
          switch (this.tagIDs[i]) {
            case TAG_ID.TBODY:
            case TAG_ID.THEAD:
            case TAG_ID.TFOOT: {
              return true;
            }
            case TAG_ID.TABLE:
            case TAG_ID.HTML: {
              return false;
            }
          }
        }
        return true;
      }
      hasInSelectScope(tagName) {
        for (let i = this.stackTop; i >= 0; i--) {
          if (this.treeAdapter.getNamespaceURI(this.items[i]) !== NS.HTML) {
            continue;
          }
          switch (this.tagIDs[i]) {
            case tagName: {
              return true;
            }
            case TAG_ID.OPTION:
            case TAG_ID.OPTGROUP: {
              break;
            }
            default: {
              return false;
            }
          }
        }
        return true;
      }
      //Implied end tags
      generateImpliedEndTags() {
        while (this.currentTagId !== void 0 && IMPLICIT_END_TAG_REQUIRED.has(this.currentTagId)) {
          this.pop();
        }
      }
      generateImpliedEndTagsThoroughly() {
        while (this.currentTagId !== void 0 && IMPLICIT_END_TAG_REQUIRED_THOROUGHLY.has(this.currentTagId)) {
          this.pop();
        }
      }
      generateImpliedEndTagsWithExclusion(exclusionId) {
        while (this.currentTagId !== void 0 && this.currentTagId !== exclusionId && IMPLICIT_END_TAG_REQUIRED_THOROUGHLY.has(this.currentTagId)) {
          this.pop();
        }
      }
    };
  }
});

// node_modules/parse5/dist/parser/formatting-element-list.js
var NOAH_ARK_CAPACITY, EntryType, MARKER, FormattingElementList;
var init_formatting_element_list = __esm({
  "node_modules/parse5/dist/parser/formatting-element-list.js"() {
    NOAH_ARK_CAPACITY = 3;
    (function(EntryType2) {
      EntryType2[EntryType2["Marker"] = 0] = "Marker";
      EntryType2[EntryType2["Element"] = 1] = "Element";
    })(EntryType || (EntryType = {}));
    MARKER = { type: EntryType.Marker };
    FormattingElementList = class {
      constructor(treeAdapter) {
        this.treeAdapter = treeAdapter;
        this.entries = [];
        this.bookmark = null;
      }
      //Noah Ark's condition
      //OPTIMIZATION: at first we try to find possible candidates for exclusion using
      //lightweight heuristics without thorough attributes check.
      _getNoahArkConditionCandidates(newElement, neAttrs) {
        const candidates = [];
        const neAttrsLength = neAttrs.length;
        const neTagName = this.treeAdapter.getTagName(newElement);
        const neNamespaceURI = this.treeAdapter.getNamespaceURI(newElement);
        for (let i = 0; i < this.entries.length; i++) {
          const entry2 = this.entries[i];
          if (entry2.type === EntryType.Marker) {
            break;
          }
          const { element } = entry2;
          if (this.treeAdapter.getTagName(element) === neTagName && this.treeAdapter.getNamespaceURI(element) === neNamespaceURI) {
            const elementAttrs = this.treeAdapter.getAttrList(element);
            if (elementAttrs.length === neAttrsLength) {
              candidates.push({ idx: i, attrs: elementAttrs });
            }
          }
        }
        return candidates;
      }
      _ensureNoahArkCondition(newElement) {
        if (this.entries.length < NOAH_ARK_CAPACITY)
          return;
        const neAttrs = this.treeAdapter.getAttrList(newElement);
        const candidates = this._getNoahArkConditionCandidates(newElement, neAttrs);
        if (candidates.length < NOAH_ARK_CAPACITY)
          return;
        const neAttrsMap = new Map(neAttrs.map((neAttr) => [neAttr.name, neAttr.value]));
        let validCandidates = 0;
        for (let i = 0; i < candidates.length; i++) {
          const candidate = candidates[i];
          if (candidate.attrs.every((cAttr) => neAttrsMap.get(cAttr.name) === cAttr.value)) {
            validCandidates += 1;
            if (validCandidates >= NOAH_ARK_CAPACITY) {
              this.entries.splice(candidate.idx, 1);
            }
          }
        }
      }
      //Mutations
      insertMarker() {
        this.entries.unshift(MARKER);
      }
      pushElement(element, token) {
        this._ensureNoahArkCondition(element);
        this.entries.unshift({
          type: EntryType.Element,
          element,
          token
        });
      }
      insertElementAfterBookmark(element, token) {
        const bookmarkIdx = this.entries.indexOf(this.bookmark);
        this.entries.splice(bookmarkIdx, 0, {
          type: EntryType.Element,
          element,
          token
        });
      }
      removeEntry(entry2) {
        const entryIndex = this.entries.indexOf(entry2);
        if (entryIndex !== -1) {
          this.entries.splice(entryIndex, 1);
        }
      }
      /**
       * Clears the list of formatting elements up to the last marker.
       *
       * @see https://html.spec.whatwg.org/multipage/parsing.html#clear-the-list-of-active-formatting-elements-up-to-the-last-marker
       */
      clearToLastMarker() {
        const markerIdx = this.entries.indexOf(MARKER);
        if (markerIdx === -1) {
          this.entries.length = 0;
        } else {
          this.entries.splice(0, markerIdx + 1);
        }
      }
      //Search
      getElementEntryInScopeWithTagName(tagName) {
        const entry2 = this.entries.find((entry3) => entry3.type === EntryType.Marker || this.treeAdapter.getTagName(entry3.element) === tagName);
        return entry2 && entry2.type === EntryType.Element ? entry2 : null;
      }
      getElementEntry(element) {
        return this.entries.find((entry2) => entry2.type === EntryType.Element && entry2.element === element);
      }
    };
  }
});

// node_modules/parse5/dist/tree-adapters/default.js
var defaultTreeAdapter;
var init_default = __esm({
  "node_modules/parse5/dist/tree-adapters/default.js"() {
    init_html();
    defaultTreeAdapter = {
      //Node construction
      createDocument() {
        return {
          nodeName: "#document",
          mode: DOCUMENT_MODE.NO_QUIRKS,
          childNodes: []
        };
      },
      createDocumentFragment() {
        return {
          nodeName: "#document-fragment",
          childNodes: []
        };
      },
      createElement(tagName, namespaceURI, attrs) {
        return {
          nodeName: tagName,
          tagName,
          attrs,
          namespaceURI,
          childNodes: [],
          parentNode: null
        };
      },
      createCommentNode(data) {
        return {
          nodeName: "#comment",
          data,
          parentNode: null
        };
      },
      createTextNode(value) {
        return {
          nodeName: "#text",
          value,
          parentNode: null
        };
      },
      //Tree mutation
      appendChild(parentNode, newNode) {
        parentNode.childNodes.push(newNode);
        newNode.parentNode = parentNode;
      },
      insertBefore(parentNode, newNode, referenceNode) {
        const insertionIdx = parentNode.childNodes.indexOf(referenceNode);
        parentNode.childNodes.splice(insertionIdx, 0, newNode);
        newNode.parentNode = parentNode;
      },
      setTemplateContent(templateElement, contentElement) {
        templateElement.content = contentElement;
      },
      getTemplateContent(templateElement) {
        return templateElement.content;
      },
      setDocumentType(document, name, publicId, systemId) {
        const doctypeNode = document.childNodes.find((node) => node.nodeName === "#documentType");
        if (doctypeNode) {
          doctypeNode.name = name;
          doctypeNode.publicId = publicId;
          doctypeNode.systemId = systemId;
        } else {
          const node = {
            nodeName: "#documentType",
            name,
            publicId,
            systemId,
            parentNode: null
          };
          defaultTreeAdapter.appendChild(document, node);
        }
      },
      setDocumentMode(document, mode) {
        document.mode = mode;
      },
      getDocumentMode(document) {
        return document.mode;
      },
      detachNode(node) {
        if (node.parentNode) {
          const idx = node.parentNode.childNodes.indexOf(node);
          node.parentNode.childNodes.splice(idx, 1);
          node.parentNode = null;
        }
      },
      insertText(parentNode, text) {
        if (parentNode.childNodes.length > 0) {
          const prevNode = parentNode.childNodes[parentNode.childNodes.length - 1];
          if (defaultTreeAdapter.isTextNode(prevNode)) {
            prevNode.value += text;
            return;
          }
        }
        defaultTreeAdapter.appendChild(parentNode, defaultTreeAdapter.createTextNode(text));
      },
      insertTextBefore(parentNode, text, referenceNode) {
        const prevNode = parentNode.childNodes[parentNode.childNodes.indexOf(referenceNode) - 1];
        if (prevNode && defaultTreeAdapter.isTextNode(prevNode)) {
          prevNode.value += text;
        } else {
          defaultTreeAdapter.insertBefore(parentNode, defaultTreeAdapter.createTextNode(text), referenceNode);
        }
      },
      adoptAttributes(recipient, attrs) {
        const recipientAttrsMap = new Set(recipient.attrs.map((attr2) => attr2.name));
        for (let j = 0; j < attrs.length; j++) {
          if (!recipientAttrsMap.has(attrs[j].name)) {
            recipient.attrs.push(attrs[j]);
          }
        }
      },
      //Tree traversing
      getFirstChild(node) {
        return node.childNodes[0];
      },
      getChildNodes(node) {
        return node.childNodes;
      },
      getParentNode(node) {
        return node.parentNode;
      },
      getAttrList(element) {
        return element.attrs;
      },
      //Node data
      getTagName(element) {
        return element.tagName;
      },
      getNamespaceURI(element) {
        return element.namespaceURI;
      },
      getTextNodeContent(textNode) {
        return textNode.value;
      },
      getCommentNodeContent(commentNode) {
        return commentNode.data;
      },
      getDocumentTypeNodeName(doctypeNode) {
        return doctypeNode.name;
      },
      getDocumentTypeNodePublicId(doctypeNode) {
        return doctypeNode.publicId;
      },
      getDocumentTypeNodeSystemId(doctypeNode) {
        return doctypeNode.systemId;
      },
      //Node types
      isTextNode(node) {
        return node.nodeName === "#text";
      },
      isCommentNode(node) {
        return node.nodeName === "#comment";
      },
      isDocumentTypeNode(node) {
        return node.nodeName === "#documentType";
      },
      isElementNode(node) {
        return Object.prototype.hasOwnProperty.call(node, "tagName");
      },
      // Source code location
      setNodeSourceCodeLocation(node, location) {
        node.sourceCodeLocation = location;
      },
      getNodeSourceCodeLocation(node) {
        return node.sourceCodeLocation;
      },
      updateNodeSourceCodeLocation(node, endLocation) {
        node.sourceCodeLocation = { ...node.sourceCodeLocation, ...endLocation };
      }
    };
  }
});

// node_modules/parse5/dist/common/doctype.js
function hasPrefix(publicId, prefixes) {
  return prefixes.some((prefix) => publicId.startsWith(prefix));
}
function isConforming(token) {
  return token.name === VALID_DOCTYPE_NAME && token.publicId === null && (token.systemId === null || token.systemId === VALID_SYSTEM_ID);
}
function getDocumentMode(token) {
  if (token.name !== VALID_DOCTYPE_NAME) {
    return DOCUMENT_MODE.QUIRKS;
  }
  const { systemId } = token;
  if (systemId && systemId.toLowerCase() === QUIRKS_MODE_SYSTEM_ID) {
    return DOCUMENT_MODE.QUIRKS;
  }
  let { publicId } = token;
  if (publicId !== null) {
    publicId = publicId.toLowerCase();
    if (QUIRKS_MODE_PUBLIC_IDS.has(publicId)) {
      return DOCUMENT_MODE.QUIRKS;
    }
    let prefixes = systemId === null ? QUIRKS_MODE_NO_SYSTEM_ID_PUBLIC_ID_PREFIXES : QUIRKS_MODE_PUBLIC_ID_PREFIXES;
    if (hasPrefix(publicId, prefixes)) {
      return DOCUMENT_MODE.QUIRKS;
    }
    prefixes = systemId === null ? LIMITED_QUIRKS_PUBLIC_ID_PREFIXES : LIMITED_QUIRKS_WITH_SYSTEM_ID_PUBLIC_ID_PREFIXES;
    if (hasPrefix(publicId, prefixes)) {
      return DOCUMENT_MODE.LIMITED_QUIRKS;
    }
  }
  return DOCUMENT_MODE.NO_QUIRKS;
}
var VALID_DOCTYPE_NAME, VALID_SYSTEM_ID, QUIRKS_MODE_SYSTEM_ID, QUIRKS_MODE_PUBLIC_ID_PREFIXES, QUIRKS_MODE_NO_SYSTEM_ID_PUBLIC_ID_PREFIXES, QUIRKS_MODE_PUBLIC_IDS, LIMITED_QUIRKS_PUBLIC_ID_PREFIXES, LIMITED_QUIRKS_WITH_SYSTEM_ID_PUBLIC_ID_PREFIXES;
var init_doctype = __esm({
  "node_modules/parse5/dist/common/doctype.js"() {
    init_html();
    VALID_DOCTYPE_NAME = "html";
    VALID_SYSTEM_ID = "about:legacy-compat";
    QUIRKS_MODE_SYSTEM_ID = "http://www.ibm.com/data/dtd/v11/ibmxhtml1-transitional.dtd";
    QUIRKS_MODE_PUBLIC_ID_PREFIXES = [
      "+//silmaril//dtd html pro v0r11 19970101//",
      "-//as//dtd html 3.0 aswedit + extensions//",
      "-//advasoft ltd//dtd html 3.0 aswedit + extensions//",
      "-//ietf//dtd html 2.0 level 1//",
      "-//ietf//dtd html 2.0 level 2//",
      "-//ietf//dtd html 2.0 strict level 1//",
      "-//ietf//dtd html 2.0 strict level 2//",
      "-//ietf//dtd html 2.0 strict//",
      "-//ietf//dtd html 2.0//",
      "-//ietf//dtd html 2.1e//",
      "-//ietf//dtd html 3.0//",
      "-//ietf//dtd html 3.2 final//",
      "-//ietf//dtd html 3.2//",
      "-//ietf//dtd html 3//",
      "-//ietf//dtd html level 0//",
      "-//ietf//dtd html level 1//",
      "-//ietf//dtd html level 2//",
      "-//ietf//dtd html level 3//",
      "-//ietf//dtd html strict level 0//",
      "-//ietf//dtd html strict level 1//",
      "-//ietf//dtd html strict level 2//",
      "-//ietf//dtd html strict level 3//",
      "-//ietf//dtd html strict//",
      "-//ietf//dtd html//",
      "-//metrius//dtd metrius presentational//",
      "-//microsoft//dtd internet explorer 2.0 html strict//",
      "-//microsoft//dtd internet explorer 2.0 html//",
      "-//microsoft//dtd internet explorer 2.0 tables//",
      "-//microsoft//dtd internet explorer 3.0 html strict//",
      "-//microsoft//dtd internet explorer 3.0 html//",
      "-//microsoft//dtd internet explorer 3.0 tables//",
      "-//netscape comm. corp.//dtd html//",
      "-//netscape comm. corp.//dtd strict html//",
      "-//o'reilly and associates//dtd html 2.0//",
      "-//o'reilly and associates//dtd html extended 1.0//",
      "-//o'reilly and associates//dtd html extended relaxed 1.0//",
      "-//sq//dtd html 2.0 hotmetal + extensions//",
      "-//softquad software//dtd hotmetal pro 6.0::19990601::extensions to html 4.0//",
      "-//softquad//dtd hotmetal pro 4.0::19971010::extensions to html 4.0//",
      "-//spyglass//dtd html 2.0 extended//",
      "-//sun microsystems corp.//dtd hotjava html//",
      "-//sun microsystems corp.//dtd hotjava strict html//",
      "-//w3c//dtd html 3 1995-03-24//",
      "-//w3c//dtd html 3.2 draft//",
      "-//w3c//dtd html 3.2 final//",
      "-//w3c//dtd html 3.2//",
      "-//w3c//dtd html 3.2s draft//",
      "-//w3c//dtd html 4.0 frameset//",
      "-//w3c//dtd html 4.0 transitional//",
      "-//w3c//dtd html experimental 19960712//",
      "-//w3c//dtd html experimental 970421//",
      "-//w3c//dtd w3 html//",
      "-//w3o//dtd w3 html 3.0//",
      "-//webtechs//dtd mozilla html 2.0//",
      "-//webtechs//dtd mozilla html//"
    ];
    QUIRKS_MODE_NO_SYSTEM_ID_PUBLIC_ID_PREFIXES = [
      ...QUIRKS_MODE_PUBLIC_ID_PREFIXES,
      "-//w3c//dtd html 4.01 frameset//",
      "-//w3c//dtd html 4.01 transitional//"
    ];
    QUIRKS_MODE_PUBLIC_IDS = /* @__PURE__ */ new Set([
      "-//w3o//dtd w3 html strict 3.0//en//",
      "-/w3c/dtd html 4.0 transitional/en",
      "html"
    ]);
    LIMITED_QUIRKS_PUBLIC_ID_PREFIXES = ["-//w3c//dtd xhtml 1.0 frameset//", "-//w3c//dtd xhtml 1.0 transitional//"];
    LIMITED_QUIRKS_WITH_SYSTEM_ID_PUBLIC_ID_PREFIXES = [
      ...LIMITED_QUIRKS_PUBLIC_ID_PREFIXES,
      "-//w3c//dtd html 4.01 frameset//",
      "-//w3c//dtd html 4.01 transitional//"
    ];
  }
});

// node_modules/parse5/dist/common/foreign-content.js
function causesExit(startTagToken) {
  const tn = startTagToken.tagID;
  const isFontWithAttrs = tn === TAG_ID.FONT && startTagToken.attrs.some(({ name }) => name === ATTRS.COLOR || name === ATTRS.SIZE || name === ATTRS.FACE);
  return isFontWithAttrs || EXITS_FOREIGN_CONTENT.has(tn);
}
function adjustTokenMathMLAttrs(token) {
  for (let i = 0; i < token.attrs.length; i++) {
    if (token.attrs[i].name === DEFINITION_URL_ATTR) {
      token.attrs[i].name = ADJUSTED_DEFINITION_URL_ATTR;
      break;
    }
  }
}
function adjustTokenSVGAttrs(token) {
  for (let i = 0; i < token.attrs.length; i++) {
    const adjustedAttrName = SVG_ATTRS_ADJUSTMENT_MAP.get(token.attrs[i].name);
    if (adjustedAttrName != null) {
      token.attrs[i].name = adjustedAttrName;
    }
  }
}
function adjustTokenXMLAttrs(token) {
  for (let i = 0; i < token.attrs.length; i++) {
    const adjustedAttrEntry = XML_ATTRS_ADJUSTMENT_MAP.get(token.attrs[i].name);
    if (adjustedAttrEntry) {
      token.attrs[i].prefix = adjustedAttrEntry.prefix;
      token.attrs[i].name = adjustedAttrEntry.name;
      token.attrs[i].namespace = adjustedAttrEntry.namespace;
    }
  }
}
function adjustTokenSVGTagName(token) {
  const adjustedTagName = SVG_TAG_NAMES_ADJUSTMENT_MAP.get(token.tagName);
  if (adjustedTagName != null) {
    token.tagName = adjustedTagName;
    token.tagID = getTagID(token.tagName);
  }
}
function isMathMLTextIntegrationPoint(tn, ns) {
  return ns === NS.MATHML && (tn === TAG_ID.MI || tn === TAG_ID.MO || tn === TAG_ID.MN || tn === TAG_ID.MS || tn === TAG_ID.MTEXT);
}
function isHtmlIntegrationPoint(tn, ns, attrs) {
  if (ns === NS.MATHML && tn === TAG_ID.ANNOTATION_XML) {
    for (let i = 0; i < attrs.length; i++) {
      if (attrs[i].name === ATTRS.ENCODING) {
        const value = attrs[i].value.toLowerCase();
        return value === MIME_TYPES.TEXT_HTML || value === MIME_TYPES.APPLICATION_XML;
      }
    }
  }
  return ns === NS.SVG && (tn === TAG_ID.FOREIGN_OBJECT || tn === TAG_ID.DESC || tn === TAG_ID.TITLE);
}
function isIntegrationPoint(tn, ns, attrs, foreignNS) {
  return (!foreignNS || foreignNS === NS.HTML) && isHtmlIntegrationPoint(tn, ns, attrs) || (!foreignNS || foreignNS === NS.MATHML) && isMathMLTextIntegrationPoint(tn, ns);
}
var MIME_TYPES, DEFINITION_URL_ATTR, ADJUSTED_DEFINITION_URL_ATTR, SVG_ATTRS_ADJUSTMENT_MAP, XML_ATTRS_ADJUSTMENT_MAP, SVG_TAG_NAMES_ADJUSTMENT_MAP, EXITS_FOREIGN_CONTENT;
var init_foreign_content = __esm({
  "node_modules/parse5/dist/common/foreign-content.js"() {
    init_html();
    MIME_TYPES = {
      TEXT_HTML: "text/html",
      APPLICATION_XML: "application/xhtml+xml"
    };
    DEFINITION_URL_ATTR = "definitionurl";
    ADJUSTED_DEFINITION_URL_ATTR = "definitionURL";
    SVG_ATTRS_ADJUSTMENT_MAP = new Map([
      "attributeName",
      "attributeType",
      "baseFrequency",
      "baseProfile",
      "calcMode",
      "clipPathUnits",
      "diffuseConstant",
      "edgeMode",
      "filterUnits",
      "glyphRef",
      "gradientTransform",
      "gradientUnits",
      "kernelMatrix",
      "kernelUnitLength",
      "keyPoints",
      "keySplines",
      "keyTimes",
      "lengthAdjust",
      "limitingConeAngle",
      "markerHeight",
      "markerUnits",
      "markerWidth",
      "maskContentUnits",
      "maskUnits",
      "numOctaves",
      "pathLength",
      "patternContentUnits",
      "patternTransform",
      "patternUnits",
      "pointsAtX",
      "pointsAtY",
      "pointsAtZ",
      "preserveAlpha",
      "preserveAspectRatio",
      "primitiveUnits",
      "refX",
      "refY",
      "repeatCount",
      "repeatDur",
      "requiredExtensions",
      "requiredFeatures",
      "specularConstant",
      "specularExponent",
      "spreadMethod",
      "startOffset",
      "stdDeviation",
      "stitchTiles",
      "surfaceScale",
      "systemLanguage",
      "tableValues",
      "targetX",
      "targetY",
      "textLength",
      "viewBox",
      "viewTarget",
      "xChannelSelector",
      "yChannelSelector",
      "zoomAndPan"
    ].map((attr2) => [attr2.toLowerCase(), attr2]));
    XML_ATTRS_ADJUSTMENT_MAP = /* @__PURE__ */ new Map([
      ["xlink:actuate", { prefix: "xlink", name: "actuate", namespace: NS.XLINK }],
      ["xlink:arcrole", { prefix: "xlink", name: "arcrole", namespace: NS.XLINK }],
      ["xlink:href", { prefix: "xlink", name: "href", namespace: NS.XLINK }],
      ["xlink:role", { prefix: "xlink", name: "role", namespace: NS.XLINK }],
      ["xlink:show", { prefix: "xlink", name: "show", namespace: NS.XLINK }],
      ["xlink:title", { prefix: "xlink", name: "title", namespace: NS.XLINK }],
      ["xlink:type", { prefix: "xlink", name: "type", namespace: NS.XLINK }],
      ["xml:lang", { prefix: "xml", name: "lang", namespace: NS.XML }],
      ["xml:space", { prefix: "xml", name: "space", namespace: NS.XML }],
      ["xmlns", { prefix: "", name: "xmlns", namespace: NS.XMLNS }],
      ["xmlns:xlink", { prefix: "xmlns", name: "xlink", namespace: NS.XMLNS }]
    ]);
    SVG_TAG_NAMES_ADJUSTMENT_MAP = new Map([
      "altGlyph",
      "altGlyphDef",
      "altGlyphItem",
      "animateColor",
      "animateMotion",
      "animateTransform",
      "clipPath",
      "feBlend",
      "feColorMatrix",
      "feComponentTransfer",
      "feComposite",
      "feConvolveMatrix",
      "feDiffuseLighting",
      "feDisplacementMap",
      "feDistantLight",
      "feFlood",
      "feFuncA",
      "feFuncB",
      "feFuncG",
      "feFuncR",
      "feGaussianBlur",
      "feImage",
      "feMerge",
      "feMergeNode",
      "feMorphology",
      "feOffset",
      "fePointLight",
      "feSpecularLighting",
      "feSpotLight",
      "feTile",
      "feTurbulence",
      "foreignObject",
      "glyphRef",
      "linearGradient",
      "radialGradient",
      "textPath"
    ].map((tn) => [tn.toLowerCase(), tn]));
    EXITS_FOREIGN_CONTENT = /* @__PURE__ */ new Set([
      TAG_ID.B,
      TAG_ID.BIG,
      TAG_ID.BLOCKQUOTE,
      TAG_ID.BODY,
      TAG_ID.BR,
      TAG_ID.CENTER,
      TAG_ID.CODE,
      TAG_ID.DD,
      TAG_ID.DIV,
      TAG_ID.DL,
      TAG_ID.DT,
      TAG_ID.EM,
      TAG_ID.EMBED,
      TAG_ID.H1,
      TAG_ID.H2,
      TAG_ID.H3,
      TAG_ID.H4,
      TAG_ID.H5,
      TAG_ID.H6,
      TAG_ID.HEAD,
      TAG_ID.HR,
      TAG_ID.I,
      TAG_ID.IMG,
      TAG_ID.LI,
      TAG_ID.LISTING,
      TAG_ID.MENU,
      TAG_ID.META,
      TAG_ID.NOBR,
      TAG_ID.OL,
      TAG_ID.P,
      TAG_ID.PRE,
      TAG_ID.RUBY,
      TAG_ID.S,
      TAG_ID.SMALL,
      TAG_ID.SPAN,
      TAG_ID.STRONG,
      TAG_ID.STRIKE,
      TAG_ID.SUB,
      TAG_ID.SUP,
      TAG_ID.TABLE,
      TAG_ID.TT,
      TAG_ID.U,
      TAG_ID.UL,
      TAG_ID.VAR
    ]);
  }
});

// node_modules/parse5/dist/parser/index.js
function aaObtainFormattingElementEntry(p, token) {
  let formattingElementEntry = p.activeFormattingElements.getElementEntryInScopeWithTagName(token.tagName);
  if (formattingElementEntry) {
    if (!p.openElements.contains(formattingElementEntry.element)) {
      p.activeFormattingElements.removeEntry(formattingElementEntry);
      formattingElementEntry = null;
    } else if (!p.openElements.hasInScope(token.tagID)) {
      formattingElementEntry = null;
    }
  } else {
    genericEndTagInBody(p, token);
  }
  return formattingElementEntry;
}
function aaObtainFurthestBlock(p, formattingElementEntry) {
  let furthestBlock = null;
  let idx = p.openElements.stackTop;
  for (; idx >= 0; idx--) {
    const element = p.openElements.items[idx];
    if (element === formattingElementEntry.element) {
      break;
    }
    if (p._isSpecialElement(element, p.openElements.tagIDs[idx])) {
      furthestBlock = element;
    }
  }
  if (!furthestBlock) {
    p.openElements.shortenToLength(Math.max(idx, 0));
    p.activeFormattingElements.removeEntry(formattingElementEntry);
  }
  return furthestBlock;
}
function aaInnerLoop(p, furthestBlock, formattingElement) {
  let lastElement = furthestBlock;
  let nextElement = p.openElements.getCommonAncestor(furthestBlock);
  for (let i = 0, element = nextElement; element !== formattingElement; i++, element = nextElement) {
    nextElement = p.openElements.getCommonAncestor(element);
    const elementEntry = p.activeFormattingElements.getElementEntry(element);
    const counterOverflow = elementEntry && i >= AA_INNER_LOOP_ITER;
    const shouldRemoveFromOpenElements = !elementEntry || counterOverflow;
    if (shouldRemoveFromOpenElements) {
      if (counterOverflow) {
        p.activeFormattingElements.removeEntry(elementEntry);
      }
      p.openElements.remove(element);
    } else {
      element = aaRecreateElementFromEntry(p, elementEntry);
      if (lastElement === furthestBlock) {
        p.activeFormattingElements.bookmark = elementEntry;
      }
      p.treeAdapter.detachNode(lastElement);
      p.treeAdapter.appendChild(element, lastElement);
      lastElement = element;
    }
  }
  return lastElement;
}
function aaRecreateElementFromEntry(p, elementEntry) {
  const ns = p.treeAdapter.getNamespaceURI(elementEntry.element);
  const newElement = p.treeAdapter.createElement(elementEntry.token.tagName, ns, elementEntry.token.attrs);
  p.openElements.replace(elementEntry.element, newElement);
  elementEntry.element = newElement;
  return newElement;
}
function aaInsertLastNodeInCommonAncestor(p, commonAncestor, lastElement) {
  const tn = p.treeAdapter.getTagName(commonAncestor);
  const tid = getTagID(tn);
  if (p._isElementCausesFosterParenting(tid)) {
    p._fosterParentElement(lastElement);
  } else {
    const ns = p.treeAdapter.getNamespaceURI(commonAncestor);
    if (tid === TAG_ID.TEMPLATE && ns === NS.HTML) {
      commonAncestor = p.treeAdapter.getTemplateContent(commonAncestor);
    }
    p.treeAdapter.appendChild(commonAncestor, lastElement);
  }
}
function aaReplaceFormattingElement(p, furthestBlock, formattingElementEntry) {
  const ns = p.treeAdapter.getNamespaceURI(formattingElementEntry.element);
  const { token } = formattingElementEntry;
  const newElement = p.treeAdapter.createElement(token.tagName, ns, token.attrs);
  p._adoptNodes(furthestBlock, newElement);
  p.treeAdapter.appendChild(furthestBlock, newElement);
  p.activeFormattingElements.insertElementAfterBookmark(newElement, token);
  p.activeFormattingElements.removeEntry(formattingElementEntry);
  p.openElements.remove(formattingElementEntry.element);
  p.openElements.insertAfter(furthestBlock, newElement, token.tagID);
}
function callAdoptionAgency(p, token) {
  for (let i = 0; i < AA_OUTER_LOOP_ITER; i++) {
    const formattingElementEntry = aaObtainFormattingElementEntry(p, token);
    if (!formattingElementEntry) {
      break;
    }
    const furthestBlock = aaObtainFurthestBlock(p, formattingElementEntry);
    if (!furthestBlock) {
      break;
    }
    p.activeFormattingElements.bookmark = formattingElementEntry;
    const lastElement = aaInnerLoop(p, furthestBlock, formattingElementEntry.element);
    const commonAncestor = p.openElements.getCommonAncestor(formattingElementEntry.element);
    p.treeAdapter.detachNode(lastElement);
    if (commonAncestor)
      aaInsertLastNodeInCommonAncestor(p, commonAncestor, lastElement);
    aaReplaceFormattingElement(p, furthestBlock, formattingElementEntry);
  }
}
function appendComment(p, token) {
  p._appendCommentNode(token, p.openElements.currentTmplContentOrNode);
}
function appendCommentToRootHtmlElement(p, token) {
  p._appendCommentNode(token, p.openElements.items[0]);
}
function appendCommentToDocument(p, token) {
  p._appendCommentNode(token, p.document);
}
function stopParsing(p, token) {
  p.stopped = true;
  if (token.location) {
    const target = p.fragmentContext ? 0 : 2;
    for (let i = p.openElements.stackTop; i >= target; i--) {
      p._setEndLocation(p.openElements.items[i], token);
    }
    if (!p.fragmentContext && p.openElements.stackTop >= 0) {
      const htmlElement = p.openElements.items[0];
      const htmlLocation = p.treeAdapter.getNodeSourceCodeLocation(htmlElement);
      if (htmlLocation && !htmlLocation.endTag) {
        p._setEndLocation(htmlElement, token);
        if (p.openElements.stackTop >= 1) {
          const bodyElement = p.openElements.items[1];
          const bodyLocation = p.treeAdapter.getNodeSourceCodeLocation(bodyElement);
          if (bodyLocation && !bodyLocation.endTag) {
            p._setEndLocation(bodyElement, token);
          }
        }
      }
    }
  }
}
function doctypeInInitialMode(p, token) {
  p._setDocumentType(token);
  const mode = token.forceQuirks ? DOCUMENT_MODE.QUIRKS : getDocumentMode(token);
  if (!isConforming(token)) {
    p._err(token, ERR.nonConformingDoctype);
  }
  p.treeAdapter.setDocumentMode(p.document, mode);
  p.insertionMode = InsertionMode.BEFORE_HTML;
}
function tokenInInitialMode(p, token) {
  p._err(token, ERR.missingDoctype, true);
  p.treeAdapter.setDocumentMode(p.document, DOCUMENT_MODE.QUIRKS);
  p.insertionMode = InsertionMode.BEFORE_HTML;
  p._processToken(token);
}
function startTagBeforeHtml(p, token) {
  if (token.tagID === TAG_ID.HTML) {
    p._insertElement(token, NS.HTML);
    p.insertionMode = InsertionMode.BEFORE_HEAD;
  } else {
    tokenBeforeHtml(p, token);
  }
}
function endTagBeforeHtml(p, token) {
  const tn = token.tagID;
  if (tn === TAG_ID.HTML || tn === TAG_ID.HEAD || tn === TAG_ID.BODY || tn === TAG_ID.BR) {
    tokenBeforeHtml(p, token);
  }
}
function tokenBeforeHtml(p, token) {
  p._insertFakeRootElement();
  p.insertionMode = InsertionMode.BEFORE_HEAD;
  p._processToken(token);
}
function startTagBeforeHead(p, token) {
  switch (token.tagID) {
    case TAG_ID.HTML: {
      startTagInBody(p, token);
      break;
    }
    case TAG_ID.HEAD: {
      p._insertElement(token, NS.HTML);
      p.headElement = p.openElements.current;
      p.insertionMode = InsertionMode.IN_HEAD;
      break;
    }
    default: {
      tokenBeforeHead(p, token);
    }
  }
}
function endTagBeforeHead(p, token) {
  const tn = token.tagID;
  if (tn === TAG_ID.HEAD || tn === TAG_ID.BODY || tn === TAG_ID.HTML || tn === TAG_ID.BR) {
    tokenBeforeHead(p, token);
  } else {
    p._err(token, ERR.endTagWithoutMatchingOpenElement);
  }
}
function tokenBeforeHead(p, token) {
  p._insertFakeElement(TAG_NAMES.HEAD, TAG_ID.HEAD);
  p.headElement = p.openElements.current;
  p.insertionMode = InsertionMode.IN_HEAD;
  p._processToken(token);
}
function startTagInHead(p, token) {
  switch (token.tagID) {
    case TAG_ID.HTML: {
      startTagInBody(p, token);
      break;
    }
    case TAG_ID.BASE:
    case TAG_ID.BASEFONT:
    case TAG_ID.BGSOUND:
    case TAG_ID.LINK:
    case TAG_ID.META: {
      p._appendElement(token, NS.HTML);
      token.ackSelfClosing = true;
      break;
    }
    case TAG_ID.TITLE: {
      p._switchToTextParsing(token, TokenizerMode.RCDATA);
      break;
    }
    case TAG_ID.NOSCRIPT: {
      if (p.options.scriptingEnabled) {
        p._switchToTextParsing(token, TokenizerMode.RAWTEXT);
      } else {
        p._insertElement(token, NS.HTML);
        p.insertionMode = InsertionMode.IN_HEAD_NO_SCRIPT;
      }
      break;
    }
    case TAG_ID.NOFRAMES:
    case TAG_ID.STYLE: {
      p._switchToTextParsing(token, TokenizerMode.RAWTEXT);
      break;
    }
    case TAG_ID.SCRIPT: {
      p._switchToTextParsing(token, TokenizerMode.SCRIPT_DATA);
      break;
    }
    case TAG_ID.TEMPLATE: {
      p._insertTemplate(token);
      p.activeFormattingElements.insertMarker();
      p.framesetOk = false;
      p.insertionMode = InsertionMode.IN_TEMPLATE;
      p.tmplInsertionModeStack.unshift(InsertionMode.IN_TEMPLATE);
      break;
    }
    case TAG_ID.HEAD: {
      p._err(token, ERR.misplacedStartTagForHeadElement);
      break;
    }
    default: {
      tokenInHead(p, token);
    }
  }
}
function endTagInHead(p, token) {
  switch (token.tagID) {
    case TAG_ID.HEAD: {
      p.openElements.pop();
      p.insertionMode = InsertionMode.AFTER_HEAD;
      break;
    }
    case TAG_ID.BODY:
    case TAG_ID.BR:
    case TAG_ID.HTML: {
      tokenInHead(p, token);
      break;
    }
    case TAG_ID.TEMPLATE: {
      templateEndTagInHead(p, token);
      break;
    }
    default: {
      p._err(token, ERR.endTagWithoutMatchingOpenElement);
    }
  }
}
function templateEndTagInHead(p, token) {
  if (p.openElements.tmplCount > 0) {
    p.openElements.generateImpliedEndTagsThoroughly();
    if (p.openElements.currentTagId !== TAG_ID.TEMPLATE) {
      p._err(token, ERR.closingOfElementWithOpenChildElements);
    }
    p.openElements.popUntilTagNamePopped(TAG_ID.TEMPLATE);
    p.activeFormattingElements.clearToLastMarker();
    p.tmplInsertionModeStack.shift();
    p._resetInsertionMode();
  } else {
    p._err(token, ERR.endTagWithoutMatchingOpenElement);
  }
}
function tokenInHead(p, token) {
  p.openElements.pop();
  p.insertionMode = InsertionMode.AFTER_HEAD;
  p._processToken(token);
}
function startTagInHeadNoScript(p, token) {
  switch (token.tagID) {
    case TAG_ID.HTML: {
      startTagInBody(p, token);
      break;
    }
    case TAG_ID.BASEFONT:
    case TAG_ID.BGSOUND:
    case TAG_ID.HEAD:
    case TAG_ID.LINK:
    case TAG_ID.META:
    case TAG_ID.NOFRAMES:
    case TAG_ID.STYLE: {
      startTagInHead(p, token);
      break;
    }
    case TAG_ID.NOSCRIPT: {
      p._err(token, ERR.nestedNoscriptInHead);
      break;
    }
    default: {
      tokenInHeadNoScript(p, token);
    }
  }
}
function endTagInHeadNoScript(p, token) {
  switch (token.tagID) {
    case TAG_ID.NOSCRIPT: {
      p.openElements.pop();
      p.insertionMode = InsertionMode.IN_HEAD;
      break;
    }
    case TAG_ID.BR: {
      tokenInHeadNoScript(p, token);
      break;
    }
    default: {
      p._err(token, ERR.endTagWithoutMatchingOpenElement);
    }
  }
}
function tokenInHeadNoScript(p, token) {
  const errCode = token.type === TokenType.EOF ? ERR.openElementsLeftAfterEof : ERR.disallowedContentInNoscriptInHead;
  p._err(token, errCode);
  p.openElements.pop();
  p.insertionMode = InsertionMode.IN_HEAD;
  p._processToken(token);
}
function startTagAfterHead(p, token) {
  switch (token.tagID) {
    case TAG_ID.HTML: {
      startTagInBody(p, token);
      break;
    }
    case TAG_ID.BODY: {
      p._insertElement(token, NS.HTML);
      p.framesetOk = false;
      p.insertionMode = InsertionMode.IN_BODY;
      break;
    }
    case TAG_ID.FRAMESET: {
      p._insertElement(token, NS.HTML);
      p.insertionMode = InsertionMode.IN_FRAMESET;
      break;
    }
    case TAG_ID.BASE:
    case TAG_ID.BASEFONT:
    case TAG_ID.BGSOUND:
    case TAG_ID.LINK:
    case TAG_ID.META:
    case TAG_ID.NOFRAMES:
    case TAG_ID.SCRIPT:
    case TAG_ID.STYLE:
    case TAG_ID.TEMPLATE:
    case TAG_ID.TITLE: {
      p._err(token, ERR.abandonedHeadElementChild);
      p.openElements.push(p.headElement, TAG_ID.HEAD);
      startTagInHead(p, token);
      p.openElements.remove(p.headElement);
      break;
    }
    case TAG_ID.HEAD: {
      p._err(token, ERR.misplacedStartTagForHeadElement);
      break;
    }
    default: {
      tokenAfterHead(p, token);
    }
  }
}
function endTagAfterHead(p, token) {
  switch (token.tagID) {
    case TAG_ID.BODY:
    case TAG_ID.HTML:
    case TAG_ID.BR: {
      tokenAfterHead(p, token);
      break;
    }
    case TAG_ID.TEMPLATE: {
      templateEndTagInHead(p, token);
      break;
    }
    default: {
      p._err(token, ERR.endTagWithoutMatchingOpenElement);
    }
  }
}
function tokenAfterHead(p, token) {
  p._insertFakeElement(TAG_NAMES.BODY, TAG_ID.BODY);
  p.insertionMode = InsertionMode.IN_BODY;
  modeInBody(p, token);
}
function modeInBody(p, token) {
  switch (token.type) {
    case TokenType.CHARACTER: {
      characterInBody(p, token);
      break;
    }
    case TokenType.WHITESPACE_CHARACTER: {
      whitespaceCharacterInBody(p, token);
      break;
    }
    case TokenType.COMMENT: {
      appendComment(p, token);
      break;
    }
    case TokenType.START_TAG: {
      startTagInBody(p, token);
      break;
    }
    case TokenType.END_TAG: {
      endTagInBody(p, token);
      break;
    }
    case TokenType.EOF: {
      eofInBody(p, token);
      break;
    }
    default:
  }
}
function whitespaceCharacterInBody(p, token) {
  p._reconstructActiveFormattingElements();
  p._insertCharacters(token);
}
function characterInBody(p, token) {
  p._reconstructActiveFormattingElements();
  p._insertCharacters(token);
  p.framesetOk = false;
}
function htmlStartTagInBody(p, token) {
  if (p.openElements.tmplCount === 0) {
    p.treeAdapter.adoptAttributes(p.openElements.items[0], token.attrs);
  }
}
function bodyStartTagInBody(p, token) {
  const bodyElement = p.openElements.tryPeekProperlyNestedBodyElement();
  if (bodyElement && p.openElements.tmplCount === 0) {
    p.framesetOk = false;
    p.treeAdapter.adoptAttributes(bodyElement, token.attrs);
  }
}
function framesetStartTagInBody(p, token) {
  const bodyElement = p.openElements.tryPeekProperlyNestedBodyElement();
  if (p.framesetOk && bodyElement) {
    p.treeAdapter.detachNode(bodyElement);
    p.openElements.popAllUpToHtmlElement();
    p._insertElement(token, NS.HTML);
    p.insertionMode = InsertionMode.IN_FRAMESET;
  }
}
function addressStartTagInBody(p, token) {
  if (p.openElements.hasInButtonScope(TAG_ID.P)) {
    p._closePElement();
  }
  p._insertElement(token, NS.HTML);
}
function numberedHeaderStartTagInBody(p, token) {
  if (p.openElements.hasInButtonScope(TAG_ID.P)) {
    p._closePElement();
  }
  if (p.openElements.currentTagId !== void 0 && NUMBERED_HEADERS.has(p.openElements.currentTagId)) {
    p.openElements.pop();
  }
  p._insertElement(token, NS.HTML);
}
function preStartTagInBody(p, token) {
  if (p.openElements.hasInButtonScope(TAG_ID.P)) {
    p._closePElement();
  }
  p._insertElement(token, NS.HTML);
  p.skipNextNewLine = true;
  p.framesetOk = false;
}
function formStartTagInBody(p, token) {
  const inTemplate = p.openElements.tmplCount > 0;
  if (!p.formElement || inTemplate) {
    if (p.openElements.hasInButtonScope(TAG_ID.P)) {
      p._closePElement();
    }
    p._insertElement(token, NS.HTML);
    if (!inTemplate) {
      p.formElement = p.openElements.current;
    }
  }
}
function listItemStartTagInBody(p, token) {
  p.framesetOk = false;
  const tn = token.tagID;
  for (let i = p.openElements.stackTop; i >= 0; i--) {
    const elementId = p.openElements.tagIDs[i];
    if (tn === TAG_ID.LI && elementId === TAG_ID.LI || (tn === TAG_ID.DD || tn === TAG_ID.DT) && (elementId === TAG_ID.DD || elementId === TAG_ID.DT)) {
      p.openElements.generateImpliedEndTagsWithExclusion(elementId);
      p.openElements.popUntilTagNamePopped(elementId);
      break;
    }
    if (elementId !== TAG_ID.ADDRESS && elementId !== TAG_ID.DIV && elementId !== TAG_ID.P && p._isSpecialElement(p.openElements.items[i], elementId)) {
      break;
    }
  }
  if (p.openElements.hasInButtonScope(TAG_ID.P)) {
    p._closePElement();
  }
  p._insertElement(token, NS.HTML);
}
function plaintextStartTagInBody(p, token) {
  if (p.openElements.hasInButtonScope(TAG_ID.P)) {
    p._closePElement();
  }
  p._insertElement(token, NS.HTML);
  p.tokenizer.state = TokenizerMode.PLAINTEXT;
}
function buttonStartTagInBody(p, token) {
  if (p.openElements.hasInScope(TAG_ID.BUTTON)) {
    p.openElements.generateImpliedEndTags();
    p.openElements.popUntilTagNamePopped(TAG_ID.BUTTON);
  }
  p._reconstructActiveFormattingElements();
  p._insertElement(token, NS.HTML);
  p.framesetOk = false;
}
function aStartTagInBody(p, token) {
  const activeElementEntry = p.activeFormattingElements.getElementEntryInScopeWithTagName(TAG_NAMES.A);
  if (activeElementEntry) {
    callAdoptionAgency(p, token);
    p.openElements.remove(activeElementEntry.element);
    p.activeFormattingElements.removeEntry(activeElementEntry);
  }
  p._reconstructActiveFormattingElements();
  p._insertElement(token, NS.HTML);
  p.activeFormattingElements.pushElement(p.openElements.current, token);
}
function bStartTagInBody(p, token) {
  p._reconstructActiveFormattingElements();
  p._insertElement(token, NS.HTML);
  p.activeFormattingElements.pushElement(p.openElements.current, token);
}
function nobrStartTagInBody(p, token) {
  p._reconstructActiveFormattingElements();
  if (p.openElements.hasInScope(TAG_ID.NOBR)) {
    callAdoptionAgency(p, token);
    p._reconstructActiveFormattingElements();
  }
  p._insertElement(token, NS.HTML);
  p.activeFormattingElements.pushElement(p.openElements.current, token);
}
function appletStartTagInBody(p, token) {
  p._reconstructActiveFormattingElements();
  p._insertElement(token, NS.HTML);
  p.activeFormattingElements.insertMarker();
  p.framesetOk = false;
}
function tableStartTagInBody(p, token) {
  if (p.treeAdapter.getDocumentMode(p.document) !== DOCUMENT_MODE.QUIRKS && p.openElements.hasInButtonScope(TAG_ID.P)) {
    p._closePElement();
  }
  p._insertElement(token, NS.HTML);
  p.framesetOk = false;
  p.insertionMode = InsertionMode.IN_TABLE;
}
function areaStartTagInBody(p, token) {
  p._reconstructActiveFormattingElements();
  p._appendElement(token, NS.HTML);
  p.framesetOk = false;
  token.ackSelfClosing = true;
}
function isHiddenInput(token) {
  const inputType = getTokenAttr(token, ATTRS.TYPE);
  return inputType != null && inputType.toLowerCase() === HIDDEN_INPUT_TYPE;
}
function inputStartTagInBody(p, token) {
  p._reconstructActiveFormattingElements();
  p._appendElement(token, NS.HTML);
  if (!isHiddenInput(token)) {
    p.framesetOk = false;
  }
  token.ackSelfClosing = true;
}
function paramStartTagInBody(p, token) {
  p._appendElement(token, NS.HTML);
  token.ackSelfClosing = true;
}
function hrStartTagInBody(p, token) {
  if (p.openElements.hasInButtonScope(TAG_ID.P)) {
    p._closePElement();
  }
  p._appendElement(token, NS.HTML);
  p.framesetOk = false;
  token.ackSelfClosing = true;
}
function imageStartTagInBody(p, token) {
  token.tagName = TAG_NAMES.IMG;
  token.tagID = TAG_ID.IMG;
  areaStartTagInBody(p, token);
}
function textareaStartTagInBody(p, token) {
  p._insertElement(token, NS.HTML);
  p.skipNextNewLine = true;
  p.tokenizer.state = TokenizerMode.RCDATA;
  p.originalInsertionMode = p.insertionMode;
  p.framesetOk = false;
  p.insertionMode = InsertionMode.TEXT;
}
function xmpStartTagInBody(p, token) {
  if (p.openElements.hasInButtonScope(TAG_ID.P)) {
    p._closePElement();
  }
  p._reconstructActiveFormattingElements();
  p.framesetOk = false;
  p._switchToTextParsing(token, TokenizerMode.RAWTEXT);
}
function iframeStartTagInBody(p, token) {
  p.framesetOk = false;
  p._switchToTextParsing(token, TokenizerMode.RAWTEXT);
}
function rawTextStartTagInBody(p, token) {
  p._switchToTextParsing(token, TokenizerMode.RAWTEXT);
}
function selectStartTagInBody(p, token) {
  p._reconstructActiveFormattingElements();
  p._insertElement(token, NS.HTML);
  p.framesetOk = false;
  p.insertionMode = p.insertionMode === InsertionMode.IN_TABLE || p.insertionMode === InsertionMode.IN_CAPTION || p.insertionMode === InsertionMode.IN_TABLE_BODY || p.insertionMode === InsertionMode.IN_ROW || p.insertionMode === InsertionMode.IN_CELL ? InsertionMode.IN_SELECT_IN_TABLE : InsertionMode.IN_SELECT;
}
function optgroupStartTagInBody(p, token) {
  if (p.openElements.currentTagId === TAG_ID.OPTION) {
    p.openElements.pop();
  }
  p._reconstructActiveFormattingElements();
  p._insertElement(token, NS.HTML);
}
function rbStartTagInBody(p, token) {
  if (p.openElements.hasInScope(TAG_ID.RUBY)) {
    p.openElements.generateImpliedEndTags();
  }
  p._insertElement(token, NS.HTML);
}
function rtStartTagInBody(p, token) {
  if (p.openElements.hasInScope(TAG_ID.RUBY)) {
    p.openElements.generateImpliedEndTagsWithExclusion(TAG_ID.RTC);
  }
  p._insertElement(token, NS.HTML);
}
function mathStartTagInBody(p, token) {
  p._reconstructActiveFormattingElements();
  adjustTokenMathMLAttrs(token);
  adjustTokenXMLAttrs(token);
  if (token.selfClosing) {
    p._appendElement(token, NS.MATHML);
  } else {
    p._insertElement(token, NS.MATHML);
  }
  token.ackSelfClosing = true;
}
function svgStartTagInBody(p, token) {
  p._reconstructActiveFormattingElements();
  adjustTokenSVGAttrs(token);
  adjustTokenXMLAttrs(token);
  if (token.selfClosing) {
    p._appendElement(token, NS.SVG);
  } else {
    p._insertElement(token, NS.SVG);
  }
  token.ackSelfClosing = true;
}
function genericStartTagInBody(p, token) {
  p._reconstructActiveFormattingElements();
  p._insertElement(token, NS.HTML);
}
function startTagInBody(p, token) {
  switch (token.tagID) {
    case TAG_ID.I:
    case TAG_ID.S:
    case TAG_ID.B:
    case TAG_ID.U:
    case TAG_ID.EM:
    case TAG_ID.TT:
    case TAG_ID.BIG:
    case TAG_ID.CODE:
    case TAG_ID.FONT:
    case TAG_ID.SMALL:
    case TAG_ID.STRIKE:
    case TAG_ID.STRONG: {
      bStartTagInBody(p, token);
      break;
    }
    case TAG_ID.A: {
      aStartTagInBody(p, token);
      break;
    }
    case TAG_ID.H1:
    case TAG_ID.H2:
    case TAG_ID.H3:
    case TAG_ID.H4:
    case TAG_ID.H5:
    case TAG_ID.H6: {
      numberedHeaderStartTagInBody(p, token);
      break;
    }
    case TAG_ID.P:
    case TAG_ID.DL:
    case TAG_ID.OL:
    case TAG_ID.UL:
    case TAG_ID.DIV:
    case TAG_ID.DIR:
    case TAG_ID.NAV:
    case TAG_ID.MAIN:
    case TAG_ID.MENU:
    case TAG_ID.ASIDE:
    case TAG_ID.CENTER:
    case TAG_ID.FIGURE:
    case TAG_ID.FOOTER:
    case TAG_ID.HEADER:
    case TAG_ID.HGROUP:
    case TAG_ID.DIALOG:
    case TAG_ID.DETAILS:
    case TAG_ID.ADDRESS:
    case TAG_ID.ARTICLE:
    case TAG_ID.SEARCH:
    case TAG_ID.SECTION:
    case TAG_ID.SUMMARY:
    case TAG_ID.FIELDSET:
    case TAG_ID.BLOCKQUOTE:
    case TAG_ID.FIGCAPTION: {
      addressStartTagInBody(p, token);
      break;
    }
    case TAG_ID.LI:
    case TAG_ID.DD:
    case TAG_ID.DT: {
      listItemStartTagInBody(p, token);
      break;
    }
    case TAG_ID.BR:
    case TAG_ID.IMG:
    case TAG_ID.WBR:
    case TAG_ID.AREA:
    case TAG_ID.EMBED:
    case TAG_ID.KEYGEN: {
      areaStartTagInBody(p, token);
      break;
    }
    case TAG_ID.HR: {
      hrStartTagInBody(p, token);
      break;
    }
    case TAG_ID.RB:
    case TAG_ID.RTC: {
      rbStartTagInBody(p, token);
      break;
    }
    case TAG_ID.RT:
    case TAG_ID.RP: {
      rtStartTagInBody(p, token);
      break;
    }
    case TAG_ID.PRE:
    case TAG_ID.LISTING: {
      preStartTagInBody(p, token);
      break;
    }
    case TAG_ID.XMP: {
      xmpStartTagInBody(p, token);
      break;
    }
    case TAG_ID.SVG: {
      svgStartTagInBody(p, token);
      break;
    }
    case TAG_ID.HTML: {
      htmlStartTagInBody(p, token);
      break;
    }
    case TAG_ID.BASE:
    case TAG_ID.LINK:
    case TAG_ID.META:
    case TAG_ID.STYLE:
    case TAG_ID.TITLE:
    case TAG_ID.SCRIPT:
    case TAG_ID.BGSOUND:
    case TAG_ID.BASEFONT:
    case TAG_ID.TEMPLATE: {
      startTagInHead(p, token);
      break;
    }
    case TAG_ID.BODY: {
      bodyStartTagInBody(p, token);
      break;
    }
    case TAG_ID.FORM: {
      formStartTagInBody(p, token);
      break;
    }
    case TAG_ID.NOBR: {
      nobrStartTagInBody(p, token);
      break;
    }
    case TAG_ID.MATH: {
      mathStartTagInBody(p, token);
      break;
    }
    case TAG_ID.TABLE: {
      tableStartTagInBody(p, token);
      break;
    }
    case TAG_ID.INPUT: {
      inputStartTagInBody(p, token);
      break;
    }
    case TAG_ID.PARAM:
    case TAG_ID.TRACK:
    case TAG_ID.SOURCE: {
      paramStartTagInBody(p, token);
      break;
    }
    case TAG_ID.IMAGE: {
      imageStartTagInBody(p, token);
      break;
    }
    case TAG_ID.BUTTON: {
      buttonStartTagInBody(p, token);
      break;
    }
    case TAG_ID.APPLET:
    case TAG_ID.OBJECT:
    case TAG_ID.MARQUEE: {
      appletStartTagInBody(p, token);
      break;
    }
    case TAG_ID.IFRAME: {
      iframeStartTagInBody(p, token);
      break;
    }
    case TAG_ID.SELECT: {
      selectStartTagInBody(p, token);
      break;
    }
    case TAG_ID.OPTION:
    case TAG_ID.OPTGROUP: {
      optgroupStartTagInBody(p, token);
      break;
    }
    case TAG_ID.NOEMBED:
    case TAG_ID.NOFRAMES: {
      rawTextStartTagInBody(p, token);
      break;
    }
    case TAG_ID.FRAMESET: {
      framesetStartTagInBody(p, token);
      break;
    }
    case TAG_ID.TEXTAREA: {
      textareaStartTagInBody(p, token);
      break;
    }
    case TAG_ID.NOSCRIPT: {
      if (p.options.scriptingEnabled) {
        rawTextStartTagInBody(p, token);
      } else {
        genericStartTagInBody(p, token);
      }
      break;
    }
    case TAG_ID.PLAINTEXT: {
      plaintextStartTagInBody(p, token);
      break;
    }
    case TAG_ID.COL:
    case TAG_ID.TH:
    case TAG_ID.TD:
    case TAG_ID.TR:
    case TAG_ID.HEAD:
    case TAG_ID.FRAME:
    case TAG_ID.TBODY:
    case TAG_ID.TFOOT:
    case TAG_ID.THEAD:
    case TAG_ID.CAPTION:
    case TAG_ID.COLGROUP: {
      break;
    }
    default: {
      genericStartTagInBody(p, token);
    }
  }
}
function bodyEndTagInBody(p, token) {
  if (p.openElements.hasInScope(TAG_ID.BODY)) {
    p.insertionMode = InsertionMode.AFTER_BODY;
    if (p.options.sourceCodeLocationInfo) {
      const bodyElement = p.openElements.tryPeekProperlyNestedBodyElement();
      if (bodyElement) {
        p._setEndLocation(bodyElement, token);
      }
    }
  }
}
function htmlEndTagInBody(p, token) {
  if (p.openElements.hasInScope(TAG_ID.BODY)) {
    p.insertionMode = InsertionMode.AFTER_BODY;
    endTagAfterBody(p, token);
  }
}
function addressEndTagInBody(p, token) {
  const tn = token.tagID;
  if (p.openElements.hasInScope(tn)) {
    p.openElements.generateImpliedEndTags();
    p.openElements.popUntilTagNamePopped(tn);
  }
}
function formEndTagInBody(p) {
  const inTemplate = p.openElements.tmplCount > 0;
  const { formElement } = p;
  if (!inTemplate) {
    p.formElement = null;
  }
  if ((formElement || inTemplate) && p.openElements.hasInScope(TAG_ID.FORM)) {
    p.openElements.generateImpliedEndTags();
    if (inTemplate) {
      p.openElements.popUntilTagNamePopped(TAG_ID.FORM);
    } else if (formElement) {
      p.openElements.remove(formElement);
    }
  }
}
function pEndTagInBody(p) {
  if (!p.openElements.hasInButtonScope(TAG_ID.P)) {
    p._insertFakeElement(TAG_NAMES.P, TAG_ID.P);
  }
  p._closePElement();
}
function liEndTagInBody(p) {
  if (p.openElements.hasInListItemScope(TAG_ID.LI)) {
    p.openElements.generateImpliedEndTagsWithExclusion(TAG_ID.LI);
    p.openElements.popUntilTagNamePopped(TAG_ID.LI);
  }
}
function ddEndTagInBody(p, token) {
  const tn = token.tagID;
  if (p.openElements.hasInScope(tn)) {
    p.openElements.generateImpliedEndTagsWithExclusion(tn);
    p.openElements.popUntilTagNamePopped(tn);
  }
}
function numberedHeaderEndTagInBody(p) {
  if (p.openElements.hasNumberedHeaderInScope()) {
    p.openElements.generateImpliedEndTags();
    p.openElements.popUntilNumberedHeaderPopped();
  }
}
function appletEndTagInBody(p, token) {
  const tn = token.tagID;
  if (p.openElements.hasInScope(tn)) {
    p.openElements.generateImpliedEndTags();
    p.openElements.popUntilTagNamePopped(tn);
    p.activeFormattingElements.clearToLastMarker();
  }
}
function brEndTagInBody(p) {
  p._reconstructActiveFormattingElements();
  p._insertFakeElement(TAG_NAMES.BR, TAG_ID.BR);
  p.openElements.pop();
  p.framesetOk = false;
}
function genericEndTagInBody(p, token) {
  const tn = token.tagName;
  const tid = token.tagID;
  for (let i = p.openElements.stackTop; i > 0; i--) {
    const element = p.openElements.items[i];
    const elementId = p.openElements.tagIDs[i];
    if (tid === elementId && (tid !== TAG_ID.UNKNOWN || p.treeAdapter.getTagName(element) === tn)) {
      p.openElements.generateImpliedEndTagsWithExclusion(tid);
      if (p.openElements.stackTop >= i)
        p.openElements.shortenToLength(i);
      break;
    }
    if (p._isSpecialElement(element, elementId)) {
      break;
    }
  }
}
function endTagInBody(p, token) {
  switch (token.tagID) {
    case TAG_ID.A:
    case TAG_ID.B:
    case TAG_ID.I:
    case TAG_ID.S:
    case TAG_ID.U:
    case TAG_ID.EM:
    case TAG_ID.TT:
    case TAG_ID.BIG:
    case TAG_ID.CODE:
    case TAG_ID.FONT:
    case TAG_ID.NOBR:
    case TAG_ID.SMALL:
    case TAG_ID.STRIKE:
    case TAG_ID.STRONG: {
      callAdoptionAgency(p, token);
      break;
    }
    case TAG_ID.P: {
      pEndTagInBody(p);
      break;
    }
    case TAG_ID.DL:
    case TAG_ID.UL:
    case TAG_ID.OL:
    case TAG_ID.DIR:
    case TAG_ID.DIV:
    case TAG_ID.NAV:
    case TAG_ID.PRE:
    case TAG_ID.MAIN:
    case TAG_ID.MENU:
    case TAG_ID.ASIDE:
    case TAG_ID.BUTTON:
    case TAG_ID.CENTER:
    case TAG_ID.FIGURE:
    case TAG_ID.FOOTER:
    case TAG_ID.HEADER:
    case TAG_ID.HGROUP:
    case TAG_ID.DIALOG:
    case TAG_ID.ADDRESS:
    case TAG_ID.ARTICLE:
    case TAG_ID.DETAILS:
    case TAG_ID.SEARCH:
    case TAG_ID.SECTION:
    case TAG_ID.SUMMARY:
    case TAG_ID.LISTING:
    case TAG_ID.FIELDSET:
    case TAG_ID.BLOCKQUOTE:
    case TAG_ID.FIGCAPTION: {
      addressEndTagInBody(p, token);
      break;
    }
    case TAG_ID.LI: {
      liEndTagInBody(p);
      break;
    }
    case TAG_ID.DD:
    case TAG_ID.DT: {
      ddEndTagInBody(p, token);
      break;
    }
    case TAG_ID.H1:
    case TAG_ID.H2:
    case TAG_ID.H3:
    case TAG_ID.H4:
    case TAG_ID.H5:
    case TAG_ID.H6: {
      numberedHeaderEndTagInBody(p);
      break;
    }
    case TAG_ID.BR: {
      brEndTagInBody(p);
      break;
    }
    case TAG_ID.BODY: {
      bodyEndTagInBody(p, token);
      break;
    }
    case TAG_ID.HTML: {
      htmlEndTagInBody(p, token);
      break;
    }
    case TAG_ID.FORM: {
      formEndTagInBody(p);
      break;
    }
    case TAG_ID.APPLET:
    case TAG_ID.OBJECT:
    case TAG_ID.MARQUEE: {
      appletEndTagInBody(p, token);
      break;
    }
    case TAG_ID.TEMPLATE: {
      templateEndTagInHead(p, token);
      break;
    }
    default: {
      genericEndTagInBody(p, token);
    }
  }
}
function eofInBody(p, token) {
  if (p.tmplInsertionModeStack.length > 0) {
    eofInTemplate(p, token);
  } else {
    stopParsing(p, token);
  }
}
function endTagInText(p, token) {
  var _a;
  if (token.tagID === TAG_ID.SCRIPT) {
    (_a = p.scriptHandler) === null || _a === void 0 ? void 0 : _a.call(p, p.openElements.current);
  }
  p.openElements.pop();
  p.insertionMode = p.originalInsertionMode;
}
function eofInText(p, token) {
  p._err(token, ERR.eofInElementThatCanContainOnlyText);
  p.openElements.pop();
  p.insertionMode = p.originalInsertionMode;
  p.onEof(token);
}
function characterInTable(p, token) {
  if (p.openElements.currentTagId !== void 0 && TABLE_STRUCTURE_TAGS.has(p.openElements.currentTagId)) {
    p.pendingCharacterTokens.length = 0;
    p.hasNonWhitespacePendingCharacterToken = false;
    p.originalInsertionMode = p.insertionMode;
    p.insertionMode = InsertionMode.IN_TABLE_TEXT;
    switch (token.type) {
      case TokenType.CHARACTER: {
        characterInTableText(p, token);
        break;
      }
      case TokenType.WHITESPACE_CHARACTER: {
        whitespaceCharacterInTableText(p, token);
        break;
      }
    }
  } else {
    tokenInTable(p, token);
  }
}
function captionStartTagInTable(p, token) {
  p.openElements.clearBackToTableContext();
  p.activeFormattingElements.insertMarker();
  p._insertElement(token, NS.HTML);
  p.insertionMode = InsertionMode.IN_CAPTION;
}
function colgroupStartTagInTable(p, token) {
  p.openElements.clearBackToTableContext();
  p._insertElement(token, NS.HTML);
  p.insertionMode = InsertionMode.IN_COLUMN_GROUP;
}
function colStartTagInTable(p, token) {
  p.openElements.clearBackToTableContext();
  p._insertFakeElement(TAG_NAMES.COLGROUP, TAG_ID.COLGROUP);
  p.insertionMode = InsertionMode.IN_COLUMN_GROUP;
  startTagInColumnGroup(p, token);
}
function tbodyStartTagInTable(p, token) {
  p.openElements.clearBackToTableContext();
  p._insertElement(token, NS.HTML);
  p.insertionMode = InsertionMode.IN_TABLE_BODY;
}
function tdStartTagInTable(p, token) {
  p.openElements.clearBackToTableContext();
  p._insertFakeElement(TAG_NAMES.TBODY, TAG_ID.TBODY);
  p.insertionMode = InsertionMode.IN_TABLE_BODY;
  startTagInTableBody(p, token);
}
function tableStartTagInTable(p, token) {
  if (p.openElements.hasInTableScope(TAG_ID.TABLE)) {
    p.openElements.popUntilTagNamePopped(TAG_ID.TABLE);
    p._resetInsertionMode();
    p._processStartTag(token);
  }
}
function inputStartTagInTable(p, token) {
  if (isHiddenInput(token)) {
    p._appendElement(token, NS.HTML);
  } else {
    tokenInTable(p, token);
  }
  token.ackSelfClosing = true;
}
function formStartTagInTable(p, token) {
  if (!p.formElement && p.openElements.tmplCount === 0) {
    p._insertElement(token, NS.HTML);
    p.formElement = p.openElements.current;
    p.openElements.pop();
  }
}
function startTagInTable(p, token) {
  switch (token.tagID) {
    case TAG_ID.TD:
    case TAG_ID.TH:
    case TAG_ID.TR: {
      tdStartTagInTable(p, token);
      break;
    }
    case TAG_ID.STYLE:
    case TAG_ID.SCRIPT:
    case TAG_ID.TEMPLATE: {
      startTagInHead(p, token);
      break;
    }
    case TAG_ID.COL: {
      colStartTagInTable(p, token);
      break;
    }
    case TAG_ID.FORM: {
      formStartTagInTable(p, token);
      break;
    }
    case TAG_ID.TABLE: {
      tableStartTagInTable(p, token);
      break;
    }
    case TAG_ID.TBODY:
    case TAG_ID.TFOOT:
    case TAG_ID.THEAD: {
      tbodyStartTagInTable(p, token);
      break;
    }
    case TAG_ID.INPUT: {
      inputStartTagInTable(p, token);
      break;
    }
    case TAG_ID.CAPTION: {
      captionStartTagInTable(p, token);
      break;
    }
    case TAG_ID.COLGROUP: {
      colgroupStartTagInTable(p, token);
      break;
    }
    default: {
      tokenInTable(p, token);
    }
  }
}
function endTagInTable(p, token) {
  switch (token.tagID) {
    case TAG_ID.TABLE: {
      if (p.openElements.hasInTableScope(TAG_ID.TABLE)) {
        p.openElements.popUntilTagNamePopped(TAG_ID.TABLE);
        p._resetInsertionMode();
      }
      break;
    }
    case TAG_ID.TEMPLATE: {
      templateEndTagInHead(p, token);
      break;
    }
    case TAG_ID.BODY:
    case TAG_ID.CAPTION:
    case TAG_ID.COL:
    case TAG_ID.COLGROUP:
    case TAG_ID.HTML:
    case TAG_ID.TBODY:
    case TAG_ID.TD:
    case TAG_ID.TFOOT:
    case TAG_ID.TH:
    case TAG_ID.THEAD:
    case TAG_ID.TR: {
      break;
    }
    default: {
      tokenInTable(p, token);
    }
  }
}
function tokenInTable(p, token) {
  const savedFosterParentingState = p.fosterParentingEnabled;
  p.fosterParentingEnabled = true;
  modeInBody(p, token);
  p.fosterParentingEnabled = savedFosterParentingState;
}
function whitespaceCharacterInTableText(p, token) {
  p.pendingCharacterTokens.push(token);
}
function characterInTableText(p, token) {
  p.pendingCharacterTokens.push(token);
  p.hasNonWhitespacePendingCharacterToken = true;
}
function tokenInTableText(p, token) {
  let i = 0;
  if (p.hasNonWhitespacePendingCharacterToken) {
    for (; i < p.pendingCharacterTokens.length; i++) {
      tokenInTable(p, p.pendingCharacterTokens[i]);
    }
  } else {
    for (; i < p.pendingCharacterTokens.length; i++) {
      p._insertCharacters(p.pendingCharacterTokens[i]);
    }
  }
  p.insertionMode = p.originalInsertionMode;
  p._processToken(token);
}
function startTagInCaption(p, token) {
  const tn = token.tagID;
  if (TABLE_VOID_ELEMENTS.has(tn)) {
    if (p.openElements.hasInTableScope(TAG_ID.CAPTION)) {
      p.openElements.generateImpliedEndTags();
      p.openElements.popUntilTagNamePopped(TAG_ID.CAPTION);
      p.activeFormattingElements.clearToLastMarker();
      p.insertionMode = InsertionMode.IN_TABLE;
      startTagInTable(p, token);
    }
  } else {
    startTagInBody(p, token);
  }
}
function endTagInCaption(p, token) {
  const tn = token.tagID;
  switch (tn) {
    case TAG_ID.CAPTION:
    case TAG_ID.TABLE: {
      if (p.openElements.hasInTableScope(TAG_ID.CAPTION)) {
        p.openElements.generateImpliedEndTags();
        p.openElements.popUntilTagNamePopped(TAG_ID.CAPTION);
        p.activeFormattingElements.clearToLastMarker();
        p.insertionMode = InsertionMode.IN_TABLE;
        if (tn === TAG_ID.TABLE) {
          endTagInTable(p, token);
        }
      }
      break;
    }
    case TAG_ID.BODY:
    case TAG_ID.COL:
    case TAG_ID.COLGROUP:
    case TAG_ID.HTML:
    case TAG_ID.TBODY:
    case TAG_ID.TD:
    case TAG_ID.TFOOT:
    case TAG_ID.TH:
    case TAG_ID.THEAD:
    case TAG_ID.TR: {
      break;
    }
    default: {
      endTagInBody(p, token);
    }
  }
}
function startTagInColumnGroup(p, token) {
  switch (token.tagID) {
    case TAG_ID.HTML: {
      startTagInBody(p, token);
      break;
    }
    case TAG_ID.COL: {
      p._appendElement(token, NS.HTML);
      token.ackSelfClosing = true;
      break;
    }
    case TAG_ID.TEMPLATE: {
      startTagInHead(p, token);
      break;
    }
    default: {
      tokenInColumnGroup(p, token);
    }
  }
}
function endTagInColumnGroup(p, token) {
  switch (token.tagID) {
    case TAG_ID.COLGROUP: {
      if (p.openElements.currentTagId === TAG_ID.COLGROUP) {
        p.openElements.pop();
        p.insertionMode = InsertionMode.IN_TABLE;
      }
      break;
    }
    case TAG_ID.TEMPLATE: {
      templateEndTagInHead(p, token);
      break;
    }
    case TAG_ID.COL: {
      break;
    }
    default: {
      tokenInColumnGroup(p, token);
    }
  }
}
function tokenInColumnGroup(p, token) {
  if (p.openElements.currentTagId === TAG_ID.COLGROUP) {
    p.openElements.pop();
    p.insertionMode = InsertionMode.IN_TABLE;
    p._processToken(token);
  }
}
function startTagInTableBody(p, token) {
  switch (token.tagID) {
    case TAG_ID.TR: {
      p.openElements.clearBackToTableBodyContext();
      p._insertElement(token, NS.HTML);
      p.insertionMode = InsertionMode.IN_ROW;
      break;
    }
    case TAG_ID.TH:
    case TAG_ID.TD: {
      p.openElements.clearBackToTableBodyContext();
      p._insertFakeElement(TAG_NAMES.TR, TAG_ID.TR);
      p.insertionMode = InsertionMode.IN_ROW;
      startTagInRow(p, token);
      break;
    }
    case TAG_ID.CAPTION:
    case TAG_ID.COL:
    case TAG_ID.COLGROUP:
    case TAG_ID.TBODY:
    case TAG_ID.TFOOT:
    case TAG_ID.THEAD: {
      if (p.openElements.hasTableBodyContextInTableScope()) {
        p.openElements.clearBackToTableBodyContext();
        p.openElements.pop();
        p.insertionMode = InsertionMode.IN_TABLE;
        startTagInTable(p, token);
      }
      break;
    }
    default: {
      startTagInTable(p, token);
    }
  }
}
function endTagInTableBody(p, token) {
  const tn = token.tagID;
  switch (token.tagID) {
    case TAG_ID.TBODY:
    case TAG_ID.TFOOT:
    case TAG_ID.THEAD: {
      if (p.openElements.hasInTableScope(tn)) {
        p.openElements.clearBackToTableBodyContext();
        p.openElements.pop();
        p.insertionMode = InsertionMode.IN_TABLE;
      }
      break;
    }
    case TAG_ID.TABLE: {
      if (p.openElements.hasTableBodyContextInTableScope()) {
        p.openElements.clearBackToTableBodyContext();
        p.openElements.pop();
        p.insertionMode = InsertionMode.IN_TABLE;
        endTagInTable(p, token);
      }
      break;
    }
    case TAG_ID.BODY:
    case TAG_ID.CAPTION:
    case TAG_ID.COL:
    case TAG_ID.COLGROUP:
    case TAG_ID.HTML:
    case TAG_ID.TD:
    case TAG_ID.TH:
    case TAG_ID.TR: {
      break;
    }
    default: {
      endTagInTable(p, token);
    }
  }
}
function startTagInRow(p, token) {
  switch (token.tagID) {
    case TAG_ID.TH:
    case TAG_ID.TD: {
      p.openElements.clearBackToTableRowContext();
      p._insertElement(token, NS.HTML);
      p.insertionMode = InsertionMode.IN_CELL;
      p.activeFormattingElements.insertMarker();
      break;
    }
    case TAG_ID.CAPTION:
    case TAG_ID.COL:
    case TAG_ID.COLGROUP:
    case TAG_ID.TBODY:
    case TAG_ID.TFOOT:
    case TAG_ID.THEAD:
    case TAG_ID.TR: {
      if (p.openElements.hasInTableScope(TAG_ID.TR)) {
        p.openElements.clearBackToTableRowContext();
        p.openElements.pop();
        p.insertionMode = InsertionMode.IN_TABLE_BODY;
        startTagInTableBody(p, token);
      }
      break;
    }
    default: {
      startTagInTable(p, token);
    }
  }
}
function endTagInRow(p, token) {
  switch (token.tagID) {
    case TAG_ID.TR: {
      if (p.openElements.hasInTableScope(TAG_ID.TR)) {
        p.openElements.clearBackToTableRowContext();
        p.openElements.pop();
        p.insertionMode = InsertionMode.IN_TABLE_BODY;
      }
      break;
    }
    case TAG_ID.TABLE: {
      if (p.openElements.hasInTableScope(TAG_ID.TR)) {
        p.openElements.clearBackToTableRowContext();
        p.openElements.pop();
        p.insertionMode = InsertionMode.IN_TABLE_BODY;
        endTagInTableBody(p, token);
      }
      break;
    }
    case TAG_ID.TBODY:
    case TAG_ID.TFOOT:
    case TAG_ID.THEAD: {
      if (p.openElements.hasInTableScope(token.tagID) || p.openElements.hasInTableScope(TAG_ID.TR)) {
        p.openElements.clearBackToTableRowContext();
        p.openElements.pop();
        p.insertionMode = InsertionMode.IN_TABLE_BODY;
        endTagInTableBody(p, token);
      }
      break;
    }
    case TAG_ID.BODY:
    case TAG_ID.CAPTION:
    case TAG_ID.COL:
    case TAG_ID.COLGROUP:
    case TAG_ID.HTML:
    case TAG_ID.TD:
    case TAG_ID.TH: {
      break;
    }
    default: {
      endTagInTable(p, token);
    }
  }
}
function startTagInCell(p, token) {
  const tn = token.tagID;
  if (TABLE_VOID_ELEMENTS.has(tn)) {
    if (p.openElements.hasInTableScope(TAG_ID.TD) || p.openElements.hasInTableScope(TAG_ID.TH)) {
      p._closeTableCell();
      startTagInRow(p, token);
    }
  } else {
    startTagInBody(p, token);
  }
}
function endTagInCell(p, token) {
  const tn = token.tagID;
  switch (tn) {
    case TAG_ID.TD:
    case TAG_ID.TH: {
      if (p.openElements.hasInTableScope(tn)) {
        p.openElements.generateImpliedEndTags();
        p.openElements.popUntilTagNamePopped(tn);
        p.activeFormattingElements.clearToLastMarker();
        p.insertionMode = InsertionMode.IN_ROW;
      }
      break;
    }
    case TAG_ID.TABLE:
    case TAG_ID.TBODY:
    case TAG_ID.TFOOT:
    case TAG_ID.THEAD:
    case TAG_ID.TR: {
      if (p.openElements.hasInTableScope(tn)) {
        p._closeTableCell();
        endTagInRow(p, token);
      }
      break;
    }
    case TAG_ID.BODY:
    case TAG_ID.CAPTION:
    case TAG_ID.COL:
    case TAG_ID.COLGROUP:
    case TAG_ID.HTML: {
      break;
    }
    default: {
      endTagInBody(p, token);
    }
  }
}
function startTagInSelect(p, token) {
  switch (token.tagID) {
    case TAG_ID.HTML: {
      startTagInBody(p, token);
      break;
    }
    case TAG_ID.OPTION: {
      if (p.openElements.currentTagId === TAG_ID.OPTION) {
        p.openElements.pop();
      }
      p._insertElement(token, NS.HTML);
      break;
    }
    case TAG_ID.OPTGROUP: {
      if (p.openElements.currentTagId === TAG_ID.OPTION) {
        p.openElements.pop();
      }
      if (p.openElements.currentTagId === TAG_ID.OPTGROUP) {
        p.openElements.pop();
      }
      p._insertElement(token, NS.HTML);
      break;
    }
    case TAG_ID.HR: {
      if (p.openElements.currentTagId === TAG_ID.OPTION) {
        p.openElements.pop();
      }
      if (p.openElements.currentTagId === TAG_ID.OPTGROUP) {
        p.openElements.pop();
      }
      p._appendElement(token, NS.HTML);
      token.ackSelfClosing = true;
      break;
    }
    case TAG_ID.INPUT:
    case TAG_ID.KEYGEN:
    case TAG_ID.TEXTAREA:
    case TAG_ID.SELECT: {
      if (p.openElements.hasInSelectScope(TAG_ID.SELECT)) {
        p.openElements.popUntilTagNamePopped(TAG_ID.SELECT);
        p._resetInsertionMode();
        if (token.tagID !== TAG_ID.SELECT) {
          p._processStartTag(token);
        }
      }
      break;
    }
    case TAG_ID.SCRIPT:
    case TAG_ID.TEMPLATE: {
      startTagInHead(p, token);
      break;
    }
    default:
  }
}
function endTagInSelect(p, token) {
  switch (token.tagID) {
    case TAG_ID.OPTGROUP: {
      if (p.openElements.stackTop > 0 && p.openElements.currentTagId === TAG_ID.OPTION && p.openElements.tagIDs[p.openElements.stackTop - 1] === TAG_ID.OPTGROUP) {
        p.openElements.pop();
      }
      if (p.openElements.currentTagId === TAG_ID.OPTGROUP) {
        p.openElements.pop();
      }
      break;
    }
    case TAG_ID.OPTION: {
      if (p.openElements.currentTagId === TAG_ID.OPTION) {
        p.openElements.pop();
      }
      break;
    }
    case TAG_ID.SELECT: {
      if (p.openElements.hasInSelectScope(TAG_ID.SELECT)) {
        p.openElements.popUntilTagNamePopped(TAG_ID.SELECT);
        p._resetInsertionMode();
      }
      break;
    }
    case TAG_ID.TEMPLATE: {
      templateEndTagInHead(p, token);
      break;
    }
    default:
  }
}
function startTagInSelectInTable(p, token) {
  const tn = token.tagID;
  if (tn === TAG_ID.CAPTION || tn === TAG_ID.TABLE || tn === TAG_ID.TBODY || tn === TAG_ID.TFOOT || tn === TAG_ID.THEAD || tn === TAG_ID.TR || tn === TAG_ID.TD || tn === TAG_ID.TH) {
    p.openElements.popUntilTagNamePopped(TAG_ID.SELECT);
    p._resetInsertionMode();
    p._processStartTag(token);
  } else {
    startTagInSelect(p, token);
  }
}
function endTagInSelectInTable(p, token) {
  const tn = token.tagID;
  if (tn === TAG_ID.CAPTION || tn === TAG_ID.TABLE || tn === TAG_ID.TBODY || tn === TAG_ID.TFOOT || tn === TAG_ID.THEAD || tn === TAG_ID.TR || tn === TAG_ID.TD || tn === TAG_ID.TH) {
    if (p.openElements.hasInTableScope(tn)) {
      p.openElements.popUntilTagNamePopped(TAG_ID.SELECT);
      p._resetInsertionMode();
      p.onEndTag(token);
    }
  } else {
    endTagInSelect(p, token);
  }
}
function startTagInTemplate(p, token) {
  switch (token.tagID) {
    // First, handle tags that can start without a mode change
    case TAG_ID.BASE:
    case TAG_ID.BASEFONT:
    case TAG_ID.BGSOUND:
    case TAG_ID.LINK:
    case TAG_ID.META:
    case TAG_ID.NOFRAMES:
    case TAG_ID.SCRIPT:
    case TAG_ID.STYLE:
    case TAG_ID.TEMPLATE:
    case TAG_ID.TITLE: {
      startTagInHead(p, token);
      break;
    }
    // Re-process the token in the appropriate mode
    case TAG_ID.CAPTION:
    case TAG_ID.COLGROUP:
    case TAG_ID.TBODY:
    case TAG_ID.TFOOT:
    case TAG_ID.THEAD: {
      p.tmplInsertionModeStack[0] = InsertionMode.IN_TABLE;
      p.insertionMode = InsertionMode.IN_TABLE;
      startTagInTable(p, token);
      break;
    }
    case TAG_ID.COL: {
      p.tmplInsertionModeStack[0] = InsertionMode.IN_COLUMN_GROUP;
      p.insertionMode = InsertionMode.IN_COLUMN_GROUP;
      startTagInColumnGroup(p, token);
      break;
    }
    case TAG_ID.TR: {
      p.tmplInsertionModeStack[0] = InsertionMode.IN_TABLE_BODY;
      p.insertionMode = InsertionMode.IN_TABLE_BODY;
      startTagInTableBody(p, token);
      break;
    }
    case TAG_ID.TD:
    case TAG_ID.TH: {
      p.tmplInsertionModeStack[0] = InsertionMode.IN_ROW;
      p.insertionMode = InsertionMode.IN_ROW;
      startTagInRow(p, token);
      break;
    }
    default: {
      p.tmplInsertionModeStack[0] = InsertionMode.IN_BODY;
      p.insertionMode = InsertionMode.IN_BODY;
      startTagInBody(p, token);
    }
  }
}
function endTagInTemplate(p, token) {
  if (token.tagID === TAG_ID.TEMPLATE) {
    templateEndTagInHead(p, token);
  }
}
function eofInTemplate(p, token) {
  if (p.openElements.tmplCount > 0) {
    p.openElements.popUntilTagNamePopped(TAG_ID.TEMPLATE);
    p.activeFormattingElements.clearToLastMarker();
    p.tmplInsertionModeStack.shift();
    p._resetInsertionMode();
    p.onEof(token);
  } else {
    stopParsing(p, token);
  }
}
function startTagAfterBody(p, token) {
  if (token.tagID === TAG_ID.HTML) {
    startTagInBody(p, token);
  } else {
    tokenAfterBody(p, token);
  }
}
function endTagAfterBody(p, token) {
  var _a;
  if (token.tagID === TAG_ID.HTML) {
    if (!p.fragmentContext) {
      p.insertionMode = InsertionMode.AFTER_AFTER_BODY;
    }
    if (p.options.sourceCodeLocationInfo && p.openElements.tagIDs[0] === TAG_ID.HTML) {
      p._setEndLocation(p.openElements.items[0], token);
      const bodyElement = p.openElements.items[1];
      if (bodyElement && !((_a = p.treeAdapter.getNodeSourceCodeLocation(bodyElement)) === null || _a === void 0 ? void 0 : _a.endTag)) {
        p._setEndLocation(bodyElement, token);
      }
    }
  } else {
    tokenAfterBody(p, token);
  }
}
function tokenAfterBody(p, token) {
  p.insertionMode = InsertionMode.IN_BODY;
  modeInBody(p, token);
}
function startTagInFrameset(p, token) {
  switch (token.tagID) {
    case TAG_ID.HTML: {
      startTagInBody(p, token);
      break;
    }
    case TAG_ID.FRAMESET: {
      p._insertElement(token, NS.HTML);
      break;
    }
    case TAG_ID.FRAME: {
      p._appendElement(token, NS.HTML);
      token.ackSelfClosing = true;
      break;
    }
    case TAG_ID.NOFRAMES: {
      startTagInHead(p, token);
      break;
    }
    default:
  }
}
function endTagInFrameset(p, token) {
  if (token.tagID === TAG_ID.FRAMESET && !p.openElements.isRootHtmlElementCurrent()) {
    p.openElements.pop();
    if (!p.fragmentContext && p.openElements.currentTagId !== TAG_ID.FRAMESET) {
      p.insertionMode = InsertionMode.AFTER_FRAMESET;
    }
  }
}
function startTagAfterFrameset(p, token) {
  switch (token.tagID) {
    case TAG_ID.HTML: {
      startTagInBody(p, token);
      break;
    }
    case TAG_ID.NOFRAMES: {
      startTagInHead(p, token);
      break;
    }
    default:
  }
}
function endTagAfterFrameset(p, token) {
  if (token.tagID === TAG_ID.HTML) {
    p.insertionMode = InsertionMode.AFTER_AFTER_FRAMESET;
  }
}
function startTagAfterAfterBody(p, token) {
  if (token.tagID === TAG_ID.HTML) {
    startTagInBody(p, token);
  } else {
    tokenAfterAfterBody(p, token);
  }
}
function tokenAfterAfterBody(p, token) {
  p.insertionMode = InsertionMode.IN_BODY;
  modeInBody(p, token);
}
function startTagAfterAfterFrameset(p, token) {
  switch (token.tagID) {
    case TAG_ID.HTML: {
      startTagInBody(p, token);
      break;
    }
    case TAG_ID.NOFRAMES: {
      startTagInHead(p, token);
      break;
    }
    default:
  }
}
function nullCharacterInForeignContent(p, token) {
  token.chars = REPLACEMENT_CHARACTER;
  p._insertCharacters(token);
}
function characterInForeignContent(p, token) {
  p._insertCharacters(token);
  p.framesetOk = false;
}
function popUntilHtmlOrIntegrationPoint(p) {
  while (p.treeAdapter.getNamespaceURI(p.openElements.current) !== NS.HTML && p.openElements.currentTagId !== void 0 && !p._isIntegrationPoint(p.openElements.currentTagId, p.openElements.current)) {
    p.openElements.pop();
  }
}
function startTagInForeignContent(p, token) {
  if (causesExit(token)) {
    popUntilHtmlOrIntegrationPoint(p);
    p._startTagOutsideForeignContent(token);
  } else {
    const current = p._getAdjustedCurrentElement();
    const currentNs = p.treeAdapter.getNamespaceURI(current);
    if (currentNs === NS.MATHML) {
      adjustTokenMathMLAttrs(token);
    } else if (currentNs === NS.SVG) {
      adjustTokenSVGTagName(token);
      adjustTokenSVGAttrs(token);
    }
    adjustTokenXMLAttrs(token);
    if (token.selfClosing) {
      p._appendElement(token, currentNs);
    } else {
      p._insertElement(token, currentNs);
    }
    token.ackSelfClosing = true;
  }
}
function endTagInForeignContent(p, token) {
  if (token.tagID === TAG_ID.P || token.tagID === TAG_ID.BR) {
    popUntilHtmlOrIntegrationPoint(p);
    p._endTagOutsideForeignContent(token);
    return;
  }
  for (let i = p.openElements.stackTop; i > 0; i--) {
    const element = p.openElements.items[i];
    if (p.treeAdapter.getNamespaceURI(element) === NS.HTML) {
      p._endTagOutsideForeignContent(token);
      break;
    }
    const tagName = p.treeAdapter.getTagName(element);
    if (tagName.toLowerCase() === token.tagName) {
      token.tagName = tagName;
      p.openElements.shortenToLength(i);
      break;
    }
  }
}
var HIDDEN_INPUT_TYPE, AA_OUTER_LOOP_ITER, AA_INNER_LOOP_ITER, InsertionMode, BASE_LOC, TABLE_STRUCTURE_TAGS, defaultParserOptions, Parser, TABLE_VOID_ELEMENTS;
var init_parser = __esm({
  "node_modules/parse5/dist/parser/index.js"() {
    init_tokenizer();
    init_open_element_stack();
    init_formatting_element_list();
    init_default();
    init_doctype();
    init_foreign_content();
    init_error_codes();
    init_unicode();
    init_html();
    init_token();
    HIDDEN_INPUT_TYPE = "hidden";
    AA_OUTER_LOOP_ITER = 8;
    AA_INNER_LOOP_ITER = 3;
    (function(InsertionMode2) {
      InsertionMode2[InsertionMode2["INITIAL"] = 0] = "INITIAL";
      InsertionMode2[InsertionMode2["BEFORE_HTML"] = 1] = "BEFORE_HTML";
      InsertionMode2[InsertionMode2["BEFORE_HEAD"] = 2] = "BEFORE_HEAD";
      InsertionMode2[InsertionMode2["IN_HEAD"] = 3] = "IN_HEAD";
      InsertionMode2[InsertionMode2["IN_HEAD_NO_SCRIPT"] = 4] = "IN_HEAD_NO_SCRIPT";
      InsertionMode2[InsertionMode2["AFTER_HEAD"] = 5] = "AFTER_HEAD";
      InsertionMode2[InsertionMode2["IN_BODY"] = 6] = "IN_BODY";
      InsertionMode2[InsertionMode2["TEXT"] = 7] = "TEXT";
      InsertionMode2[InsertionMode2["IN_TABLE"] = 8] = "IN_TABLE";
      InsertionMode2[InsertionMode2["IN_TABLE_TEXT"] = 9] = "IN_TABLE_TEXT";
      InsertionMode2[InsertionMode2["IN_CAPTION"] = 10] = "IN_CAPTION";
      InsertionMode2[InsertionMode2["IN_COLUMN_GROUP"] = 11] = "IN_COLUMN_GROUP";
      InsertionMode2[InsertionMode2["IN_TABLE_BODY"] = 12] = "IN_TABLE_BODY";
      InsertionMode2[InsertionMode2["IN_ROW"] = 13] = "IN_ROW";
      InsertionMode2[InsertionMode2["IN_CELL"] = 14] = "IN_CELL";
      InsertionMode2[InsertionMode2["IN_SELECT"] = 15] = "IN_SELECT";
      InsertionMode2[InsertionMode2["IN_SELECT_IN_TABLE"] = 16] = "IN_SELECT_IN_TABLE";
      InsertionMode2[InsertionMode2["IN_TEMPLATE"] = 17] = "IN_TEMPLATE";
      InsertionMode2[InsertionMode2["AFTER_BODY"] = 18] = "AFTER_BODY";
      InsertionMode2[InsertionMode2["IN_FRAMESET"] = 19] = "IN_FRAMESET";
      InsertionMode2[InsertionMode2["AFTER_FRAMESET"] = 20] = "AFTER_FRAMESET";
      InsertionMode2[InsertionMode2["AFTER_AFTER_BODY"] = 21] = "AFTER_AFTER_BODY";
      InsertionMode2[InsertionMode2["AFTER_AFTER_FRAMESET"] = 22] = "AFTER_AFTER_FRAMESET";
    })(InsertionMode || (InsertionMode = {}));
    BASE_LOC = {
      startLine: -1,
      startCol: -1,
      startOffset: -1,
      endLine: -1,
      endCol: -1,
      endOffset: -1
    };
    TABLE_STRUCTURE_TAGS = /* @__PURE__ */ new Set([TAG_ID.TABLE, TAG_ID.TBODY, TAG_ID.TFOOT, TAG_ID.THEAD, TAG_ID.TR]);
    defaultParserOptions = {
      scriptingEnabled: true,
      sourceCodeLocationInfo: false,
      treeAdapter: defaultTreeAdapter,
      onParseError: null
    };
    Parser = class {
      constructor(options, document, fragmentContext = null, scriptHandler = null) {
        this.fragmentContext = fragmentContext;
        this.scriptHandler = scriptHandler;
        this.currentToken = null;
        this.stopped = false;
        this.insertionMode = InsertionMode.INITIAL;
        this.originalInsertionMode = InsertionMode.INITIAL;
        this.headElement = null;
        this.formElement = null;
        this.currentNotInHTML = false;
        this.tmplInsertionModeStack = [];
        this.pendingCharacterTokens = [];
        this.hasNonWhitespacePendingCharacterToken = false;
        this.framesetOk = true;
        this.skipNextNewLine = false;
        this.fosterParentingEnabled = false;
        this.options = {
          ...defaultParserOptions,
          ...options
        };
        this.treeAdapter = this.options.treeAdapter;
        this.onParseError = this.options.onParseError;
        if (this.onParseError) {
          this.options.sourceCodeLocationInfo = true;
        }
        this.document = document !== null && document !== void 0 ? document : this.treeAdapter.createDocument();
        this.tokenizer = new Tokenizer(this.options, this);
        this.activeFormattingElements = new FormattingElementList(this.treeAdapter);
        this.fragmentContextID = fragmentContext ? getTagID(this.treeAdapter.getTagName(fragmentContext)) : TAG_ID.UNKNOWN;
        this._setContextModes(fragmentContext !== null && fragmentContext !== void 0 ? fragmentContext : this.document, this.fragmentContextID);
        this.openElements = new OpenElementStack(this.document, this.treeAdapter, this);
      }
      // API
      static parse(html, options) {
        const parser = new this(options);
        parser.tokenizer.write(html, true);
        return parser.document;
      }
      static getFragmentParser(fragmentContext, options) {
        const opts = {
          ...defaultParserOptions,
          ...options
        };
        fragmentContext !== null && fragmentContext !== void 0 ? fragmentContext : fragmentContext = opts.treeAdapter.createElement(TAG_NAMES.TEMPLATE, NS.HTML, []);
        const documentMock = opts.treeAdapter.createElement("documentmock", NS.HTML, []);
        const parser = new this(opts, documentMock, fragmentContext);
        if (parser.fragmentContextID === TAG_ID.TEMPLATE) {
          parser.tmplInsertionModeStack.unshift(InsertionMode.IN_TEMPLATE);
        }
        parser._initTokenizerForFragmentParsing();
        parser._insertFakeRootElement();
        parser._resetInsertionMode();
        parser._findFormInFragmentContext();
        return parser;
      }
      getFragment() {
        const rootElement = this.treeAdapter.getFirstChild(this.document);
        const fragment = this.treeAdapter.createDocumentFragment();
        this._adoptNodes(rootElement, fragment);
        return fragment;
      }
      //Errors
      /** @internal */
      _err(token, code, beforeToken) {
        var _a;
        if (!this.onParseError)
          return;
        const loc = (_a = token.location) !== null && _a !== void 0 ? _a : BASE_LOC;
        const err = {
          code,
          startLine: loc.startLine,
          startCol: loc.startCol,
          startOffset: loc.startOffset,
          endLine: beforeToken ? loc.startLine : loc.endLine,
          endCol: beforeToken ? loc.startCol : loc.endCol,
          endOffset: beforeToken ? loc.startOffset : loc.endOffset
        };
        this.onParseError(err);
      }
      //Stack events
      /** @internal */
      onItemPush(node, tid, isTop) {
        var _a, _b;
        (_b = (_a = this.treeAdapter).onItemPush) === null || _b === void 0 ? void 0 : _b.call(_a, node);
        if (isTop && this.openElements.stackTop > 0)
          this._setContextModes(node, tid);
      }
      /** @internal */
      onItemPop(node, isTop) {
        var _a, _b;
        if (this.options.sourceCodeLocationInfo) {
          this._setEndLocation(node, this.currentToken);
        }
        (_b = (_a = this.treeAdapter).onItemPop) === null || _b === void 0 ? void 0 : _b.call(_a, node, this.openElements.current);
        if (isTop) {
          let current;
          let currentTagId;
          if (this.openElements.stackTop === 0 && this.fragmentContext) {
            current = this.fragmentContext;
            currentTagId = this.fragmentContextID;
          } else {
            ({ current, currentTagId } = this.openElements);
          }
          this._setContextModes(current, currentTagId);
        }
      }
      _setContextModes(current, tid) {
        const isHTML = current === this.document || current && this.treeAdapter.getNamespaceURI(current) === NS.HTML;
        this.currentNotInHTML = !isHTML;
        this.tokenizer.inForeignNode = !isHTML && current !== void 0 && tid !== void 0 && !this._isIntegrationPoint(tid, current);
      }
      /** @protected */
      _switchToTextParsing(currentToken, nextTokenizerState) {
        this._insertElement(currentToken, NS.HTML);
        this.tokenizer.state = nextTokenizerState;
        this.originalInsertionMode = this.insertionMode;
        this.insertionMode = InsertionMode.TEXT;
      }
      switchToPlaintextParsing() {
        this.insertionMode = InsertionMode.TEXT;
        this.originalInsertionMode = InsertionMode.IN_BODY;
        this.tokenizer.state = TokenizerMode.PLAINTEXT;
      }
      //Fragment parsing
      /** @protected */
      _getAdjustedCurrentElement() {
        return this.openElements.stackTop === 0 && this.fragmentContext ? this.fragmentContext : this.openElements.current;
      }
      /** @protected */
      _findFormInFragmentContext() {
        let node = this.fragmentContext;
        while (node) {
          if (this.treeAdapter.getTagName(node) === TAG_NAMES.FORM) {
            this.formElement = node;
            break;
          }
          node = this.treeAdapter.getParentNode(node);
        }
      }
      _initTokenizerForFragmentParsing() {
        if (!this.fragmentContext || this.treeAdapter.getNamespaceURI(this.fragmentContext) !== NS.HTML) {
          return;
        }
        switch (this.fragmentContextID) {
          case TAG_ID.TITLE:
          case TAG_ID.TEXTAREA: {
            this.tokenizer.state = TokenizerMode.RCDATA;
            break;
          }
          case TAG_ID.STYLE:
          case TAG_ID.XMP:
          case TAG_ID.IFRAME:
          case TAG_ID.NOEMBED:
          case TAG_ID.NOFRAMES:
          case TAG_ID.NOSCRIPT: {
            this.tokenizer.state = TokenizerMode.RAWTEXT;
            break;
          }
          case TAG_ID.SCRIPT: {
            this.tokenizer.state = TokenizerMode.SCRIPT_DATA;
            break;
          }
          case TAG_ID.PLAINTEXT: {
            this.tokenizer.state = TokenizerMode.PLAINTEXT;
            break;
          }
          default:
        }
      }
      //Tree mutation
      /** @protected */
      _setDocumentType(token) {
        const name = token.name || "";
        const publicId = token.publicId || "";
        const systemId = token.systemId || "";
        this.treeAdapter.setDocumentType(this.document, name, publicId, systemId);
        if (token.location) {
          const documentChildren = this.treeAdapter.getChildNodes(this.document);
          const docTypeNode = documentChildren.find((node) => this.treeAdapter.isDocumentTypeNode(node));
          if (docTypeNode) {
            this.treeAdapter.setNodeSourceCodeLocation(docTypeNode, token.location);
          }
        }
      }
      /** @protected */
      _attachElementToTree(element, location) {
        if (this.options.sourceCodeLocationInfo) {
          const loc = location && {
            ...location,
            startTag: location
          };
          this.treeAdapter.setNodeSourceCodeLocation(element, loc);
        }
        if (this._shouldFosterParentOnInsertion()) {
          this._fosterParentElement(element);
        } else {
          const parent = this.openElements.currentTmplContentOrNode;
          this.treeAdapter.appendChild(parent !== null && parent !== void 0 ? parent : this.document, element);
        }
      }
      /**
       * For self-closing tags. Add an element to the tree, but skip adding it
       * to the stack.
       */
      /** @protected */
      _appendElement(token, namespaceURI) {
        const element = this.treeAdapter.createElement(token.tagName, namespaceURI, token.attrs);
        this._attachElementToTree(element, token.location);
      }
      /** @protected */
      _insertElement(token, namespaceURI) {
        const element = this.treeAdapter.createElement(token.tagName, namespaceURI, token.attrs);
        this._attachElementToTree(element, token.location);
        this.openElements.push(element, token.tagID);
      }
      /** @protected */
      _insertFakeElement(tagName, tagID) {
        const element = this.treeAdapter.createElement(tagName, NS.HTML, []);
        this._attachElementToTree(element, null);
        this.openElements.push(element, tagID);
      }
      /** @protected */
      _insertTemplate(token) {
        const tmpl = this.treeAdapter.createElement(token.tagName, NS.HTML, token.attrs);
        const content = this.treeAdapter.createDocumentFragment();
        this.treeAdapter.setTemplateContent(tmpl, content);
        this._attachElementToTree(tmpl, token.location);
        this.openElements.push(tmpl, token.tagID);
        if (this.options.sourceCodeLocationInfo)
          this.treeAdapter.setNodeSourceCodeLocation(content, null);
      }
      /** @protected */
      _insertFakeRootElement() {
        const element = this.treeAdapter.createElement(TAG_NAMES.HTML, NS.HTML, []);
        if (this.options.sourceCodeLocationInfo)
          this.treeAdapter.setNodeSourceCodeLocation(element, null);
        this.treeAdapter.appendChild(this.openElements.current, element);
        this.openElements.push(element, TAG_ID.HTML);
      }
      /** @protected */
      _appendCommentNode(token, parent) {
        const commentNode = this.treeAdapter.createCommentNode(token.data);
        this.treeAdapter.appendChild(parent, commentNode);
        if (this.options.sourceCodeLocationInfo) {
          this.treeAdapter.setNodeSourceCodeLocation(commentNode, token.location);
        }
      }
      /** @protected */
      _insertCharacters(token) {
        let parent;
        let beforeElement;
        if (this._shouldFosterParentOnInsertion()) {
          ({ parent, beforeElement } = this._findFosterParentingLocation());
          if (beforeElement) {
            this.treeAdapter.insertTextBefore(parent, token.chars, beforeElement);
          } else {
            this.treeAdapter.insertText(parent, token.chars);
          }
        } else {
          parent = this.openElements.currentTmplContentOrNode;
          this.treeAdapter.insertText(parent, token.chars);
        }
        if (!token.location)
          return;
        const siblings = this.treeAdapter.getChildNodes(parent);
        const textNodeIdx = beforeElement ? siblings.lastIndexOf(beforeElement) : siblings.length;
        const textNode = siblings[textNodeIdx - 1];
        const tnLoc = this.treeAdapter.getNodeSourceCodeLocation(textNode);
        if (tnLoc) {
          const { endLine, endCol, endOffset } = token.location;
          this.treeAdapter.updateNodeSourceCodeLocation(textNode, { endLine, endCol, endOffset });
        } else if (this.options.sourceCodeLocationInfo) {
          this.treeAdapter.setNodeSourceCodeLocation(textNode, token.location);
        }
      }
      /** @protected */
      _adoptNodes(donor, recipient) {
        for (let child = this.treeAdapter.getFirstChild(donor); child; child = this.treeAdapter.getFirstChild(donor)) {
          this.treeAdapter.detachNode(child);
          this.treeAdapter.appendChild(recipient, child);
        }
      }
      /** @protected */
      _setEndLocation(element, closingToken) {
        if (this.treeAdapter.getNodeSourceCodeLocation(element) && closingToken.location) {
          const ctLoc = closingToken.location;
          const tn = this.treeAdapter.getTagName(element);
          const endLoc = (
            // NOTE: For cases like <p> <p> </p> - First 'p' closes without a closing
            // tag and for cases like <td> <p> </td> - 'p' closes without a closing tag.
            closingToken.type === TokenType.END_TAG && tn === closingToken.tagName ? {
              endTag: { ...ctLoc },
              endLine: ctLoc.endLine,
              endCol: ctLoc.endCol,
              endOffset: ctLoc.endOffset
            } : {
              endLine: ctLoc.startLine,
              endCol: ctLoc.startCol,
              endOffset: ctLoc.startOffset
            }
          );
          this.treeAdapter.updateNodeSourceCodeLocation(element, endLoc);
        }
      }
      //Token processing
      shouldProcessStartTagTokenInForeignContent(token) {
        if (!this.currentNotInHTML)
          return false;
        let current;
        let currentTagId;
        if (this.openElements.stackTop === 0 && this.fragmentContext) {
          current = this.fragmentContext;
          currentTagId = this.fragmentContextID;
        } else {
          ({ current, currentTagId } = this.openElements);
        }
        if (token.tagID === TAG_ID.SVG && this.treeAdapter.getTagName(current) === TAG_NAMES.ANNOTATION_XML && this.treeAdapter.getNamespaceURI(current) === NS.MATHML) {
          return false;
        }
        return (
          // Check that `current` is not an integration point for HTML or MathML elements.
          this.tokenizer.inForeignNode || // If it _is_ an integration point, then we might have to check that it is not an HTML
          // integration point.
          (token.tagID === TAG_ID.MGLYPH || token.tagID === TAG_ID.MALIGNMARK) && currentTagId !== void 0 && !this._isIntegrationPoint(currentTagId, current, NS.HTML)
        );
      }
      /** @protected */
      _processToken(token) {
        switch (token.type) {
          case TokenType.CHARACTER: {
            this.onCharacter(token);
            break;
          }
          case TokenType.NULL_CHARACTER: {
            this.onNullCharacter(token);
            break;
          }
          case TokenType.COMMENT: {
            this.onComment(token);
            break;
          }
          case TokenType.DOCTYPE: {
            this.onDoctype(token);
            break;
          }
          case TokenType.START_TAG: {
            this._processStartTag(token);
            break;
          }
          case TokenType.END_TAG: {
            this.onEndTag(token);
            break;
          }
          case TokenType.EOF: {
            this.onEof(token);
            break;
          }
          case TokenType.WHITESPACE_CHARACTER: {
            this.onWhitespaceCharacter(token);
            break;
          }
        }
      }
      //Integration points
      /** @protected */
      _isIntegrationPoint(tid, element, foreignNS) {
        const ns = this.treeAdapter.getNamespaceURI(element);
        const attrs = this.treeAdapter.getAttrList(element);
        return isIntegrationPoint(tid, ns, attrs, foreignNS);
      }
      //Active formatting elements reconstruction
      /** @protected */
      _reconstructActiveFormattingElements() {
        const listLength = this.activeFormattingElements.entries.length;
        if (listLength) {
          const endIndex = this.activeFormattingElements.entries.findIndex((entry2) => entry2.type === EntryType.Marker || this.openElements.contains(entry2.element));
          const unopenIdx = endIndex === -1 ? listLength - 1 : endIndex - 1;
          for (let i = unopenIdx; i >= 0; i--) {
            const entry2 = this.activeFormattingElements.entries[i];
            this._insertElement(entry2.token, this.treeAdapter.getNamespaceURI(entry2.element));
            entry2.element = this.openElements.current;
          }
        }
      }
      //Close elements
      /** @protected */
      _closeTableCell() {
        this.openElements.generateImpliedEndTags();
        this.openElements.popUntilTableCellPopped();
        this.activeFormattingElements.clearToLastMarker();
        this.insertionMode = InsertionMode.IN_ROW;
      }
      /** @protected */
      _closePElement() {
        this.openElements.generateImpliedEndTagsWithExclusion(TAG_ID.P);
        this.openElements.popUntilTagNamePopped(TAG_ID.P);
      }
      //Insertion modes
      /** @protected */
      _resetInsertionMode() {
        for (let i = this.openElements.stackTop; i >= 0; i--) {
          switch (i === 0 && this.fragmentContext ? this.fragmentContextID : this.openElements.tagIDs[i]) {
            case TAG_ID.TR: {
              this.insertionMode = InsertionMode.IN_ROW;
              return;
            }
            case TAG_ID.TBODY:
            case TAG_ID.THEAD:
            case TAG_ID.TFOOT: {
              this.insertionMode = InsertionMode.IN_TABLE_BODY;
              return;
            }
            case TAG_ID.CAPTION: {
              this.insertionMode = InsertionMode.IN_CAPTION;
              return;
            }
            case TAG_ID.COLGROUP: {
              this.insertionMode = InsertionMode.IN_COLUMN_GROUP;
              return;
            }
            case TAG_ID.TABLE: {
              this.insertionMode = InsertionMode.IN_TABLE;
              return;
            }
            case TAG_ID.BODY: {
              this.insertionMode = InsertionMode.IN_BODY;
              return;
            }
            case TAG_ID.FRAMESET: {
              this.insertionMode = InsertionMode.IN_FRAMESET;
              return;
            }
            case TAG_ID.SELECT: {
              this._resetInsertionModeForSelect(i);
              return;
            }
            case TAG_ID.TEMPLATE: {
              this.insertionMode = this.tmplInsertionModeStack[0];
              return;
            }
            case TAG_ID.HTML: {
              this.insertionMode = this.headElement ? InsertionMode.AFTER_HEAD : InsertionMode.BEFORE_HEAD;
              return;
            }
            case TAG_ID.TD:
            case TAG_ID.TH: {
              if (i > 0) {
                this.insertionMode = InsertionMode.IN_CELL;
                return;
              }
              break;
            }
            case TAG_ID.HEAD: {
              if (i > 0) {
                this.insertionMode = InsertionMode.IN_HEAD;
                return;
              }
              break;
            }
          }
        }
        this.insertionMode = InsertionMode.IN_BODY;
      }
      /** @protected */
      _resetInsertionModeForSelect(selectIdx) {
        if (selectIdx > 0) {
          for (let i = selectIdx - 1; i > 0; i--) {
            const tn = this.openElements.tagIDs[i];
            if (tn === TAG_ID.TEMPLATE) {
              break;
            } else if (tn === TAG_ID.TABLE) {
              this.insertionMode = InsertionMode.IN_SELECT_IN_TABLE;
              return;
            }
          }
        }
        this.insertionMode = InsertionMode.IN_SELECT;
      }
      //Foster parenting
      /** @protected */
      _isElementCausesFosterParenting(tn) {
        return TABLE_STRUCTURE_TAGS.has(tn);
      }
      /** @protected */
      _shouldFosterParentOnInsertion() {
        return this.fosterParentingEnabled && this.openElements.currentTagId !== void 0 && this._isElementCausesFosterParenting(this.openElements.currentTagId);
      }
      /** @protected */
      _findFosterParentingLocation() {
        for (let i = this.openElements.stackTop; i >= 0; i--) {
          const openElement = this.openElements.items[i];
          switch (this.openElements.tagIDs[i]) {
            case TAG_ID.TEMPLATE: {
              if (this.treeAdapter.getNamespaceURI(openElement) === NS.HTML) {
                return { parent: this.treeAdapter.getTemplateContent(openElement), beforeElement: null };
              }
              break;
            }
            case TAG_ID.TABLE: {
              const parent = this.treeAdapter.getParentNode(openElement);
              if (parent) {
                return { parent, beforeElement: openElement };
              }
              return { parent: this.openElements.items[i - 1], beforeElement: null };
            }
            default:
          }
        }
        return { parent: this.openElements.items[0], beforeElement: null };
      }
      /** @protected */
      _fosterParentElement(element) {
        const location = this._findFosterParentingLocation();
        if (location.beforeElement) {
          this.treeAdapter.insertBefore(location.parent, element, location.beforeElement);
        } else {
          this.treeAdapter.appendChild(location.parent, element);
        }
      }
      //Special elements
      /** @protected */
      _isSpecialElement(element, id) {
        const ns = this.treeAdapter.getNamespaceURI(element);
        return SPECIAL_ELEMENTS[ns].has(id);
      }
      /** @internal */
      onCharacter(token) {
        this.skipNextNewLine = false;
        if (this.tokenizer.inForeignNode) {
          characterInForeignContent(this, token);
          return;
        }
        switch (this.insertionMode) {
          case InsertionMode.INITIAL: {
            tokenInInitialMode(this, token);
            break;
          }
          case InsertionMode.BEFORE_HTML: {
            tokenBeforeHtml(this, token);
            break;
          }
          case InsertionMode.BEFORE_HEAD: {
            tokenBeforeHead(this, token);
            break;
          }
          case InsertionMode.IN_HEAD: {
            tokenInHead(this, token);
            break;
          }
          case InsertionMode.IN_HEAD_NO_SCRIPT: {
            tokenInHeadNoScript(this, token);
            break;
          }
          case InsertionMode.AFTER_HEAD: {
            tokenAfterHead(this, token);
            break;
          }
          case InsertionMode.IN_BODY:
          case InsertionMode.IN_CAPTION:
          case InsertionMode.IN_CELL:
          case InsertionMode.IN_TEMPLATE: {
            characterInBody(this, token);
            break;
          }
          case InsertionMode.TEXT:
          case InsertionMode.IN_SELECT:
          case InsertionMode.IN_SELECT_IN_TABLE: {
            this._insertCharacters(token);
            break;
          }
          case InsertionMode.IN_TABLE:
          case InsertionMode.IN_TABLE_BODY:
          case InsertionMode.IN_ROW: {
            characterInTable(this, token);
            break;
          }
          case InsertionMode.IN_TABLE_TEXT: {
            characterInTableText(this, token);
            break;
          }
          case InsertionMode.IN_COLUMN_GROUP: {
            tokenInColumnGroup(this, token);
            break;
          }
          case InsertionMode.AFTER_BODY: {
            tokenAfterBody(this, token);
            break;
          }
          case InsertionMode.AFTER_AFTER_BODY: {
            tokenAfterAfterBody(this, token);
            break;
          }
          default:
        }
      }
      /** @internal */
      onNullCharacter(token) {
        this.skipNextNewLine = false;
        if (this.tokenizer.inForeignNode) {
          nullCharacterInForeignContent(this, token);
          return;
        }
        switch (this.insertionMode) {
          case InsertionMode.INITIAL: {
            tokenInInitialMode(this, token);
            break;
          }
          case InsertionMode.BEFORE_HTML: {
            tokenBeforeHtml(this, token);
            break;
          }
          case InsertionMode.BEFORE_HEAD: {
            tokenBeforeHead(this, token);
            break;
          }
          case InsertionMode.IN_HEAD: {
            tokenInHead(this, token);
            break;
          }
          case InsertionMode.IN_HEAD_NO_SCRIPT: {
            tokenInHeadNoScript(this, token);
            break;
          }
          case InsertionMode.AFTER_HEAD: {
            tokenAfterHead(this, token);
            break;
          }
          case InsertionMode.TEXT: {
            this._insertCharacters(token);
            break;
          }
          case InsertionMode.IN_TABLE:
          case InsertionMode.IN_TABLE_BODY:
          case InsertionMode.IN_ROW: {
            characterInTable(this, token);
            break;
          }
          case InsertionMode.IN_COLUMN_GROUP: {
            tokenInColumnGroup(this, token);
            break;
          }
          case InsertionMode.AFTER_BODY: {
            tokenAfterBody(this, token);
            break;
          }
          case InsertionMode.AFTER_AFTER_BODY: {
            tokenAfterAfterBody(this, token);
            break;
          }
          default:
        }
      }
      /** @internal */
      onComment(token) {
        this.skipNextNewLine = false;
        if (this.currentNotInHTML) {
          appendComment(this, token);
          return;
        }
        switch (this.insertionMode) {
          case InsertionMode.INITIAL:
          case InsertionMode.BEFORE_HTML:
          case InsertionMode.BEFORE_HEAD:
          case InsertionMode.IN_HEAD:
          case InsertionMode.IN_HEAD_NO_SCRIPT:
          case InsertionMode.AFTER_HEAD:
          case InsertionMode.IN_BODY:
          case InsertionMode.IN_TABLE:
          case InsertionMode.IN_CAPTION:
          case InsertionMode.IN_COLUMN_GROUP:
          case InsertionMode.IN_TABLE_BODY:
          case InsertionMode.IN_ROW:
          case InsertionMode.IN_CELL:
          case InsertionMode.IN_SELECT:
          case InsertionMode.IN_SELECT_IN_TABLE:
          case InsertionMode.IN_TEMPLATE:
          case InsertionMode.IN_FRAMESET:
          case InsertionMode.AFTER_FRAMESET: {
            appendComment(this, token);
            break;
          }
          case InsertionMode.IN_TABLE_TEXT: {
            tokenInTableText(this, token);
            break;
          }
          case InsertionMode.AFTER_BODY: {
            appendCommentToRootHtmlElement(this, token);
            break;
          }
          case InsertionMode.AFTER_AFTER_BODY:
          case InsertionMode.AFTER_AFTER_FRAMESET: {
            appendCommentToDocument(this, token);
            break;
          }
          default:
        }
      }
      /** @internal */
      onDoctype(token) {
        this.skipNextNewLine = false;
        switch (this.insertionMode) {
          case InsertionMode.INITIAL: {
            doctypeInInitialMode(this, token);
            break;
          }
          case InsertionMode.BEFORE_HEAD:
          case InsertionMode.IN_HEAD:
          case InsertionMode.IN_HEAD_NO_SCRIPT:
          case InsertionMode.AFTER_HEAD: {
            this._err(token, ERR.misplacedDoctype);
            break;
          }
          case InsertionMode.IN_TABLE_TEXT: {
            tokenInTableText(this, token);
            break;
          }
          default:
        }
      }
      /** @internal */
      onStartTag(token) {
        this.skipNextNewLine = false;
        this.currentToken = token;
        this._processStartTag(token);
        if (token.selfClosing && !token.ackSelfClosing) {
          this._err(token, ERR.nonVoidHtmlElementStartTagWithTrailingSolidus);
        }
      }
      /**
       * Processes a given start tag.
       *
       * `onStartTag` checks if a self-closing tag was recognized. When a token
       * is moved inbetween multiple insertion modes, this check for self-closing
       * could lead to false positives. To avoid this, `_processStartTag` is used
       * for nested calls.
       *
       * @param token The token to process.
       * @protected
       */
      _processStartTag(token) {
        if (this.shouldProcessStartTagTokenInForeignContent(token)) {
          startTagInForeignContent(this, token);
        } else {
          this._startTagOutsideForeignContent(token);
        }
      }
      /** @protected */
      _startTagOutsideForeignContent(token) {
        switch (this.insertionMode) {
          case InsertionMode.INITIAL: {
            tokenInInitialMode(this, token);
            break;
          }
          case InsertionMode.BEFORE_HTML: {
            startTagBeforeHtml(this, token);
            break;
          }
          case InsertionMode.BEFORE_HEAD: {
            startTagBeforeHead(this, token);
            break;
          }
          case InsertionMode.IN_HEAD: {
            startTagInHead(this, token);
            break;
          }
          case InsertionMode.IN_HEAD_NO_SCRIPT: {
            startTagInHeadNoScript(this, token);
            break;
          }
          case InsertionMode.AFTER_HEAD: {
            startTagAfterHead(this, token);
            break;
          }
          case InsertionMode.IN_BODY: {
            startTagInBody(this, token);
            break;
          }
          case InsertionMode.IN_TABLE: {
            startTagInTable(this, token);
            break;
          }
          case InsertionMode.IN_TABLE_TEXT: {
            tokenInTableText(this, token);
            break;
          }
          case InsertionMode.IN_CAPTION: {
            startTagInCaption(this, token);
            break;
          }
          case InsertionMode.IN_COLUMN_GROUP: {
            startTagInColumnGroup(this, token);
            break;
          }
          case InsertionMode.IN_TABLE_BODY: {
            startTagInTableBody(this, token);
            break;
          }
          case InsertionMode.IN_ROW: {
            startTagInRow(this, token);
            break;
          }
          case InsertionMode.IN_CELL: {
            startTagInCell(this, token);
            break;
          }
          case InsertionMode.IN_SELECT: {
            startTagInSelect(this, token);
            break;
          }
          case InsertionMode.IN_SELECT_IN_TABLE: {
            startTagInSelectInTable(this, token);
            break;
          }
          case InsertionMode.IN_TEMPLATE: {
            startTagInTemplate(this, token);
            break;
          }
          case InsertionMode.AFTER_BODY: {
            startTagAfterBody(this, token);
            break;
          }
          case InsertionMode.IN_FRAMESET: {
            startTagInFrameset(this, token);
            break;
          }
          case InsertionMode.AFTER_FRAMESET: {
            startTagAfterFrameset(this, token);
            break;
          }
          case InsertionMode.AFTER_AFTER_BODY: {
            startTagAfterAfterBody(this, token);
            break;
          }
          case InsertionMode.AFTER_AFTER_FRAMESET: {
            startTagAfterAfterFrameset(this, token);
            break;
          }
          default:
        }
      }
      /** @internal */
      onEndTag(token) {
        this.skipNextNewLine = false;
        this.currentToken = token;
        if (this.currentNotInHTML) {
          endTagInForeignContent(this, token);
        } else {
          this._endTagOutsideForeignContent(token);
        }
      }
      /** @protected */
      _endTagOutsideForeignContent(token) {
        switch (this.insertionMode) {
          case InsertionMode.INITIAL: {
            tokenInInitialMode(this, token);
            break;
          }
          case InsertionMode.BEFORE_HTML: {
            endTagBeforeHtml(this, token);
            break;
          }
          case InsertionMode.BEFORE_HEAD: {
            endTagBeforeHead(this, token);
            break;
          }
          case InsertionMode.IN_HEAD: {
            endTagInHead(this, token);
            break;
          }
          case InsertionMode.IN_HEAD_NO_SCRIPT: {
            endTagInHeadNoScript(this, token);
            break;
          }
          case InsertionMode.AFTER_HEAD: {
            endTagAfterHead(this, token);
            break;
          }
          case InsertionMode.IN_BODY: {
            endTagInBody(this, token);
            break;
          }
          case InsertionMode.TEXT: {
            endTagInText(this, token);
            break;
          }
          case InsertionMode.IN_TABLE: {
            endTagInTable(this, token);
            break;
          }
          case InsertionMode.IN_TABLE_TEXT: {
            tokenInTableText(this, token);
            break;
          }
          case InsertionMode.IN_CAPTION: {
            endTagInCaption(this, token);
            break;
          }
          case InsertionMode.IN_COLUMN_GROUP: {
            endTagInColumnGroup(this, token);
            break;
          }
          case InsertionMode.IN_TABLE_BODY: {
            endTagInTableBody(this, token);
            break;
          }
          case InsertionMode.IN_ROW: {
            endTagInRow(this, token);
            break;
          }
          case InsertionMode.IN_CELL: {
            endTagInCell(this, token);
            break;
          }
          case InsertionMode.IN_SELECT: {
            endTagInSelect(this, token);
            break;
          }
          case InsertionMode.IN_SELECT_IN_TABLE: {
            endTagInSelectInTable(this, token);
            break;
          }
          case InsertionMode.IN_TEMPLATE: {
            endTagInTemplate(this, token);
            break;
          }
          case InsertionMode.AFTER_BODY: {
            endTagAfterBody(this, token);
            break;
          }
          case InsertionMode.IN_FRAMESET: {
            endTagInFrameset(this, token);
            break;
          }
          case InsertionMode.AFTER_FRAMESET: {
            endTagAfterFrameset(this, token);
            break;
          }
          case InsertionMode.AFTER_AFTER_BODY: {
            tokenAfterAfterBody(this, token);
            break;
          }
          default:
        }
      }
      /** @internal */
      onEof(token) {
        switch (this.insertionMode) {
          case InsertionMode.INITIAL: {
            tokenInInitialMode(this, token);
            break;
          }
          case InsertionMode.BEFORE_HTML: {
            tokenBeforeHtml(this, token);
            break;
          }
          case InsertionMode.BEFORE_HEAD: {
            tokenBeforeHead(this, token);
            break;
          }
          case InsertionMode.IN_HEAD: {
            tokenInHead(this, token);
            break;
          }
          case InsertionMode.IN_HEAD_NO_SCRIPT: {
            tokenInHeadNoScript(this, token);
            break;
          }
          case InsertionMode.AFTER_HEAD: {
            tokenAfterHead(this, token);
            break;
          }
          case InsertionMode.IN_BODY:
          case InsertionMode.IN_TABLE:
          case InsertionMode.IN_CAPTION:
          case InsertionMode.IN_COLUMN_GROUP:
          case InsertionMode.IN_TABLE_BODY:
          case InsertionMode.IN_ROW:
          case InsertionMode.IN_CELL:
          case InsertionMode.IN_SELECT:
          case InsertionMode.IN_SELECT_IN_TABLE: {
            eofInBody(this, token);
            break;
          }
          case InsertionMode.TEXT: {
            eofInText(this, token);
            break;
          }
          case InsertionMode.IN_TABLE_TEXT: {
            tokenInTableText(this, token);
            break;
          }
          case InsertionMode.IN_TEMPLATE: {
            eofInTemplate(this, token);
            break;
          }
          case InsertionMode.AFTER_BODY:
          case InsertionMode.IN_FRAMESET:
          case InsertionMode.AFTER_FRAMESET:
          case InsertionMode.AFTER_AFTER_BODY:
          case InsertionMode.AFTER_AFTER_FRAMESET: {
            stopParsing(this, token);
            break;
          }
          default:
        }
      }
      /** @internal */
      onWhitespaceCharacter(token) {
        if (this.skipNextNewLine) {
          this.skipNextNewLine = false;
          if (token.chars.charCodeAt(0) === CODE_POINTS.LINE_FEED) {
            if (token.chars.length === 1) {
              return;
            }
            token.chars = token.chars.substr(1);
          }
        }
        if (this.tokenizer.inForeignNode) {
          this._insertCharacters(token);
          return;
        }
        switch (this.insertionMode) {
          case InsertionMode.IN_HEAD:
          case InsertionMode.IN_HEAD_NO_SCRIPT:
          case InsertionMode.AFTER_HEAD:
          case InsertionMode.TEXT:
          case InsertionMode.IN_COLUMN_GROUP:
          case InsertionMode.IN_SELECT:
          case InsertionMode.IN_SELECT_IN_TABLE:
          case InsertionMode.IN_FRAMESET:
          case InsertionMode.AFTER_FRAMESET: {
            this._insertCharacters(token);
            break;
          }
          case InsertionMode.IN_BODY:
          case InsertionMode.IN_CAPTION:
          case InsertionMode.IN_CELL:
          case InsertionMode.IN_TEMPLATE:
          case InsertionMode.AFTER_BODY:
          case InsertionMode.AFTER_AFTER_BODY:
          case InsertionMode.AFTER_AFTER_FRAMESET: {
            whitespaceCharacterInBody(this, token);
            break;
          }
          case InsertionMode.IN_TABLE:
          case InsertionMode.IN_TABLE_BODY:
          case InsertionMode.IN_ROW: {
            characterInTable(this, token);
            break;
          }
          case InsertionMode.IN_TABLE_TEXT: {
            whitespaceCharacterInTableText(this, token);
            break;
          }
          default:
        }
      }
    };
    TABLE_VOID_ELEMENTS = /* @__PURE__ */ new Set([TAG_ID.CAPTION, TAG_ID.COL, TAG_ID.COLGROUP, TAG_ID.TBODY, TAG_ID.TD, TAG_ID.TFOOT, TAG_ID.TH, TAG_ID.THEAD, TAG_ID.TR]);
  }
});

// node_modules/entities/dist/escape.js
function getEscaper(regex, map) {
  return function escape(data) {
    let match;
    let lastIndex = 0;
    let result = "";
    while (match = regex.exec(data)) {
      if (lastIndex !== match.index) {
        result += data.substring(lastIndex, match.index);
      }
      result += map.get(match[0].charCodeAt(0));
      lastIndex = match.index + 1;
    }
    return result + data.substring(lastIndex);
  };
}
var getCodePoint, escapeAttribute, escapeText;
var init_escape = __esm({
  "node_modules/entities/dist/escape.js"() {
    getCodePoint = typeof String.prototype.codePointAt === "function" ? (input, index) => input.codePointAt(index) : (
      // http://mathiasbynens.be/notes/javascript-encoding#surrogate-formulae
      (c, index) => (c.charCodeAt(index) & 64512) === 55296 ? (c.charCodeAt(index) - 55296) * 1024 + c.charCodeAt(index + 1) - 56320 + 65536 : c.charCodeAt(index)
    );
    escapeAttribute = /* @__PURE__ */ getEscaper(/["&\u00A0]/g, /* @__PURE__ */ new Map([
      [34, "&quot;"],
      [38, "&amp;"],
      [160, "&nbsp;"]
    ]));
    escapeText = /* @__PURE__ */ getEscaper(/[&<>\u00A0]/g, /* @__PURE__ */ new Map([
      [38, "&amp;"],
      [60, "&lt;"],
      [62, "&gt;"],
      [160, "&nbsp;"]
    ]));
  }
});

// node_modules/parse5/dist/serializer/index.js
function isVoidElement(node, options) {
  return options.treeAdapter.isElementNode(node) && options.treeAdapter.getNamespaceURI(node) === NS.HTML && VOID_ELEMENTS.has(options.treeAdapter.getTagName(node));
}
function serialize(node, options) {
  const opts = { ...defaultOpts, ...options };
  if (isVoidElement(node, opts)) {
    return "";
  }
  return serializeChildNodes(node, opts);
}
function serializeOuter(node, options) {
  const opts = { ...defaultOpts, ...options };
  return serializeNode(node, opts);
}
function serializeChildNodes(parentNode, options) {
  let html = "";
  const container = options.treeAdapter.isElementNode(parentNode) && options.treeAdapter.getTagName(parentNode) === TAG_NAMES.TEMPLATE && options.treeAdapter.getNamespaceURI(parentNode) === NS.HTML ? options.treeAdapter.getTemplateContent(parentNode) : parentNode;
  const childNodes = options.treeAdapter.getChildNodes(container);
  if (childNodes) {
    for (const currentNode of childNodes) {
      html += serializeNode(currentNode, options);
    }
  }
  return html;
}
function serializeNode(node, options) {
  if (options.treeAdapter.isElementNode(node)) {
    return serializeElement(node, options);
  }
  if (options.treeAdapter.isTextNode(node)) {
    return serializeTextNode(node, options);
  }
  if (options.treeAdapter.isCommentNode(node)) {
    return serializeCommentNode(node, options);
  }
  if (options.treeAdapter.isDocumentTypeNode(node)) {
    return serializeDocumentTypeNode(node, options);
  }
  return "";
}
function serializeElement(node, options) {
  const tn = options.treeAdapter.getTagName(node);
  return `<${tn}${serializeAttributes(node, options)}>${isVoidElement(node, options) ? "" : `${serializeChildNodes(node, options)}</${tn}>`}`;
}
function serializeAttributes(node, { treeAdapter }) {
  let html = "";
  for (const attr2 of treeAdapter.getAttrList(node)) {
    html += " ";
    if (attr2.namespace) {
      switch (attr2.namespace) {
        case NS.XML: {
          html += `xml:${attr2.name}`;
          break;
        }
        case NS.XMLNS: {
          if (attr2.name !== "xmlns") {
            html += "xmlns:";
          }
          html += attr2.name;
          break;
        }
        case NS.XLINK: {
          html += `xlink:${attr2.name}`;
          break;
        }
        default: {
          html += `${attr2.prefix}:${attr2.name}`;
        }
      }
    } else {
      html += attr2.name;
    }
    html += `="${escapeAttribute(attr2.value)}"`;
  }
  return html;
}
function serializeTextNode(node, options) {
  const { treeAdapter } = options;
  const content = treeAdapter.getTextNodeContent(node);
  const parent = treeAdapter.getParentNode(node);
  const parentTn = parent && treeAdapter.isElementNode(parent) && treeAdapter.getTagName(parent);
  return parentTn && treeAdapter.getNamespaceURI(parent) === NS.HTML && hasUnescapedText(parentTn, options.scriptingEnabled) ? content : escapeText(content);
}
function serializeCommentNode(node, { treeAdapter }) {
  return `<!--${treeAdapter.getCommentNodeContent(node)}-->`;
}
function serializeDocumentTypeNode(node, { treeAdapter }) {
  return `<!DOCTYPE ${treeAdapter.getDocumentTypeNodeName(node)}>`;
}
var VOID_ELEMENTS, defaultOpts;
var init_serializer = __esm({
  "node_modules/parse5/dist/serializer/index.js"() {
    init_html();
    init_escape();
    init_default();
    VOID_ELEMENTS = /* @__PURE__ */ new Set([
      TAG_NAMES.AREA,
      TAG_NAMES.BASE,
      TAG_NAMES.BASEFONT,
      TAG_NAMES.BGSOUND,
      TAG_NAMES.BR,
      TAG_NAMES.COL,
      TAG_NAMES.EMBED,
      TAG_NAMES.FRAME,
      TAG_NAMES.HR,
      TAG_NAMES.IMG,
      TAG_NAMES.INPUT,
      TAG_NAMES.KEYGEN,
      TAG_NAMES.LINK,
      TAG_NAMES.META,
      TAG_NAMES.PARAM,
      TAG_NAMES.SOURCE,
      TAG_NAMES.TRACK,
      TAG_NAMES.WBR
    ]);
    defaultOpts = { treeAdapter: defaultTreeAdapter, scriptingEnabled: true };
  }
});

// node_modules/parse5/dist/index.js
function parse(html, options) {
  return Parser.parse(html, options);
}
function parseFragment(fragmentContext, html, options) {
  if (typeof fragmentContext === "string") {
    options = html;
    html = fragmentContext;
    fragmentContext = null;
  }
  const parser = Parser.getFragmentParser(fragmentContext, options);
  parser.tokenizer.write(html, true);
  return parser.getFragment();
}
var init_dist = __esm({
  "node_modules/parse5/dist/index.js"() {
    init_parser();
    init_default();
    init_parser();
    init_serializer();
    init_error_codes();
    init_foreign_content();
    init_html();
    init_token();
    init_tokenizer();
  }
});

// src/core/bind.ts
function setAttr(el, name, value) {
  const a = el.attrs.find((x) => x.name === name);
  if (a) a.value = value;
  else el.attrs.push({ name, value });
}
function* elements(node) {
  for (const c of defaultTreeAdapter.getChildNodes(node)) {
    if (!defaultTreeAdapter.isElementNode(c)) continue;
    yield c;
    yield* elements(c);
  }
}
function parseRef(ref) {
  const m = /^([^#]+)#([^#]+)$/.exec(ref.trim());
  if (!m) return void 0;
  const [, file, name] = m;
  if (/[\\/]/.test(file) || file.includes("..") || !name.trim()) return void 0;
  return { file, name: name.trim() };
}
function loadSource(text) {
  const doc = parse(text);
  const styles = [];
  const components = /* @__PURE__ */ new Map();
  for (const el of elements(doc)) {
    if (defaultTreeAdapter.getTagName(el) === "style") styles.push(el);
    const name = attr(el, COMPONENT);
    if (name === void 0) continue;
    const hit = components.get(name);
    if (hit) hit.count += 1;
    else components.set(name, { el, count: 1 });
  }
  return { styles, components };
}
function copyOf(el) {
  const frag = parseFragment(serializeOuter(el));
  const copy = defaultTreeAdapter.getChildNodes(frag).find((n) => defaultTreeAdapter.isElementNode(n));
  if (!copy) throw new Error("copy of an element produced no element");
  return copy;
}
function errorBox(ref, message) {
  const box = defaultTreeAdapter.createElement("div", html_exports.NS.HTML, [{ name: BOUND_ERROR, value: ref }]);
  defaultTreeAdapter.insertText(box, message);
  return box;
}
function replace(placeholder, by) {
  const parent = defaultTreeAdapter.getParentNode(placeholder);
  if (!parent) return;
  defaultTreeAdapter.insertBefore(parent, by, placeholder);
  defaultTreeAdapter.detachNode(placeholder);
}
function mergeAttributes(placeholder, into, ref) {
  const cls = attr(placeholder, "class");
  if (cls) setAttr(into, "class", [attr(into, "class"), cls].filter(Boolean).join(" "));
  const style = attr(placeholder, "style");
  if (style) {
    const own = attr(into, "style")?.trim();
    setAttr(into, "style", own ? `${own.replace(/;?\s*$/, "")}; ${style}` : style);
  }
  setAttr(into, BOUND, ref);
}
function warnOnComponent(el, ref, warnings) {
  for (const a of el.attrs) {
    if (a.name === "id") warnings.push({ ref, message: `component carries id="${a.value}"` });
    else if (a.name.startsWith("on"))
      warnings.push({ ref, message: `component carries inline handler ${a.name}` });
  }
}
function refuseNested(placed, errors) {
  for (const el of elements(placed)) {
    const ref = attr(el, BIND);
    if (ref === void 0) continue;
    const message = "nested binding not supported";
    errors.push({ ref, message });
    setAttr(el, BOUND_ERROR, ref);
    defaultTreeAdapter.insertText(el, `${message}: ${ref}`);
  }
}
function childElement(parent, tag) {
  for (const c of defaultTreeAdapter.getChildNodes(parent)) if (defaultTreeAdapter.isElementNode(c) && defaultTreeAdapter.getTagName(c) === tag) return c;
  return void 0;
}
function injectStyles(doc, used) {
  const html = childElement(doc, "html");
  const head = html && childElement(html, "head");
  if (!head) return;
  const cursor = defaultTreeAdapter.getFirstChild(head);
  for (const [file, source] of used) {
    for (const style of source.styles) {
      const copy = copyOf(style);
      setAttr(copy, BOUND_STYLE, file);
      if (cursor) defaultTreeAdapter.insertBefore(head, copy, cursor);
      else defaultTreeAdapter.appendChild(head, copy);
    }
  }
}
function resolveBindings(html, readSource) {
  const none = { html, bound: 0, sources: [], errors: [], warnings: [] };
  if (!html.includes(BIND)) return none;
  const doc = parse(html);
  const placeholders = [...elements(doc)].filter((el) => attr(el, BIND) !== void 0);
  if (placeholders.length === 0) return none;
  const errors = [];
  const warnings = [];
  const sources = [];
  const loaded = /* @__PURE__ */ new Map();
  const used = /* @__PURE__ */ new Map();
  let bound = 0;
  for (const ph of placeholders) {
    const ref = attr(ph, BIND) ?? "";
    const parsed = parseRef(ref);
    if (!parsed) {
      errors.push({ ref, message: "invalid binding, expected file#Name" });
      replace(ph, errorBox(ref, `Invalid binding: ${ref}`));
      continue;
    }
    const { file, name } = parsed;
    if (!sources.includes(file)) sources.push(file);
    if (!loaded.has(file)) {
      const text = readSource(file);
      loaded.set(file, text === void 0 ? void 0 : loadSource(text));
    }
    const source = loaded.get(file);
    if (!source) {
      errors.push({ ref, message: `Not found: ${file}` });
      replace(ph, errorBox(ref, `Not found: ${ref}`));
      continue;
    }
    const hit = source.components.get(name);
    if (!hit) {
      errors.push({ ref, message: `Component ${name} not in ${file}` });
      replace(ph, errorBox(ref, `Component ${name} not in ${file}`));
      continue;
    }
    if (hit.count > 1) warnings.push({ ref, message: `${hit.count} candidates, first used` });
    warnOnComponent(hit.el, ref, warnings);
    if (!used.has(file)) used.set(file, source);
    const placed = copyOf(hit.el);
    mergeAttributes(ph, placed, ref);
    refuseNested(placed, errors);
    replace(ph, placed);
    bound += 1;
  }
  injectStyles(doc, used);
  return { html: serialize(doc), bound, sources, errors, warnings };
}
function enclosingComponent(el) {
  for (let p = defaultTreeAdapter.getParentNode(el); p; p = defaultTreeAdapter.getParentNode(p)) {
    if (!defaultTreeAdapter.isElementNode(p)) return void 0;
    const name = attr(p, COMPONENT);
    if (name !== void 0) return name;
  }
  return void 0;
}
function listComponents(html) {
  const doc = parse(html);
  const offers = [];
  const pulls = [];
  const seen = /* @__PURE__ */ new Map();
  for (const el of elements(doc)) {
    const bind = attr(el, BIND);
    if (bind !== void 0) {
      const p = parseRef(bind);
      pulls.push({ ref: bind, file: p?.file ?? "", name: p?.name ?? "" });
      continue;
    }
    const name = attr(el, COMPONENT);
    if (name === void 0) continue;
    const warnings = [];
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    if (n > 1) warnings.push(`declared ${n} times, the first is used`);
    for (const x of [el, ...elements(el)]) {
      const where = x === el ? "root" : `<${defaultTreeAdapter.getTagName(x)}>`;
      for (const a of x.attrs) {
        if (a.name === "id") warnings.push(`${where} carries id="${a.value}"`);
        else if (a.name.startsWith("on")) warnings.push(`${where} carries inline handler ${a.name}`);
      }
    }
    const within = enclosingComponent(el);
    offers.push(within ? { name, tag: defaultTreeAdapter.getTagName(el), within, warnings } : { name, tag: defaultTreeAdapter.getTagName(el), warnings });
  }
  return { offers, pulls };
}
var BIND, COMPONENT, BOUND, BOUND_ERROR, BOUND_STYLE, attr;
var init_bind = __esm({
  "src/core/bind.ts"() {
    "use strict";
    init_dist();
    BIND = "data-bind";
    COMPONENT = "data-component";
    BOUND = "data-bound";
    BOUND_ERROR = "data-bound-error";
    BOUND_STYLE = "data-bound-style";
    attr = (el, name) => el.attrs.find((a) => a.name === name)?.value;
  }
});

// src/core/pointer.ts
function pointerHash(p) {
  const parts = [`doc=${p.id}`];
  if (p.components.length) parts.push(`show=${p.components.join(",")}`);
  if (p.variant) parts.push(`variant=${p.variant}`);
  return parts.join("&");
}
function unknownNames(asked, known, what) {
  const missing = asked.filter((n) => !known.includes(n));
  if (!missing.length) return void 0;
  const has = known.length ? `it has: ${known.join(", ")}` : `it declares none`;
  return `no ${what} named ${missing.join(", ")} in this prototype; ${has}`;
}
var NAME, isName;
var init_pointer = __esm({
  "src/core/pointer.ts"() {
    "use strict";
    NAME = /^[\w.-]+$/;
    isName = (s) => NAME.test(s);
  }
});

// src/core/serverstate.ts
import fs5 from "node:fs";
import path6 from "node:path";
function writeServerFiles(port, version) {
  ensureHome();
  if (version === null) fs5.rmSync(VERSION_FILE, { force: true });
  else fs5.writeFileSync(VERSION_FILE, version);
  fs5.writeFileSync(PID_FILE, String(process.pid));
  fs5.writeFileSync(PORT_FILE, String(port));
}
function clearServerFiles() {
  if (readInt(PID_FILE) === process.pid) {
    try {
      fs5.rmSync(PID_FILE, { force: true });
      fs5.rmSync(PORT_FILE, { force: true });
      fs5.rmSync(VERSION_FILE, { force: true });
    } catch {
    }
  }
}
function readServerStatus() {
  const pid = readInt(PID_FILE);
  const port = readInt(PORT_FILE);
  if (pid === null || port === null)
    return { running: false, pid: null, port: null, version: null, stale: pid !== null || port !== null };
  const version = readText(VERSION_FILE);
  if (!alive(pid)) return { running: false, pid, port, version, stale: true };
  return { running: true, pid, port, version, stale: false };
}
var PID_FILE, PORT_FILE, VERSION_FILE, readInt, alive, readText;
var init_serverstate = __esm({
  "src/core/serverstate.ts"() {
    "use strict";
    init_home();
    PID_FILE = path6.join(DATA_ROOT, "aiview.pid");
    PORT_FILE = path6.join(DATA_ROOT, "aiview.port");
    VERSION_FILE = path6.join(DATA_ROOT, "aiview.version");
    readInt = (f) => {
      try {
        const n = Number(fs5.readFileSync(f, "utf8").trim());
        return Number.isInteger(n) && n > 0 ? n : null;
      } catch {
        return null;
      }
    };
    alive = (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    readText = (f) => {
      try {
        const t = fs5.readFileSync(f, "utf8").trim();
        return t === "" ? null : t;
      } catch {
        return null;
      }
    };
  }
});

// src/core/collectionversion.ts
import fs6 from "node:fs";
import path7 from "node:path";
function collectionVersion(toolRoot) {
  for (let dir = path7.dirname(path7.resolve(toolRoot)); ; dir = path7.dirname(dir)) {
    const manifest = path7.join(dir, ".claude-plugin", "plugin.json");
    if (fs6.existsSync(manifest)) {
      try {
        const parsed = JSON.parse(fs6.readFileSync(manifest, "utf8"));
        return typeof parsed.version === "string" ? parsed.version : null;
      } catch {
        return null;
      }
    }
    if (path7.dirname(dir) === dir) return null;
  }
}
var init_collectionversion = __esm({
  "src/core/collectionversion.ts"() {
    "use strict";
  }
});

// src/core/watcher.ts
import { EventEmitter } from "node:events";
import fs7 from "node:fs";
import path8 from "node:path";
var SIDECAR_MANIFEST, DocWatcher;
var init_watcher = __esm({
  "src/core/watcher.ts"() {
    "use strict";
    init_paths();
    SIDECAR_MANIFEST = "manifest.json";
    DocWatcher = class extends EventEmitter {
      watched = /* @__PURE__ */ new Map();
      timers = /* @__PURE__ */ new Map();
      /** sidecar dir -> its watch; dropped on error, re-armed on the next `<stem>` event. */
      sidecars = /* @__PURE__ */ new Map();
      dataTimers = /* @__PURE__ */ new Map();
      /** page dir -> stem -> the workbench doc, so a `<stem>` event there arms its sidecar. */
      benches = /* @__PURE__ */ new Map();
      /** host id -> absolute paths of the files it was composed from, replaced on each resolve. */
      sources = /* @__PURE__ */ new Map();
      resolve;
      debounceMs;
      constructor(resolve, debounceMs = 150) {
        super();
        this.resolve = resolve;
        this.debounceMs = debounceMs;
      }
      ensureWatch(doc) {
        const dir = path8.dirname(doc.abs_path);
        const sidecar = sidecarOf(doc.abs_path);
        if (sidecar) {
          let inDir = this.benches.get(dir);
          if (!inDir) this.benches.set(dir, inDir = /* @__PURE__ */ new Map());
          inDir.set(path8.basename(sidecar), doc);
          this.ensureSidecarWatch(doc);
        }
        if (this.watched.has(dir)) return;
        try {
          const w = fs7.watch(dir, (_event, name) => {
            if (!name) return;
            const bench = this.benches.get(dir)?.get(String(name));
            if (bench) {
              this.ensureSidecarWatch(bench);
              return;
            }
            const hit = this.resolve(dir, String(name));
            if (hit) this.schedule(hit.id);
            for (const id of this.hostsOf(path8.resolve(dir, String(name)))) this.schedule(id);
          });
          this.watched.set(dir, w);
        } catch (e) {
          console.error(`watch failed for ${dir}: ${e.message}`);
        }
      }
      /** Watch `<stem>/` of a `.workbench.html` when it exists; emits "data-changed" on manifest.json only. */
      ensureSidecarWatch(doc) {
        const dir = sidecarOf(doc.abs_path);
        if (!dir || this.sidecars.has(dir)) return;
        try {
          if (!fs7.statSync(dir).isDirectory()) return;
        } catch {
          return;
        }
        try {
          const w = fs7.watch(dir, (_event, name) => {
            if (name && String(name) === SIDECAR_MANIFEST) this.scheduleData(doc.id);
          });
          w.on("error", () => {
            w.close();
            this.sidecars.delete(dir);
          });
          this.sidecars.set(dir, w);
        } catch (e) {
          console.error(`watch failed for ${dir}: ${e.message}`);
        }
      }
      /** Replace (never merge) the set of files `hostId` depends on. An empty list clears it. */
      setSources(hostId, absPaths) {
        if (absPaths.length === 0) this.sources.delete(hostId);
        else this.sources.set(hostId, new Set(absPaths.map((p) => path8.resolve(p))));
      }
      /** The hosts composed from `absPath`. */
      hostsOf(absPath) {
        const key = path8.resolve(absPath);
        const ids = [];
        for (const [id, set] of this.sources) if (set.has(key)) ids.push(id);
        return ids;
      }
      schedule(id) {
        clearTimeout(this.timers.get(id));
        this.timers.set(
          id,
          setTimeout(() => this.emit("changed", { id }), this.debounceMs)
        );
      }
      scheduleData(id) {
        clearTimeout(this.dataTimers.get(id));
        this.dataTimers.set(
          id,
          setTimeout(() => this.emit("data-changed", { id }), this.debounceMs)
        );
      }
      close() {
        for (const t of this.timers.values()) clearTimeout(t);
        this.timers.clear();
        for (const t of this.dataTimers.values()) clearTimeout(t);
        this.dataTimers.clear();
        for (const w of this.sidecars.values()) w.close();
        this.sidecars.clear();
        this.benches.clear();
        for (const w of this.watched.values()) w.close();
        this.watched.clear();
        this.sources.clear();
      }
    };
  }
});

// ../swarm-board/src/board/mentions.ts
var init_mentions = __esm({
  "../swarm-board/src/board/mentions.ts"() {
    "use strict";
  }
});

// ../swarm-board/src/wire.ts
import crypto from "node:crypto";
import fs8 from "node:fs";
import path9 from "node:path";
function encode(f) {
  return JSON.stringify(f);
}
function decode(text) {
  const f = JSON.parse(text);
  const type = f && typeof f === "object" ? f.type : void 0;
  if (typeof type !== "string" || !FRAME_TYPES.has(type)) throw new Error(`unknown frame type: ${String(type)}`);
  return f;
}
function builtCliOf(entry2) {
  const file = path9.resolve(entry2);
  const bundle = path9.join(path9.dirname(file), "dist-cli", "cli.mjs");
  return fs8.existsSync(bundle) ? bundle : file;
}
function bundleVersion(entry2) {
  if (entry2 === void 0) return ownVersion ??= bundleVersion(process.argv[1] ?? "");
  const file = builtCliOf(entry2);
  const st = fs8.statSync(file);
  const key = `${file}|${st.mtimeMs}|${st.size}`;
  let v = versionsByBuild.get(key);
  if (v === void 0) {
    v = crypto.createHash("sha256").update(fs8.readFileSync(file)).digest("hex").slice(0, 16);
    versionsByBuild.set(key, v);
  }
  return v;
}
function serverStateFile(dataRoot) {
  return path9.join(dataRoot, "swarm-server.json");
}
function serverLogFile(dataRoot) {
  return path9.join(dataRoot, "swarm-server.log");
}
function serverStartLock(dataRoot) {
  return path9.join(dataRoot, "swarm-server.lock");
}
function serverLockHolder(dataRoot) {
  try {
    const pid = Number(fs8.readFileSync(serverStartLock(dataRoot), "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}
function liveStartLockHolder(dataRoot) {
  const holder = serverLockHolder(dataRoot);
  if (holder === null || !isAlive(holder)) return null;
  try {
    if (JSON.parse(fs8.readFileSync(serverStateFile(dataRoot), "utf8")).pid === holder) return holder;
  } catch {
  }
  try {
    return Date.now() - fs8.statSync(serverStartLock(dataRoot)).mtimeMs < START_LOCK_GRACE_MS ? holder : null;
  } catch {
    return null;
  }
}
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}
var RPC_METHODS, FRAME_TYPES, versionsByBuild, ownVersion, SERVER_STARTER_ENV, START_LOCK_GRACE_MS;
var init_wire = __esm({
  "../swarm-board/src/wire.ts"() {
    "use strict";
    RPC_METHODS = [
      "openRun",
      "addSeat",
      "closeRun",
      "phase",
      "currentPhase",
      "showPhase",
      "lock",
      "unlock",
      "locks",
      "pause",
      "resume",
      "pausedOf",
      "park",
      "unpark",
      "block",
      "unblock",
      "done",
      "phaseProgress",
      "lastActivity",
      "owedPhase",
      "idle",
      "unreadMentions",
      "guidesUntold",
      "setting",
      "runs",
      "packCall",
      "join",
      "participant",
      "identify",
      "setDoing",
      "subscribe",
      "unsubscribe",
      "end",
      "roster",
      "endedMembers",
      "heldBy",
      "post",
      "endorse",
      "read",
      "thread",
      "runThread",
      "deliver",
      "deliverMentions",
      "wait",
      "stats",
      "repos",
      "snapshot",
      "composition"
    ];
    FRAME_TYPES = /* @__PURE__ */ new Set(["hello", "call", "cancel", "activity", "bye", "subscribe", "welcome", "result", "refused", "changed"]);
    versionsByBuild = /* @__PURE__ */ new Map();
    SERVER_STARTER_ENV = "SWARM_SERVER_STARTER";
    START_LOCK_GRACE_MS = 15e3;
  }
});

// ../swarm-board/src/board/home.ts
import fs9 from "node:fs";
import os2 from "node:os";
import path10 from "node:path";
var homeFromEnv2, NEW_HOME2, OLD_HOME2, DATA_ROOT2, HOME_OVERRIDE, SQLITE_PATH2;
var init_home2 = __esm({
  "../swarm-board/src/board/home.ts"() {
    "use strict";
    homeFromEnv2 = process.env.SWARMSTORM_HOME ?? process.env.CHARRETTE_HOME;
    NEW_HOME2 = path10.join(os2.homedir(), "swarmstorm_appdata");
    OLD_HOME2 = path10.join(os2.homedir(), "charrette_appdata");
    DATA_ROOT2 = homeFromEnv2 ? path10.resolve(homeFromEnv2) : !fs9.existsSync(NEW_HOME2) && fs9.existsSync(OLD_HOME2) ? OLD_HOME2 : NEW_HOME2;
    HOME_OVERRIDE = homeFromEnv2 && path10.resolve(homeFromEnv2) !== NEW_HOME2 && process.env.SWARMSTORM_PRINT_HOME !== "0" ? DATA_ROOT2 : null;
    SQLITE_PATH2 = path10.join(DATA_ROOT2, "swarm.sqlite");
  }
});

// ../swarm-board/src/board/liveness.ts
var IDLE_MS, NO_TRANSCRIPT_MS, READINGS_KEPT_MS, BUSY_MAX_MS, STALLED_AGAIN_MS, LINK_LOST_MS, IN_TURN_MS, OWE_WAIT_MS, CARRY_MAX_MS, LOCK_HELD_MS;
var init_liveness = __esm({
  "../swarm-board/src/board/liveness.ts"() {
    "use strict";
    IDLE_MS = 15 * 60 * 1e3;
    NO_TRANSCRIPT_MS = 30 * 1e3;
    READINGS_KEPT_MS = 10 * 60 * 1e3;
    BUSY_MAX_MS = 15 * 60 * 1e3;
    STALLED_AGAIN_MS = 15 * 60 * 1e3;
    LINK_LOST_MS = 30 * 1e3;
    IN_TURN_MS = 120 * 1e3;
    OWE_WAIT_MS = 10 * 60 * 1e3;
    CARRY_MAX_MS = 5 * 60 * 1e3;
    LOCK_HELD_MS = 10 * 60 * 1e3;
  }
});

// ../swarm-board/src/link/transcripts.ts
var init_transcripts = __esm({
  "../swarm-board/src/link/transcripts.ts"() {
    "use strict";
    init_liveness();
  }
});

// ../swarm-board/src/link/link.ts
import crypto2 from "node:crypto";
import os3 from "node:os";
import path11 from "node:path";
function linkPipe(dataRoot, run, member) {
  const home = crypto2.createHash("sha256").update(path11.resolve(dataRoot)).digest("hex").slice(0, 12);
  const name = `swarm-${home}-${run}-${member.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  return process.platform === "win32" ? `\\\\.\\pipe\\${name}` : path11.join(os3.tmpdir(), `${name}.sock`);
}
var DEFAULT_TIMING;
var init_link = __esm({
  "../swarm-board/src/link/link.ts"() {
    "use strict";
    init_proc2();
    init_home2();
    init_wire();
    init_transcripts();
    DEFAULT_TIMING = { reconnectGiveUpMs: 6e4, reconnectEveryMs: 500, idleMs: 2 * 60 * 6e4, stateFileWaitMs: 5e3, watchEveryMs: 1e3, activityGapMs: 3e3 };
  }
});

// ../swarm-board/src/client/remote.ts
var remote_exports = {};
__export(remote_exports, {
  HARNESS_LINK_WAIT_MS: () => HARNESS_LINK_WAIT_MS,
  LINK_DOWN_WAIT_MS: () => LINK_DOWN_WAIT_MS,
  bindingOf: () => bindingOf,
  connectBoard: () => connectBoard,
  connectServer: () => connectServer,
  ensureServer: () => ensureServer,
  inHarnessSession: () => inHarnessSession,
  linkDownMarker: () => linkDownMarker,
  linkVerbArgs: () => linkVerbArgs,
  openLinkPipe: () => openLinkPipe
});
import crypto3 from "node:crypto";
import fs10 from "node:fs";
import net from "node:net";
import os4 from "node:os";
import path12 from "node:path";
function isAlive2(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}
function readServerState(dataRoot) {
  try {
    const s = JSON.parse(fs10.readFileSync(serverStateFile(dataRoot), "utf8"));
    return Number.isInteger(s.pid) && Number.isInteger(s.port) ? s : null;
  } catch {
    return null;
  }
}
async function ensureServer(dataRoot, swarmEntry = entry()[0]) {
  const found = readServerState(dataRoot);
  if (found && isCurrent(found, swarmEntry)) return found;
  if (found && found.pid !== process.pid && isAlive2(found.pid)) {
    try {
      process.kill(found.pid);
    } catch {
    }
    for (const until = Date.now() + START_TIMEOUT_MS; isAlive2(found.pid) && Date.now() < until; ) await pause(START_POLL_MS);
  }
  const startedElsewhere = () => liveStartLockHolder(dataRoot) !== null;
  let exited = null;
  if (!startedElsewhere()) {
    let log = "ignore";
    try {
      fs10.mkdirSync(dataRoot, { recursive: true });
      fs10.writeFileSync(serverLogFile(dataRoot), "");
      log = fs10.openSync(serverLogFile(dataRoot), "a");
    } catch {
    }
    const child = hiddenSpawn2(process.execPath, [swarmEntry, "serve"], { detached: true, cwd: DETACHED_CWD, stdio: ["ignore", log, log], windowsHide: true, env: { ...homeEnv(dataRoot), [SERVER_STARTER_ENV]: process.argv.join(" ") } });
    child.on("exit", (code, signal) => exited = signal ? `it was killed by ${signal}` : `it exited with code ${code}`);
    child.on("error", (e) => exited = e.message);
    child.unref();
    if (typeof log === "number") fs10.closeSync(log);
  }
  for (const until = Date.now() + START_TIMEOUT_MS; Date.now() < until; ) {
    const s = readServerState(dataRoot);
    if (s && isCurrent(s, swarmEntry)) return s;
    if (exited && !startedElsewhere()) break;
    await pause(START_POLL_MS);
  }
  let said = "";
  try {
    const lines = fs10.readFileSync(serverLogFile(dataRoot), "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    said = lines.find((l) => /^(\w*Error|swarm\b)[^:]*:/.test(l)) ?? lines.filter((l) => !/^Node\.js v/.test(l)).pop() ?? "";
  } catch {
  }
  const reason = said || exited || `it did not answer within ${START_TIMEOUT_MS / 1e3} s`;
  throw new Error(`swarm: the board server did not start: ${reason}; run swarm serve to see it`);
}
function bindingOf(member) {
  const [group, id] = splitMember(member.name);
  return id === "orchestrator" ? { verb: "open", group } : { verb: "join", run: member.run, seat: id };
}
function splitMember(name) {
  const at = name.lastIndexOf("/");
  return [name.slice(0, at), name.slice(at + 1)];
}
function connectPipe(pipe) {
  return new Promise((resolve) => {
    const s = net.createConnection(pipe);
    s.once("connect", () => {
      s.removeAllListeners("error");
      resolve(s);
    });
    s.once("error", () => resolve(null));
  });
}
async function openLinkPipe(dataRoot, member, harnessWaitMs, downWaitMs = LINK_DOWN_WAIT_MS) {
  const pipe = linkPipe(dataRoot, member.run, member.name);
  const marker = linkDownMarker(dataRoot, member);
  const answered = (s) => {
    try {
      fs10.rmSync(marker, { force: true });
    } catch {
    }
    return s;
  };
  const there = await connectPipe(pipe);
  if (there) return answered(there);
  if (harnessWaitMs != null) {
    const wait = fs10.existsSync(marker) ? Math.min(harnessWaitMs, downWaitMs) : harnessWaitMs;
    for (const until = Date.now() + wait; Date.now() < until; ) {
      await pause(START_POLL_MS);
      const s = await connectPipe(pipe);
      if (s) return answered(s);
    }
    try {
      fs10.mkdirSync(path12.dirname(marker), { recursive: true });
      fs10.writeFileSync(marker, String(Date.now()));
    } catch {
    }
    return null;
  }
  const child = hiddenSpawn2(process.execPath, [...entry(), ...linkVerbArgs(member)], {
    detached: true,
    cwd: DETACHED_CWD,
    stdio: "ignore",
    windowsHide: true,
    env: homeEnv(dataRoot)
  });
  child.on("error", () => {
  });
  child.unref();
  for (const until = Date.now() + START_TIMEOUT_MS; Date.now() < until; ) {
    const s = await connectPipe(pipe);
    if (s) return s;
    await pause(START_POLL_MS);
  }
  throw new Error(`swarm: ${member.name}'s link did not start`);
}
function lineFrames(sock, onFrame) {
  let buf = "";
  sock.setEncoding("utf8");
  sock.on("data", (chunk) => {
    buf += chunk;
    for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onFrame(decode(line));
    }
  });
}
function callsOver(firstSend) {
  let send = firstSend;
  const pending = /* @__PURE__ */ new Map();
  let next = 0;
  const callPrefix = crypto3.randomUUID();
  let closed = null;
  return {
    call(method, args2) {
      if (closed) return Promise.reject(new Error(closed));
      const id = `${callPrefix}-${++next}`;
      const given = [...args2];
      while (given.length && given[given.length - 1] === void 0) given.pop();
      const frame = { type: "call", id, method, args: given };
      return new Promise((resolve, reject) => {
        pending.set(id, { call: frame, resolve, reject });
        send(frame);
      });
    },
    settle(f) {
      if (f.type === "result") {
        const p = pending.get(f.id);
        if (!p) return;
        pending.delete(f.id);
        if (f.ok) p.resolve(f.value);
        else p.reject(new Error(f.error));
      } else if (f.type === "refused") this.fail(`swarm: the board refused the connection: ${f.reason}`);
    },
    fail(why) {
      closed ??= why;
      for (const p of pending.values()) p.reject(new Error(closed));
      pending.clear();
    },
    reroute(to) {
      send = to;
      for (const p of pending.values()) send(p.call);
    }
  };
}
async function connectServer(state) {
  const ws = new WebSocket(`ws://127.0.0.1:${state.port}`);
  let handler = () => {
  };
  let closer = () => {
  };
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", () => ws.send(encode({ type: "hello", version: state.version, secret: state.secret })), { once: true });
    ws.addEventListener("message", (ev) => {
      const f = decode(String(ev.data));
      if (f.type === "welcome") resolve();
      else if (f.type === "refused") reject(new Error(`swarm: the board server refused the connection: ${f.reason}`));
      else handler(f);
    });
    ws.addEventListener("error", () => reject(new Error(`swarm: the board server at port ${state.port} does not answer; run swarm serve to see it`)), { once: true });
    ws.addEventListener("close", () => closer());
  });
  return {
    send: (f) => ws.send(encode(f)),
    onFrame: (h) => handler = h,
    onClose: (h) => closer = h,
    close: () => ws.close()
  };
}
function asRemote(call) {
  const board = {};
  for (const m of RPC_METHODS) board[m] = (...a) => call(m, a);
  return board;
}
async function connectBoard(opts) {
  const state = await ensureServer(opts.dataRoot);
  if (opts.member) {
    const member = opts.member;
    const harness = opts.harness ?? inHarnessSession();
    const sock = await openLinkPipe(opts.dataRoot, member, harness ? opts.harnessWaitMs ?? HARNESS_LINK_WAIT_MS : null);
    if (sock) {
      const calls2 = callsOver((f) => sock.write(`${encode(f)}
`));
      lineFrames(sock, (f) => calls2.settle(f));
      let direct = null;
      let closing = false;
      sock.on("close", () => {
        if (closing) return;
        connectServer(state).then(
          (conn2) => {
            direct = conn2;
            conn2.onFrame((f) => calls2.settle(f));
            conn2.onClose(() => calls2.fail("swarm: the board server closed the connection"));
            calls2.reroute(conn2.send);
          },
          () => calls2.fail(`swarm: ${member.name}'s link closed the pipe`)
        );
      });
      sock.on("error", () => {
      });
      return Object.assign(asRemote(calls2.call), {
        close: () => {
          closing = true;
          sock.destroy();
          direct?.close();
        },
        linkMissing: false
      });
    }
  }
  const conn = await connectServer(state);
  const calls = callsOver(conn.send);
  conn.onFrame((f) => calls.settle(f));
  conn.onClose(() => calls.fail("swarm: the board server closed the connection"));
  return Object.assign(asRemote(calls.call), { close: conn.close, linkMissing: !!opts.member });
}
var START_TIMEOUT_MS, START_POLL_MS, entry, homeEnv, pause, DETACHED_CWD, isCurrent, linkVerbArgs, HARNESS_LINK_WAIT_MS, LINK_DOWN_WAIT_MS, linkDownMarker, inHarnessSession;
var init_remote = __esm({
  "../swarm-board/src/client/remote.ts"() {
    "use strict";
    init_proc2();
    init_wire();
    init_link();
    START_TIMEOUT_MS = 5e3;
    START_POLL_MS = 50;
    entry = () => [process.argv[1]];
    homeEnv = (dataRoot) => ({ ...process.env, SWARMSTORM_HOME: dataRoot });
    pause = (ms) => new Promise((r) => setTimeout(r, ms));
    DETACHED_CWD = os4.tmpdir();
    isCurrent = (s, swarmEntry) => !!s && s.version === bundleVersion(swarmEntry) && isAlive2(s.pid);
    linkVerbArgs = (member) => ["link", "--run", String(member.run), "--as", member.name];
    HARNESS_LINK_WAIT_MS = 1e4;
    LINK_DOWN_WAIT_MS = 1e3;
    linkDownMarker = (dataRoot, member) => path12.join(dataRoot, "link-down", `${member.run}-${member.name.replace(/[^A-Za-z0-9_-]/g, "_")}`);
    inHarnessSession = (env = process.env) => !!env.CLAUDE_CODE_SESSION_ID;
  }
});

// ../swarm-board/src/client/reader.ts
async function openBoardReader(opts) {
  const { ensureServer: ensureServer2, connectServer: connectServer2 } = await Promise.resolve().then(() => (init_remote(), remote_exports));
  const listeners = /* @__PURE__ */ new Set();
  const pending = /* @__PURE__ */ new Map();
  let next = 0;
  let closed = false;
  const tell = (repo) => {
    for (const l of [...listeners]) l(repo);
  };
  const onFrame = (f) => {
    if (f.type === "changed") return tell(f.repo);
    if (f.type !== "result") return;
    const p = pending.get(f.id);
    if (!p) return;
    pending.delete(f.id);
    if (f.ok) p.resolve(f.value);
    else p.reject(new Error(f.error));
  };
  const connect = async () => {
    const conn = await connectServer2(await ensureServer2(opts.dataRoot, opts.swarmEntry));
    conn.onFrame(onFrame);
    conn.send({ type: "subscribe" });
    conn.onClose(() => {
      for (const p of pending.values()) p.reject(new Error("swarm: the board server closed the connection"));
      pending.clear();
      if (closed) return;
      connection = reconnect();
    });
    return conn;
  };
  const reconnect = async () => {
    for (; ; ) {
      await new Promise((r) => setTimeout(r, RECONNECT_MS));
      if (closed) throw new Error("the reader is closed");
      try {
        const conn = await connect();
        const repos = (await callOn(conn, "repos", [])).map((r) => r.repo);
        for (const repo of repos) tell(repo);
        return conn;
      } catch {
      }
    }
  };
  let connection = connect();
  await connection;
  function callOn(conn, method, args2) {
    if (!READING.includes(method)) return Promise.reject(new Error(`the reader does not call ${method}`));
    return new Promise((resolve, reject) => {
      const id = `reader-${process.pid}-${++next}`;
      pending.set(id, { resolve, reject });
      try {
        conn.send({ type: "call", id, method, args: args2 });
      } catch (e) {
        pending.delete(id);
        reject(e);
      }
    });
  }
  const call = (method, args2) => connection.then((conn) => callOn(conn, method, args2));
  return {
    repos: () => call("repos", []),
    snapshot: (repo) => call("snapshot", [repo]),
    stats: (scope) => call("stats", [scope]),
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      closed = true;
      listeners.clear();
      void connection.then((c) => c.close(), () => {
      });
    }
  };
}
var RECONNECT_MS, READING;
var init_reader = __esm({
  "../swarm-board/src/client/reader.ts"() {
    "use strict";
    init_mentions();
    RECONNECT_MS = 200;
    READING = ["repos", "snapshot", "stats"];
  }
});

// src/server/board.ts
import fs11 from "node:fs";
import path13 from "node:path";
function mountBoard(sse, opts = {}) {
  const dataRoot = opts.dataRoot ?? DATA_ROOT;
  const swarmEntry = opts.swarmEntry ?? DEFAULT_SWARM_ENTRY;
  let reader = null;
  let opening = null;
  let stopListening = null;
  let closed = false;
  const openReader = () => {
    if (reader) return Promise.resolve(reader);
    opening ??= openBoardReader({ dataRoot, swarmEntry }).then(
      (opened) => {
        if (closed) {
          opened.close();
          throw new Error("the server is closing");
        }
        reader = opened;
        stopListening = opened.onChange(
          (repo) => sse.broadcast({ type: "board-changed", repo })
        );
        return opened;
      },
      (err) => {
        opening = null;
        throw err;
      }
    );
    return opening;
  };
  if (fs11.existsSync(path13.join(dataRoot, SERVER_STATE_FILE))) openReader().catch(() => {
  });
  const json = (res, obj, status = 200) => {
    if (res.headersSent) return;
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(obj));
  };
  const sameRepo = (a, b) => {
    const norm2 = (r) => {
      const g = fs11.existsSync(r) && fs11.statSync(r).isFile() ? commonGitDir(r) : r;
      return process.platform === "win32" ? path13.resolve(g).toLowerCase() : path13.resolve(g);
    };
    return norm2(a) === norm2(b);
  };
  const repoNamed = async (board, url) => {
    const run = url.searchParams.get(url.pathname === "/api/run" ? "id" : "run");
    const key = url.searchParams.get("repo");
    const repos = await board.repos();
    if (run !== null) {
      const repo = repos.find((r) => r.runs.some((x) => x.run === Number(run)))?.repo;
      return repo ? { repo } : { missing: `no run ${run}` };
    }
    if (key !== null) {
      const repo = repos.find((r) => sameRepo(r.repo, key))?.repo;
      return repo ? { repo } : { missing: `no repository ${key}` };
    }
    return { missing: "no repository named: ask ?repo=<repository> or ?run=<id>" };
  };
  const answerBoard = async (board, url, res) => {
    const named = await repoNamed(board, url);
    if ("missing" in named) return json(res, { error: named.missing }, 404);
    const [repos, snapshot] = await Promise.all([board.repos(), board.snapshot(named.repo)]);
    json(res, { repos: repos.filter((r) => r.repo === named.repo), snapshot });
  };
  const answerStats = async (board, url, res) => {
    const q = url.searchParams;
    const key = q.get("repo");
    const known = key !== null ? (await board.repos()).find((r) => sameRepo(r.repo, key))?.repo : void 0;
    const named = key !== null ? known ? { repo: known } : { missing: `no repository ${key}` } : await repoNamed(board, url);
    if ("missing" in named) return json(res, { error: named.missing }, 404);
    const run = q.get("run");
    const since = q.get("since");
    const kinds = (q.get("kind") ?? "").split(",").filter(Boolean);
    const scope = {
      repo: named.repo,
      ...run !== null ? { run: Number(run) } : {},
      ...since !== null && since !== "all" ? { since } : {},
      ...kinds.length ? { kinds } : {},
      ...q.get("closedOnly") === "1" ? { closedOnly: true } : {}
    };
    let stats;
    try {
      stats = await board.stats(scope);
    } catch (err) {
      if (scope.run !== void 0 && err.message === `no run ${scope.run}`) return json(res, { error: err.message }, 404);
      throw err;
    }
    json(res, stats);
  };
  const ROUTES = /* @__PURE__ */ new Map([
    ["/api/board", answerBoard],
    ["/api/run", answerBoard],
    ["/api/stats", answerStats]
  ]);
  return {
    handle(req, res, url) {
      const answer = ROUTES.get(url.pathname);
      if (!answer) return false;
      if (req.method !== "GET" && req.method !== "HEAD") return false;
      openReader().then((board) => answer(board, url, res)).catch((err) => json(res, { error: err.message }, 500));
      return true;
    },
    close() {
      closed = true;
      stopListening?.();
      reader?.close();
      reader = null;
    }
  };
}
var DEFAULT_SWARM_ENTRY, SERVER_STATE_FILE;
var init_board = __esm({
  async "src/server/board.ts"() {
    "use strict";
    init_reader();
    await init_db();
    init_home();
    init_place();
    DEFAULT_SWARM_ENTRY = path13.join(TOOL_ROOT, "..", "swarm-board", "swarm.mjs");
    SERVER_STATE_FILE = "swarm-server.json";
  }
});

// src/server/sse.ts
function createSseHub(heartbeatMs = HEARTBEAT_MS, hello = () => ({})) {
  const clients = /* @__PURE__ */ new Map();
  const drop = (res) => {
    if (clients.delete(res)) res.destroy();
  };
  const send = (res, event) => {
    if (res.writableEnded || res.destroyed) return drop(res);
    try {
      res.write(`data: ${JSON.stringify(event)}

`, (err) => {
        if (err) drop(res);
      });
    } catch {
      drop(res);
    }
  };
  const beat = setInterval(() => {
    for (const res of [...clients.keys()]) send(res, { type: "ping" });
  }, heartbeatMs);
  beat.unref?.();
  return {
    add(res, project = null) {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive"
      });
      clients.set(res, project);
      res.on("close", () => clients.delete(res));
      res.on("error", () => drop(res));
      send(res, { type: "hello", ...hello() });
    },
    // The set is copied: a write that fails drops its client from it.
    broadcast(event) {
      for (const res of [...clients.keys()]) send(res, event);
    },
    broadcastTo(project, event) {
      const onProject = [...clients].filter(([, p]) => p === project).map(([res]) => res);
      for (const res of onProject) send(res, event);
      return onProject.length;
    },
    size: () => clients.size,
    close() {
      clearInterval(beat);
      for (const res of [...clients.keys()]) drop(res);
    }
  };
}
var HEARTBEAT_MS;
var init_sse = __esm({
  "src/server/sse.ts"() {
    "use strict";
    HEARTBEAT_MS = 15e3;
  }
});

// src/server/index.ts
var server_exports = {};
__export(server_exports, {
  servedBuild: () => servedBuild,
  startServer: () => startServer
});
import { spawn as spawn3 } from "node:child_process";
import fs12 from "node:fs";
import http from "node:http";
import path14 from "node:path";
function servedBuild(distDir) {
  try {
    return /assets\/(index-[\w-]+\.js)/.exec(fs12.readFileSync(path14.join(distDir, "index.html"), "utf8"))?.[1] ?? null;
  } catch {
    return null;
  }
}
function openBrowser(url) {
  const [c, args2] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    spawn3(c, args2, { detached: true, stdio: "ignore" }).unref();
  } catch (e) {
    console.error(`could not open browser: ${e.message}`);
  }
}
function startServer(index, { port, open, startDoc, toolRoot = TOOL_ROOT, writeState = true, heartbeatMs, boardDataRoot, swarmEntry, openTab = openBrowser }) {
  const sse = createSseHub(heartbeatMs, () => {
    const build = servedBuild(path14.join(toolRoot, "dist"));
    return build ? { build } : {};
  });
  const board = mountBoard(sse, { dataRoot: boardDataRoot, swarmEntry });
  const version = collectionVersion(toolRoot);
  const watcher = new DocWatcher(
    (dir, name) => index.all().find((d) => path14.dirname(d.abs_path) === dir && path14.basename(d.abs_path) === name)
  );
  watcher.on("changed", ({ id }) => {
    index.touch(id);
    sse.broadcast({ type: "changed", id });
  });
  watcher.on("data-changed", ({ id }) => {
    sse.broadcast({ type: "data-changed", id });
  });
  for (const d of index.all()) if (d.exists) watcher.ensureWatch(d);
  const send = (res, status, body, type = "application/json; charset=utf-8", cacheControl = "no-store") => {
    res.writeHead(status, { "content-type": type, "cache-control": cacheControl });
    res.end(body);
  };
  const json = (res, obj, status = 200) => send(res, status, JSON.stringify(obj));
  const projectOfBoardKey = (key) => {
    const projects = index.allProjects();
    if (projects.some((x) => x.slug === key)) return key;
    const checkoutOf = (repo) => repo.replace(/[\\/]+$/, "").replace(/[\\/]\.git$/i, "");
    const named = (repo) => path14.basename(checkoutOf(repo)).toLowerCase() === key.toLowerCase();
    for (const x of projects) {
      const repo = index.boardRepos(x.slug).find(named);
      if (repo) return projectForCwd(checkoutOf(repo), projects)?.slug ?? x.slug;
    }
    return null;
  };
  const toProjectTabs = (project, event, hash) => {
    const tabs = sse.broadcastTo(project, event);
    if (tabs > 0) return { tabs, opened: false };
    openTab(`http://localhost:${server.address().port}/#${hash}`);
    return { tabs: 0, opened: true };
  };
  const distDir = path14.join(toolRoot, "dist");
  const useDist = fs12.existsSync(path14.join(distDir, "index.html"));
  const serveStatic = (res, p) => {
    if (!useDist)
      return send(res, 404, `aiview UI not built. Run: npm install && npm run build  (in ${toolRoot})`, "text/plain");
    const f = path14.resolve(distDir, "." + p.replaceAll("..", ""));
    const indexHtml = path14.join(distDir, "index.html");
    if (f !== indexHtml && f.startsWith(distDir) && fs12.existsSync(f) && fs12.statSync(f).isFile()) {
      const hashed = f.startsWith(path14.join(distDir, "assets") + path14.sep);
      const mime = MIME[path14.extname(f).toLowerCase()] ?? "application/octet-stream";
      return send(res, 200, fs12.readFileSync(f), mime, hashed ? "public, max-age=31536000, immutable" : "no-cache");
    }
    return send(res, 200, fs12.readFileSync(indexHtml), "text/html; charset=utf-8", "no-cache");
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (board.handle(req, res, url)) return;
    const p = url.pathname;
    if (p === "/events") return sse.add(res, url.searchParams.get("project") || null);
    if (p === "/api/documents")
      return json(res, {
        documents: index.all(),
        groups: Object.fromEntries(index.allGroups().map((g) => [g.slug, g.title ?? g.slug])),
        projects: Object.fromEntries(index.allProjects().map((x) => [x.slug, x.title ?? x.slug])),
        recentProject: index.recentProject(),
        start: startDoc?.id ?? null,
        version
      });
    if (p === "/api/index-changed" && req.method === "POST") {
      req.resume();
      req.on("end", () => {
        sse.broadcast({ type: "index" });
        json(res, { ok: true });
      });
      return;
    }
    if (p === "/api/project-board") {
      const key = url.searchParams.get("repo");
      const slug = key ? projectOfBoardKey(key) : url.searchParams.get("project") || null;
      if (slug === null) return json(res, { error: key ? `no project for ${key}` : "name a project: ?project=<slug> or ?repo=<key>" }, key ? 404 : 400);
      return json(res, { project: slug, repos: index.boardRepos(slug) });
    }
    if (p === "/api/pin" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => {
        body += c;
        if (body.length > 4096) req.destroy();
      });
      req.on("end", () => {
        let id, pinned;
        try {
          ({ id, pinned } = JSON.parse(body));
        } catch {
          return json(res, { error: "bad json" }, 400);
        }
        if (typeof id !== "number" || typeof pinned !== "boolean") return json(res, { error: "id and pinned required" }, 400);
        if (!index.setPinned(id, pinned)) return json(res, { error: `no such document: ${id}` }, 404);
        sse.broadcast({ type: "index" });
        json(res, { id, pinned });
      });
      return;
    }
    if (p === "/api/recent-project" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => {
        body += c;
        if (body.length > 4096) req.destroy();
      });
      req.on("end", () => {
        let slug;
        try {
          slug = JSON.parse(body).project;
        } catch {
          return json(res, { error: "bad json" }, 400);
        }
        if (typeof slug !== "string" || !slug) return json(res, { error: "project required" }, 400);
        if (!index.allProjects().some((x) => x.slug === slug)) return json(res, { error: `no such project: ${slug}` }, 404);
        index.recordRecentProject(slug);
        json(res, { project: slug });
      });
      return;
    }
    if (p === "/api/pending-changed" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => {
        body += c;
        if (body.length > 4096) req.destroy();
      });
      req.on("end", () => {
        let id;
        try {
          id = JSON.parse(body).id;
        } catch {
          return json(res, { error: "bad json" }, 400);
        }
        if (typeof id !== "number") return json(res, { error: "id required" }, 400);
        sse.broadcast({ type: "changed", id });
        json(res, { ok: true });
      });
      return;
    }
    if (p === "/api/show" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => {
        body += c;
        if (body.length > 4096) req.destroy();
      });
      req.on("end", () => {
        let asked;
        try {
          asked = JSON.parse(body);
        } catch {
          return json(res, { error: "bad json" }, 400);
        }
        const { id, components, variant, project } = asked;
        if (typeof id !== "number" || !index.get(id)) return json(res, { error: "no such document" }, 404);
        if (!Array.isArray(components) || !components.every((c) => typeof c === "string" && isName(c)))
          return json(res, { error: "components must be names" }, 400);
        if (variant !== void 0 && (typeof variant !== "string" || !isName(variant)))
          return json(res, { error: "variant must be a name" }, 400);
        const event = { type: "show", id, components, ...variant ? { variant } : {} };
        if (typeof project === "string" && project) {
          const hash = [`doc=${id}`, ...components.length ? [`show=${components.join(",")}`] : [], ...variant ? [`variant=${variant}`] : []].join("&");
          return json(res, toProjectTabs(project, event, hash));
        }
        sse.broadcast(event);
        json(res, { tabs: sse.size() });
      });
      return;
    }
    if (p === "/api/open" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => {
        body += c;
        if (body.length > 4096) req.destroy();
      });
      req.on("end", () => {
        let asked;
        try {
          asked = JSON.parse(body);
        } catch {
          return json(res, { error: "bad json" }, 400);
        }
        const { id, project } = asked;
        if (typeof id !== "number" || !index.get(id)) return json(res, { error: "no such document" }, 404);
        if (typeof project !== "string" || !project) return json(res, { error: "project required" }, 400);
        json(res, toProjectTabs(project, { type: "open", id }, `doc=${id}`));
      });
      return;
    }
    if (p === "/api/show-done" && req.method === "POST") {
      req.resume();
      req.on("end", () => {
        sse.broadcast({ type: "show-done" });
        json(res, { tabs: sse.size() });
      });
      return;
    }
    const a = p.match(/^\/api\/asset\/(\d+)\/(.+)$/);
    if (a) {
      const doc = index.get(Number(a[1]));
      if (!doc) return send(res, 404, "not found", "text/plain");
      const dir = path14.dirname(doc.abs_path);
      const asked = path14.resolve(dir, decodeURIComponent(a[2]));
      if (asked !== dir && !asked.startsWith(dir + path14.sep)) return send(res, 403, "forbidden", "text/plain");
      let base;
      let f;
      try {
        base = fs12.realpathSync(dir);
        f = fs12.realpathSync(asked);
      } catch {
        return send(res, 404, "not found", "text/plain");
      }
      if (f !== base && !f.startsWith(base + path14.sep)) return send(res, 403, "forbidden", "text/plain");
      if (!fs12.statSync(f).isFile()) return send(res, 404, "not found", "text/plain");
      return send(res, 200, fs12.readFileSync(f), MIME[path14.extname(f).toLowerCase()] ?? "application/octet-stream");
    }
    const r = p.match(/^\/api\/raw\/(\d+)$/);
    if (r) {
      const doc = index.get(Number(r[1]));
      if (!doc || !fs12.existsSync(doc.abs_path)) return send(res, 404, "not found", "text/plain");
      watcher.ensureWatch(doc);
      const type = isPdf(doc.file_path) ? "application/pdf" : isHtml(doc.file_path) ? "text/html; charset=utf-8" : "text/plain; charset=utf-8";
      return send(res, 200, fs12.readFileSync(doc.abs_path), type);
    }
    const m = p.match(/^\/api\/document\/(\d+)$/);
    if (m) {
      const doc = index.get(Number(m[1]));
      if (!doc) return json(res, { error: "not found" }, 404);
      const pending = index.pendingFor(doc.id);
      if (!fs12.existsSync(doc.abs_path))
        return json(res, { document: doc, content: null, pending });
      watcher.ensureWatch(doc);
      if (isPdf(doc.file_path))
        return json(res, { document: doc, format: "pdf", content: null, pending });
      if (isHtml(doc.file_path)) {
        const dir = path14.dirname(doc.abs_path);
        const reader = (name) => {
          if (/[\\/]/.test(name) || name.includes("..")) return void 0;
          const f = path14.join(dir, name);
          return fs12.existsSync(f) && fs12.statSync(f).isFile() ? readDoc(f) : void 0;
        };
        const { html, sources, errors, warnings } = resolveBindings(readDoc(doc.abs_path), reader);
        watcher.setSources(doc.id, sources.map((s) => path14.join(dir, s)));
        return json(res, {
          document: doc,
          format: "html",
          content: html,
          pending,
          bindings: { sources, errors, warnings }
        });
      }
      return json(res, {
        document: doc,
        format: formatOf(doc.file_path),
        content: readDoc(doc.abs_path),
        pending
      });
    }
    if (p.startsWith("/api/")) return send(res, 404, "not found", "text/plain");
    serveStatic(res, p);
  });
  server.on("close", () => {
    board.close();
    watcher.close();
    sse.close();
  });
  server.on("error", (err) => {
    console.error(
      err.code === "EADDRINUSE" ? `aiview: port ${port} is already in use. Retry with --port <n> or set AIVIEW_PORT.` : `aiview: server error: ${err.message}`
    );
    process.exit(1);
  });
  server.listen(port, "127.0.0.1", () => {
    const actualPort = server.address().port;
    if (writeState) {
      writeServerFiles(actualPort, version);
      process.on("exit", clearServerFiles);
    }
    const url = `http://localhost:${actualPort}/${startDoc ? `#doc=${startDoc.id}` : ""}`;
    console.log(`aiview  ${startDoc ? startDoc.title : "(index)"}
  url   ${url}`);
    if (open) openBrowser(url);
  });
  return server;
}
var MIME;
var init_server = __esm({
  async "src/server/index.ts"() {
    "use strict";
    await init_db();
    init_projects();
    init_bind();
    init_paths();
    init_pointer();
    init_serverstate();
    init_collectionversion();
    init_watcher();
    await init_board();
    init_sse();
    MIME = {
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".pdf": "application/pdf",
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".mjs": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".map": "application/json; charset=utf-8",
      ".woff2": "font/woff2",
      ".ico": "image/x-icon"
    };
  }
});

// src/cli/index.ts
init_proc();
await init_db();
init_bind();
init_paths();
init_pointer();
init_projects();
import { spawn as spawn4, spawnSync as spawnSync3 } from "node:child_process";
import fs13 from "node:fs";
import path15 from "node:path";
import { fileURLToPath as fileURLToPath2, pathToFileURL } from "node:url";

// src/core/boardhash.ts
function boardHash(repo, run) {
  return `#board&repo=${encodeURIComponent(repo)}${run ? `&run=${run}` : ""}`;
}

// src/cli/index.ts
init_home();
init_serverstate();
init_collectionversion();

// src/cli/args.ts
var VALUE_FLAGS = /* @__PURE__ */ new Set([
  "--port",
  "--tag",
  "--untag",
  "--kind",
  "--started",
  "--group",
  "--group-title",
  "--project",
  "--title",
  "--path",
  "--component",
  "--variant"
]);
function parseArgs(argv) {
  const [verb, ...rest] = argv;
  return {
    verb,
    rest,
    positional: rest.filter((a, i) => !a.startsWith("--") && !VALUE_FLAGS.has(rest[i - 1] ?? "")),
    flag: (name) => {
      const i = rest.indexOf(name);
      return i >= 0 ? rest[i + 1] : void 0;
    },
    flags: (name) => rest.flatMap((a, i) => a === name && rest[i + 1] ? [rest[i + 1]] : []),
    has: (name) => rest.includes(name)
  };
}

// src/mermaid/discipline.ts
function captionWarning(lines, fenceLine) {
  for (let i = fenceLine - 2; i >= 0; i--) {
    const l = lines[i].trim();
    if (!l) continue;
    if (/^#{1,6}\s/.test(l) || /^```/.test(l) || /^\|/.test(l) || /^---+$/.test(l)) break;
    return void 0;
  }
  return "no caption above the fence: one line naming the diagram's type and the question it answers";
}
var SKIP = /^\s*(subgraph\b|end\b|classDef\b|class\b|style\b|linkStyle\b|click\b|direction\b|flowchart\b|graph\b|%%)/;
var SHAPES = /\[\[.*?\]\]|\[\(.*?\)\]|\(\(.*?\)\)|\{\{.*?\}\}|\[.*?\]|\(.*?\)|\{.*?\}|(?<=\w)>[^\]]*\]/g;
var EDGE = /(-{2,}\s*[^-|>\s][^>]*?-{2,}>|-\.+\s*[^.|>\s][^>]*?\.+->|={2,}\s*[^=|>\s][^>]*?={2,}>|(?:<?-{2,}>|<?-\.+->|<?={2,}>|-{3,}|-\.+-|={3,}|--[ox]|[ox]--)(?:\s*\|[^|]*\|)?)/g;
function forkWarning(text) {
  const head = text.trim().split("\n")[0] ?? "";
  if (!/^\s*(flowchart|graph)\b/.test(head)) return void 0;
  const out = /* @__PURE__ */ new Map();
  for (const raw of text.split("\n")) {
    if (SKIP.test(raw) || !raw.trim()) continue;
    const line = raw.replace(SHAPES, "").replace(/:::\w+/g, "");
    const parts = line.split(EDGE);
    if (parts.length < 3) continue;
    for (let i = 1; i < parts.length; i += 2) {
      const edge = parts[i];
      const labeled = /\|[^|]*\|/.test(edge) || /^(-{2,}|-\.+|={2,})\s*[^-.=|>\s]/.test(edge);
      const sources = parts[i - 1].split("&").map((s) => s.trim()).filter((s) => /^[\w.-]+$/.test(s));
      for (const s of sources) {
        const c = out.get(s) ?? { total: 0, unlabeled: 0 };
        c.total++;
        if (!labeled) c.unlabeled++;
        out.set(s, c);
      }
    }
  }
  const bad = [...out].filter(([, c]) => c.total >= 2 && c.unlabeled > 0);
  if (!bad.length) return void 0;
  return bad.map(([n, c]) => c.unlabeled === c.total ? `${n} branches (${c.total} arrows) and none carries a label` : `${n} branches (${c.total} arrows) and ${c.unlabeled} of them ${c.unlabeled === 1 ? "carries" : "carry"} no label`).join("; ");
}
function disciplineWarnings(lines, fenceLine, text, markdown) {
  const w = [];
  if (markdown) {
    const c = captionWarning(lines, fenceLine);
    if (c) w.push(c);
  }
  const f = forkWarning(text);
  if (f) w.push(f);
  return w;
}

// src/core/tracker.ts
var GLYPH_CLASS = /* @__PURE__ */ new Map([
  ["\u2705", "done"],
  ["\u25B6", "next"],
  ["\u23F8", "todo"],
  ["\u2B1C", "todo"],
  ["\u2716", "todo"],
  ["\u{1F4CD}", "state"]
]);
var NODE = /^(\s*)([A-Za-z_][\w.-]*)\[\s*"(.*)"\s*\]\s*$/;
var CLASS_LINE = /^(\s*)class\s+([\w.,\s-]+?)\s+(\w+)\s*$/;
var CLASSDEF = /^\s*classDef\s+(\w+)\b/;
var SUBGRAPH = /^\s*subgraph\s+([A-Za-z_][\w.-]*)\s*\[\s*"?(.*?)"?\s*\]\s*$/;
var END = /^\s*end\s*$/;
var sliceOf = (id) => (/^SL(\d+)$/i.exec(id) ?? /^S(\d+)\.\w+$/i.exec(id))?.[1];
var MARKER2 = /^\s*%%\s*(aiview:)?tracker\b/i;
var MANDATE_LINE = /^\s*(\*\*)?mandate(\*\*)?\s*:/i;
function findTracker(text) {
  const lines = text.split("\n");
  let start = -1;
  const blocks = [];
  lines.forEach((line, i) => {
    if (!/^\s*```/.test(line)) return;
    if (start < 0 && /^\s*```\s*mermaid\b/.test(line)) start = i;
    else if (start >= 0) {
      blocks.push({ fence: start + 1, from: start + 1, to: i });
      start = -1;
    }
  });
  if (!blocks.length) blocks.push({ fence: 0, from: 0, to: lines.length });
  const read = (block, diagramsAbove) => {
    const nodes = [];
    const slices = [];
    const assigned = /* @__PURE__ */ new Map();
    const declared = /* @__PURE__ */ new Set();
    const classLines = [];
    const open = [];
    let marked = false;
    let indent = "  ";
    for (let i = block.from; i < block.to; i++) {
      const raw = lines[i];
      if (MARKER2.test(raw)) {
        marked = true;
        continue;
      }
      const sub = SUBGRAPH.exec(raw);
      if (sub) {
        const [, id, title] = sub;
        slices.push({ id, title, line: i + 1, needsPerson: title.includes("\u{1F464}") });
        open.push(id);
        continue;
      }
      if (END.test(raw)) {
        open.pop();
        continue;
      }
      const node = NODE.exec(raw);
      if (node) {
        const [, pad, id, label] = node;
        const glyph = [...label.trimStart()][0];
        nodes.push({ id, glyph: GLYPH_CLASS.has(glyph) ? glyph : void 0, label, line: i + 1, slice: open.at(-1) });
        if (pad) indent = pad;
        continue;
      }
      const def = CLASSDEF.exec(raw);
      if (def) {
        declared.add(def[1]);
        continue;
      }
      const cls = CLASS_LINE.exec(raw);
      if (cls) {
        const [, pad, ids, name] = cls;
        classLines.push(i + 1);
        indent = pad || indent;
        for (const id of ids.split(",").map((s) => s.trim()).filter(Boolean)) {
          assigned.set(id, [...assigned.get(id) ?? [], name]);
        }
      }
    }
    const under = lines.slice(block.to + 1).find((l) => l.trim() !== "") ?? "";
    const mandateLine = block.fence === 0 || MANDATE_LINE.test(under);
    const mandate = MANDATE_LINE.test(under) ? under.trim() : "";
    return { fence: block.fence, marked, diagramsAbove, mandateLine, mandate, nodes, slices, assigned, declared, classLines, indent };
  };
  const all = blocks.map((block, i) => read(block, i));
  return all.find((t) => t.marked) ?? all.find((t) => t.nodes.some((n) => n.glyph));
}
function derive(t) {
  const out = /* @__PURE__ */ new Map();
  for (const n of t.nodes) {
    const cls = n.glyph ? GLYPH_CLASS.get(n.glyph) : void 0;
    if (cls && t.declared.has(cls)) out.set(n.id, cls);
  }
  return out;
}
function check(t) {
  const found = [];
  const want = derive(t);
  if (t.diagramsAbove > 0) {
    found.push({ line: t.fence, text: `the tracker is drawn below ${t.diagramsAbove === 1 ? "another diagram" : `${t.diagramsAbove} other diagrams`}: it is the first thing in the plan, under the header` });
  }
  if (!t.mandateLine) {
    found.push({ line: t.fence, text: "no mandate line under the tracker: the first line below the diagram states the mandate in force, `mandate: seats 4 \xB7 phases 3 \xB7 \u2026`" });
  }
  if (/tests at the plan end/i.test(t.mandate) && !t.slices.some((sl) => /\bthe tests\b/i.test(sl.title))) {
    found.push({ line: t.fence, text: "the mandate says tests at the plan end and no phase is the tests phase: draw it, titled `\u2026 \xB7 the tests`, last before the person's checks, every other slice owing it its tests" });
  }
  for (const n of t.nodes) {
    const has = t.assigned.get(n.id) ?? [];
    if (!n.glyph) {
      found.push({ line: n.line, text: `${n.id} opens with no status glyph: a step's label starts with one of \u2705 \u25B6 \u23F8 \u2B1C \u2716` });
      continue;
    }
    const should = want.get(n.id);
    if (!should) continue;
    if (has.length === 0) {
      found.push({ line: n.line, text: `${n.id} is ${n.glyph} and belongs to no class: it should be '${should}'` });
    } else if (has.length > 1) {
      found.push({ line: n.line, text: `${n.id} is in ${has.length} classes (${has.join(", ")}): a node carries one, and its glyph ${n.glyph} says '${should}'` });
    } else if (has[0] !== should) {
      found.push({ line: n.line, text: `${n.id} is ${n.glyph} but styled '${has[0]}': the glyph says '${should}'` });
    }
  }
  const ids = new Set(t.nodes.map((n) => n.id));
  for (const [id, names] of t.assigned) {
    if (!ids.has(id)) found.push({ line: t.classLines[0] ?? 0, text: `${id} is styled '${names.join(", ")}' but no node declares it` });
  }
  const perSlice = /* @__PURE__ */ new Map();
  for (const n of t.nodes.filter((x) => x.glyph === "\u25B6")) {
    const key = n.slice ?? "";
    perSlice.set(key, [...perSlice.get(key) ?? [], n]);
  }
  for (const [slice, running] of perSlice) {
    if (running.length > 1) {
      found.push({
        line: running[1].line,
        text: `${running.length} steps are \u25B6 in ${slice || "no slice"} (${running.map((n) => n.id).join(", ")}): one at a time, or one per branch the slice draws`
      });
    }
  }
  for (const n of t.nodes) {
    if (!n.slice || !n.glyph || n.glyph === "\u{1F4CD}") continue;
    const byId = sliceOf(n.id);
    const bySlice = sliceOf(n.slice);
    if (byId && bySlice && byId !== bySlice) {
      found.push({ line: n.line, text: `${n.id} names slice ${byId} but is drawn inside ${n.slice}` });
    }
  }
  for (const n of t.nodes) {
    if (n.glyph && n.glyph !== "\u{1F4CD}" && !n.slice) {
      found.push({ line: n.line, text: `${n.id} is a step drawn outside every slice: only the state node stands on its own` });
    }
  }
  for (const n of t.nodes) {
    if (n.glyph === "\u23F8" && !/paused|wait|block|until|needs|asked/i.test(n.label)) {
      found.push({ line: n.line, text: `${n.id} is \u23F8 and does not say what it waits on, or since when` });
    }
  }
  for (const n of t.nodes) {
    if (n.glyph && n.glyph !== "\u{1F4CD}") found.push(...shapeFindings(n));
  }
  const state = t.nodes.find((n) => n.glyph === "\u{1F4CD}");
  if (state) found.push(...stateFindings(state));
  return found;
}
var STEP_LINES = 3;
var STEP_WIDTH = 80;
var VERDICTS = ["done when", "went on", "paused", "dropped"];
var VERDICT_OF = /* @__PURE__ */ new Map([
  ["\u2B1C", ["done when"]],
  ["\u25B6", ["done when"]],
  ["\u2705", ["went on"]],
  ["\u23F8", ["done when", "paused"]],
  ["\u2716", ["dropped"]]
]);
var IDENTIFIER = /\w\(\)|\b[a-z]+[A-Z]\w*/;
function shapeFindings(n) {
  const lines = n.label.split(/<br\s*\/?>/i).map((l) => l.trim());
  const found = [];
  if (lines.length > STEP_LINES) {
    found.push({ line: n.line, text: `${n.id} has ${lines.length} lines: a step holds ${STEP_LINES} at most, and the rest has a home in the pull request, a decisions row or the slice document` });
  }
  const wide = lines.filter((l) => [...l].length > STEP_WIDTH);
  if (wide.length) {
    found.push({ line: n.line, text: `${n.id} has ${wide.length === 1 ? "a line" : `${wide.length} lines`} over ${STEP_WIDTH} characters: "${[...wide[0]].slice(0, 40).join("")}\u2026"` });
  }
  const allowed = VERDICT_OF.get(n.glyph ?? "") ?? [];
  const stray = lines.map((l) => VERDICTS.find((v) => l.toLowerCase().startsWith(`${v}:`))).filter((v) => !!v && !allowed.includes(v));
  if (stray.length) {
    found.push({ line: n.line, text: `${n.id} is ${n.glyph} and says '${stray.join("', '")}': its verdict line is '${allowed.at(-1)}'` });
  }
  const named = IDENTIFIER.exec(lines[0])?.[0];
  if (named) {
    found.push({ line: n.line, text: `${n.id} names '${named}' in its title: the first line says what an observer of the system could tell, and the slice document holds the identifier` });
  }
  return found;
}
var STATE_FIELDS = ["branch", "deployed", "next", "blocked", "parked"];
var MANDATE_FIELDS = ["seats", "phases", "pace", "model", "verify"];
function stateFindings(state) {
  const seen = /* @__PURE__ */ new Map();
  const mandate = [];
  for (const part of state.label.split(/<br\s*\/?>/i)) {
    const word = part.trim().split(/\s+/)[0]?.toLowerCase().replace(/:$/, "");
    if (word && MANDATE_FIELDS.includes(word)) mandate.push(word);
    if (word && STATE_FIELDS.includes(word)) seen.set(word, (seen.get(word) ?? 0) + 1);
  }
  const twice = [...seen].filter(([, n]) => n > 1).map(([f]) => f);
  const found = [];
  if (twice.length) {
    found.push({ line: state.line, text: `the state node names ${twice.join(" and ")} more than once: its fields are overwritten, and a node appended to becomes a log` });
  }
  if (mandate.length) {
    found.push({ line: state.line, text: `the state node carries ${mandate.join(" and ")}: the mandate lives in the plan's Mandate section, and the state node describes now` });
  }
  return found;
}
function sync(text, t) {
  const want = derive(t);
  const byClass = /* @__PURE__ */ new Map();
  for (const n of t.nodes) {
    const cls = want.get(n.id);
    if (cls) byClass.set(cls, [...byClass.get(cls) ?? [], n.id]);
  }
  const order = [...t.declared].filter((c) => byClass.has(c));
  const rewritten = order.map((c) => `${t.indent}class ${byClass.get(c).join(",")} ${c}`);
  const lines = text.split("\n");
  const first = t.classLines[0];
  if (!first) return { text, changed: false };
  const drop = new Set(t.classLines);
  const out = [];
  lines.forEach((line, i) => {
    const n = i + 1;
    if (n === first) out.push(...rewritten);
    else if (!drop.has(n)) out.push(line);
  });
  const next = out.join("\n");
  return { text: next, changed: next !== text };
}

// src/core/plan.ts
var STATUS = /^\s*>?\s*(\*\*)?status(\*\*)?\s*:\s*(.*)$/i;
var APPROVED = /^approved\b/i;
var CONFIRMED = /defaults confirmed\s*:\s*([^;]*)/i;
var DECISIONS = /^#{2,3}\s*(\d+\.\s*)?decisions\b/i;
var HEADING = /^#{1,6}\s/;
var DEFAULT_SOURCE = /\bagent'?s? default\b/i;
var cell = (s) => s.replace(/[`*_]/g, "").trim();
var cells = (row) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell);
var isRule = (row) => /^\s*\|?[\s:|-]+\|?\s*$/.test(row) && row.includes("-");
function readDecisions(lines) {
  const start = lines.findIndex((l) => DECISIONS.test(l));
  if (start < 0) return [];
  const out = [];
  let header;
  for (let i = start + 1; i < lines.length && !HEADING.test(lines[i]); i++) {
    const l = lines[i];
    if (!l.trim().startsWith("|")) {
      if (header && out.length) break;
      continue;
    }
    if (isRule(l)) continue;
    const row = cells(l);
    if (!header) {
      header = row.map((h) => h.toLowerCase());
      continue;
    }
    const at = (name) => row[header.indexOf(name)] ?? "";
    const id = at("id");
    if (id) out.push({ id, kind: at("kind").toLowerCase(), source: at("source"), line: i + 1 });
  }
  return out;
}
function readApproval(text) {
  const lines = text.split("\n");
  const statusIdx = lines.findIndex((l) => STATUS.test(l));
  const status = statusIdx < 0 ? "" : STATUS.exec(lines[statusIdx])[3].trim();
  const decisions = readDecisions(lines);
  const defaults = decisions.filter((d) => DEFAULT_SOURCE.test(d.source)).sort((a, b) => Number(b.kind === "contract") - Number(a.kind === "contract"));
  const named = CONFIRMED.exec(status)?.[1]?.trim();
  const confirmed = named === void 0 ? void 0 : /^all\b/i.test(named) ? defaults.map((d) => d.id) : named.split(/[\s,]+/).map(cell).filter((s) => s && !/^none$/i.test(s));
  return {
    status,
    statusLine: statusIdx + 1,
    approved: APPROVED.test(status),
    confirmed,
    decisions,
    defaults
  };
}
function check2(plan) {
  if (!plan.statusLine) return [{ line: 1, text: 'no status line: `> **Status**: draft | approved: <who>, <date>, "<words>"`' }];
  if (!plan.approved) return [];
  const out = [];
  const ids = (ds) => ds.map((d) => `${d.id}${d.kind === "contract" ? " (contract)" : ""}`).join(", ");
  if (plan.defaults.length && plan.confirmed === void 0) {
    out.push({
      line: plan.statusLine,
      text: `approved, but ${plan.defaults.length} agent default(s) were never confirmed: ${ids(plan.defaults)}; list them to the person and add "defaults confirmed: <ids>" to the status`
    });
    return out;
  }
  const confirmed = new Set(plan.confirmed ?? []);
  const unconfirmed = plan.defaults.filter((d) => !confirmed.has(d.id));
  if (unconfirmed.length)
    out.push({ line: plan.statusLine, text: `agent default(s) approved without confirmation: ${ids(unconfirmed)}` });
  const known = new Set(plan.defaults.map((d) => d.id));
  for (const id of confirmed)
    if (!known.has(id)) out.push({ line: plan.statusLine, text: `${id} is confirmed in the status, but no decision row with source agent default has that id` });
  return out;
}

// src/cli/index.ts
var LF = String.fromCharCode(10);
var CRLF = String.fromCharCode(13, 10);
var args = parseArgs(process.argv.slice(2));
var asJson = args.has("--json");
var USAGE = [
  "usage: aiview <verb> [--json]",
  "  open <file> [--kind k] [--tag t]... [--group g [--group-title T]] [--started ISO] [--port p] [--open]",
  "  add <file> [--kind k] [--tag t]... [--group g [--group-title T]] [--started ISO]",
  "  update <file|#id> [--kind k] [--tag t]... [--untag t]... [--group g|--ungroup] [--group-title T] [--started ISO]",
  "  list [--kind k] [--tag t]... [--project p]   # the project of this directory, else --project",
  "  project <add|list|rm> [slug] [--title T] [--path P]...",
  "  remove <file|#id>...",
  "  move <file|#id>... [--project <slug>]    # refile: file + index together",
  "  serve [file] [--port <n>, default 4321, another data home its own] [--open] [--detach]",
  "  pending add <file|#id> --label L [--note N]   # work the reader is waiting on",
  "  pending done <#pendingId>                     # the work landed; the card goes away",
  "  pending list [<file|#id>] | clear <file|#id>",
  "  status",
  "  path <filename> [--project <slug>]       # where this document belongs, joined for this OS",
  "  components <file|#id>                    # what this prototype offers to siblings, what it pulls, every name on its page and its variants",
  "  check <file|#id>                         # do this prototype's bindings resolve? errors as text, exit 1 if any",
  "  show <file|#id> [--component Name]... [--variant v]   # point the person's viewer at these components of a prototype; prints the link",
  "  show --done                              # the question is answered: every tab goes back to what the person was reading",
  "  mermaid-check <file|#id>                 # parse every mermaid block; warn on a missing caption or an unlabeled fork; exit 1 if one fails",
  "  tracker check <file|#id>                 # a plan's tracker judged against itself; exit 1 if anything disagrees",
  "  tracker sync <file|#id>                  # rewrite the class lines from the glyphs, the one place a step's state is written twice",
  "  plan check <file|#id>                    # a plan's approval against its decisions: warns on agent defaults never confirmed; always exit 0",
  "  board [--repo <path>] [--project <slug>] [--open]   # the project's board page: its repositories, a repository added; prints the link",
  "  init                                     # create the data home; report where everything lives"
].join("\n");
var registerOpts = () => ({
  kind: args.flag("--kind") ?? "",
  tags: args.flags("--tag"),
  started: args.flag("--started") ?? "",
  group: args.flag("--group") ?? "",
  groupTitle: args.flag("--group-title") ?? "",
  project: args.flag("--project") ?? ""
});
function postToServer(route, body) {
  return askServer(route, body) !== null;
}
function askServer(route, body) {
  const st = readServerStatus();
  if (!st.running || st.port === null) return null;
  const b = JSON.stringify(body);
  const r = hiddenSpawnSync(
    process.execPath,
    [
      "-e",
      `const b=${JSON.stringify(b)};const q=require('node:http').request(
         {host:'127.0.0.1',port:${st.port},path:${JSON.stringify(route)},method:'POST',
          headers:{'content-type':'application/json','content-length':Buffer.byteLength(b)}},
         r=>{r.pipe(process.stdout);r.on('end',()=>process.exitCode=r.statusCode===200?0:1)});
       q.on('error',()=>process.exit(1));q.end(b);`
    ],
    { timeout: 5e3, encoding: "utf8" }
  );
  return r.status === 0 ? r.stdout : null;
}
function recordRecentProject(index, slug) {
  if (!postToServer("/api/recent-project", { project: slug })) index.recordRecentProject(slug);
}
function projectOfVerb(index) {
  return args.flag("--project") ?? projectForCwd(process.cwd(), index.allProjects())?.slug ?? null;
}
function noProjectLine(known) {
  return `no aiview project for ${process.cwd()}: pass --project <slug>, or declare one with aiview project add <slug> --path <dir>${known.length ? `
known: ${known.join(", ")}` : ""}`;
}
function notifyPendingChanged(documentId) {
  postToServer("/api/pending-changed", { id: documentId });
}
function notifyIndexChanged() {
  postToServer("/api/index-changed", {});
}
var MUTATES_INDEX = /* @__PURE__ */ new Set(["add", "open", "update", "remove", "move", "project", "board"]);
var docLine = (d) => `#${d.id}  ${d.kind} [${d.tags.join(", ")}]${d.group_slug ? `  group:${d.group_slug}` : ""}  started ${d.created_at}  ${d.title}`;
var emit = (json, human) => {
  if (asJson) console.log(JSON.stringify(json));
  else if (typeof human === "string") console.log(human);
  else human();
};
function ensureDist() {
  if (fs13.existsSync(path15.join(TOOL_ROOT, "dist", "index.html"))) return;
  if (!fs13.existsSync(path15.join(TOOL_ROOT, "app", "index.html"))) return;
  console.error("aiview: dist/ missing \u2014 building the UI once\u2026");
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const r = spawnSync3(npm, ["run", "build"], { cwd: TOOL_ROOT, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) {
    console.error(`aiview: UI build failed. Run: npm install && npm run build  (in ${TOOL_ROOT})`);
    process.exit(1);
  }
}
function spawnDetachedServer(port) {
  try {
    fs13.rmSync(PORT_FILE, { force: true });
    fs13.rmSync(PID_FILE, { force: true });
  } catch {
  }
  const child = hiddenSpawn(process.execPath, [process.argv[1], "serve", "--port", String(port)], {
    detached: true,
    stdio: "ignore",
    cwd: TOOL_ROOT
  });
  child.unref();
  const t0 = Date.now();
  for (; ; ) {
    const st = readServerStatus();
    if (st.running && st.port !== null && st.pid === child.pid) return st.port;
    if (Date.now() - t0 > 1e4) {
      console.error(`aiview: server did not come up within 10s (port ${port} may be in use \u2014 retry with --port <n>)`);
      process.exit(1);
    }
    pause2(120);
  }
}
var pause2 = (ms) => {
  hiddenSpawnSync(process.execPath, ["-e", `setTimeout(()=>{},${ms})`]);
};
var isAlive3 = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
function stopServerProcess(pid) {
  try {
    process.kill(pid);
  } catch {
  }
  const t0 = Date.now();
  while (isAlive3(pid)) {
    if (Date.now() - t0 > 5e3) {
      console.error(`aiview: the running server (pid ${pid}) is an older version and did not stop within 5s; stop it and retry`);
      process.exit(1);
    }
    pause2(100);
  }
}
function portOfInstalledServer() {
  const asked = args.flag("--port") ?? process.env.AIVIEW_PORT;
  const st = readServerStatus();
  if (!st.running || st.port === null || st.pid === null) return spawnDetachedServer(asked !== void 0 ? Number(asked) : firstFreePort(defaultPort()));
  const installed = collectionVersion(TOOL_ROOT);
  if (installed === null || st.version === installed) return st.port;
  stopServerProcess(st.pid);
  return spawnDetachedServer(st.port);
}
function agentProject(fallback) {
  const index = openIndex();
  try {
    return projectForCwd(process.cwd(), index.allProjects())?.slug ?? fallback;
  } finally {
    index.close();
  }
}
var movedLine = (r, project, verb) => r.opened ? `no tab showed ${project}: opened a new one` : `${verb} in ${r.tabs} open tab${r.tabs > 1 ? "s" : ""} on ${project}`;
function resolveRef(ref) {
  const index = openIndex();
  try {
    return /^#?\d+$/.test(ref) ? index.get(Number(ref.replace("#", ""))) : index.getByPath(path15.resolve(ref));
  } finally {
    index.close();
  }
}
function cmdStatus() {
  const index = openIndex();
  const documents = index.all().length;
  const cwdProject = projectForCwd(process.cwd(), index.allProjects())?.slug ?? null;
  const project = cwdProject;
  const projectDocs = cwdProject === null ? null : docsDirFor(cwdProject);
  index.close();
  const server = readServerStatus();
  emit(
    { home: DATA_ROOT, docs: DOCS_ROOT, project, projectDocs, cwdProject, sqlite: SQLITE_PATH, tool: TOOL_ROOT, documents, server },
    () => {
      console.log(`home       ${DATA_ROOT}`);
      console.log(`docs       ${DOCS_ROOT}`);
      console.log(`project    ${project ?? "(none for this directory: pass --project)"}`);
      if (projectDocs) console.log(`write to   ${projectDocs}`);
      console.log(`sqlite     ${SQLITE_PATH}`);
      console.log(`tool       ${TOOL_ROOT}`);
      console.log(`documents  ${documents}`);
      console.log(
        `server     ${server.running ? `up (pid ${server.pid}, port ${server.port}, version ${server.version ?? "unrecorded"})` : server.stale ? "down (stale pidfile)" : "down"}`
      );
    }
  );
}
function cmdPath() {
  const name = args.positional[0];
  if (!name) {
    console.error("usage: aiview path <filename> [--project <slug>]");
    process.exit(1);
  }
  const index = openIndex();
  const slug = projectOfVerb(index);
  const known = index.allProjects().map((p) => p.slug);
  index.close();
  if (slug === null) {
    console.error(noProjectLine(known));
    process.exit(1);
  }
  if (!known.includes(slug)) {
    console.error(`no such project: ${slug}${known.length ? `
known: ${known.join(", ")}` : ""}`);
    process.exit(1);
  }
  const dir = docsDirFor(slug);
  fs13.mkdirSync(dir, { recursive: true });
  const full = path15.join(dir, path15.basename(name));
  emit({ path: full, dir, project: slug }, full);
}
function prototypeArg(usage) {
  const ref = args.positional[0];
  if (!ref) {
    console.error(usage);
    process.exit(1);
  }
  const abs = resolveRef(ref)?.abs_path ?? path15.resolve(ref);
  if (!fs13.existsSync(abs)) {
    console.error(`no such file: ${abs}`);
    process.exit(1);
  }
  if (!isHtml(abs)) {
    console.error(`not an html prototype: ${abs}`);
    process.exit(1);
  }
  return abs;
}
function cmdComponents() {
  const abs = prototypeArg("usage: aiview components <file|#id>");
  const r = listComponents(readDoc(abs));
  const vocabulary = pageVocabulary(abs);
  emit({ file: path15.basename(abs), ...r, ...vocabulary }, () => {
    if (!r.offers.length) console.log("offers   nothing: no data-component in this file");
    for (const o of r.offers)
      console.log(
        `offers   ${o.name}  <${o.tag}>${o.within ? `  within ${o.within}` : ""}${o.warnings.length ? `  !! ${o.warnings.join(", ")}` : ""}`
      );
    for (const x of r.pulls) console.log(`pulls    ${x.name || x.ref}  from ${x.file || "(invalid ref)"}`);
    if (!r.pulls.length) console.log("pulls    nothing: no data-bind in this file");
    console.log(`page     ${vocabulary.page.join(", ") || "no component"}`);
    console.log(`variants ${vocabulary.variants.join(", ") || "none declared"}`);
  });
}
function composed(abs) {
  const dir = path15.dirname(abs);
  const reader = (name) => {
    if (/[\\/]/.test(name) || name.includes("..")) return void 0;
    const f = path15.join(dir, name);
    return fs13.existsSync(f) && fs13.statSync(f).isFile() ? readDoc(f) : void 0;
  };
  return resolveBindings(readDoc(abs), reader);
}
function pageVocabulary(abs) {
  const raw = readDoc(abs);
  const html = composed(abs).html;
  const names = [...listComponents(html).offers, ...listComponents(raw).pulls].map((c) => c.name).filter(Boolean);
  return {
    page: [...new Set(names)],
    variants: [...new Set([...html.matchAll(/data-aiview-variant="([^"]+)"/g)].map((m) => m[1]))]
  };
}
function cmdShow() {
  const usage = "usage: aiview show <file|#id> [--component Name]... [--variant v]  |  aiview show --done";
  if (args.has("--done")) {
    const answer2 = askServer("/api/show-done", {});
    const tabs = answer2 === null ? 0 : JSON.parse(answer2).tabs;
    emit({ done: true, tabs }, tabs ? `${tabs} open tab${tabs > 1 ? "s" : ""} sent back to what the person was reading` : "no tab is open: nothing to send back");
    return;
  }
  const abs = prototypeArg(usage);
  const doc = resolveRef(args.positional[0]);
  if (!doc) {
    console.error(`not registered: ${abs}. Register and serve it with: aiview open <file>`);
    process.exit(1);
  }
  const components = args.flags("--component");
  const variant = args.flag("--variant");
  const { page: known, variants } = pageVocabulary(abs);
  const wrong = [...components, ...variant ? [variant] : []].find((n) => !isName(n)) !== void 0 ? "a name holds letters, digits, dot, dash and underscore only" : unknownNames(components, known, "component") ?? (variant ? unknownNames([variant], variants, "variant") : void 0);
  if (wrong) {
    console.error(wrong);
    process.exit(1);
  }
  ensureDist();
  const port = portOfInstalledServer();
  const pointer = { id: doc.id, components, ...variant ? { variant } : {} };
  const url = `http://localhost:${port}/#${pointerHash(pointer)}`;
  const project = agentProject(doc.project);
  const answer = askServer("/api/show", { ...pointer, project });
  const moved = answer === null ? null : JSON.parse(answer);
  emit({ id: doc.id, url, components, variant: variant ?? null, project, tabs: moved?.tabs ?? 0, opened: moved?.opened ?? false }, () => {
    console.log(url);
    console.log(moved ? movedLine(moved, project, "shown") : "no aiview server answered: give the person the link");
  });
}
function cmdCheck() {
  const abs = prototypeArg("usage: aiview check <file|#id>");
  const r = composed(abs);
  emit({ file: path15.basename(abs), bound: r.bound, sources: r.sources, errors: r.errors, warnings: r.warnings }, () => {
    console.log(`${r.bound} bound from ${r.sources.length} source${r.sources.length === 1 ? "" : "s"}${r.sources.length ? `: ${r.sources.join(", ")}` : ""}`);
    for (const e of r.errors) console.log(`error    ${e.ref}: ${e.message}`);
    for (const w of r.warnings) console.log(`warning  ${w.ref}: ${w.message}`);
    if (!r.errors.length && !r.warnings.length) console.log("ok");
  });
  if (r.errors.length) process.exit(1);
}
async function cmdMermaidCheck() {
  const ref = args.positional[0];
  if (!ref) {
    console.error("usage: aiview mermaid-check <file|#id>");
    process.exit(1);
  }
  const abs = resolveRef(ref)?.abs_path ?? path15.resolve(ref);
  if (!fs13.existsSync(abs)) {
    console.error(`no such file: ${abs}`);
    process.exit(1);
  }
  const here = path15.dirname(fileURLToPath2(import.meta.url));
  const bundle = [path15.join(here, "mermaid-check.mjs"), path15.join(here, "..", "..", "dist-cli", "mermaid-check.mjs")].find((f) => fs13.existsSync(f));
  if (!bundle) {
    console.error(`aiview: the mermaid checker is not built. Run: npm install && npm run build  (in ${TOOL_ROOT})`);
    process.exit(1);
  }
  const { blocksOf, checkBlocks } = await import(pathToFileURL(bundle).href);
  const content = fs13.readFileSync(abs, "utf8").replace(/\r\n/g, "\n");
  const markdown = /\.(md|markdown)$/i.test(abs);
  const lines = content.split("\n");
  const blocks = blocksOf(content, markdown);
  const results = (await checkBlocks(blocks)).map((r, i) => ({
    ...r,
    warnings: r.ok ? disciplineWarnings(lines, r.line, blocks[i].text, markdown) : []
  }));
  const failed = results.filter((r) => !r.ok).length;
  const warned = results.reduce((n, r) => n + r.warnings.length, 0);
  emit({ file: path15.basename(abs), blocks: results.length, failed, warnings: warned, results }, () => {
    if (!results.length) return console.log("no mermaid block in this document");
    for (const r of results) {
      console.log(r.ok ? `ok     line ${r.line}  ${r.type}` : `FAIL   line ${r.line}  ${r.error}`);
      for (const w of r.warnings) console.log(`warn   line ${r.line}  ${w}`);
    }
    console.log(`${results.length} block${results.length === 1 ? "" : "s"}, ${failed} failed, ${warned} warning${warned === 1 ? "" : "s"}`);
  });
  if (failed) process.exit(1);
}
function cmdInit() {
  ensureHome();
  adoptLegacyIndex(TOOL_ROOT, SQLITE_PATH);
  emit({ home: DATA_ROOT, docs: DOCS_ROOT, sqlite: SQLITE_PATH, tool: TOOL_ROOT }, () => {
    console.log(`data home  ${DATA_ROOT}      (yours: index, server files, documents \u2014 never versioned)`);
    console.log(`documents  ${path15.join(DOCS_ROOT, "<project>")}`);
    console.log(`tool       ${TOOL_ROOT}      (the checkout: rebuildable, safe to delete)`);
  });
}
function cmdAdd() {
  if (!args.positional[0]) {
    console.error("usage: aiview add <file.md> [--kind k] [--tag t]...");
    process.exit(1);
  }
  const index = openIndex();
  const d = index.register(path15.resolve(args.positional[0]), registerOpts());
  index.close();
  emit(d, docLine(d));
}
function cmdUpdate() {
  if (!args.positional[0]) {
    console.error("usage: aiview update <file|#id> [--kind k] [--tag t] [--untag t] [--group g|--ungroup] [--group-title T] [--started ISO]");
    process.exit(1);
  }
  if (args.flag("--project")) {
    console.error(`project is a directory, not metadata \u2014 use: aiview move ${args.positional[0]} --project <slug>`);
    process.exit(1);
  }
  const target = resolveRef(args.positional[0]);
  if (!target) {
    console.error(`not in index: ${args.positional[0]}`);
    process.exit(1);
  }
  const patch = {
    kind: args.flag("--kind"),
    addTags: args.flags("--tag"),
    removeTags: args.flags("--untag"),
    group: args.has("--ungroup") ? null : args.flag("--group") ?? void 0,
    groupTitle: args.flag("--group-title"),
    started: args.flag("--started")
  };
  const index = openIndex();
  const d = index.update(target.id, patch);
  index.close();
  emit(d, docLine(d));
}
function cmdList() {
  const want = args.flags("--tag");
  const wantKind = args.flag("--kind") ?? "";
  if (args.has("--all")) {
    console.error("list --all is gone (board-split D41): every list is one project's; pass --project <slug> for another");
    process.exit(1);
  }
  const index = openIndex();
  const scope = projectOfVerb(index);
  if (scope === null) {
    const known = index.allProjects().map((p) => p.slug);
    index.close();
    console.error(noProjectLine(known));
    process.exit(1);
  }
  const docs = index.all().filter(
    (d) => d.project === scope && (!wantKind || d.kind === wantKind) && (!want.length || want.every((t) => d.tags.includes(t)))
  );
  index.close();
  emit(docs, () => {
    for (const d of docs)
      console.log(
        `started ${d.created_at}  ${d.kind.padEnd(12)} [${d.tags.join(", ")}]  ${d.title}${d.exists ? "" : "  (missing)"}
    ${d.file_path}`
      );
  });
}
function cmdRemove() {
  if (!args.positional.length) {
    console.error("usage: aiview remove <file|#id>...");
    process.exit(1);
  }
  const index = openIndex();
  const removed = [];
  for (const ref of args.positional) {
    const row = /^#?\d+$/.test(ref) ? index.get(Number(ref.replace("#", ""))) : index.getByPath(path15.resolve(ref));
    if (!row) {
      console.error(`not in index: ${ref}`);
      continue;
    }
    index.remove(row.id);
    removed.push(row);
    if (!asJson) console.log(`removed #${row.id}  ${row.title}  (file untouched)`);
  }
  index.close();
  if (asJson) console.log(JSON.stringify({ removed }));
}
function cmdProject() {
  const sub = args.positional[0] ?? "list";
  const index = openIndex();
  try {
    if (sub === "list") {
      const projects = index.allProjects();
      const docs = index.all();
      const here = projectForCwd(process.cwd(), projects)?.slug ?? null;
      const count = (slug2) => docs.filter((d) => d.project === slug2).length;
      emit(
        projects.map((p) => ({ ...p, documents: count(p.slug), here: p.slug === here })),
        () => {
          for (const p of projects)
            console.log(
              `${p.slug === here ? "*" : " "} ${p.slug.padEnd(14)} ${String(count(p.slug)).padStart(3)} docs  ${docsDirFor(p.slug)}${p.paths.length ? `
    covers ${p.paths.join(", ")}` : ""}`
            );
        }
      );
      return;
    }
    const slug = args.positional[1];
    if (!slug) {
      console.error(`usage: aiview project ${sub} <slug>`);
      process.exit(1);
    }
    if (sub === "add") {
      const p = index.upsertProject(slug, { title: args.flag("--title"), addPaths: args.flags("--path").map((p2) => path15.resolve(p2)) });
      fs13.mkdirSync(docsDirFor(slug), { recursive: true });
      emit({ ...p, docs: docsDirFor(slug) }, `${p.slug}  ${docsDirFor(slug)}${p.paths.length ? `
  covers ${p.paths.join(", ")}` : ""}`);
      return;
    }
    if (sub === "rm") {
      const r = index.removeProject(slug);
      if (!r.removed) {
        console.error(
          r.documents > 0 ? `${slug} still has ${r.documents} document${r.documents === 1 ? "" : "s"}. Move or remove them first.` : `no such project: ${slug}`
        );
        process.exit(1);
      }
      emit(r, `removed project ${slug}  (its directory is left on disk)`);
      return;
    }
    console.error("usage: aiview project <add|list|rm> [slug] [--title T] [--path P]...");
    process.exit(1);
  } finally {
    index.close();
  }
}
function moveAcrossVolumes(from, to) {
  try {
    fs13.renameSync(from, to);
  } catch (e) {
    if (e.code !== "EXDEV") throw e;
    fs13.cpSync(from, to, { recursive: true });
    fs13.rmSync(from, { recursive: true });
  }
}
function cmdMove() {
  if (!args.positional.length) {
    console.error("usage: aiview move <file|#id>... [--project <slug>]");
    process.exit(1);
  }
  const target = args.flag("--project");
  const index = openIndex();
  if (target && !index.allProjects().some((p) => p.slug === target)) {
    const known = index.allProjects().map((p) => p.slug);
    console.error(`no such project: ${target}${known.length ? `
known: ${known.join(", ")}` : ""}`);
    index.close();
    process.exit(1);
  }
  const moved = [];
  for (const ref of args.positional) {
    const row = /^#?\d+$/.test(ref) ? index.get(Number(ref.replace("#", ""))) : index.getByPath(path15.resolve(ref));
    if (!row) {
      console.error(`not in index: ${ref}`);
      continue;
    }
    const from = row.abs_path;
    const dir = docsDirFor(target ?? row.project);
    const dest = path15.join(dir, path15.basename(from));
    if (dest === from) {
      console.error(`already there: ${from}`);
      continue;
    }
    const sidecarFrom = sidecarOf(from);
    const sidecarDest = sidecarOf(dest);
    const carriesSidecar = sidecarFrom !== null && fs13.existsSync(sidecarFrom);
    const orphaned = !fs13.existsSync(from) && fs13.existsSync(dest);
    if (!fs13.existsSync(from) && !orphaned) {
      console.error(`missing file, not moved: ${from}`);
      continue;
    }
    if (!orphaned) {
      const taken = [dest, ...carriesSidecar ? [sidecarDest] : []].filter((p) => fs13.existsSync(p));
      if (taken.length) {
        const named = carriesSidecar ? `${dest} and ${sidecarDest}` : dest;
        console.error(`target exists (${taken.join(", ")}), skipped: ${named}`);
        continue;
      }
    }
    fs13.mkdirSync(dir, { recursive: true });
    if (!orphaned) {
      moveAcrossVolumes(from, dest);
      if (carriesSidecar) moveAcrossVolumes(sidecarFrom, sidecarDest);
    }
    const d = index.move(row.id, dest);
    moved.push(d);
    if (!asJson) console.log(`moved #${d.id}  ${from}
           -> ${dest}`);
  }
  index.close();
  if (asJson) console.log(JSON.stringify({ moved }));
}
function cmdOpen() {
  if (!args.positional[0]) {
    console.error("usage: aiview open <file> [--kind k] [--tag t]... [--group g] [--port p] [--open]");
    process.exit(1);
  }
  ensureDist();
  const index = openIndex();
  const d = index.register(path15.resolve(args.positional[0]), registerOpts());
  recordRecentProject(index, d.project);
  const project = projectForCwd(process.cwd(), index.allProjects())?.slug ?? d.project;
  index.close();
  const port = portOfInstalledServer();
  const url = `http://localhost:${port}/#doc=${d.id}`;
  const answer = askServer("/api/open", { id: d.id, project });
  const moved = answer === null ? null : JSON.parse(answer);
  if (!moved && args.has("--open")) {
    const [c, a] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
    try {
      spawn4(c, a, { detached: true, stdio: "ignore" }).unref();
    } catch {
    }
  }
  emit({ id: d.id, url, project, tabs: moved?.tabs ?? 0, opened: moved?.opened ?? false, server: readServerStatus() }, moved ? [url, movedLine(moved, project, "opened")].join("\n") : url);
}
function cmdBoard() {
  const index = openIndex();
  try {
    const slug = args.flag("--project") ?? projectForCwd(process.cwd(), index.allProjects())?.slug ?? null;
    if (!slug) {
      console.error(`no aiview project for ${process.cwd()}: declare one with aiview project add <slug> --path <dir>, or pass --project`);
      process.exit(1);
    }
    const repo = args.flag("--repo");
    if (repo === void 0 && !index.allProjects().some((p) => p.slug === slug)) {
      console.error(`no such project: ${slug}`);
      process.exit(1);
    }
    const repos = repo === void 0 ? index.boardRepos(slug) : index.addBoardRepo(slug, repo);
    recordRecentProject(index, slug);
    ensureDist();
    const url = `http://localhost:${portOfInstalledServer()}/${boardHash(slug)}`;
    if (args.has("--open")) {
      const [c, a] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
      try {
        spawn4(c, a, { detached: true, stdio: "ignore" }).unref();
      } catch {
      }
    }
    emit({ project: slug, repos, url, server: readServerStatus() }, [url, ...repos.map((x) => `  ${x}`)].join("\n"));
  } finally {
    index.close();
  }
}
async function cmdServe() {
  if (args.has("--detach")) {
    ensureDist();
    if (args.positional[0]) {
      const index2 = openIndex();
      index2.register(path15.resolve(args.positional[0]), registerOpts());
      index2.close();
    }
    const port = portOfInstalledServer();
    emit({ server: readServerStatus() }, `aiview server up on http://localhost:${port}/`);
    return;
  }
  ensureDist();
  const { startServer: startServer2 } = await init_server().then(() => server_exports);
  const index = openIndex();
  const startDoc = args.positional[0] ? index.register(path15.resolve(args.positional[0]), registerOpts()) : null;
  startServer2(index, {
    port: Number(args.flag("--port") ?? process.env.AIVIEW_PORT ?? defaultPort()),
    open: args.has("--open"),
    startDoc
  });
}
function cmdPending() {
  const sub = args.positional[0];
  const index = openIndex();
  const needDoc = (ref2) => {
    if (!ref2) {
      console.error("usage: aiview pending <add|done|list|clear> ...");
      process.exit(1);
    }
    const doc = resolveRef(ref2);
    if (!doc) {
      console.error(`no such document: ${ref2}`);
      process.exit(1);
    }
    return doc;
  };
  if (sub === "add") {
    const doc = needDoc(args.positional[1]);
    const label = args.flag("--label");
    if (!label) {
      console.error("usage: aiview pending add <file|#id> --label L [--note N]");
      process.exit(1);
    }
    const id = index.addPending(doc.id, label, args.flag("--note") ?? "");
    index.close();
    notifyPendingChanged(doc.id);
    emit({ id, document: doc.id, label }, `pending #${id}  ${label}  (doc #${doc.id})`);
    return;
  }
  if (sub === "done") {
    const raw = (args.positional[1] ?? "").replace(/^#/, "");
    const id = Number(raw);
    if (!raw || Number.isNaN(id)) {
      console.error("usage: aiview pending done <#pendingId>");
      process.exit(1);
    }
    const docId = index.donePending(id);
    index.close();
    if (docId === null) {
      console.error(`no such pending item: #${id}`);
      process.exit(1);
    }
    notifyPendingChanged(docId);
    emit({ id, document: docId }, `done #${id}`);
    return;
  }
  if (sub === "clear") {
    const doc = needDoc(args.positional[1]);
    index.clearPending(doc.id);
    index.close();
    notifyPendingChanged(doc.id);
    emit({ document: doc.id, cleared: true }, `cleared pending for #${doc.id}`);
    return;
  }
  const ref = args.positional[1];
  const rows = ref ? index.pendingFor(needDoc(ref).id) : index.allPending();
  index.close();
  emit(rows, () => {
    if (!rows.length) return console.log("nothing pending");
    for (const r of rows) console.log(`#${r.id}  doc #${r.document_id}  ${r.label}${r.note ? ` \u2014 ${r.note}` : ""}  since ${r.started_at}`);
  });
}
function cmdTracker() {
  const mode = args.positional[0] === "sync" ? "sync" : "check";
  const ref = args.positional[1] ?? (args.positional[0] === "check" || args.positional[0] === "sync" ? void 0 : args.positional[0]);
  if (!ref) {
    console.error("usage: aiview tracker <check|sync> <file|#id>");
    process.exit(1);
  }
  const abs = resolveRef(ref)?.abs_path ?? path15.resolve(ref);
  if (!fs13.existsSync(abs)) {
    console.error(`no such file: ${abs}`);
    process.exit(1);
  }
  const raw = fs13.readFileSync(abs, "utf8");
  const body = raw.split(CRLF).join(LF);
  const tracker = findTracker(body);
  if (!tracker) {
    console.error(`no tracker in ${path15.basename(abs)}: no mermaid block whose nodes open with \u2705 \u25B6 \u23F8 \u2B1C \u2716`);
    process.exit(1);
  }
  if (mode === "sync") {
    const crlf = raw.includes(CRLF);
    const { text, changed } = sync(body, tracker);
    if (changed) {
      const tmp = `${abs}.aiview-${process.pid}`;
      fs13.writeFileSync(tmp, crlf ? text.split(LF).join(CRLF) : text, "utf8");
      fs13.renameSync(tmp, abs);
    }
    const after = findTracker(text);
    const left = after ? check(after) : [];
    emit(
      { file: path15.basename(abs), changed, findings: left.length },
      () => console.log(
        changed ? `synced ${path15.basename(abs)}: the class lines now follow the glyphs${left.length ? `, ${left.length} finding(s) remain` : ""}` : `nothing to sync: the class lines already follow the glyphs`
      )
    );
    if (left.length) process.exit(1);
    return;
  }
  const findings = check(tracker);
  emit({ file: path15.basename(abs), nodes: tracker.nodes.length, findings }, () => {
    if (!findings.length) return console.log(`ok  ${tracker.nodes.length} steps, glyphs and classes agree`);
    for (const f of findings) console.log(`line ${f.line}  ${f.text}`);
    console.log(`${findings.length} finding(s) in ${tracker.nodes.length} steps`);
  });
  if (findings.length) process.exit(1);
}
function cmdPlan() {
  const ref = args.positional[0] === "check" ? args.positional[1] : args.positional[0];
  if (!ref) {
    console.error("usage: aiview plan check <file|#id>");
    process.exit(1);
  }
  const abs = resolveRef(ref)?.abs_path ?? path15.resolve(ref);
  if (!fs13.existsSync(abs)) {
    console.error(`no such file: ${abs}`);
    process.exit(1);
  }
  const plan = readApproval(fs13.readFileSync(abs, "utf8").split(CRLF).join(LF));
  const findings = check2(plan);
  emit(
    {
      file: path15.basename(abs),
      approved: plan.approved,
      decisions: plan.decisions.length,
      defaults: plan.defaults.map((d) => ({ id: d.id, kind: d.kind, line: d.line })),
      confirmed: plan.confirmed ?? null,
      findings
    },
    () => {
      for (const f of findings) console.log(`warn  line ${f.line}  ${f.text}`);
      const state = plan.approved ? "approved" : "not approved";
      const tail = !plan.defaults.length ? "no agent defaults" : plan.approved ? `${plan.defaults.length} agent default(s), ${findings.length ? "not all confirmed" : "all confirmed"}` : `${plan.defaults.length} agent default(s) to list at approval: ${plan.defaults.map((d) => d.id).join(", ")}`;
      console.log(`${findings.length ? "warn" : "ok"}  ${state}, ${plan.decisions.length} decisions, ${tail}`);
    }
  );
}
async function runVerb() {
  switch (args.verb) {
    case "pending":
      cmdPending();
      break;
    case "status":
      cmdStatus();
      break;
    case "path":
      cmdPath();
      break;
    case "init":
      cmdInit();
      break;
    case "components":
      cmdComponents();
      break;
    case "show":
      cmdShow();
      break;
    case "check":
      cmdCheck();
      break;
    case "mermaid-check":
      await cmdMermaidCheck();
      break;
    case "tracker":
      cmdTracker();
      break;
    case "plan":
      cmdPlan();
      break;
    case "add":
      cmdAdd();
      break;
    case "update":
      cmdUpdate();
      break;
    case "list":
      cmdList();
      break;
    case "remove":
      cmdRemove();
      break;
    case "move":
      cmdMove();
      break;
    case "project":
      cmdProject();
      break;
    case "use":
      console.error("aiview use is gone (board-split D41): each verb takes its project from this directory or --project <slug>, and each tab keeps its own");
      process.exit(1);
      break;
    case "open":
      cmdOpen();
      break;
    case "serve":
      await cmdServe();
      break;
    case "board":
      cmdBoard();
      break;
    default:
      console.error(USAGE);
      process.exit(1);
  }
}
try {
  await runVerb();
} catch (err) {
  if (process.env.AIVIEW_DEBUG === "1") throw err;
  console.error(`aiview ${args.verb}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
if (MUTATES_INDEX.has(args.verb ?? "")) notifyIndexChanged();
