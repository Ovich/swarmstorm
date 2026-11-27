// The verbs of the viewer itself: serving it, and the project's board page in it.
import path from "node:path";
import { openIndex } from "../../core/db.ts";
import { projectForCwd } from "../../core/projects.ts";
import { boardHash } from "../../core/boardhash.ts";
import { defaultPort } from "../../core/home.ts";
import { readServerStatus } from "../../core/serverstate.ts";
import { openBrowser } from "../../core/browser.ts";
import { fail, type VerbContext } from "../context.ts";
import { ensureDist, portOfInstalledServer, recordRecentProject } from "../server.ts";
import type { Verb } from "../dispatch.ts";

/** `--detach` starts (or reuses) the server in the background and says where; bare, this
 *  process becomes the server, holding an index of its own for as long as it runs. */
async function runServe({ args, emit, registerOpts }: VerbContext): Promise<void> {
  const startFile = args.positional[0];
  if (args.has("--detach")) {
    // register the start doc in-process; the detached server serves the index
    if (startFile) {
      const index = openIndex();
      index.register(path.resolve(startFile), registerOpts());
      index.close();
    }
    const port = portOfInstalledServer(args.flag("--port"));
    emit({ server: readServerStatus() }, `aiview server up on http://localhost:${port}/`);
    return;
  }
  const { startServer } = await import("../../server/index.ts");
  const index = openIndex();
  const startDoc = startFile ? index.register(path.resolve(startFile), registerOpts()) : null;
  startServer(index, {
    port: Number(args.flag("--port") ?? process.env.AIVIEW_PORT ?? defaultPort()),
    open: args.has("--open"),
    startDoc,
  });
}

/** The project's board, aiview's /board page: `--repo` adds a repository to it (what
 *  `swarm open` does), bare reads it. The project is --project, else the one claiming this
 *  directory. Its link is the project's scoped board URL (D41). */
function runBoard({ args, index, emit }: VerbContext): void {
  const slug =
    (args.flag("--project") ?? projectForCwd(process.cwd(), index.allProjects())?.slug) ||
    fail(`no aiview project for ${process.cwd()}: declare one with aiview project add <slug> --path <dir>, or pass --project`);
  const repo = args.flag("--repo");
  if (repo === undefined && !index.allProjects().some((p) => p.slug === slug)) fail(`no such project: ${slug}`);
  const repos = repo === undefined ? index.boardRepos(slug) : index.addBoardRepo(slug, repo);
  recordRecentProject(index, slug);
  ensureDist();
  // the board's scoped URL (D41): the tab it opens shows this project, whatever another tab shows
  const url = `http://localhost:${portOfInstalledServer(args.flag("--port"))}/${boardHash(slug)}`;
  if (args.has("--open")) openBrowser(url);
  emit({ project: slug, repos, url, server: readServerStatus() }, [url, ...repos.map((x) => `  ${x}`)].join("\n"));
}

export const VIEWER_VERBS: Verb[] = [
  { name: "serve", help: "listed", needs: { dist: true }, run: runServe },
  { name: "board", help: "listed", needs: { index: true }, mutatesIndex: true, run: runBoard },
];
