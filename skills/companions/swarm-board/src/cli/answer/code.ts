// The code pack's answers (board-split D8; product-shape#D20): every line a code verb (merge-lock, merged, worktree)
// or a code event (an overlap) makes a member read, the code verbs' help, and the rules choosing which of them a member
// reads after a code event, pure functions over the event and its reader, as rules.ts is for the core. Still the answer
// module (AGENTS rule 13); the core lines stay in wording.ts.
import type { Message, Participant } from "../../contract/board.ts";
import { type EventName, eventOf, FOREGROUND_WAIT_MS } from "../../contract/events.ts";
import { planCode } from "../../board/conversation/mentions.ts";
import type { Command, VerbUsage } from "./command.ts";
import type { Situation } from "./situation.ts";
import { shellWord, WORDING as W } from "./wording.ts";

/** The code pack's words inside the core help's lines (D12: one static help, its code parts the pack's), so the
 *  core help reads as before. */
export const CODE_IN_CORE_HELP = {
  codeVerbs: "the merge verbs",
  ontoLine: "          # --onto: the branch a code run's worktrees branch from and merge into, default the checkout's branch",
  pauseRefuses: "merge-lock refused",
  closeRemoves: "removes the run's worktrees that are clean and merged, names those it kept and why",
  joinMakes: "on a code run (plan, task) it names your worktree, <git dir>/swarm/worktrees/<run>/<seat> on branch swarm/<run>-<group>/<seat>, made at join, or reuses it",
  withoutAs: "the member joined from this worktree",
};

/** The code verbs' entries of VERB_USAGE (codebase-rework#D12): their help lines and the corrected form an argument
 *  error offers, in help order. */
export const CODE_VERB_USAGE = {
  "merge-lock": {
    lines: () => [
      "  merge-lock [--report <text>|--report-stdin|--report-file <path>] [--onto <branch>] [--as <member>]   # delivers your committed branch, one merge at a time per repository: the board rebases it, fast-forwards and records merged, your report posted to the orchestrator (none given: your commits' subjects; a long one piped in with --report-stdin); only a clean merge passes: a conflict is handed back, nothing merged, the lock released; edit the files it names, then run it again (it stages them and goes on); --onto defaults to the run's own",
      "  merge-lock --lock-only [--onto <branch>] [--as <member>]        # the lock alone, for a merge made by hand, recorded with merged; what a member with no worktree always gets",
    ],
    example: (as) => `merge-lock --onto main --as ${as}`,
  },
  merged: {
    lines: () => [
      "  merged  [--as <member>] <sha> --report <text>|- | --report-file <path> [--unlocked <why>]   # records a merge made by hand; refused without the merge lock on a code run (--unlocked: the orchestrator's alone, the why posted in the run); releases the lock, tells who holds a file it changed and who was refused the lock, names whom to tell of a resolved conflict; posts \"@orchestrator merged <sha>: <text>\", your report and its one wake; --report-file <path>: a long report from a file; --report - merges silently",
    ],
    example: (as) => `merged 1a2b3c4 --report "what I did" --as ${as}`,
  },
  // product-shape#D28 (P-4): worktree prune is the code pack's, so its line is in --help code, no longer the core help
  worktree: { lines: () => ["  worktree prune                                                  # removes the board's worktrees of closed runs that are clean and merged; names the others and why"], example: () => "worktree prune" },
} satisfies Record<string, VerbUsage>;

export const CODE_WORDING = {
  // board-fixes#D6: a code run's close: its members finish by merging, the closing table names each merge
  closeFinish: "merged, reported, done",
  closeColumns: "| task | seat | state | merge sha |",
  /** The code help's first line; its verbs' lines are CODE_VERB_USAGE's (D22). */
  usageHead: (cli: Command): string =>
    `usage: ${cli} <verb> [--json]        the code verbs; refused on a run whose kind has none; the files you hold are what your worktree changed, read by your link`,

  /** board-split D36: what the code pack says of a member beside its state, on its roster line */
  /** board-split D19 (F9): files a member declared at join that another member held, so not claimed; shown till claimed */
  declaredNotClaimed: (paths: string[]) => `  declared, held by another: ${paths.join(", ")}; to share it, tell its holder what you change (post --about it), then claim it`,
  // V-21: printed after the state word, which already reads `merging`
  memberFact: { merging: "holds the merge lock" },
  /** board-split D52 (U-F18): the project's merge lock, beside the named locks in `locks` and `status` */
  mergeLockLine: (project: string, holder: string, since: string, waiters: string[] = []) =>
    `merge lock of ${project}  held by ${holder} since ${since}${waiters.length ? `  waiters: ${waiters.join(", ")}` : ""}`,

  // ── the merge (V12: every command runnable as printed) ──
  mergeGranted: (cli: Command, as: string) =>
    // board-fixes#D11: the tests the task asked for ran before the lock; under it only rebase, quick check, fast-forward
    // the lock alone (--lock-only, or a member with no worktree): the merge is made by hand
    `granted: under the lock only rebase, the task's quick check (the tests covering the files you touched; the tests your task asked for have finished before merge-lock), fast-forward (a long report: --report-file <path> in place of --report), then ${cli} merged <sha> --report "<your report>" --as ${as}`,
  /** board-split#D66 (V-20): the target branch checked out in a worktree refuses every fast-forward into it */
  detach: (worktree: string): Command => `git -C ${worktree} switch --detach`,
  ontoCheckedOutAtOpen: (onto: string, worktree: string, detach: Command) =>
    `${onto} is checked out at ${worktree}: git refuses a worker's fast-forward into a checked-out branch; detach it before the first merge: ${detach}`,
  ontoCheckedOutAtMerge: (onto: string, worktree: string, holder: string | null, detach: Command) =>
    `${onto} is checked out at ${worktree}${holder ? ` (${holder}'s worktree)` : ""}: git would refuse your fast-forward; ask the orchestrator to detach it (${detach}), then run merge-lock again`,
  // the delivery: the board rebases and fast-forwards; only a clean merge passes, and what does not is handed back
  // with the lock released. On a conflict the worker's one part is the files: it edits them and runs the call again
  autoConflict: (onto: string, files: string[], again: Command) =>
    `rebasing onto ${onto} met a conflict in ${files.join(", ")}: nothing merged, the lock released; the rebase is stopped in your worktree with the conflict marked in each file: edit each to what it must be, run no git command, then: ${again}`,
  autoStillConflicted: (files: string[], again: Command) => `still conflicted: ${files.join(", ")} carry conflict markers (<<<<<<< or >>>>>>>); edit each to what it must be, then: ${again}`,
  autoRebaseFailed: (onto: string, why: string) => `rebase onto ${onto} failed (${why}); nothing merged, the lock released: commit what is uncommitted, then merge-lock again`,
  autoNothing: (onto: string) => `nothing to deliver: your branch has no commit ${onto} lacks; the lock released`,
  autoPushFailed: (onto: string, why: string) => `fast-forward of ${onto} refused (${why}); nothing merged, the lock released: merge-lock again`,
  autoFreed: (waiters: string[], who: string) => `${waiters.map((w) => `@${w}`).join(" ")} the merge lock is free: ${who} merged nothing; take it now`,
  // V-27: the command last
  mergeHeld: (holder: string, wait: Command) => `held by ${holder}: wait for its merged event, then take the lock again: ${wait}`,

  /** V-32 (D69): merged's report refusals, naming --report-file */
  reportMissing: 'merged: --report "<what you did>" is your report to the orchestrator, its one wake (--report-file <path> for a long one); --report - merges silently',
  reportIsAFile: (given: string) => `merged: --report takes the report's text, and ${given} is a file: pass it as --report-file ${given}`,
  reportFileUnreadable: (file: string) => `merged: --report-file ${file} cannot be read`,
  reportStdinEmpty: "merged: --report-stdin read no report: pipe it in, a heredoc for a long one",

  // S32: said at the grant, before the rebase and the report, never after the report is written
  conflictsInReport: "if your rebase conflicts in a file another member changed, resolve it and say how in merged's --report",
  tellResolved: (path: string, member: string) => `if you resolved a conflict in ${path}, tell them: swarm post "@${member} I resolved ${path}: <how>" --about ${path}`,

  // ── board-split T52: the lock, the held claim, the unmerged work (V-2, V-7, V-13) ──
  /** V-36 (D71): the paused line of the merge lock's holder: finish that merge, then stop */
  pausedMerging: (run: number, why: string, wait: Command) =>
    `run ${run} is paused${why}. You hold the merge lock: finish that merge (rebase, quick check, fast-forward, merged), start nothing else, then wait in the foreground for the resume: ${wait}`,
  /** V-36 (D71): the pause's answer names the merge lock's holder, who lands its merge first */
  pauseLockHolder: (holder: string) => `${holder} holds the merge lock: it finishes that merge, then stops; its merged still lands in the pause`,
  /** V-22: a member refused the merge lock, told it is free (its holder went lost): the command last (rule 10) */
  mergeLockFree: (cli: Command, as: string) => `it is free: take it now: ${cli} merge-lock --as ${as}`,
  /** V-45: a close while a member of the run holds the merge lock: its merge did not land */
  closedLockHolder: (holder: string) => `${holder} held the merge lock: its merge did not land; the lock is released, its branch keeps the work`,
  /** V-40: the orchestrator ending a live seat whose branch holds work not merged */
  endSeatUnmerged: (member: string, unmerged: string, close: Command) =>
    `end --seat: ${member} is not ended: ${unmerged}. Its member merges it first (tell it on the thread), or the run's close keeps the branch: ${close}`,
  /** V-27: what a seat's branch holds not merged, said once: the branch named by the fact, or before it */
  unmergedFact: (branch: string, left: string) => (left.startsWith("branch ") ? left : `branch ${branch} has ${left}`),
  /** D59: a member joining a seat whose branch holds work not merged, not holding the merge lock (its last member's
   *  was released when it went lost); the command last */
  lockNotHeldAtJoin: (unmerged: string, cli: Command, onto: string, as: string) =>
    `you do not hold the merge lock; ${unmerged}: take the lock again to merge it: ${cli} merge-lock --onto ${onto} --as ${as}`,
  /** D59: the orchestrator ended a seat whose worktree holds work not merged: accepted, the branch kept */
  endedSeatUnmerged: (member: string, unmerged: string) =>
    `${member} ended; ${unmerged}, kept: dispatch a member to the seat to merge it, or merge it yourself`,
  /** D63: a done with commits not merged: accepted, the branch, the count and the merge step named, the command last */
  unmergedAtDone: (unmerged: string, cli: Command, onto: string, as: string) => `${unmerged}: merge it: ${cli} merge-lock --onto ${onto} --as ${as}`,

  // ── spec §7: an overlap, a path two members' worktrees both changed: the one told settles it with the other ──
  overlapSettle: (cli: Command, other: string, otherName: string, about: string, as: string) => `settle it: ${cli} agree ${other} --with ${otherName} --about ${about} --as ${as}`,

  // ── codebase-rework#D13: lines the CLI's code verbs wrote themselves before ──
  /** a call with no --as from a place no single member joined from (board-split D24: the core says no worktree) */
  whoIsCalling: "who is calling? no single member joined from this worktree; pass --as <group>/<seat>",
  /** a close kept a worktree not clean or not merged: why, and the prune once it is */
  keptWorktree: (worktree: string, member: string, why: string | null, cli: Command) => `kept ${worktree} (${member}): ${why}; merge it or discard it, then: ${cli} worktree prune`,
  /** join, on a code run: the member's own worktree and how to work there */
  ownWorktreeAs: (own: { branch: string; base: string; reused: boolean }, path: string, pathWord: string, member: string) =>
    `your worktree: ${path} (branch ${own.branch} from ${own.base}${own.reused ? ", reused" : ""}). Work there by absolute paths and git -C ${pathWord}, never cd into it; pass --as ${member} on every call`,
  /** the same merge-lock call, as the member runs it again once what was handed back is fixed; `report` its report words */
  mergeLockAgain: (cli: Command, onto: string, report: readonly string[], as: string): Command => [cli, "merge-lock", "--onto", onto, ...report, "--as", as].join(" "),
  /** merged on a code run without the merge lock */
  mergedWithoutLock: (cli: Command, onto: string, as: string) => `merged: you do not hold the merge lock; run ${cli} merge-lock --onto ${onto} --as ${as} first, then merge, then merged again`,
  /** end refused: the member's worktree holds work not merged; `step` what it does first, the merge command last */
  endUnmerged: (worktree: string, left: string, step: string, merge: Command) => `end: your worktree ${worktree} holds work not merged: ${left}. ${step}: ${merge}; then end again`,
  endCommitThenMerge: "Commit it, then merge it",
  endMergeIt: "Merge it",
  mergeLockReport: (cli: Command, onto: string, as: string): Command => `${cli} merge-lock --onto ${onto} --report "<what you did>" --as ${as}`,
} as const;

// ── the rules ──

/** board-fixes#D6: a code run's first `close`: its members finish by merging, its closing table names each merge sha. */
export const codeCloseStep = (owing: string[], run: number, confirm: string): string =>
  owing.length ? W.closeWaitRunning(run, owing, CODE_WORDING.closeFinish) : W.closeSteps(run, confirm, CODE_WORDING.closeColumns);

/** A member as `me` mentions it: `@<seat>` in its own run, `@<CODE>·<seat>` in another. */
const mentionFrom = (me: Participant, member: string): string => {
  const [plan, seat] = [member.slice(0, member.lastIndexOf("/")), member.slice(member.lastIndexOf("/") + 1)];
  return plan === me.plan ? `@${seat}` : `@${planCode(plan)}·${seat}`;
};

/** board-split V-36 (D71): the paused line of the merge lock's holder: it finishes that merge, then stops. */
export const pausedMergingStep = (s: Situation): string | null =>
  s.pause ? CODE_WORDING.pausedMerging(s.run, W.pauseWhy(s.pause.person, s.pause.text), W.wait(s.cli, s.as, FOREGROUND_WAIT_MS)) : null;

/** The merge lock's name in an `unlocked` event, as the code pack posts it (contract/code.ts MERGE_LOCK). */
const MERGE_LOCK = "merge-lock";

/** The line under a code event for `me`; null for one that asks nothing of it; undefined for an event not the code
 *  pack's (the core words it). */
export function codeEventStep(m: Message, me: Participant, cli: string, event: EventName | null = eventOf(m)): string | null | undefined {
  if (event === "merged") {
    // V-49: a merge that frees the lock gives each member refused it the merge-lock command, as the lost path does
    const free = m.meta && "free" in m.meta ? (m.meta.free ?? []) : [];
    return free.includes(me.name) ? CODE_WORDING.mergeLockFree(cli, shellWord(me.name)) : null;
  }
  if (event === "unlocked") {
    // board-split V-22: the merge lock freed from a lost holder: a waiter's step is the merge-lock command; the
    // orchestrator's lost alarm already told it
    if (!m.meta || !("unlocked" in m.meta) || m.meta.unlocked !== MERGE_LOCK) return undefined;
    return me.seat !== "orchestrator" && m.mentions.includes(me.name) ? CODE_WORDING.mergeLockFree(cli, shellWord(me.name)) : null;
  }
  if (event !== "flag") return undefined;
  // spec §7: an overlap names the two members whose worktrees changed the path; the one it is posted to settles it
  // with the other (a row from before the meta: its mentions, the holder then the writer)
  const [holder, writer] = m.meta && "holder" in m.meta ? [m.meta.holder, m.meta.writer] : m.mentions;
  if (!m.about || !holder || !writer || (me.name !== holder && me.name !== writer)) return null;
  const other = me.name === holder ? writer : holder;
  return CODE_WORDING.overlapSettle(cli, shellWord(`${mentionFrom(me, other)} <who changes what>`), shellWord(other), shellWord(m.about), shellWord(me.name));
}

/** codebase-rework#D13: an end refused over work not merged: uncommitted work is committed first, then merged. */
export const endUnmergedLine = (worktree: string, left: string, merge: string): string =>
  CODE_WORDING.endUnmerged(worktree, left, /uncommitted/.test(left) ? CODE_WORDING.endCommitThenMerge : CODE_WORDING.endMergeIt, merge);
