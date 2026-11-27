// The verbs of the document index: register, open, update, list, remove and refile.
import fs from "node:fs";
import path from "node:path";
import { type Document, type UpdatePatch } from "../../core/db.ts";
import { sidecarOf } from "../../core/paths.ts";
import { projectForCwd } from "../../core/projects.ts";
import { docsDirFor } from "../../core/home.ts";
import { readServerStatus } from "../../core/serverstate.ts";
import { openBrowser } from "../../core/browser.ts";
import { fail, noProjectLine, noSuchProjectLine, projectOfVerb, resolveRef, rowOf, type VerbContext } from "../context.ts";
import { askServerToMove, ensureDist, movedLine, noBrowserLine, portOfInstalledServer, recordRecentProject } from "../server.ts";
import { verbUsage } from "../usage.ts";
import type { Verb } from "../dispatch.ts";

const docLine = (d: Document): string =>
  `#${d.id}  ${d.kind} [${d.tags.join(", ")}]${d.group_slug ? `  group:${d.group_slug}` : ""}  started ${d.created_at}  ${d.title}`;

function runOpen(ctx: VerbContext): void {
  const { args, emit, registerOpts } = ctx;
  if (!args.positional[0]) fail(verbUsage("open"));
  ensureDist();
  const index = ctx.index();
  const d = index.register(path.resolve(args.positional[0]), registerOpts());
  // the project shown last, for a new tab (D41); the tabs it moves are the server's /api/open answer
  recordRecentProject(index, d.project);
  const project = projectForCwd(process.cwd(), index.allProjects())?.slug ?? d.project;
  const port = portOfInstalledServer(args.flag("--port"));
  const url = `http://localhost:${port}/#doc=${d.id}`;
  // the tabs on the agent's project go to it; none there, the server opens one (D41)
  const moved = askServerToMove("/api/open", { id: d.id, project });
  // no server answered: --open opens the browser from here, under the same refusal
  const localRefusal = !moved && args.has("--open") ? openBrowser(url) : undefined;
  const answerLine = moved ? movedLine(moved, project, "opened") : localRefusal ? noBrowserLine(project, localRefusal) : null;
  emit(
    {
      id: d.id,
      url,
      project,
      tabs: moved?.tabs ?? 0,
      opened: moved?.opened ?? localRefusal === null,
      browserRefusal: moved?.browserRefusal ?? localRefusal ?? null,
      server: readServerStatus(),
    },
    answerLine ? [url, answerLine].join("\n") : url,
  );
}

function runAdd(ctx: VerbContext): void {
  const { args, emit, registerOpts } = ctx;
  if (!args.positional[0]) fail(verbUsage("add"));
  const d = ctx.index().register(path.resolve(args.positional[0]), registerOpts());
  emit(d, docLine(d));
}

function runUpdate(ctx: VerbContext): void {
  const { args, emit } = ctx;
  if (!args.positional[0]) fail(verbUsage("update"));
  // Kind, tags and group are metadata; project is a directory. Silently ignoring
  // --project here would look like it worked.
  if (args.flag("--project")) fail(`project is a directory, not metadata — use: aiview move ${args.positional[0]} --project <slug>`);
  const target = resolveRef(args.positional[0]) ?? fail(`not in index: ${args.positional[0]}`);
  const patch: UpdatePatch = {
    kind: args.flag("--kind"),
    addTags: args.flags("--tag"),
    removeTags: args.flags("--untag"),
    group: args.has("--ungroup") ? null : (args.flag("--group") ?? undefined),
    groupTitle: args.flag("--group-title"),
    started: args.flag("--started"),
  };
  const d = ctx.index().update(target.id, patch)!;
  emit(d, docLine(d));
}

function runList(ctx: VerbContext): void {
  const { args, emit } = ctx;
  const want = args.flags("--tag");
  const wantKind = args.flag("--kind") ?? "";
  if (args.has("--all")) fail("list --all is gone: every list is one project's; pass --project <slug> for another");
  const index = ctx.index();
  // one project's documents (D41): --project, else this directory's
  const scope = projectOfVerb(args, index) ?? fail(noProjectLine(index.allProjects().map((p) => p.slug)));
  const docs = index
    .all()
    .filter((d) => d.project === scope && (!wantKind || d.kind === wantKind) && (!want.length || want.every((t) => d.tags.includes(t))));
  emit(docs, () => {
    for (const d of docs)
      console.log(
        `started ${d.created_at}  ${d.kind.padEnd(12)} [${d.tags.join(", ")}]  ${d.title}${d.exists ? "" : "  (missing)"}\n    ${d.file_path}`,
      );
  });
}

function runRemove(ctx: VerbContext): void {
  const { args, asJson } = ctx;
  if (!args.positional.length) fail(verbUsage("remove"));
  const index = ctx.index();
  const removed: Document[] = [];
  for (const ref of args.positional) {
    const row = rowOf(index, ref);
    if (!row) {
      console.error(`not in index: ${ref}`);
      continue;
    }
    index.remove(row.id);
    removed.push(row);
    if (!asJson) console.log(`removed #${row.id}  ${row.title}  (file untouched)`);
  }
  if (asJson) console.log(JSON.stringify({ removed }));
}

/** Rename a file or folder; on another volume (EXDEV), copy it recursively and then
 *  drop the original. Any other error (EPERM on a held file) is thrown, not retried. */
function moveAcrossVolumes(from: string, to: string): void {
  try {
    fs.renameSync(from, to);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
    fs.cpSync(from, to, { recursive: true });
    fs.rmSync(from, { recursive: true });
  }
}

/** Why one document cannot move to `dest`, or null when it can. A workbench carries its
 *  sidecar `<stem>/` with it; the sidecar is never in the index. */
function moveRefusal(from: string, dest: string, orphaned: boolean): string | null {
  if (dest === from) return `already there: ${from}`;
  if (!fs.existsSync(from) && !orphaned) return `missing file, not moved: ${from}`;
  if (orphaned) return null;
  const sidecarFrom = sidecarOf(from);
  const sidecarDest = sidecarOf(dest);
  const carriesSidecar = sidecarFrom !== null && fs.existsSync(sidecarFrom);
  const taken = [dest, ...(carriesSidecar ? [sidecarDest!] : [])].filter((p) => fs.existsSync(p));
  if (!taken.length) return null;
  return `target exists (${taken.join(", ")}), skipped: ${carriesSidecar ? `${dest} and ${sidecarDest}` : dest}`;
}

/** Refile a document: `--project` puts it in another project, bare pulls a stray back
 *  into its own project's directory. The project IS the directory (D14), so this is
 *  the only way to reclassify one — and the caller names a project, never a path. */
function runMove(ctx: VerbContext): void {
  const { args, asJson } = ctx;
  if (!args.positional.length) fail(verbUsage("move"));
  const index = ctx.index();
  const target = args.flag("--project");
  if (target && !index.allProjects().some((p) => p.slug === target)) fail(noSuchProjectLine(target, index.allProjects().map((p) => p.slug)));
  const moved: Document[] = [];
  for (const ref of args.positional) {
    const row = rowOf(index, ref);
    if (!row) {
      console.error(`not in index: ${ref}`);
      continue;
    }
    const from = row.abs_path;
    const dir = docsDirFor(target ?? row.project);
    const dest = path.join(dir, path.basename(from));
    // File already at the destination with a stale row: a previous run moved the
    // file (and its sidecar, if it had one) and then failed to write the index.
    // Re-point the row and carry on.
    const orphaned = dest !== from && !fs.existsSync(from) && fs.existsSync(dest);
    const refusal = moveRefusal(from, dest, orphaned);
    if (refusal) {
      console.error(refusal);
      continue;
    }
    fs.mkdirSync(dir, { recursive: true });
    if (!orphaned) {
      moveAcrossVolumes(from, dest);
      const sidecarFrom = sidecarOf(from);
      if (sidecarFrom !== null && fs.existsSync(sidecarFrom)) moveAcrossVolumes(sidecarFrom, sidecarOf(dest)!);
    }
    const d = index.move(row.id, dest)!;
    moved.push(d);
    if (!asJson) console.log(`moved #${d.id}  ${from}\n           -> ${dest}`);
  }
  if (asJson) console.log(JSON.stringify({ moved }));
}

export const DOCUMENT_VERBS: Verb[] = [
  { name: "open", help: "listed", needs: { index: true }, mutatesIndex: true, run: runOpen },
  { name: "add", help: "listed", needs: { index: true }, mutatesIndex: true, run: runAdd },
  { name: "update", help: "listed", needs: { index: true }, mutatesIndex: true, run: runUpdate },
  { name: "list", help: "listed", needs: { index: true }, run: runList },
  { name: "remove", help: "listed", needs: { index: true }, mutatesIndex: true, run: runRemove },
  { name: "move", help: "listed", needs: { index: true }, mutatesIndex: true, run: runMove },
];
