import fs from "node:fs";
import path from "node:path";
import type { Kind, SeatSpec } from "../../board/board.ts";
import { profileOf } from "../../contract/kinds.ts";
import { stallMsFloor } from "../../board/liveness.ts";
import { HOME_OVERRIDE } from "../../board/home.ts";
import { DATA_ROOT } from "../../host/home.ts";
import { connectBoard, connectDirectBoard } from "../../client/remote.ts";
import { boardHome, registerBoard } from "../aiview-board.ts";
import { baseAt, worktreeHolding } from "../../host/git.ts";
import { CODE_WORDING, orchestratorsLines, shellWord, WORDING } from "../answer/index.ts";
import * as rules from "../answer/rules.ts";
import type { VerbContext } from "../context.ts";
import { fail } from "../fail.ts";
import { fwd, repoOf, toolRoot, writeOrchestratorSeats } from "../paths.ts";

export async function openVerb(ctx: VerbContext): Promise<void> {
  const { kind, group } = openKindAndGroup(ctx);
  const seatsFile = ctx.args.flag("--seats") ?? fail(`open: --seats <file.json> is required\n${ctx.verbHelp()}`);
  const rawStall = ctx.args.flag("--stall-ms");
  const stallMs = rawStall === undefined ? undefined : Number(rawStall);
  if (stallMs !== undefined && !(Number.isInteger(stallMs) && stallMs > 0)) fail(`--stall-ms takes a positive whole number of ms, got ${rawStall}`);
  // board-split D55 (amended): never under the floor; the answer says so in one line
  const stallClamped = stallMs !== undefined && stallMs < stallMsFloor() ? WORDING.stallClamped(stallMs, stallMsFloor()) : null;
  const protocol = ctx.args.flag("--protocol");
  // board-split#D28: the roles the orchestrator holds, comma-separated; the core checks their shape only
  const rawAuthority = ctx.args.flag("--authority");
  const authority = rawAuthority === undefined ? [] : rawAuthority.split(",").map((role) => role.trim()).filter(Boolean);
  const badRole = authority.find((role) => !/^[a-z0-9][a-z0-9-]*$/.test(role));
  if (badRole !== undefined) fail(`--authority takes roles in lower case, digits and dashes, comma-separated (architect,tech-lead), got ${badRole}`);
  if (protocol !== undefined && !/^[a-z0-9][a-z0-9-]*$/.test(protocol)) fail(`--protocol takes a name in lower case, digits and dashes (build-verify), got ${protocol}`);
  // aiview installed but no project here: the run's board would show nowhere, so refuse before opening
  const home = boardHome({ toolRoot: toolRoot(), cwd: process.cwd() });
  if (!home.found && home.launcher)
    fail(
      `open: no aiview project covers ${process.cwd()}, so the run's board would show nowhere. Declare it, then open again:
` +
        `  ${WORDING.aiviewProjectAdd(HOME_OVERRIDE ? `SWARMSTORM_HOME=${shellWord(fwd(HOME_OVERRIDE))} ` : "", shellWord(fwd(home.launcher)), shellWord(fwd(process.cwd())))}`,
    );
  const openRepo = repoOf(process.cwd());
  // board-split#D58: one open run per group on a project, said before anything opens
  const sameGroup = (await ctx.board.runs()).find((r) => r.repo === openRepo && r.group === group);
  if (sameGroup) fail(WORDING.groupAlreadyOpen(group, sameGroup.id, ctx.cli));
  // a failed open leaves no run: the run it began (stored before the connection dropped) is closed again
  // its flags and seats file read first: their errors print as they always did, outside the wrapper
  const title = ctx.need("--title");
  const seats = readSeats(seatsFile);
  let began = false;
  try {
    await openAndAnswer();
  } catch (err) {
    if (!began) throw err;
    const undone = await undoOpen(ctx, openRepo, group, err instanceof Error ? err.message : String(err));
    // no run kept: the board refused the open itself, and its refusal prints as before
    if (undone === null) throw err;
    fail(undone);
  }
  async function openAndAnswer(): Promise<void> {
    began = true;
    const run = await ctx.board.openRun({
      repo: openRepo,
      kind,
      group,
      title,
      link: ctx.args.flag("--link") ?? null,
      seats,
      ...(stallMs !== undefined ? { stallMs: Math.max(stallMs, stallMsFloor()) } : {}),
      ...(protocol !== undefined ? { protocol } : {}),
      authority,
      // what a code run's worktrees branch from and merge into: --onto, else the checkout's branch
      base: ctx.args.flag("--onto") ?? baseAt(process.cwd()),
    });
    // the orchestrator's link, from now on how its verbs reach the board (D29), started by its agent (D32)
    const link = ctx.startLinkLine({ name: `${run.group}/orchestrator`, run: run.id });
    // the person watches the project's board on aiview's /board page
    const doc = registerBoard({ home, cwd: process.cwd(), repo: run.repo });
    // the orchestrator's next step, the answer's last line (idea 3): the first phase, or why there is none
    const next = rules.firstPhaseLine(run.kind, protocol ?? null, ctx.cli, shellWord(`${run.group}/orchestrator`));
    // every orchestrator registers on the project's orchestrators board, whatever its roles
    const orchestrators = orchestratorsLines(await ctx.board.runs(), ctx.cli, writeOrchestratorSeats, run.id);
    // V-16 (AGENTS rule 10): how each declared seat joins, runnable as printed
    const seatIds = run.seats.map((s) => s.id);
    const seatsJoin = seatIds.length ? WORDING.seatsJoin(seatIds, WORDING.seatJoin(ctx.cli, run.id, shellWord(run.group), shellWord("waiting for a task"))) : null;
    // board-split#D66 (V-20): a run of workers whose target branch is checked out: every fast-forward into it would be refused
    const holding = profileOf(run.kind).member === "worker" && run.base ? worktreeHolding(process.cwd(), run.base) : null;
    const detachLine = holding ? CODE_WORDING.ontoCheckedOutAtOpen(run.base!, holding, CODE_WORDING.detach(shellWord(holding))) : null;
    const lines = (url: string | null) => [String(run.id), stallClamped, url, link, seatsJoin, detachLine, ...orchestrators, next].filter((l): l is string => l !== null).join("\n");
    if (!doc.registered) {
      // the run is open all the same; swarm has no page of its own (companions-merge D13)
      console.error(`swarm: ${doc.reason}: the run is open; its board is read in aiview once aiview is installed and knows this project`);
      ctx.emit({ run: run.id, repo: run.repo, kind: run.kind, group: run.group, plan: run.plan, url: null, link, orchestrators, ...(next ? { next } : {}) }, lines(null));
      return;
    }
    const runUrl = WORDING.runBoardUrl(doc.url, run.id);
    ctx.emit({ run: run.id, repo: run.repo, kind: run.kind, group: run.group, plan: run.plan, url: runUrl, link, orchestrators, ...(next ? { next } : {}) }, lines(runUrl));
  }
}

/** `open`'s kind and group: `--plan <slug>` is `--kind plan --group <slug>` (D22). */
function openKindAndGroup(ctx: VerbContext): { kind: Kind; group: string } {
  const raw = ctx.args.flag("--kind") ?? "plan";
  let kind: Kind;
  try {
    kind = profileOf(raw).kind;
  } catch (e) {
    return fail(`open: ${(e as Error).message}`);
  }
  const plan = ctx.args.flag("--plan");
  if (plan !== undefined && kind !== "plan") fail(`open: --plan means --kind plan; a ${kind} run takes --group <slug>`);
  const group = ctx.args.flag("--group") ?? plan ?? fail(`open: --group <slug> is required (or --plan <slug> for a plan run)\n${ctx.verbHelp()}`);
  return { kind, group };
}

/** V13: a seats file the CLI cannot take: what is wrong, then a seats file it takes. */
const seatsFail = (what: string): never =>
  fail(`${what}\ne.g. a seats file: [{"id": "w1", "role": "builder", "blockers": []}, {"id": "v1", "role": "verifier", "blockers": []}]`);

function readSeats(file: string): SeatSpec[] {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  } catch (e) {
    return seatsFail(`cannot read seats from ${file}: ${(e as Error).message}`);
  }
  const list = Array.isArray(raw) ? raw : (raw as { seats?: unknown }).seats;
  if (!Array.isArray(list)) return seatsFail(`${file}: expected an array of {id, role, area, blockers}`);
  return list.map((s: { id?: unknown; role?: unknown; area?: unknown; blockers?: unknown; link?: unknown }) => {
    if (typeof s.id !== "string") seatsFail(`${file}: a seat without an id`);
    // D24: the link finds each member's transcript; a seat row naming one is refused
    if ("title" in s) seatsFail(`${file}: unknown field title in ${s.id}; a seat has id, role, area`);
    if ("transcript" in s) seatsFail(`${file}: unknown field transcript in ${s.id}`);
    return {
      id: String(s.id),
      ...(typeof s.role === "string" && s.role ? { role: s.role } : {}),
      ...(typeof s.area === "string" && s.area ? { area: s.area } : {}),
      blockers: Array.isArray(s.blockers) ? s.blockers.map(String) : [],
      link: typeof s.link === "string" && s.link ? s.link : null,
    };
  });
}

/** After a failed open: the run it began for `group` on `repo`, if the store kept it, closed again over a fresh
 *  connection (the failure may have been the old one closing); the refusal line to print, null when no run was kept. */
async function undoOpen(ctx: VerbContext, repo: string, group: string, why: string): Promise<string | null> {
  try {
    ctx.board.close();
    ctx.board = await connectBoard({ dataRoot: DATA_ROOT });
    const begun = (await ctx.board.runs()).find((r) => r.repo === repo && r.group === group);
    if (!begun) return null;
    // trust-adaptations#D5: closed by the orchestrator the open created, declared on its own connection
    ctx.board.close();
    ctx.board = await connectDirectBoard(DATA_ROOT, { name: `${group}/orchestrator`, run: begun.id });
    await ctx.board.closeRun(begun.id);
    return WORDING.openFailedUndone(why, begun.id);
  } catch {
    return WORDING.openFailedLeft(why, group, ctx.cli);
  }
}
