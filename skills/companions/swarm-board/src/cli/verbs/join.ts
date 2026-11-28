import path from "node:path";
import type { Declared, Participant } from "../../contract/board.ts";
import { FOREGROUND_WAIT_MS, eventOf } from "../../contract/events.ts";
import { discoverGuides, guidesLine, type Guide } from "../guides.ts";
import { resolveIn, worktreeOf } from "../../host/place.ts";
import { answer, CODE_WORDING, shellWord, WORDING } from "../answer/index.ts";
import type { VerbContext } from "../context.ts";
import { fail } from "../fail.ts";
import { rosterLine, shownOf } from "../lines.ts";
import { fwd, repoRelative, toolRoot } from "../paths.ts";
import { madeWorktree, memberWorktree } from "../pack-calls.ts";

export async function joinVerb(ctx: VerbContext): Promise<void> {
  // V-42 (board-split#D58): --as names the run's own group, never another run's member
  const joinAs = ctx.args.flag("--as");
  const joinRun = await ctx.runOf(ctx.runArg());
  if (joinAs !== undefined && joinRun && joinAs !== `${joinRun.group}/${joinedSeat(ctx)}`)
    fail(WORDING.joinAsOtherGroup(joinAs, joinRun.id, joinRun.group, WORDING.seatJoin(ctx.cli, joinRun.id, shellWord(joinRun.group), shellWord(ctx.need("--doing")), shellWord(joinedSeat(ctx)))));
  // trust-adaptations#D23 (v1-F1): a live member's worktree joins only as that member; taking a seat back from its
  // own worktree (its member ended, or the same one) or from the checkout stays open
  const joinName = `${joinRun?.group ?? ""}/${joinedSeat(ctx)}`;
  const here = worktreeOf(process.cwd());
  const owner = joinRun && here ? await ctx.board.identify({ place: here }) : null;
  if (owner && owner.name !== joinName) fail(WORDING.joinAsAnotherMember(joinName, owner.name));
  const own = await memberWorktree(ctx, ctx.runArg(), joinedSeat(ctx));
  const joined = await ctx.board.join({
    run: ctx.runArg(),
    seat: joinedSeat(ctx),
    doing: ctx.need("--doing"),
    files: [...ctx.args.list("--files"), ...ctx.args.flags("--file")].map((spec) => parseFile(ctx, spec)),
    place: own?.path ?? worktreeOf(process.cwd()) ?? undefined,
  });
  const { member, roster, composition } = joined;
  // spec §7: the worktree is made at join, so its link reads its changes from the start (§8: still by the pack)
  if (own) await madeWorktree(ctx, member, "join");
  // the project's guides, listed once at join: skills for the member to load, nothing the board checks
  const guidesAtJoin = own ? guidesLine(guidesHere(member)) : null;
  // the member's link, from now on how its verbs reach the board (D29), started by its agent (D32)
  const link = ctx.startLinkLine({ name: member.name, run: member.run });
  // a kind without worktree: the checkout is shared, so every call names the member (D21, D36)
  const shared = member.pack === null;
  // a verifier seat (verify set at join, D22) reads the merged branch and judges by post: its own lines (D12)
  const verifier = shared && member.verify;
  const as = verifier
    ? WORDING.verifierAs(member.name)
    : shared
    ? WORDING.sharedCheckoutAs(member.name)
    : own
      ? CODE_WORDING.ownWorktreeAs(own, fwd(own.path), shellWord(fwd(own.path)), member.name)
      : null;
  // board-split D59: a member re-joining a seat whose branch holds work not merged, without the merge lock (its last
  // member's was released when it went lost), is told so and how to take it again
  const unmergedNow = !shared && own?.reused ? ((await ctx.board.packCall(member, "unmerged", {})) as { branch: string; left: string } | null) : null;
  const lockNotHeld = unmergedNow && (await ctx.board.packCall(member, "held-merge-lock", {})) == null;
  const lockNotHeldLine = lockNotHeld && own ? CODE_WORDING.lockNotHeldAtJoin(CODE_WORDING.unmergedFact(unmergedNow.branch, unmergedNow.left), ctx.cli, shellWord(own.base), shellWord(member.name)) : null;
  const commands = verifier ? WORDING.verifierCommands(ctx.cli, shellWord(member.name)) : shared ? seatCommands(ctx, member.name) : null;
  // every member posts markdown shaped to what it says: agents do what the board prints (D2)
  const drawing = POSTS_MARKDOWN;
  // the run's current phase after the roster: a late or restarted member starts in it; then the owed phase and the
  // listener, after the link, so the agent starts its link before a wait blocks it (swarm-relay D33)
  // S1: a post for the seat made before its join is delivered here, whole, as a wait would (D8: marked delivered)
  const waiting = await ctx.board.deliverMentions(member);
  // S20: the roster read after that delivery, so the member's own row counts none of it as unread
  const rosterNow = waiting.full.length ? await ctx.board.roster(member.repo) : roster;
  const head = [`you are ${member.name}, ${member.nick}: @${member.seat} or @${member.nick.replace(/\s+/g, "")} mentions you`, ...composition.lines, ...rosterNow.map((r) => rosterLine(r, rosterNow))];
  // a seat taken back, or a run already under way: what came before is read back on demand, never delivered whole
  const history = joined.entry === "back" || (await ctx.board.currentPhase(member.run)) !== null ? WORDING.seatHistory(ctx.cli, member.run, member.seat) : null;
  const tail = [...(as ? [as] : []), ...(guidesAtJoin ? [guidesAtJoin] : []), ...(history ? [history] : []), ...(lockNotHeldLine ? [lockNotHeldLine] : []), ...(commands ?? []), ...(drawing ? [drawing] : []), link];
  // the phase and pause events are left out: the join's own phase or paused line states them (one fact, once)
  const statedByJoin = new Set(["phase", "pause"]);
  const shown = shownOf({ full: waiting.full.filter((m) => !statedByJoin.has(eventOf(m) ?? "")) });
  const a = answer({ verb: "join", head, shown, tail }, await ctx.situation(member));
  ctx.emitAnswer({ member: member.name, nick: member.nick, roster: rosterNow, composition, ...(shared ? { as: member.name, commands } : {}), ...(own ? { worktree: own.path, branch: own.branch, as: member.name } : {}), ...(lockNotHeldLine ? { lockNotHeld: true } : {}), ...(drawing ? { drawing } : {}), link }, a);
}

/** `join`'s member id: `--seat`. */
function joinedSeat(ctx: VerbContext): string {
  const seat = ctx.args.flag("--seat");
  return seat ?? fail(`--seat is required\n${ctx.verbHelp()}`);
}

/** What a seat's join tells it of its posts, before the listener line (D2). */
const POSTS_MARKDOWN = "posts are markdown, rendered on the board: steps as a list, options as a table, a task or a report in short headed parts, a flow or a structure as a mermaid block; more than one line goes through post --file <path>";

/** The commands a member of a kind without worktree runs next, `--as` filled in (D21, D36). */
const seatCommands = (ctx: VerbContext, as: string): string[] => WORDING.seatCommands(ctx.cli, shellWord(as), FOREGROUND_WAIT_MS);

/** The guides of the caller's repository: shipped beside this tool, and the project's own. */
const guidesHere = (p: Participant): Guide[] => discoverGuides(toolRoot(), p.place ?? worktreeOf(process.cwd()));

/** `<path>`, resolved (D6); a file not there yet is one the seat creates, declared from the repository root. */
const parseFile = (ctx: VerbContext, spec: string): Declared => ({ path: repoRelative(ctx.pathsRoot(), declaredPath(spec)) });

/** A declared file: from the shell's folder when it is there, else from the repository root (created, or not). */
const declaredPath = (file: string, root = worktreeOf(process.cwd())): string => {
  const { abs, missing } = resolveIn(root, file);
  // not there yet: one the seat creates, from the repository root
  return missing.length && root ? path.resolve(root, file) : abs;
};
