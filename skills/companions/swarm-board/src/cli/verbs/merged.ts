import type { Sharer, Participant } from "../../contract/board.ts";
import type { HeldMergeLock } from "../../contract/code.ts";
import { git, gitAnswer } from "../../host/git.ts";
import { conflictsOf, MERGE_CONFLICTS_ENV, type Conflicts } from "../conflicts.ts";
import { CODE_WORDING, shellWord } from "../answer/index.ts";
import * as rules from "../answer/rules.ts";
import type { VerbContext } from "../context.ts";
import { fail } from "../fail.ts";
import { commitChanged, fwd } from "../paths.ts";
import { packVerb, refuseWithoutPack, reportGiven } from "../pack-calls.ts";

export async function mergedVerb(ctx: VerbContext, p: Participant): Promise<void> {
  refuseWithoutPack(p, "merged");
  const sha = ctx.args.positional[0] ?? fail("merged: which sha?");
  // the report rides on the merge: one post, the orchestrator's one wake; "-" merges silently, recorded in the run only
  const report = reportGiven(ctx) ?? fail(CODE_WORDING.reportMissing);
  // what a rebase since the lock's grant met, read before the lock goes (D3, D25, D36); no worktree, no lock or no mark: unknown (D33)
  const lock = (await packVerb(ctx, p, "held-merge-lock", {})) as HeldMergeLock | null;
  // a code run merges one at a time: no lock, no merged; the orchestrator alone may merge past it, saying why
  const unlocked = ctx.args.flag("--unlocked")?.trim();
  if (!lock && p.pack !== null) {
    if (unlocked === undefined) {
      return fail(CODE_WORDING.mergedWithoutLock(ctx.cli, shellWord((await ctx.runOf(p.run))?.base ?? "<branch>"), shellWord(p.name)));
    }
    if (!p.name.endsWith("/orchestrator")) fail("merged: --unlocked is the orchestrator's alone; take the merge lock: merge-lock --onto <branch>");
    if (!unlocked) fail('merged: --unlocked "<why>" says why the merge skipped the lock');
  }
  // a commit git knows is on the branch the lock names, or it was not merged (V1)
  // V1: a sha git does not know was never merged
  if (lock?.onto && p.place && !git(p.place, "rev-parse", "--verify", "-q", "--end-of-options", `${sha}^{commit}`))
    fail(`merged: ${sha} is no commit git knows in ${fwd(p.place)}; give the sha you pushed onto ${lock.onto}: git -C ${fwd(p.place)} rev-parse --short HEAD`);
  if (lock?.onto && p.place && gitAnswer(p.place, "merge-base", "--is-ancestor", "--end-of-options", sha, lock.onto).status !== 0)
    fail(`merged: ${sha} is not on ${lock.onto}; fast-forward it first: git -C ${fwd(p.place)} push . HEAD:${lock.onto}, then merged again`);
  // merge-lock, delivering, ran the merge and says what it handed back; by hand, the rebase since the grant says it
  const handed = process.env[MERGE_CONFLICTS_ENV];
  const conflicts = handed ? (JSON.parse(handed) as Conflicts) : p.place && lock && lock.reflogMark !== null ? conflictsOf(p.place, lock.onto ?? "", lock.reflogMark) : undefined;
  // the files of the merge, never typed (a --files given is read and ignored): what the branch changed, recorded with
  // the lock at its grant; a lock taken with no worktree: the member's claims; past the lock: the commit's own change
  const files = lock ? (lock.files ?? (await ctx.board.heldBy(p))) : commitChanged(p.place ?? ctx.pathsRoot(), sha);
  const sharers = (await packVerb(ctx, p, "merged", { sha, files, conflicts })) as Sharer[];
  const reported = report === "-" ? null : await ctx.board.post(p, `@orchestrator merged ${sha}: ${report}`, { kind: "msg" });
  // a merge past the lock is recorded in the run, with its why
  if (!lock && unlocked) await ctx.board.post(p, `merged ${sha} without the merge lock: ${unlocked}`, { kind: "msg" });
  // the post after a resolved conflict, prompted by the command just run (D63)
  const ended = new Set(await ctx.board.endedMembers(p.repo));
  // S32: the report's word on a resolved conflict was asked at merge-lock; here only a member still there is told
  const tell = sharers.filter((o) => !ended.has(o.member)).map((o) => CODE_WORDING.tellResolved(o.path, o.member));
  // the worktree stays for the seat's next task; end, close and prune remove it
  // simple-states: merged and reported, a member owing nothing ends its turn
  const after = await ctx.situation(p);
  // the end-turn line, or the undelivered messages to read first (owesNothingLine says which); else those alone
  const endTurn = (reported ? rules.owesNothingLine(after) : null) ?? rules.unreadLine(after, "merged");
  ctx.emit({ member: p.name, sha, files, tell, ...(reported ? { reported: reported.seq } : {}), ...(endTurn ? { next: endTurn } : {}) }, () => {
    console.log(`merged ${sha}: lock released${reported ? `; reported as #${reported.seq}` : ""}`);
    for (const line of tell) console.log(line);
    if (endTurn) console.log(endTurn);
  });
}
