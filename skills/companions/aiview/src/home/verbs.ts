// The verbs of the data home: where everything lives, and where a document belongs.
import fs from "node:fs";
import path from "node:path";
import { SQLITE_PATH, TOOL_ROOT } from "../store/index-db.ts";
import { projectForCwd } from "../store/projects.ts";
import { DATA_ROOT, docsDirFor, DOCS_ROOT, ensureHome } from "../host/home.ts";
import { readServerStatus } from "../host/serverstate.ts";
import { fail, noProjectLine, noSuchProjectLine, projectOfVerb, resolveRef, withIndex, type VerbContext } from "../cli/context.ts";
import { verbUsage } from "../cli/usage.ts";
import type { Verb } from "../cli/dispatch.ts";

function runStatus(ctx: VerbContext): void {
  const index = ctx.index();
  const documents = index.all().length;
  // Which project the agent is standing in, if any project claims this directory: where it writes (D14, D41).
  const cwdProject = projectForCwd(process.cwd(), index.allProjects())?.slug ?? null;
  const project = cwdProject;
  const projectDocs = cwdProject === null ? null : docsDirFor(cwdProject);
  const server = readServerStatus();
  ctx.emit({ home: DATA_ROOT, docs: DOCS_ROOT, project, projectDocs, cwdProject, sqlite: SQLITE_PATH, tool: TOOL_ROOT, documents, server }, () => {
    console.log(`home       ${DATA_ROOT}`);
    console.log(`docs       ${DOCS_ROOT}`);
    console.log(`project    ${project ?? "(none for this directory: pass --project)"}`);
    if (projectDocs) console.log(`write to   ${projectDocs}`);
    console.log(`sqlite     ${SQLITE_PATH}`);
    console.log(`tool       ${TOOL_ROOT}`);
    console.log(`documents  ${documents}`);
    console.log(
      `server     ${server.running ? `up (pid ${server.pid}, port ${server.port}, version ${server.version ?? "unrecorded"})` : server.stale ? "down (stale pidfile)" : "down"}`,
    );
  });
}

/** Where a document with this name belongs. The tool joins the path — with this OS's
 *  separator, under this machine's home — so no caller ever builds one by hand. */
function runPath({ args, emit }: VerbContext): void {
  const name = args.positional[0] || fail(verbUsage("path"));
  // board-fixes plan, its "small" row: a registered doc's id (`#<n>` or a bare number) names its file, whatever the project
  if (/^#?\d+$/.test(name)) {
    const doc = resolveRef(name) ?? fail(`no document ${name.startsWith("#") ? name : `#${name}`} in the index`);
    emit({ path: doc.abs_path, dir: path.dirname(doc.abs_path), project: doc.project }, doc.abs_path);
    return;
  }
  const { slug, known } = withIndex((index) => ({ slug: projectOfVerb(args, index), known: index.allProjects().map((p) => p.slug) }));
  if (slug === null) fail(noProjectLine(known));
  if (!known.includes(slug)) fail(noSuchProjectLine(slug, known));
  const dir = docsDirFor(slug);
  fs.mkdirSync(dir, { recursive: true });
  const full = path.join(dir, path.basename(name)); // basename: a name, not a path
  emit({ path: full, dir, project: slug }, full);
}

/** First clone / new machine: make the data home exist and say what lives where. */
function runInit({ emit }: VerbContext): void {
  ensureHome();
  emit({ home: DATA_ROOT, docs: DOCS_ROOT, sqlite: SQLITE_PATH, tool: TOOL_ROOT }, () => {
    console.log(`data home  ${DATA_ROOT}      (yours: index, server files, documents — never versioned)`);
    console.log(`documents  ${path.join(DOCS_ROOT, "<project>")}`);
    console.log(`tool       ${TOOL_ROOT}      (the checkout: rebuildable, safe to delete)`);
  });
}

export const HOME_VERBS: Verb[] = [
  { name: "status", help: "listed", needs: { index: true }, run: runStatus },
  { name: "path", help: "listed", run: runPath },
  { name: "init", help: "listed", run: runInit },
];
