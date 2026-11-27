import { DATA_ROOT } from "../../host/home.ts";
import type { VerbContext } from "../context.ts";

/** The board server (swarm-relay D2, D6): a hidden verb, the server module loaded only here; `serve stop` ends the
 *  running one (D27). The process stays up with the server, and exits when it closes. */
export async function serveVerb(ctx: VerbContext): Promise<void> {
  const { startBoardServer, stopBoardServer, onBoardServerClosed } = await import("../../server/server.ts");
  if (ctx.args.positional[0] === "stop") process.exit((await stopBoardServer(DATA_ROOT)) ? 0 : 1);
  const server = await startBoardServer({ dataRoot: DATA_ROOT });
  onBoardServerClosed(DATA_ROOT, () => process.exit(0));
  console.log(server.url);
}
