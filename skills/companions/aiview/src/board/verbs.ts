// The verb of the project's board page in the viewer.
import { projectForCwd } from "../projects/projects.ts";
import { boardHash } from "./hash.ts";
import { readServerStatus } from "../host/serverstate.ts";
import { openBrowser } from "../host/browser.ts";
import { fail, type VerbContext } from "../cli/context.ts";
import { ensureDist, portOfInstalledServer, recordRecentProject } from "../cli/server.ts";
import type { Verb } from "../cli/dispatch.ts";

/** The project's board, aiview's /board page: `--repo` adds a repository to it (what
 *  `swarm open` does), bare reads it. The project is --project, else the one claiming this
 *  directory. Its link is the project's scoped board URL (D41). */
function runBoard(ctx: VerbContext): void {
  const { args, emit } = ctx;
  const index = ctx.index();
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

export const BOARD_VERBS: Verb[] = [
  { name: "board", help: "listed", needs: { index: true }, mutatesIndex: true, run: runBoard },
];
