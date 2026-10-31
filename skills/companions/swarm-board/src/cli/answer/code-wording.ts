// The code pack's wording (board-split D8): every line a code verb (claim, release, merge-lock, merged) or a code event
// (flag) makes a member read, and the code verbs' help. Still the answer module (AGENTS rule 13); which line a member
// reads is code-rules.ts's choice. The core lines stay in wording.ts.
import type { Command } from "./wording.ts";

/** The code pack's words inside the core help's lines (D12: one static help, its code parts the pack's), so the
 *  core help reads as before. */
export const CODE_IN_CORE_HELP = {
  codeVerbs: "the claim and merge verbs",
  ontoLine: "          # --onto: the branch a code run's worktrees branch from and merge into, default the checkout's branch",
  pauseRefuses: "claim and merge-lock refused",
  closeRemoves: "removes the run's worktrees that are clean and merged, names those it kept and why",
  joinMakes: "on a code run (plan, task) it names your worktree, <git dir>/swarm/worktrees/<run>/<seat> on branch swarm/<run>-<group>/<seat>, made at your first claim or merge-lock, or reuses it",
  pruneLine: "  worktree prune                                                  # removes the board's worktrees of closed runs that are clean and merged; names the others and why",
  withoutAs: "the member joined from this worktree",
};

export const CODE_WORDING = {
  /** The code verbs' help, apart from the core (D22). */
  usage: (cli: Command): string =>
    [
      `usage: ${cli} <verb> [--json]        the code verbs; refused on a run whose kind has no claims`,
      "  claim   [--as <member>] <path>... [--interface] [--new]            # before editing a file: exit 0 claimed, 3 held until you post about it (the post claims it); --new: a file you create",
      "  release [--as <member>] <path>... | --all                        # gives up a claim; --all: every claim you hold",
      "  merge-lock [--onto <branch>] [--as <member>]                    # one merge at a time per repository; --onto defaults to the run's own; claims or flags what your branch wrote unclaimed",
      "  merged  [--as <member>] <sha> --files <path>... --report <text>|- | --report-file <path> [--guides \"<name>:ok|n/a <why>, ...\"] [--unlocked <why>]   # refused without the merge lock on a code run (--unlocked: the orchestrator's alone, the why posted in the run); releases the lock, tells who must rebase and who was refused the lock, names whom to tell of a resolved conflict; posts \"@orchestrator merged <sha>: <text>\", your report and its one wake; --report-file <path>: a long report from a file; --report - merges silently",
    ].join("\n"),

  /** board-split D36: what the code pack says of a member beside its state, on its roster line */
  /** board-split D19 (F9): files a member declared at join that another member held, so not claimed; shown till claimed */
  declaredNotClaimed: (paths: string[]) => `  declared, held by another: ${paths.join(", ")}; to share it, tell its holder what you change (post --about it), then claim it`,
  // V-21: printed after the state word, which already reads `merging`
  memberFact: { merging: "holds the merge lock" },
  /** board-split D52 (U-F18): the project's merge lock, beside the named locks in `locks` and `status` */
  mergeLockLine: (project: string, holder: string, since: string, waiters: string[] = []) =>
    `merge lock of ${project}  held by ${holder} since ${since}${waiters.length ? `  waiters: ${waiters.join(", ")}` : ""}`,

  // ── the merge (V12: every command runnable as printed) ──
  mergeGuides: (guides: string) => `guides of this merge: ${guides}; check your change against each, then settle each in merged's --guides below`,
  /** S4: the --guides form filled with this merge's guides, as merged takes it */
  guidesForm: (guides: string[]) => `"${guides.map((g) => `${g}:ok|n/a <why>`).join(", ")}"`,
  mergeGranted: (cli: Command, as: string, guidesForm: string | null) =>
    // board-split D52: the full suite ran before the lock; under it only rebase, quick check, fast-forward
    `granted: under the lock only rebase, the task's quick check (the tests covering the files you touched; your full suite ran before merge-lock), fast-forward (a long report: --report-file <path> in place of --report), then ${cli} merged <sha> --files <path>... --report "<your report>"${guidesForm ? ` --guides ${guidesForm}` : ""} --as ${as}`,
  /** D2: an argument error names what is wrong, then usage, then one corrected form */
  guidesRefused: (problem: string, corrected: string) => `merged: --guides ${problem}; usage: --guides "<name>:ok|n/a <why>, ..."; corrected: --guides ${corrected}`,
  /** board-split#D66 (V-20): the target branch checked out in a worktree refuses every fast-forward into it */
  detach: (worktree: string): Command => `git -C ${worktree} switch --detach`,
  ontoCheckedOutAtOpen: (onto: string, worktree: string, detach: Command) =>
    `${onto} is checked out at ${worktree}: git refuses a worker's fast-forward into a checked-out branch; detach it before the first merge: ${detach}`,
  ontoCheckedOutAtMerge: (onto: string, worktree: string, holder: string | null, detach: Command) =>
    `${onto} is checked out at ${worktree}${holder ? ` (${holder}'s worktree)` : ""}: git would refuse your fast-forward; ask the orchestrator to detach it (${detach}), then run merge-lock again`,
  // V-27: the command last
  mergeHeld: (holder: string, wait: Command) => `held by ${holder}: wait for its merged event, then take the lock again: ${wait}`,

  /** V-32 (D69): merged's report refusals, naming --report-file */
  reportMissing: 'merged: --report "<what you did>" is your report to the orchestrator, its one wake (--report-file <path> for a long one); --report - merges silently',
  reportIsAFile: (given: string) => `merged: --report takes the report's text, and ${given} is a file: pass it as --report-file ${given}`,

  // S32: said at the grant, before the rebase and the report, never after the report is written
  conflictsInReport: "if your rebase conflicts in a file another member changed, resolve it and say how in merged's --report",
  tellResolved: (path: string, member: string) => `if you resolved a conflict in ${path}, tell them: swarm post "@${member} I resolved ${path}: <how>" --about ${path}`,

  // ── board-split T52: the lock, the held claim, the unmerged work (V-2, V-7, V-13) ──
  /** V-13: a claim held by another member (D41): the post to make, runnable as printed, its mentions the caller's own */
  claimHeld: (path: string, who: string, many: boolean, post: Command) =>
    `${path} is also held by ${who}. You may share it, but first tell ${many ? "them" : "its holder"} what you change in it: ${post}; ` +
    `${many ? "they answer" : "its holder answers"} with an agreement on who changes what, and that agreement goes. Claim again once posted; do not wait for the agreement.`,
  claimHeldPost: (cli: Command, mentions: string, about: string, as: string) => `${cli} post "${mentions} <what you change>" --about ${about} --as ${as}`,
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

  // ── a flag: a write outside the writer's claim on a path another holds (D10) ──
  flagHolder: (cli: Command, writer: string, about: string) => `settle it: ${cli} agree ${writer} --about ${about}`,
  flagWriter: (cli: Command, holder: string, about: string) => `settle it: ${cli} post ${holder} --about ${about}`,
} as const;
