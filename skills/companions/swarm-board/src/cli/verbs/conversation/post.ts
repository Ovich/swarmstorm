import fs from "node:fs";
import path from "node:path";
import type { Participant } from "../../../contract/board.ts";
import { seqLine } from "./format.ts";
import { nameHandle, unmatchedMentions } from "../../../board/conversation/mentions.ts";
import { resolveIn } from "../../../host/place.ts";
import { lostMentionLines, shellWord, WORDING } from "../../answer/index.ts";
import * as rules from "../../answer/rules.ts";
import type { VerbContext } from "../../context.ts";
import { fail } from "../../fail.ts";
import { repoRelative } from "../../paths.ts";

export async function postVerb(ctx: VerbContext, p: Participant): Promise<void> {
  // --file: a long body (a table, quotes, guillemets) read from a file, never through the shell's quoting
  const file = ctx.args.flag("--file");
  const body = (file ? fs.readFileSync(file, "utf8").trim() : ctx.args.positional.join(" ")) || fail(`${ctx.verb}: nothing to say`);
  const urgent = ctx.args.has("--urgent");
  if (urgent && ctx.verb !== "post") fail("--urgent is for post");
  if (ctx.verb !== "agree" && ctx.args.has("--with")) fail("--with is for agree");
  if (urgent && p.seat !== "orchestrator") fail("--urgent is the orchestrator's: it wakes every waiter of the run, even in a pause; ask @orchestrator on the thread instead");
  // board-fixes#D13: a task to one seat; --after (seats, comma lists) implies it
  const after = ctx.args.flags("--after").flatMap((w) => w.split(",")).filter(Boolean);
  const task = ctx.args.has("--task") || after.length > 0;
  if (task && ctx.verb !== "post") fail("--task and --after are for post");
  if (task && urgent) fail("--task: a task is a plain post, never --urgent");
  const m = await ctx.board.post(p, body, {
    ...(task ? { task: true, after } : {}),
    about: aboutArg(ctx),
    kind: ctx.verb === "agree" ? "agreement" : urgent ? "urgent" : "msg",
    // every --with counts, each a seat or a comma list of seats (S5)
    ...(ctx.verb === "agree" && ctx.args.has("--with") ? { with: ctx.args.flags("--with").flatMap((w) => w.split(",")) } : {}),
  });
  const unmatched = await unmatchedLines(ctx, p, body);
  // break-flow V-47: the orchestrator told which member it named is lost, as phase tells it (V-35); a group mention (@swarm) names every member of it
  const named = p.seat === "orchestrator" && m.mentions?.length ? (await ctx.board.roster(p.repo)).filter((r) => r.name !== p.name && rules.mentionReaches(m.mentions!, r.name)) : [];
  // simple-states: a post to a member whose link is down says how it is reached; the lost line then says it alone
  const unreached = rules.unreachedMentionLines(named);
  const lostNamed = named.filter((r) => r.badge?.name === "lost" && !(unreached.length && r.state === "lost")).map((r) => r.name);
  const lostMentioned = [...lostMentionLines(lostNamed, ctx.cli, shellWord(p.name)), ...unreached];
  const json = { seq: m.seq, mentions: m.mentions, run: m.run, ...(unmatched.length ? { unmatched } : {}), ...(lostMentioned.length ? { lost: lostMentioned } : {}) };
  const human = [
    seqLine(m),
    // posting is claiming (D7)
    ...unmatched,
    ...lostMentioned,
    ...(ctx.verb === "agree" && m.mentions?.length ? [WORDING.agreeParties(p.name, m.mentions)] : []),
    ...rules.taskHintLines({ orchestrator: p.seat === "orchestrator", plain: ctx.verb === "post" && !urgent, task, mentions: m.mentions ?? [], group: p.plan }),
  ];
  // V4: open's next line is said once, by open; a post never repeats it
  await ctx.emitHeard(p, json, human);
}

/** One line per `@…` of `body` that names no member (D63): the closest active names, at most three. */
async function unmatchedLines(ctx: VerbContext, p: Participant, body: string): Promise<string[]> {
  const roster = await ctx.board.roster(p.repo);
  const members = roster.filter((r) => r.seat !== "orchestrator");
  const plans = [...new Set(roster.map((r) => r.plan))];
  const names = new Map(members.map((r) => [nameHandle(r.nick), r.name]));
  const nickOf = new Map(members.map((r) => [r.name, r.nick.replace(/\s+/g, "")]));
  const ended = new Set(await ctx.board.endedMembers(p.repo));
  // a seat an open run declares, not joined yet: the post waits for it and is read at its join (G1)
  const declared = new Set((await ctx.board.runs()).filter((r) => r.repo === p.repo).flatMap((r) => r.seats.map((s) => `${r.group}/${s.id}`)));
  return unmatchedMentions(body, p.plan, plans, names).map(({ name, closest }) => {
    const member = name.includes("/") ? name : `${p.plan}/${name}`;
    if (ended.has(member)) return WORDING.mentionEnded(name);
    if (declared.has(member)) return WORDING.mentionNotJoined(name);
    return WORDING.mentionNobody(name, closest.map((c) => (nickOf.has(c) ? `@${c} or @${nickOf.get(c)}` : `@${c}`)));
  });
}

/** `--about`: a path (it has a slash) resolved (D6) and made repository-relative; a decision id or a bare name as given.
 *  A file not on disk is refused, unless `--new`. */
function aboutArg(ctx: VerbContext): string | undefined {
  const about = ctx.args.flag("--about");
  if (about === undefined || !/[\/]/.test(about)) return about;
  const { abs, missing } = resolveIn(ctx.pathsRoot(), about, { create: ctx.args.has("--new") });
  if (missing.length) fail(`no such file: ${missing.join(" nor ")}; pass --new if you are creating it (--about takes a file not yet on disk with --new)`);
  return repoRelative(ctx.pathsRoot(), abs);
}
