import type { Participant } from "../../contract/board.ts";
import { seqLine } from "../format.ts";
import { shellWord, WORDING } from "../answer/index.ts";
import * as rules from "../answer/rules.ts";
import type { VerbContext } from "../context.ts";
import { fail } from "../fail.ts";

export async function phaseVerb(ctx: VerbContext, p: Participant): Promise<void> {
  const [name, ...said] = ctx.args.positional;
  if (!name) fail(`phase: which phase?\n${ctx.verbHelp()}`);
  if (!rules.phaseKind(name)) fail(WORDING.phaseNoKind(name));
  const text = said.join(" ") || fail(`phase ${name}: what does it ask?`);
  // --watch: the members whose done wakes the orchestrator the moment it lands (idea 2, §3)
  const watch = ctx.args.list("--watch");
  // --for: only these seats are woken and owe their done; a seat with nothing to do is not woken (tokens)
  const only = ctx.args.list("--for");
  // V-44: an empty --for is refused, never read as a phase for every member
  if (ctx.args.has("--for") && !only.length) fail(WORDING.phaseForEmpty(name));
  // two steps by the answer alone, as close: the first names the opt-ins to weigh and the confirming call
  if (!ctx.args.has("--confirm") && p.seat === "orchestrator") {
    const flags = (only.length ? ` --for ${only.join(",")}` : "") + (watch.length ? ` --watch ${watch.join(",")}` : "");
    fail(rules.phaseStep(name, WORDING.phaseConfirm(ctx.cli, shellWord(name), shellWord(text), flags, shellWord(p.name))));
  }
  const previous = (await ctx.board.currentPhase(p.run))?.name ?? null;
  const m = await ctx.board.phase(p, name, text, watch.length || only.length ? { ...(watch.length ? { watch } : {}), ...(only.length ? { for: only } : {}) } : undefined);
  // V-6 (D62): the members that still owed the phase this one replaces, named once
  const stillOwed = previous !== null && m.stillOwed.length ? WORDING.phaseStillOwed(previous, m.stillOwed) : null;
  // the orchestrator's next step (rule 10): a watched done wakes it; the board says when all are in
  const cli = ctx.cli;
  const next = WORDING.phaseOpened(name, WORDING.phaseFor(only), WORDING.phaseHeard(watch), cli, shellWord(p.name), m.run);
  // the person follows from the session they talk to, not the board: a few lines there at every phase (rule 10)
  const brief = WORDING.briefThePerson;
  // board-split D65: opened during a pause, the phase reaches its members at the resume
  const pausedNow = (await ctx.board.runs()).find((r) => r.id === m.run)?.paused != null;
  // a seat whose member ended still owes this phase: all-done waits for it, so it is named with how to wake it
  const opened = await ctx.board.phaseProgress(m.run);
  const idleEnded = (opened?.idleEnded ?? []).map((s) => WORDING.seatIdleEnded(s.slice(s.lastIndexOf("/") + 1)));
  const seatOf = (member: string): string => member.slice(member.lastIndexOf("/") + 1);
  // V-35: a member owing it whose agent is lost is named with the move it needs
  const lostLines = (opened?.gone ?? []).map((member) => WORDING.phaseLostMember(member, WORDING.lostMove(cli, shellWord(seatOf(member)), shellWord(p.name))));
  const pausedLine = pausedNow ? WORDING.phaseOpenedPaused(name, m.run) : null;
  const circling = rules.circlingLine(m.earlier, name);
  ctx.emit({ seq: m.seq, run: m.run, phase: name, brief, idleEnded, stillOwed: m.stillOwed, lost: lostLines, next, ...(circling ? { circling } : {}), ...(pausedLine ? { paused: pausedLine } : {}) }, () => {
    console.log(seqLine(m));
    if (pausedLine) console.log(pausedLine);
    if (stillOwed) console.log(stillOwed);
    for (const line of lostLines) console.log(line);
    for (const line of idleEnded) console.log(line);
    console.log(brief);
    if (circling) console.log(circling);
    console.log(next);
  });
}
