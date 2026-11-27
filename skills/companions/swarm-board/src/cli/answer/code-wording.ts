// The code pack's wording (board-split D8): every line a code verb (merge-lock, merged) or a code event
// (an overlap) makes a member read, and the code verbs' help. Still the answer module (AGENTS rule 13); which line a member
// reads is code-rules.ts's choice. The core lines stay in wording.ts.
import type { Command, VerbUsage } from "./wording.ts";

/** The code pack's words inside the core help's lines (D12: one static help, its code parts the pack's), so the
 *  core help reads as before. */
export const CODE_IN_CORE_HELP = {
  codeVerbs: "the merge verbs",
  ontoLine: "          # --onto: the branch a code run's worktrees branch from and merge into, default the checkout's branch",
  pauseRefuses: "merge-lock refused",
  closeRemoves: "removes the run's worktrees that are clean and merged, names those it kept and why",
  joinMakes: "on a code run (plan, task) it names your worktree, <git dir>/swarm/worktrees/<run>/<seat> on branch swarm/<run>-<group>/<seat>, made at join, or reuses it",
  pruneLine: "  worktree prune                                                  # removes the board's worktrees of closed runs that are clean and merged; names the others and why",
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
} as const;
