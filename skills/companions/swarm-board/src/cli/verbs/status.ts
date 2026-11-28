import { SQLITE_PATH } from "../../store/home.ts";
import { DATA_ROOT } from "../../host/home.ts";
import { CODE_WORDING, orchestratorsLines, ORCHESTRATORS_GROUP, shellWord, WORDING } from "../answer/index.ts";
import type { VerbContext } from "../context.ts";
import { heldLine, phaseSuffix, stateAndContextLine } from "../lines.ts";
import { projectNameOf, writeOrchestratorSeats } from "../paths.ts";
import { mergeLocksHeld } from "../pack-calls.ts";

/** An open run idle this long is shown by status as likely forgotten, with its close command. */
const FORGOTTEN_MS = 24 * 60 * 60 * 1000;

export async function statusVerb(ctx: VerbContext): Promise<void> {
  const runs = await ctx.board.runs();
  // each member's worktree, null for a seat or an orchestrator (D64)
  const membersOf = async (r: (typeof runs)[number]) => (await ctx.board.roster(r.repo)).filter((m) => m.run === r.id).map((m) => ({ name: m.name, nick: m.nick, worktree: m.worktree, state: m.state, activity: m.activity, context: m.context, progressAt: m.progressAt, aliveAt: m.aliveAt, files: m.held }));
  const cli = ctx.cli;
  const open = await Promise.all(
    runs.map(async (r) => {
      const lastActivity = await ctx.board.lastActivity(r.id);
      // a run with no activity for a day is likely forgotten: its orchestrator ended without close; the orchestrators board is never closed
      const idleMs = r.group === ORCHESTRATORS_GROUP ? 0 : Date.now() - Date.parse(lastActivity);
      return { run: r.id, kind: r.kind, protocol: r.protocol ?? null, authority: r.authority, group: r.plan, title: r.title, phase: r.phase, progress: await ctx.board.phaseProgress(r.id), members: await membersOf(r), lastActivity, forgotten: idleMs >= FORGOTTEN_MS, idleMs };
    }),
  );
  const merge = await mergeLocksHeld(ctx);
  // each open run not yet seated on its project's orchestrators board, with the command registering it
  const orchestrators = orchestratorsLines(runs, cli, writeOrchestratorSeats);
  ctx.emit({ home: DATA_ROOT, sqlite: SQLITE_PATH, runs: runs.length, open: open.map(({ idleMs: _, ...o }) => o), mergeLocks: merge, orchestrators }, () => {
    console.log(`home    ${DATA_ROOT}`);
    console.log(`sqlite  ${SQLITE_PATH}`);
    const projectName = projectNameOf();
    for (const m of merge) console.log(`lock    ${CODE_WORDING.mergeLockLine(projectName(m.project), m.holder, m.since, m.waiters)}`);
    if (!runs.length) console.log("no open run");
    for (const [i, r] of runs.entries()) {
      console.log(`run ${r.id}  ${r.kind}  ${r.plan}  ${r.title}${WORDING.authorityShown(r.authority)}${phaseSuffix(r.phase, open[i].progress)}${WORDING.runPausedShown(r.paused, r.pausedPerson)}  ${projectName(r.repo)}`);
      for (const s of r.seats) console.log(`  ${s.id} ${WORDING.seatState(s.state)}${s.role ? `  ${s.role}` : ""}${s.blockers.length ? `  blocked by ${s.blockers.join(", ")}` : ""}`);
      for (const m of open[i].members) {
        const files = heldLine(m.files);
        console.log(`  ${m.name}  ${stateAndContextLine(m, true)}${files ? `  files: ${files}` : ""}`);
      }
      const idle = open[i].idleMs;
      if (idle >= FORGOTTEN_MS)
        console.log(WORDING.forgottenRun(Math.floor(idle / 86400000), cli, r.id, shellWord(`${r.plan}/orchestrator`)));
    }
    for (const line of orchestrators) console.log(line);
  });
}
