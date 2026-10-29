// The index — the ONLY module that sees SQL (spec A7). Everything else calls the
// typed functions returned by openIndex().
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { commonGitDir } from "../../../swarm-board/src/place/place.ts";
import { adoptLegacyIndex, DATA_ROOT, DOCS_ROOT, ensureHome } from "./home.ts";
import { resolveProject, type Project } from "./projects.ts";
import {
  formatOf,
  currentKind,
  isPdf,
  kindFromName,
  projectRoot,
  readDoc,
  titleOf,
  toAbs,
  toStored,
  type DocFormat,
} from "./paths.ts";

// node:sqlite prints an ExperimentalWarning on import; keep every other warning.
process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (w.name !== "ExperimentalWarning") console.warn(w);
});
const { DatabaseSync } = await import("node:sqlite");

/** Tool root: where the code and its build output live (app/, dist/, dist-cli/).
 *  The launcher sets AIVIEW_ROOT; the fallback walks up from this module to the
 *  directory holding package.json, which covers both dist-cli/cli.mjs and direct
 *  src/ execution (tests). User data does NOT live here — see core/home.ts. */
function findToolRoot(): string {
  if (process.env.AIVIEW_ROOT) return process.env.AIVIEW_ROOT;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return dir;
    dir = parent;
  }
}
export const TOOL_ROOT = findToolRoot();
export const SQLITE_PATH = path.join(DATA_ROOT, "aiview.sqlite");
/** Stored paths are relative to the data home when inside it — so a synced home
 *  carries a working index to another machine — and absolute anywhere else. */
export const STORE_ROOT = DATA_ROOT;

export interface Document {
  id: number;
  file_path: string; // stored form: posix-relative to root when inside it
  abs_path: string;
  project: string;
  title: string | null;
  kind: string;
  tags: string[];
  /** Exclusive membership: at most one group per doc. null = ungrouped. */
  group_slug: string | null;
  /** Pinned by the person: shown in the viewer's menu under its kind. */
  pinned: boolean;
  created_at: string;
  last_seen_at: string;
}

/** One unit of work a document is still waiting on. */
export interface Pending {
  id: number;
  document_id: number;
  /** Short name of the worker, e.g. "Intent axis". */
  label: string;
  /** One line on what it is actually doing. */
  note: string;
  started_at: string;
}

export interface Group {
  slug: string;
  /** Display title; falls back to the slug in the UI. */
  title: string | null;
}

export interface DocumentWithState extends Document {
  exists: boolean;
  /** The file's own mtime: the honest "last changed". `last_seen_at` is index
   *  bookkeeping and gets bumped by re-registering or moving a document, which must
   *  not make a year-old board look like today's work. null when the file is gone. */
  updated_at: string | null;
  format: DocFormat;
}

export interface RegisterOptions {
  kind?: string;
  tags?: string[];
  started?: string;
  group?: string;
  groupTitle?: string;
  /** Explicit --project; wins over every other resolution rule. */
  project?: string;
}

/** The repositories a board document's text names: `{ repos }`, or a pre-merge `{ url }`'s
 *  `?repo=` values; [] when it names none or cannot be read. */
export function boardReposInText(text: string): string[] {
  let parsed: { repos?: unknown; url?: unknown };
  try {
    parsed = JSON.parse(text) as { repos?: unknown; url?: unknown };
  } catch {
    return [];
  }
  if (Array.isArray(parsed.repos)) return [...new Set(parsed.repos.filter((x): x is string => typeof x === "string"))];
  if (typeof parsed.url === "string") {
    try {
      return [...new Set(new URL(parsed.url).searchParams.getAll("repo"))];
    } catch {
      return [];
    }
  }
  return [];
}

interface Row {
  id: number;
  file_path: string;
  project: string;
  title: string | null;
  kind: string;
  tags: string;
  group_slug: string | null;
  pinned: number;
  created_at: string;
  last_seen_at: string;
}

const now = () => new Date().toISOString();

export interface UpdatePatch {
  kind?: string;
  addTags?: string[];
  removeTags?: string[];
  /** string = set (creates the group), null = ungroup, undefined = keep. */
  group?: string | null;
  groupTitle?: string;
  started?: string;
}

export interface Index {
  register(absFile: string, opts?: RegisterOptions): Document;
  update(id: number, patch: UpdatePatch): Document | undefined;
  /** Re-point a row at a file that has already been moved on disk. */
  move(id: number, newAbs: string): Document | undefined;
  get(id: number): Document | undefined;
  getByPath(absFile: string): Document | undefined;
  all(): DocumentWithState[];
  allGroups(): Group[];
  /** Create the group if new; a non-empty title also renames it. */
  upsertGroup(slug: string, title?: string): Group;
  allProjects(): Project[];
  /** The repositories the project's board reads, in the order they were added. */
  boardRepos(slug: string): string[];
  /** Adds a repository to the project's board (the project is created if new); returns the list. */
  addBoardRepo(slug: string, repo: string): string[];
  /** Create the project if new; a non-empty title renames it, paths are merged in. */
  upsertProject(slug: string, patch?: { title?: string; addPaths?: string[] }): Project;
  /** Refused while documents still reference it: `documents` reports how many. */
  removeProject(slug: string): { removed: boolean; documents: number };
  /** The project a tab with none in its hash starts on, once (board-split#D41): the one a tab or an agent's
   *  `open` showed last, null when none or it was removed. Never a scope: no verb reads it. */
  recentProject(): string | null;
  recordRecentProject(slug: string): void;
  remove(id: number): boolean;
  touch(id: number): void;
  /** Pin or unpin a document; false when there is no such document. */
  setPinned(id: number, pinned: boolean): boolean;
  /** Register work the document is waiting on; returns the pending id. */
  addPending(documentId: number, label: string, note?: string): number;
  /** Finish one unit of work — the row is deleted. Returns its document id, or null. */
  donePending(id: number): number | null;
  clearPending(documentId: number): void;
  pendingFor(documentId: number): Pending[];
  allPending(): Pending[];
  close(): void;
}

export function openIndex(dbPath: string = SQLITE_PATH, root: string = STORE_ROOT): Index {
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
  // Schema upkeep for indexes created by earlier versions.
  const cols = (db.prepare("PRAGMA table_info(documents)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("tags")) db.exec("ALTER TABLE documents ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'");
  if (!cols.includes("kind")) db.exec("ALTER TABLE documents ADD COLUMN kind TEXT NOT NULL DEFAULT ''");
  if (!cols.includes("group_slug")) db.exec("ALTER TABLE documents ADD COLUMN group_slug TEXT");
  if (!cols.includes("pinned")) db.exec("ALTER TABLE documents ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
  db.exec("CREATE TABLE IF NOT EXISTS groups (slug TEXT PRIMARY KEY, title TEXT)");
  db.exec(
    "CREATE TABLE IF NOT EXISTS projects (slug TEXT PRIMARY KEY, title TEXT, paths TEXT NOT NULL DEFAULT '[]')",
  );
  db.exec("CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const projectCols = (db.prepare("PRAGMA table_info(projects)").all() as { name: string }[]).map((c) => c.name);
  if (!projectCols.includes("board_repos")) db.exec("ALTER TABLE projects ADD COLUMN board_repos TEXT NOT NULL DEFAULT '[]'");
  // the project is its repository: one board; a repo written as its folder or its .git, or gone from disk, is read once
  // D12: the `.git` of every path of the project that is a repository: the board's repos when none was registered yet
  // G6: a path that is a git worktree has a `.git` file pointing at its own git dir; the board keys the repository by the common one (Place, D5)
  const gitDirsOf = (pathsJson: string): string[] =>
    (JSON.parse(pathsJson) as string[])
      .map((p) => path.join(path.resolve(p), ".git"))
      .filter((g) => fs.existsSync(g))
      .map((g) => commonGitDir(g).split("\\").join("/"));
  const boardReposOf = (slug: string): string[] => {
    const row = db.prepare("SELECT board_repos, paths FROM projects WHERE slug = ?").get(slug) as { board_repos: string; paths: string } | undefined;
    if (!row) return [];
    const seen = new Set<string>();
    const repos: string[] = [];
    // a worktree's own `.git` (a file), stored before G6, reads as its repository's common git dir
    const keyed = (r: string): string => {
      const g = /[\\/]\.git$/i.test(r) ? r : path.join(r, ".git");
      return fs.existsSync(g) && fs.statSync(g).isFile() ? commonGitDir(g).split("\\").join("/") : r;
    };
    for (const r of [...(JSON.parse(row.board_repos) as string[]).map(keyed), ...(JSON.parse(row.board_repos).length === 0 ? gitDirsOf(row.paths) : [])]) {
      const folder = path.resolve(r).replace(/[\\/]\.git$/i, "");
      const key = process.platform === "win32" ? folder.toLowerCase() : folder;
      if (seen.has(key) || !fs.existsSync(folder)) continue;
      seen.add(key);
      repos.push(r);
    }
    return repos;
  };
  const addRepo = (slug: string, repo: string): string[] => {
    db.prepare("INSERT INTO projects (slug, title, paths) VALUES (?, NULL, '[]') ON CONFLICT(slug) DO NOTHING").run(slug);
    const repos = boardReposOf(slug);
    if (!repos.includes(repo)) repos.push(repo);
    db.prepare("UPDATE projects SET board_repos = ? WHERE slug = ?").run(JSON.stringify(repos), slug);
    return repos;
  };
  // Work still running behind a document the reader can already open. Deliberately the
  // only ephemeral state in the index: a row exists exactly while the work is pending,
  // and finishing means deleting it, so nothing accumulates and nothing needs cleaning.
  // It lives here rather than in the file because the file is the deliverable — a
  // "still working" placeholder left in a shared document is worse than no feature.
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

  // The board is aiview's /board page, no longer a document: a project's `swarm` document
  // (`swarm.swarm.json` { repos }, or a pre-merge { url }) gives its repositories to the
  // project and leaves the index. Its file stays on disk; nothing reads it again.
  for (const row of db.prepare("SELECT id, file_path, project FROM documents WHERE kind = 'swarm'").all() as {
    id: number;
    file_path: string;
    project: string;
  }[]) {
    let text = "";
    try {
      text = fs.readFileSync(toAbs(row.file_path, root), "utf8");
    } catch {
      // a missing file gives no repository; the row leaves all the same
    }
    for (const repo of boardReposInText(text)) addRepo(row.project, repo);
    db.prepare("DELETE FROM pending WHERE document_id = ?").run(row.id);
    db.prepare("DELETE FROM documents WHERE id = ?").run(row.id);
  }

  // The `mockup` kind is now `prototype`: its rows say so, its files keep their name on disk.
  db.prepare("UPDATE documents SET kind = 'prototype' WHERE kind = 'mockup'").run();

  const parse = (row: Row): Document => ({
    ...row,
    tags: JSON.parse(row.tags) as string[],
    pinned: row.pinned === 1,
    abs_path: toAbs(row.file_path, root),
  });

  interface ProjectRow {
    slug: string;
    title: string | null;
    paths: string;
  }
  const parseProject = (row: ProjectRow): Project => ({
    slug: row.slug,
    title: row.title,
    paths: JSON.parse(row.paths) as string[],
  });

  const upsertProject = (slug: string, patch: { title?: string; addPaths?: string[] } = {}): Project => {
    const existing = db.prepare("SELECT * FROM projects WHERE slug = ?").get(slug) as ProjectRow | undefined;
    const paths = [...new Set([...(existing ? (JSON.parse(existing.paths) as string[]) : []), ...(patch.addPaths ?? [])])];
    const title = patch.title || existing?.title || null;
    db.prepare(
      `INSERT INTO projects (slug, title, paths) VALUES (?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET title = excluded.title, paths = excluded.paths`,
    ).run(slug, title, JSON.stringify(paths));
    // D12: runs opened under these paths before the project was declared show up now
    for (const g of gitDirsOf(JSON.stringify(paths))) addRepo(slug, g);
    return parseProject(db.prepare("SELECT * FROM projects WHERE slug = ?").get(slug) as unknown as ProjectRow);
  };

  const upsertGroup = (slug: string, title?: string): Group => {
    db.prepare(
      `INSERT INTO groups (slug, title) VALUES (?, ?)
       ON CONFLICT(slug) DO UPDATE SET title = CASE WHEN excluded.title IS NOT NULL THEN excluded.title ELSE groups.title END`,
    ).run(slug, title ?? null);
    return db.prepare("SELECT * FROM groups WHERE slug = ?").get(slug) as unknown as Group;
  };

  return {
    register(absFile, { kind = "", tags: extraTags = [], started = "", group = "", groupTitle = "", project = "" } = {}) {
      if (!fs.existsSync(absFile)) throw new Error(`no such file: ${absFile}`);
      const file = toStored(absFile, root);
      const content = isPdf(absFile) ? "" : readDoc(absFile); // binary formats title by filename
      const existing = db.prepare("SELECT * FROM documents WHERE file_path = ?").get(file) as Row | undefined;
      const finalKind = currentKind(kind || existing?.kind || kindFromName(file));
      if (!finalKind)
        throw new Error(
          "kind is mandatory: name the file <name>.<kind>.md or pass --kind <kind> (e.g. brainstorm, prototype, pr-analysis)",
        );
      const tags = [...new Set([...(existing ? (JSON.parse(existing.tags) as string[]) : []), ...extraTags])].filter(
        (t) => t !== finalKind,
      );
      const t = now();
      // created_at = start of the work: first registration, or an explicit --started ISO date-time.
      const startedAt = started ? new Date(started).toISOString() : (existing?.created_at ?? t);
      const groupSlug = (group || existing?.group_slug || null) as string | null;
      if (group) upsertGroup(group, groupTitle || undefined);
      // Declared, not derived (D6/D8): projectRoot survives only as the last resort.
      const proj = resolveProject({
        explicit: project,
        absFile,
        docsRoot: DOCS_ROOT,
        existing: existing?.project,
        fallback: projectRoot(absFile),
      });
      upsertProject(proj); // never leave a document pointing at a project with no record
      db.prepare(
        `INSERT INTO documents (file_path, project, title, kind, tags, group_slug, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(file_path) DO UPDATE SET last_seen_at = excluded.last_seen_at, title = excluded.title,
           kind = excluded.kind, tags = excluded.tags, group_slug = excluded.group_slug,
           project = excluded.project, created_at = excluded.created_at`,
      ).run(file, proj, titleOf(content, absFile), finalKind, JSON.stringify(tags), groupSlug, startedAt, t);
      return parse(db.prepare("SELECT * FROM documents WHERE file_path = ?").get(file) as unknown as Row);
    },

    update(id, patch) {
      const row = db.prepare("SELECT * FROM documents WHERE id = ?").get(Number(id)) as Row | undefined;
      if (!row) return undefined;
      const kind = patch.kind ? currentKind(patch.kind) : row.kind;
      const tags = [
        ...new Set([...(JSON.parse(row.tags) as string[]), ...(patch.addTags ?? [])]),
      ].filter((t) => t !== kind && !(patch.removeTags ?? []).includes(t));
      const group = patch.group === undefined ? row.group_slug : patch.group;
      if (patch.group) upsertGroup(patch.group, patch.groupTitle || undefined);
      else if (patch.groupTitle && row.group_slug) upsertGroup(row.group_slug, patch.groupTitle);
      const createdAt = patch.started ? new Date(patch.started).toISOString() : row.created_at;
      db.prepare(
        "UPDATE documents SET kind = ?, tags = ?, group_slug = ?, created_at = ?, last_seen_at = ? WHERE id = ?",
      ).run(kind, JSON.stringify(tags), group, createdAt, now(), row.id);
      return parse(db.prepare("SELECT * FROM documents WHERE id = ?").get(row.id) as unknown as Row);
    },

    move(id, newAbs) {
      const row = db.prepare("SELECT * FROM documents WHERE id = ?").get(Number(id)) as Row | undefined;
      if (!row) return undefined;
      // Identity, start time, tags and group all survive: only the location changes.
      // Moving into <docs>/<slug>/ re-files the document under that project.
      const proj = resolveProject({
        absFile: newAbs,
        docsRoot: DOCS_ROOT,
        existing: row.project,
        fallback: projectRoot(newAbs),
      });
      upsertProject(proj);
      db.prepare("UPDATE documents SET file_path = ?, project = ?, last_seen_at = ? WHERE id = ?").run(
        toStored(newAbs, root),
        proj,
        now(),
        row.id,
      );
      return parse(db.prepare("SELECT * FROM documents WHERE id = ?").get(row.id) as unknown as Row);
    },

    get(id) {
      const row = db.prepare("SELECT * FROM documents WHERE id = ?").get(Number(id)) as Row | undefined;
      return row ? parse(row) : undefined;
    },

    getByPath(absFile) {
      const row = db.prepare("SELECT * FROM documents WHERE file_path = ?").get(toStored(absFile, root)) as
        | Row
        | undefined;
      return row ? parse(row) : undefined;
    },

    all() {
      return (db.prepare("SELECT * FROM documents ORDER BY created_at DESC, id DESC").all() as unknown as Row[])
        .map(parse)
        .map((d) => {
          // one stat answers both "is it there" and "when did it really change"
          let stat: fs.Stats | null = null;
          try {
            stat = fs.statSync(d.abs_path);
          } catch {
            stat = null;
          }
          return {
            ...d,
            exists: stat !== null,
            updated_at: stat ? new Date(stat.mtimeMs).toISOString() : null,
            format: formatOf(d.file_path),
          };
        });
    },

    allGroups() {
      return db.prepare("SELECT * FROM groups ORDER BY slug").all() as unknown as Group[];
    },

    upsertGroup,

    boardRepos(slug) {
      return boardReposOf(slug);
    },

    addBoardRepo(slug, repo) {
      return addRepo(slug, repo);
    },

    allProjects() {
      return (db.prepare("SELECT * FROM projects ORDER BY slug").all() as unknown as ProjectRow[]).map(parseProject);
    },

    upsertProject,

    removeProject(slug) {
      const { n } = db.prepare("SELECT COUNT(*) AS n FROM documents WHERE project = ?").get(slug) as unknown as {
        n: number;
      };
      if (n > 0) return { removed: false, documents: n };
      const info = db.prepare("DELETE FROM projects WHERE slug = ?").run(slug);
      return { removed: info.changes > 0, documents: 0 };
    },

    recentProject() {
      // the store key predates D41's widening, kept so an existing data home reads its last project
      const row = db.prepare("SELECT value FROM state WHERE key = 'active_project'").get() as { value: string } | undefined;
      if (!row) return null;
      return db.prepare("SELECT 1 FROM projects WHERE slug = ?").get(row.value) ? row.value : null;
    },

    recordRecentProject(slug) {
      db.prepare(
        "INSERT INTO state (key, value) VALUES ('active_project', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(slug);
    },

    addPending(documentId, label, note = "") {
      const started = new Date().toISOString();
      db.prepare("INSERT INTO pending (document_id, label, note, started_at) VALUES (?, ?, ?, ?)").run(
        documentId,
        label,
        note,
        started,
      );
      return Number(db.prepare("SELECT last_insert_rowid() AS id").get()!.id);
    },
    donePending(id) {
      const row = db.prepare("SELECT document_id FROM pending WHERE id = ?").get(id) as
        | { document_id: number }
        | undefined;
      if (!row) return null;
      db.prepare("DELETE FROM pending WHERE id = ?").run(id);
      return row.document_id;
    },
    clearPending(documentId) {
      db.prepare("DELETE FROM pending WHERE document_id = ?").run(documentId);
    },
    pendingFor(documentId) {
      return db
        .prepare("SELECT id, document_id, label, note, started_at FROM pending WHERE document_id = ? ORDER BY id")
        .all(documentId) as unknown as Pending[];
    },
    allPending() {
      return db
        .prepare("SELECT id, document_id, label, note, started_at FROM pending ORDER BY document_id, id")
        .all() as unknown as Pending[];
    },

    remove(id) {
      const row = db.prepare("SELECT id FROM documents WHERE id = ?").get(Number(id)) as { id: number } | undefined;
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
    },
  };
}
