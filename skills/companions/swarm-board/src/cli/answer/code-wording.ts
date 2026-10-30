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
  joinMakes: "on a code run (plan, task) it makes your worktree under the data home, branch swarm/<run>-<group>/<seat>, or reuses it",
  onExample: "agreement,any:merged",
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
      "  merged  [--as <member>] <sha> --files <path>... --report <text>|- [--guides \"<name>:ok|n/a <why>, ...\"] [--unlocked <why>]   # refused without the merge lock on a code run (--unlocked: the orchestrator's alone, the why posted in the run); releases the lock, tells who must rebase and who was refused the lock, names whom to tell of a resolved conflict; posts \"@orchestrator merged <sha>: <text>\", your report and its one wake; --report - merges silently",
    ].join("\n"),

  /** board-split D36: what the code pack says of a member beside its state, on its roster line */
  /** board-split D19 (F9): files a member declared at join that another member held, so not claimed; shown till claimed */
  declaredNotClaimed: (paths: string[]) => `  declared, held by another: ${paths.join(", ")}; to share it, tell its holder what you change (post --about it), then claim it`,
  memberFact: { merging: "merging (holds the merge lock)" },

  // ── the merge (V12: every command runnable as printed) ──
  mergeGuides: (guides: string) => `guides of this merge: ${guides}; check your change against each, then settle each in merged's --guides below`,
  /** S4: the --guides form filled with this merge's guides, as merged takes it */
  guidesForm: (guides: string[]) => `"${guides.map((g) => `${g}:ok|n/a <why>`).join(", ")}"`,
  mergeGranted: (cli: Command, as: string, guidesForm: string | null) =>
    `granted: merge, then ${cli} merged <sha> --files <path>... --report "<your report>"${guidesForm ? ` --guides ${guidesForm}` : ""} --as ${as}`,
  /** D2: an argument error names what is wrong, then usage, then one corrected form */
  guidesRefused: (problem: string, corrected: string) => `merged: --guides ${problem}; usage: --guides "<name>:ok|n/a <why>, ..."; corrected: --guides ${corrected}`,
  mergeHeld: (holder: string, wait: Command) => `held by ${holder}: ${wait} for its merged event`,

  // S32: said at the grant, before the rebase and the report, never after the report is written
  conflictsInReport: "if your rebase conflicts in a file another member changed, resolve it and say how in merged's --report",
  tellResolved: (path: string, member: string) => `if you resolved a conflict in ${path}, tell them: swarm post "@${member} I resolved ${path}: <how>" --about ${path}`,

  // ── a flag: a write outside the writer's claim on a path another holds (D10) ──
  flagHolder: (cli: Command, writer: string, about: string) => `settle it: ${cli} agree ${writer} --about ${about}`,
  flagWriter: (cli: Command, holder: string, about: string) => `settle it: ${cli} post ${holder} --about ${about}`,
} as const;
