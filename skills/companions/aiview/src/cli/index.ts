// CLI dispatch — the agent-facing surface. `open` is the standard gesture:
// ensure registered, ensure server, print URL. Unknown verbs fall to legacy
// (dies in Phase 8 cutover).
import { spawn, spawnSync } from "node:child_process"; // AGENTS EXCEPTION (D39): the raw starters of the lines marked so
import { hiddenSpawn, hiddenSpawnSync } from "../proc.ts";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ALL_PROJECTS,
  openIndex,
  SQLITE_PATH,
  TOOL_ROOT,
  type Document,
  type Index,
  type RegisterOptions,
  type UpdatePatch,
} from "../core/db.ts";
import { listComponents, resolveBindings } from "../core/bind.ts";
import { isHtml, readDoc, sidecarOf } from "../core/paths.ts";
import { pointerHash, isName, unknownNames } from "../core/pointer.ts";
import type { ShowResponse } from "../core/api.ts";
import { projectForCwd } from "../core/projects.ts";
import { boardHash } from "../core/boardhash.ts";
import { adoptLegacyIndex, DATA_ROOT, defaultPort, firstFreePort, docsDirFor, DOCS_ROOT, ensureHome } from "../core/home.ts";
import { readServerStatus, PORT_FILE, type ServerStatus } from "../core/serverstate.ts";
import { collectionVersion } from "../core/collectionversion.ts";
import { parseArgs } from "./args.ts";
import { disciplineWarnings } from "../mermaid/discipline.ts";
import { check as trackerCheck, findTracker, sync as trackerSync } from "../core/tracker.ts";
import { check as planCheck, readApproval } from "../core/plan.ts";

/** Line endings, named rather than written inline: a plan on Windows is CRLF and the
 *  tracker parser works in LF, so the file is normalised in and restored out. */
const LF = String.fromCharCode(10);
const CRLF = String.fromCharCode(13, 10);

const args = parseArgs(process.argv.slice(2));
const asJson = args.has("--json");

const USAGE = [
  "usage: aiview <verb> [--json]",
  "  open <file> [--kind k] [--tag t]... [--group g [--group-title T]] [--started ISO] [--port p] [--open]",
  "  add <file> [--kind k] [--tag t]... [--group g [--group-title T]] [--started ISO]",
  "  update <file|#id> [--kind k] [--tag t]... [--untag t]... [--group g|--ungroup] [--group-title T] [--started ISO]",
  "  list [--kind k] [--tag t]... [--project p | --all]   # defaults to the active project",
  "  project <add|list|rm> [slug] [--title T] [--path P]...",
  "  use <slug|*>                             # set the active project",
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
  "  init                                     # create the data home; report where everything lives",
].join("\n");

const registerOpts = (): RegisterOptions => ({
  kind: args.flag("--kind") ?? "",
  tags: args.flags("--tag"),
  started: args.flag("--started") ?? "",
  group: args.flag("--group") ?? "",
  groupTitle: args.flag("--group-title") ?? "",
  project: args.flag("--project") ?? "",
});

/** POST to the running server, synchronously (the CLI has no event loop to await on).
 *  false = no server, or it refused; the caller decides whether that matters. */
function postToServer(route: string, body: unknown): boolean {
  return askServer(route, body) !== null;
}

/** The same POST, with the server's answer: its body on a 200, null on anything else. */
function askServer(route: string, body: unknown): string | null {
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
       q.on('error',()=>process.exit(1));q.end(b);`,
    ],
    { timeout: 5000, encoding: "utf8" },
  );
  return r.status === 0 ? r.stdout : null;
}

/** Set the active project through the ONE write path: POST so the server writes the
 *  row and broadcasts in the same step. With no server there is nobody to tell, so
 *  writing the row directly is correct, not a fallback hack. */
function setActive(index: Index, slug: string): string {
  if (!postToServer("/api/active", { project: slug })) index.setActiveProject(slug);
  return slug;
}

/** Tell an open tab that one document's pending cards moved. Reuses the `changed`
 *  event, so the tab reloads through the path the file watcher already uses. */
function notifyPendingChanged(documentId: number): void {
  postToServer("/api/pending-changed", { id: documentId });
}

/** Tell an open tab that the document list moved. The CLI writes sqlite in its own
 *  process, so without this a newly registered document is invisible until a refresh. */
function notifyIndexChanged(): void {
  postToServer("/api/index-changed", {});
}

/** Verbs that change what the sidebar should be showing. */
const MUTATES_INDEX = new Set(["add", "open", "update", "remove", "move", "project", "board"]);

const docLine = (d: Document): string =>
  `#${d.id}  ${d.kind} [${d.tags.join(", ")}]${d.group_slug ? `  group:${d.group_slug}` : ""}  started ${d.created_at}  ${d.title}`;

const emit = (json: unknown, human: string | (() => void)): void => {
  if (asJson) console.log(JSON.stringify(json));
  else if (typeof human === "string") console.log(human);
  else human();
};

/** dist/ missing but the app source present -> build once; on failure, print the command. */
function ensureDist(): void {
  if (fs.existsSync(path.join(TOOL_ROOT, "dist", "index.html"))) return;
  if (!fs.existsSync(path.join(TOOL_ROOT, "app", "index.html"))) return; // no app source: legacy ui
  console.error("aiview: dist/ missing — building the UI once…");
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const r = spawnSync(npm, ["run", "build"], { cwd: TOOL_ROOT, stdio: "inherit", shell: process.platform === "win32" });  // AGENTS EXCEPTION (D39): the person watches the build's output in this console
  if (r.status !== 0) {
    console.error(`aiview: UI build failed. Run: npm install && npm run build  (in ${TOOL_ROOT})`);
    process.exit(1);
  }
}

/** Spawn a detached server and wait for its portfile. Returns the actual port. */
function spawnDetachedServer(port: number): number {
  try {
    fs.rmSync(PORT_FILE, { force: true });
  } catch {}
  // re-invoke the current entry (aiview.mjs in real use, the TS source under test)
  const child = hiddenSpawn(process.execPath, [process.argv[1], "serve", "--port", String(port)], {
    detached: true,
    stdio: "ignore",
    cwd: TOOL_ROOT,
  });
  child.unref();
  const t0 = Date.now();
  for (;;) {
    const st = readServerStatus();
    if (st.running && st.port !== null) return st.port;
    if (Date.now() - t0 > 10_000) {
      console.error(`aiview: server did not come up within 10s (port ${port} may be in use — retry with --port <n>)`);
      process.exit(1);
    }
    // synchronous CLI: a short busy-wait poll is fine here
    pause(120);
  }
}

/** Busy-wait a little: the CLI is synchronous and has no event loop to sleep on. */
const pause = (ms: number): void => {
  hiddenSpawnSync(process.execPath, ["-e", `setTimeout(()=>{},${ms})`]);
};

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Stop the server at this pid and wait until it is gone; its files may stay behind (on
 *  Windows the kill skips its exit hook), and read as stale once the pid is dead. */
function stopServerProcess(pid: number): void {
  try {
    process.kill(pid);
  } catch {}
  const t0 = Date.now();
  while (isAlive(pid)) {
    if (Date.now() - t0 > 5_000) {
      console.error(`aiview: the running server (pid ${pid}) is an older version and did not stop within 5s; stop it and retry`);
      process.exit(1);
    }
    pause(100);
  }
}

/** The port of a server running the installed collection: the running one when its
 *  version is the installed one, else a fresh one. A running server of another version,
 *  or with none recorded, is stopped and replaced on its own port. With no installed
 *  version to compare against, any running server is reused. */
function portOfInstalledServer(): number {
  const asked = args.flag("--port") ?? process.env.AIVIEW_PORT;
  const st: ServerStatus = readServerStatus();
  // V2: a derived port another process already holds is passed over for the next free one; an asked port is kept as asked
  if (!st.running || st.port === null || st.pid === null) return spawnDetachedServer(asked !== undefined ? Number(asked) : firstFreePort(defaultPort()));
  const installed = collectionVersion(TOOL_ROOT);
  if (installed === null || st.version === installed) return st.port;
  stopServerProcess(st.pid);
  return spawnDetachedServer(st.port);
}

/** The project the agent works in (board-split#D41): the one claiming the CLI's working directory, else `fallback`
 *  (the document's own). Its tabs are the only ones the agent's open or pointer moves. */
function agentProject(fallback: string): string {
  const index = openIndex();
  try {
    return projectForCwd(process.cwd(), index.allProjects())?.slug ?? fallback;
  } finally {
    index.close();
  }
}

/** What the agent reads of a move sent to its project's tabs (D41). */
const movedLine = (r: ShowResponse, project: string, verb: string): string =>
  r.opened ? `no tab showed ${project}: opened a new one` : `${verb} in ${r.tabs} open tab${r.tabs > 1 ? "s" : ""} on ${project}`;

function resolveRef(ref: string): Document | undefined {
  const index = openIndex();
  try {
    return /^#?\d+$/.test(ref) ? index.get(Number(ref.replace("#", ""))) : index.getByPath(path.resolve(ref));
  } finally {
    index.close();
  }
}

function cmdStatus(): void {
  const index = openIndex();
  const documents = index.all().length;
  const project = index.activeProject();
  // Where the agent writes: ask, never construct (D14).
  const projectDocs = project === ALL_PROJECTS ? DOCS_ROOT : docsDirFor(project);
  // Which project the agent is standing in, if any project claims this directory.
  const cwdProject = projectForCwd(process.cwd(), index.allProjects())?.slug ?? null;
  index.close();
  const server = readServerStatus();
  emit(
    { home: DATA_ROOT, docs: DOCS_ROOT, project, projectDocs, cwdProject, sqlite: SQLITE_PATH, tool: TOOL_ROOT, documents, server },
    () => {
    console.log(`home       ${DATA_ROOT}`);
    console.log(`docs       ${DOCS_ROOT}`);
    console.log(`project    ${project === ALL_PROJECTS ? "(all)" : project}`);
    console.log(`write to   ${projectDocs}`);
    if (cwdProject) console.log(`cwd is in  ${cwdProject}`);
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
function cmdPath(): void {
  const name = args.positional[0];
  if (!name) {
    console.error("usage: aiview path <filename> [--project <slug>]");
    process.exit(1);
  }
  const index = openIndex();
  // the project the cwd is in wins over the active one, as status computes it
  const cwdProject = projectForCwd(process.cwd(), index.allProjects())?.slug ?? null;
  const slug = args.flag("--project") ?? cwdProject ?? index.activeProject();
  const known = index.allProjects().map((p) => p.slug);
  index.close();
  if (slug === ALL_PROJECTS) {
    console.error(`no active project — run: aiview use <slug>, or pass --project${known.length ? `\nknown: ${known.join(", ")}` : ""}`);
    process.exit(1);
  }
  if (!known.includes(slug)) {
    console.error(`no such project: ${slug}${known.length ? `\nknown: ${known.join(", ")}` : ""}`);
    process.exit(1);
  }
  const dir = docsDirFor(slug);
  fs.mkdirSync(dir, { recursive: true });
  const full = path.join(dir, path.basename(name)); // basename: a name, not a path
  emit({ path: full, dir, project: slug }, full);
}

/** An html prototype by registered ref or by path, for the binding verbs. */
function prototypeArg(usage: string): string {
  const ref = args.positional[0];
  if (!ref) {
    console.error(usage);
    process.exit(1);
  }
  const abs = resolveRef(ref)?.abs_path ?? path.resolve(ref);
  if (!fs.existsSync(abs)) {
    console.error(`no such file: ${abs}`);
    process.exit(1);
  }
  if (!isHtml(abs)) {
    console.error(`not an html prototype: ${abs}`);
    process.exit(1);
  }
  return abs;
}

/** What a prototype offers to its siblings and what it pulls from them, so an agent never
 *  greps a 90 KB file for data-component before writing a placeholder. */
function cmdComponents(): void {
  const abs = prototypeArg("usage: aiview components <file|#id>");
  const r = listComponents(readDoc(abs));
  const vocabulary = pageVocabulary(abs);
  emit({ file: path.basename(abs), ...r, ...vocabulary }, () => {
    if (!r.offers.length) console.log("offers   nothing: no data-component in this file");
    for (const o of r.offers)
      console.log(
        `offers   ${o.name}  <${o.tag}>${o.within ? `  within ${o.within}` : ""}${o.warnings.length ? `  !! ${o.warnings.join(", ")}` : ""}`,
      );
    for (const x of r.pulls) console.log(`pulls    ${x.name || x.ref}  from ${x.file || "(invalid ref)"}`);
    if (!r.pulls.length) console.log("pulls    nothing: no data-bind in this file");
    console.log(`page     ${vocabulary.page.join(", ") || "no component"}`);
    console.log(`variants ${vocabulary.variants.join(", ") || "none declared"}`);
  });
}

/** A prototype composed the way the server composes it: `data-bind` placeholders replaced
 *  from sibling files of the same folder, bare names only. */
function composed(abs: string): ReturnType<typeof resolveBindings> {
  const dir = path.dirname(abs);
  const reader = (name: string): string | undefined => {
    if (/[\\/]/.test(name) || name.includes("..")) return undefined;
    const f = path.join(dir, name);
    return fs.existsSync(f) && fs.statSync(f).isFile() ? readDoc(f) : undefined;
  };
  return resolveBindings(readDoc(abs), reader);
}

/** What the person sees on a prototype's page and can be pointed at: every component name
 *  once composed, the bound ones and what they hold included, and the variants declared.
 *  `components` prints it and `show` holds names to it, so the two never disagree. */
function pageVocabulary(abs: string): { page: string[]; variants: string[] } {
  const raw = readDoc(abs);
  const html = composed(abs).html;
  const names = [...listComponents(html).offers, ...listComponents(raw).pulls].map((c) => c.name).filter(Boolean);
  return {
    page: [...new Set(names)],
    variants: [...new Set([...html.matchAll(/data-aiview-variant="([^"]+)"/g)].map((m) => m[1]))],
  };
}

/** Point the person's viewer at components of a prototype, before asking them about it.
 *  The names are held to the page as the person sees it, bound components included, so
 *  a region named in the agent's own words stops here. The link is the pointer: it is
 *  printed whether or not a tab heard the broadcast. */
function cmdShow(): void {
  const usage = "usage: aiview show <file|#id> [--component Name]... [--variant v]  |  aiview show --done";
  // The pointing is over. The tabs remember where they were; the agent only says so.
  if (args.has("--done")) {
    const answer = askServer("/api/show-done", {});
    const tabs = answer === null ? 0 : (JSON.parse(answer) as ShowResponse).tabs;
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
  const wrong =
    [...components, ...(variant ? [variant] : [])].find((n) => !isName(n)) !== undefined
      ? "a name holds letters, digits, dot, dash and underscore only"
      : (unknownNames(components, known, "component") ?? (variant ? unknownNames([variant], variants, "variant") : undefined));
  if (wrong) {
    console.error(wrong);
    process.exit(1);
  }

  ensureDist();
  const port = portOfInstalledServer();
  const pointer = { id: doc.id, components, ...(variant ? { variant } : {}) };
  const url = `http://localhost:${port}/#${pointerHash(pointer)}`;
  const project = agentProject(doc.project);
  const answer = askServer("/api/show", { ...pointer, project });
  const moved: ShowResponse | null = answer === null ? null : (JSON.parse(answer) as ShowResponse);
  emit({ id: doc.id, url, components, variant: variant ?? null, project, tabs: moved?.tabs ?? 0, opened: moved?.opened ?? false }, () => {
    console.log(url);
    console.log(moved ? movedLine(moved, project, "shown") : "no aiview server answered: give the person the link");
  });
}

/** Resolve a host the way the server does and say what went wrong, as text. Exit 1 on errors. */
function cmdCheck(): void {
  const abs = prototypeArg("usage: aiview check <file|#id>");
  const r = composed(abs);
  emit({ file: path.basename(abs), bound: r.bound, sources: r.sources, errors: r.errors, warnings: r.warnings }, () => {
    console.log(`${r.bound} bound from ${r.sources.length} source${r.sources.length === 1 ? "" : "s"}${r.sources.length ? `: ${r.sources.join(", ")}` : ""}`);
    for (const e of r.errors) console.log(`error    ${e.ref}: ${e.message}`);
    for (const w of r.warnings) console.log(`warning  ${w.ref}: ${w.message}`);
    if (!r.errors.length && !r.warnings.length) console.log("ok");
  });
  if (r.errors.length) process.exit(1);
}

/** Parse every mermaid block of a document, the way the viewer will. The checker is a
 *  separate bundle next to the CLI bundle, loaded only here. */
async function cmdMermaidCheck(): Promise<void> {
  const ref = args.positional[0];
  if (!ref) {
    console.error("usage: aiview mermaid-check <file|#id>");
    process.exit(1);
  }
  const abs = resolveRef(ref)?.abs_path ?? path.resolve(ref);
  if (!fs.existsSync(abs)) {
    console.error(`no such file: ${abs}`);
    process.exit(1);
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const bundle = [path.join(here, "mermaid-check.mjs"), path.join(here, "..", "..", "dist-cli", "mermaid-check.mjs")].find((f) => fs.existsSync(f));
  if (!bundle) {
    console.error(`aiview: the mermaid checker is not built. Run: npm install && npm run build  (in ${TOOL_ROOT})`);
    process.exit(1);
  }
  const { blocksOf, checkBlocks } = (await import(pathToFileURL(bundle).href)) as typeof import("../mermaid/check.ts");
  const content = fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n");
  const markdown = /\.(md|markdown)$/i.test(abs);
  const lines = content.split("\n");
  const blocks = blocksOf(content, markdown);
  const results = (await checkBlocks(blocks)).map((r, i) => ({
    ...r,
    warnings: r.ok ? disciplineWarnings(lines, r.line, blocks[i].text, markdown) : [],
  }));
  const failed = results.filter((r) => !r.ok).length;
  const warned = results.reduce((n, r) => n + r.warnings.length, 0);
  emit({ file: path.basename(abs), blocks: results.length, failed, warnings: warned, results }, () => {
    if (!results.length) return console.log("no mermaid block in this document");
    for (const r of results) {
      console.log(r.ok ? `ok     line ${r.line}  ${r.type}` : `FAIL   line ${r.line}  ${r.error}`);
      for (const w of r.warnings) console.log(`warn   line ${r.line}  ${w}`);
    }
    console.log(`${results.length} block${results.length === 1 ? "" : "s"}, ${failed} failed, ${warned} warning${warned === 1 ? "" : "s"}`);
  });
  if (failed) process.exit(1);
}

/** First clone / new machine: make the data home exist and say what lives where. */
function cmdInit(): void {
  ensureHome();
  adoptLegacyIndex(TOOL_ROOT, SQLITE_PATH);
  emit({ home: DATA_ROOT, docs: DOCS_ROOT, sqlite: SQLITE_PATH, tool: TOOL_ROOT }, () => {
    console.log(`data home  ${DATA_ROOT}      (yours: index, server files, documents — never versioned)`);
    console.log(`documents  ${path.join(DOCS_ROOT, "<project>")}`);
    console.log(`tool       ${TOOL_ROOT}      (the checkout: rebuildable, safe to delete)`);
  });
}

function cmdAdd(): void {
  if (!args.positional[0]) {
    console.error("usage: aiview add <file.md> [--kind k] [--tag t]...");
    process.exit(1);
  }
  const index = openIndex();
  const d = index.register(path.resolve(args.positional[0]), registerOpts());
  index.close();
  emit(d, docLine(d));
}

function cmdUpdate(): void {
  if (!args.positional[0]) {
    console.error("usage: aiview update <file|#id> [--kind k] [--tag t] [--untag t] [--group g|--ungroup] [--group-title T] [--started ISO]");
    process.exit(1);
  }
  // Kind, tags and group are metadata; project is a directory. Silently ignoring
  // --project here would look like it worked.
  if (args.flag("--project")) {
    console.error(`project is a directory, not metadata — use: aiview move ${args.positional[0]} --project <slug>`);
    process.exit(1);
  }
  const target = resolveRef(args.positional[0]);
  if (!target) {
    console.error(`not in index: ${args.positional[0]}`);
    process.exit(1);
  }
  const patch: UpdatePatch = {
    kind: args.flag("--kind"),
    addTags: args.flags("--tag"),
    removeTags: args.flags("--untag"),
    group: args.has("--ungroup") ? null : (args.flag("--group") ?? undefined),
    groupTitle: args.flag("--group-title"),
    started: args.flag("--started"),
  };
  const index = openIndex();
  const d = index.update(target.id, patch)!;
  index.close();
  emit(d, docLine(d));
}

function cmdList(): void {
  const want = args.flags("--tag");
  const wantKind = args.flag("--kind") ?? "";
  const index = openIndex();
  // Scope defaults to the active project (D10); --all or --project override it.
  const scope = args.has("--all") ? ALL_PROJECTS : (args.flag("--project") ?? index.activeProject());
  const docs = index
    .all()
    .filter(
      (d) =>
        (scope === ALL_PROJECTS || d.project === scope) &&
        (!wantKind || d.kind === wantKind) &&
        (!want.length || want.every((t) => d.tags.includes(t))),
    );
  index.close();
  emit(docs, () => {
    for (const d of docs)
      console.log(
        `started ${d.created_at}  ${d.kind.padEnd(12)} [${d.tags.join(", ")}]  ${d.title}${d.exists ? "" : "  (missing)"}\n    ${d.file_path}`,
      );
  });
}

function cmdRemove(): void {
  if (!args.positional.length) {
    console.error("usage: aiview remove <file|#id>...");
    process.exit(1);
  }
  const index = openIndex();
  const removed: Document[] = [];
  for (const ref of args.positional) {
    const row = /^#?\d+$/.test(ref) ? index.get(Number(ref.replace("#", ""))) : index.getByPath(path.resolve(ref));
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

function cmdProject(): void {
  const sub = args.positional[0] ?? "list";
  const index = openIndex();
  try {
    if (sub === "list") {
      const projects = index.allProjects();
      const docs = index.all();
      const active = index.activeProject();
      const count = (slug: string) => docs.filter((d) => d.project === slug).length;
      emit(
        projects.map((p) => ({ ...p, documents: count(p.slug), active: p.slug === active })),
        () => {
          for (const p of projects)
            console.log(
              `${p.slug === active ? "*" : " "} ${p.slug.padEnd(14)} ${String(count(p.slug)).padStart(3)} docs  ${docsDirFor(p.slug)}${p.paths.length ? `\n    covers ${p.paths.join(", ")}` : ""}`,
            );
        },
      );
      return;
    }

    const slug = args.positional[1];
    if (!slug) {
      console.error(`usage: aiview project ${sub} <slug>`);
      process.exit(1);
    }

    if (sub === "add") {
      const p = index.upsertProject(slug, { title: args.flag("--title"), addPaths: args.flags("--path").map((p) => path.resolve(p)) });
      fs.mkdirSync(docsDirFor(slug), { recursive: true });
      emit({ ...p, docs: docsDirFor(slug) }, `${p.slug}  ${docsDirFor(slug)}${p.paths.length ? `\n  covers ${p.paths.join(", ")}` : ""}`);
      return;
    }

    if (sub === "rm") {
      const r = index.removeProject(slug);
      if (!r.removed) {
        console.error(
          r.documents > 0
            ? `${slug} still has ${r.documents} document${r.documents === 1 ? "" : "s"}. Move or remove them first.`
            : `no such project: ${slug}`,
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

/** Set the active project. `*` = All projects. */
function cmdUse(): void {
  const slug = args.positional[0];
  if (!slug) {
    console.error("usage: aiview use <slug|*>");
    process.exit(1);
  }
  const index = openIndex();
  try {
    if (slug !== ALL_PROJECTS && !index.allProjects().some((p) => p.slug === slug)) {
      const known = index.allProjects().map((p) => p.slug);
      console.error(`no such project: ${slug}${known.length ? `\nknown: ${known.join(", ")}` : ""}`);
      process.exit(1);
    }
    setActive(index, slug);
    emit(
      { project: slug, docs: slug === ALL_PROJECTS ? DOCS_ROOT : docsDirFor(slug) },
      slug === ALL_PROJECTS ? `all projects  ${DOCS_ROOT}` : `${slug}  ${docsDirFor(slug)}`,
    );
  } finally {
    index.close();
  }
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

/** Refile a document: `--project` puts it in another project, bare pulls a stray back
 *  into its own project's directory. The project IS the directory (D14), so this is
 *  the only way to reclassify one — and the caller names a project, never a path. */
function cmdMove(): void {
  if (!args.positional.length) {
    console.error("usage: aiview move <file|#id>... [--project <slug>]");
    process.exit(1);
  }
  const target = args.flag("--project");
  const index = openIndex();
  if (target && !index.allProjects().some((p) => p.slug === target)) {
    const known = index.allProjects().map((p) => p.slug);
    console.error(`no such project: ${target}${known.length ? `\nknown: ${known.join(", ")}` : ""}`);
    index.close();
    process.exit(1);
  }
  const moved: Document[] = [];
  for (const ref of args.positional) {
    const row = /^#?\d+$/.test(ref) ? index.get(Number(ref.replace("#", ""))) : index.getByPath(path.resolve(ref));
    if (!row) {
      console.error(`not in index: ${ref}`);
      continue;
    }
    const from = row.abs_path;
    const dir = docsDirFor(target ?? row.project);
    const dest = path.join(dir, path.basename(from));
    if (dest === from) {
      console.error(`already there: ${from}`);
      continue;
    }
    // A workbench carries its sidecar `<stem>/` with it; the sidecar is never in the index.
    const sidecarFrom = sidecarOf(from);
    const sidecarDest = sidecarOf(dest);
    const carriesSidecar = sidecarFrom !== null && fs.existsSync(sidecarFrom);
    // File already at the destination with a stale row: a previous run moved the
    // file (and its sidecar, if it had one) and then failed to write the index.
    // Re-point the row and carry on.
    const orphaned = !fs.existsSync(from) && fs.existsSync(dest);
    if (!fs.existsSync(from) && !orphaned) {
      console.error(`missing file, not moved: ${from}`);
      continue;
    }
    if (!orphaned) {
      const taken = [dest, ...(carriesSidecar ? [sidecarDest!] : [])].filter((p) => fs.existsSync(p));
      if (taken.length) {
        const named = carriesSidecar ? `${dest} and ${sidecarDest}` : dest;
        console.error(`target exists (${taken.join(", ")}), skipped: ${named}`);
        continue;
      }
    }
    fs.mkdirSync(dir, { recursive: true });
    if (!orphaned) {
      moveAcrossVolumes(from, dest);
      if (carriesSidecar) moveAcrossVolumes(sidecarFrom!, sidecarDest!);
    }
    const d = index.move(row.id, dest)!;
    moved.push(d);
    if (!asJson) console.log(`moved #${d.id}  ${from}\n           -> ${dest}`);
  }
  index.close();
  if (asJson) console.log(JSON.stringify({ moved }));
}

function cmdOpen(): void {
  if (!args.positional[0]) {
    console.error("usage: aiview open <file> [--kind k] [--tag t]... [--group g] [--port p] [--open]");
    process.exit(1);
  }
  ensureDist();
  const index = openIndex();
  const d = index.register(path.resolve(args.positional[0]), registerOpts());
  // Opening a document moves the mode to it (D9): the selector always states where
  // you are, and the agent never has to switch-then-open in two steps.
  setActive(index, d.project);
  const project = projectForCwd(process.cwd(), index.allProjects())?.slug ?? d.project;
  index.close();
  const port = portOfInstalledServer();
  const url = `http://localhost:${port}/#doc=${d.id}`;
  // the tabs on the agent's project go to it; none there, the server opens one (D41)
  const answer = askServer("/api/open", { id: d.id, project });
  const moved: ShowResponse | null = answer === null ? null : (JSON.parse(answer) as ShowResponse);
  if (!moved && args.has("--open")) {
    const [c, a] =
      process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
    try {
      spawn(c, a as string[], { detached: true, stdio: "ignore" }).unref();  // AGENTS EXCEPTION (D39): a browser opener: the browser's own window is the point
    } catch {}
  }
  emit({ id: d.id, url, project, tabs: moved?.tabs ?? 0, opened: moved?.opened ?? false, server: readServerStatus() }, moved ? [url, movedLine(moved, project, "opened")].join("\n") : url);
}

/** The project's board, aiview's /board page: `--repo` adds a repository to it (what
 *  `swarm open` does), bare reads it. The project is --project, else the one claiming this
 *  directory. Like `open`, it makes that project the active one, so the link shows its board. */
function cmdBoard(): void {
  const index = openIndex();
  try {
    const slug = args.flag("--project") ?? projectForCwd(process.cwd(), index.allProjects())?.slug ?? null;
    if (!slug) {
      console.error(`no aiview project for ${process.cwd()}: declare one with aiview project add <slug> --path <dir>, or pass --project`);
      process.exit(1);
    }
    const repo = args.flag("--repo");
    if (repo === undefined && !index.allProjects().some((p) => p.slug === slug)) {
      console.error(`no such project: ${slug}`);
      process.exit(1);
    }
    const repos = repo === undefined ? index.boardRepos(slug) : index.addBoardRepo(slug, repo);
    setActive(index, slug);
    ensureDist();
    // the board's scoped URL (D41): the tab it opens shows this project, whatever another tab shows
    const url = `http://localhost:${portOfInstalledServer()}/${boardHash(slug)}`;
    if (args.has("--open")) {
      const [c, a] =
        process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
      try {
        spawn(c, a as string[], { detached: true, stdio: "ignore" }).unref();  // AGENTS EXCEPTION (D39): a browser opener: the browser's own window is the point
      } catch {}
    }
    emit({ project: slug, repos, url, server: readServerStatus() }, [url, ...repos.map((x) => `  ${x}`)].join("\n"));
  } finally {
    index.close();
  }
}

async function cmdServe(): Promise<void> {
  if (args.has("--detach")) {
    ensureDist();
    if (args.positional[0]) {
      // register the start doc in-process; the detached server serves the index
      const index = openIndex();
      index.register(path.resolve(args.positional[0]), registerOpts());
      index.close();
    }
    const port = portOfInstalledServer();
    emit({ server: readServerStatus() }, `aiview server up on http://localhost:${port}/`);
    return;
  }
  ensureDist();
  const { startServer } = await import("../server/index.ts");
  const index = openIndex();
  const startDoc = args.positional[0] ? index.register(path.resolve(args.positional[0]), registerOpts()) : null;
  startServer(index, {
    port: Number(args.flag("--port") ?? process.env.AIVIEW_PORT ?? defaultPort()),
    open: args.has("--open"),
    startDoc,
  });
}

function cmdPending(): void {
  const sub = args.positional[0];
  const index = openIndex();
  const needDoc = (ref: string | undefined): Document => {
    if (!ref) {
      console.error("usage: aiview pending <add|done|list|clear> ...");
      process.exit(1);
    }
    const doc = resolveRef(ref);
    if (!doc) {
      console.error(`no such document: ${ref}`);
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
  // list, the default
  const ref = args.positional[1];
  const rows = ref ? index.pendingFor(needDoc(ref).id) : index.allPending();
  index.close();
  emit(rows, () => {
    if (!rows.length) return console.log("nothing pending");
    for (const r of rows) console.log(`#${r.id}  doc #${r.document_id}  ${r.label}${r.note ? ` — ${r.note}` : ""}  since ${r.started_at}`);
  });
}

function cmdTracker(): void {
  const mode = args.positional[0] === "sync" ? "sync" : "check";
  const ref = args.positional[1] ?? (args.positional[0] === "check" || args.positional[0] === "sync" ? undefined : args.positional[0]);
  if (!ref) {
    console.error("usage: aiview tracker <check|sync> <file|#id>");
    process.exit(1);
  }
  const abs = resolveRef(ref)?.abs_path ?? path.resolve(ref);
  if (!fs.existsSync(abs)) {
    console.error(`no such file: ${abs}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(abs, "utf8");
  const body = raw.split(CRLF).join(LF);
  const tracker = findTracker(body);
  if (!tracker) {
    console.error(`no tracker in ${path.basename(abs)}: no mermaid block whose nodes open with ✅ ▶ ⏸ ⬜ ✖`);
    process.exit(1);
  }

  if (mode === "sync") {
    // Read and write in one breath, and replace the file rather than truncate it: a
    // plan is edited by whoever is running it, and a half-written tracker is worse
    // than a stale one.
    const crlf = raw.includes(CRLF);
    const { text, changed } = trackerSync(body, tracker);
    if (changed) {
      const tmp = `${abs}.aiview-${process.pid}`;
      fs.writeFileSync(tmp, crlf ? text.split(LF).join(CRLF) : text, "utf8");
      fs.renameSync(tmp, abs);
    }
    const after = findTracker(text);
    const left = after ? trackerCheck(after) : [];
    emit({ file: path.basename(abs), changed, findings: left.length }, () =>
      console.log(
        changed
          ? `synced ${path.basename(abs)}: the class lines now follow the glyphs${left.length ? `, ${left.length} finding(s) remain` : ""}`
          : `nothing to sync: the class lines already follow the glyphs`,
      ),
    );
    if (left.length) process.exit(1);
    return;
  }

  const findings = trackerCheck(tracker);
  emit({ file: path.basename(abs), nodes: tracker.nodes.length, findings }, () => {
    if (!findings.length) return console.log(`ok  ${tracker.nodes.length} steps, glyphs and classes agree`);
    for (const f of findings) console.log(`line ${f.line}  ${f.text}`);
    console.log(`${findings.length} finding(s) in ${tracker.nodes.length} steps`);
  });
  if (findings.length) process.exit(1);
}

function cmdPlan(): void {
  const ref = args.positional[0] === "check" ? args.positional[1] : args.positional[0];
  if (!ref) {
    console.error("usage: aiview plan check <file|#id>");
    process.exit(1);
  }
  const abs = resolveRef(ref)?.abs_path ?? path.resolve(ref);
  if (!fs.existsSync(abs)) {
    console.error(`no such file: ${abs}`);
    process.exit(1);
  }
  const plan = readApproval(fs.readFileSync(abs, "utf8").split(CRLF).join(LF));
  const findings = planCheck(plan);
  emit(
    {
      file: path.basename(abs),
      approved: plan.approved,
      decisions: plan.decisions.length,
      defaults: plan.defaults.map((d) => ({ id: d.id, kind: d.kind, line: d.line })),
      confirmed: plan.confirmed ?? null,
      findings,
    },
    () => {
      for (const f of findings) console.log(`warn  line ${f.line}  ${f.text}`);
      const state = plan.approved ? "approved" : "not approved";
      const tail = !plan.defaults.length
        ? "no agent defaults"
        : plan.approved
          ? `${plan.defaults.length} agent default(s), ${findings.length ? "not all confirmed" : "all confirmed"}`
          : `${plan.defaults.length} agent default(s) to list at approval: ${plan.defaults.map((d) => d.id).join(", ")}`;
      console.log(`${findings.length ? "warn" : "ok"}  ${state}, ${plan.decisions.length} decisions, ${tail}`);
    },
  );
}

async function runVerb(): Promise<void> {
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
    cmdUse();
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

// a verb's thrown error is a user's: one line, exit 1; AIVIEW_DEBUG=1 shows the stack
try {
  await runVerb();
} catch (err) {
  if (process.env.AIVIEW_DEBUG === "1") throw err;
  console.error(`aiview ${args.verb}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

// One notification per invocation, after the work is done: any open tab reloads its
// list. Error paths exit before here, so nothing is announced that did not happen.
if (MUTATES_INDEX.has(args.verb ?? "")) notifyIndexChanged();
