import type { Delivery } from "../../board/board.ts";
import type { Message, Participant } from "../../contract/board.ts";
import { FOREGROUND_WAIT_MS, eventOf } from "../../contract/events.ts";
import { answer, eventStep, shellWord, WORDING } from "../answer/index.ts";
import * as rules from "../answer/rules.ts";
import type { VerbContext } from "../context.ts";
import { shownOf } from "../lines.ts";

export async function waitVerb(ctx: VerbContext, p: Participant): Promise<void> {
  const raw = ctx.args.flag("--timeout");
  const timeout = raw === undefined ? undefined : Number(raw);
  if (timeout !== undefined && !(timeout >= 0)) ctx.usageError(`--timeout takes milliseconds, got ${raw}`, "wait [--mentions] [--timeout <ms>] --as <member>", `wait --mentions --timeout ${FOREGROUND_WAIT_MS} --as ${ctx.asWord()}`);
  const mentionsOnly = ctx.args.has("--mentions");
  // board-fixes#D2: with no --timeout, a wait that is a foreground one (a seat listening in the foreground, a member
  // owing nothing) holds FOREGROUND_WAIT_MS and returns empty with its re-arm line; a background listener stays unbounded
  const timeoutMs = timeout ?? (rules.foregroundBound(await ctx.situation(p)) ? FOREGROUND_WAIT_MS : undefined);
  const delivered = await ctx.board.wait(p, { timeoutMs, mentionsOnly });
  // release-prep: ended, its link about to be stopped by the end: the ended line at once, with no call more (G26)
  if (delivered.ended) {
    ctx.emit(delivered, WORDING.ended(p.run));
    return;
  }
  const d = withNext(ctx, p, delivered, (await ctx.situation(p)).pauseStep ?? null);
  // the run closed while this wait was pending: the close ended the member
  if (await ctx.answeredGate(p, true)) return;
  if (d.superseded) {
    // a newer wait of this member gets what arrives (D64)
    ctx.emit(d, answer({ verb: "wait", outcome: "superseded" }, await ctx.situation(p)).lines[0]);
    return;
  }
  // the member's next step, before the message: the exact command that re-arms this listener (D49)
  // every foreground re-arm holds 150000, under the 180 s a harness lets a foreground command run (F22), whatever the caller gave: an old 110000
  // habit stays on 2-min turns otherwise (v1-c); a background listener (the orchestrator's) keeps its own form
  const { again, foreground: foregroundAgain } = WORDING.waitAgain(ctx.cli, { mentions: mentionsOnly, as: ctx.args.flag("--as") ? shellWord(ctx.args.flag("--as")!) : undefined, timeout: raw, json: ctx.asJson });
  if (!d.full.length) {
    // a timeout: the line to run again (B7); the member ended: it says so, nothing to re-arm (G26)
    const ended = (await ctx.board.participant(p.name))?.ended ?? true;
    if (ended) {
      ctx.emit(d, answer({ verb: "wait", outcome: "ended" }, await ctx.situation(p)).lines[0]);
      return;
    }
    // a member with nothing to do ends rather than wake every 150 s (tokens); the orchestrator dispatches it again
    const idle = mentionsOnly && (await ctx.board.idle(p));
    const a = answer({ verb: "wait", outcome: "empty", idle, again, foregroundAgain }, await ctx.situation(p));
    ctx.emit({ ...d, ...(idle ? { idle: true } : {}), next: a.next }, a.next!);
    return;
  }
  const phaseEvent = d.full.some((m) => eventOf(m) === "phase");
  const a = answer({ verb: "wait", outcome: "woke", again, foregroundAgain, phaseEvent, mentionsOnly, shown: shownOf(d) }, await ctx.situation(p, true));
  // F28: a background listener's end is also announced by the harness; the same event, already delivered here
  ctx.emit({ phase: a.phase, next: a.next, ...d, ...(a.lines.includes(WORDING.delivered) ? { delivered: WORDING.delivered } : {}) }, () => {
    for (const l of a.lines) console.log(l);
  });
}

/** A delivery as the member reads it: each event followed by the line its registry row gives (D36, D59). */
const withNext = (ctx: VerbContext, me: Participant, d: Delivery, pausedMerging: string | null): Delivery & { full: (Message & { endorse?: string })[] } => ({
  ...d,
  full: d.full.map((m) => {
    // board-split V-36 (D71): the merge lock's holder reads its own paused line under the pause, never the stop
    const line = pausedMerging && eventOf(m) === "pause" ? pausedMerging : eventStep(m, me, ctx.cli);
    // `endorse`: the JSON field the back-it line has always had
    return line ? { ...m, endorse: line } : m;
  }),
});
