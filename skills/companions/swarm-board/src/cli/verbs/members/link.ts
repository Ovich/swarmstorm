import { bindingOf } from "../../../client/remote.ts";
import { DATA_ROOT } from "../../../host/home.ts";
import { hiddenSpawn } from "../../../host/proc.ts";
import { runLink } from "../../../link/link.ts";
import { shellWord, WORDING } from "../../answer/index.ts";
import type { VerbContext } from "../../context.ts";

/** Runs this link's own command line again (the launcher, which loads the bundle built now) and resolves with its exit code. */
const relaunchLink = async (): Promise<number> => {
  // the old pipe is closing: give the named pipe a moment to be free before the new link listens on it
  await new Promise((r) => setTimeout(r, 300));
  const child = hiddenSpawn(process.execPath, process.argv.slice(1), { stdio: "inherit" });
  return new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 1)));
};

/** A member's link, started by its agent from join's or open's last line, or detached by a verb that found none (D32):
 *  a hidden verb, never a member's. It ends the process itself: the link's timers and pipe are its own. */
export async function linkVerb(ctx: VerbContext): Promise<void> {
  try {
    const member = { name: ctx.args.flag("--as") ?? "", run: Number(ctx.args.flag("--run")) };
    const stop = await runLink({ dataRoot: DATA_ROOT, member: member.name, run: member.run, binding: bindingOf(member) });
    // plan D56 (amended): a rebuild met: the same command again, through the launcher, loads the new bundle; this process
    // stays its parent so the harness's background task lives on, and ends with it
    if (stop.why === "new version") process.exit(await relaunchLink());
    // break-flow V-46: a second link of a member whose link runs says so, exit 0
    if (stop.why === "pipe taken") console.log(WORDING.linkRunning(member.name));
    // break-flow V-30: a link that met its run closed (or its member ended) says the closed line, then exits 0
    if (stop.why === "closed") console.log(WORDING.closed(member.run, WORDING.end(ctx.cli, shellWord(member.name))));
    process.exit(0);
  } catch (e) {
    console.error(`swarm link: ${(e as Error).message}`);
    process.exit(1);
  }
}
