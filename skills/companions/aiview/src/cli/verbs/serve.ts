// The verb of the viewer itself: serving it.
import path from "node:path";
import { openIndex } from "../../store/index-db.ts";
import { defaultPort } from "../../host/home.ts";
import { readServerStatus } from "../../host/serverstate.ts";
import { type VerbContext } from "../context.ts";
import { portOfInstalledServer } from "../server.ts";
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

export const SERVE_VERBS: Verb[] = [
  { name: "serve", help: "listed", needs: { dist: true }, run: runServe },
];
