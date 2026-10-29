// The code pack's entry (board-split#D1, D18): claims, merges and worktrees, the verbs a worker of a code run has.
// Its tables are the claims store (D20); its worktrees are made at the first claim or merge-lock, in the board
// server, before any transaction opens (D19); its end refuses work not merged and removes the worktree after (D38).
import fs from "node:fs";
import path from "node:path";
import type { MemberWorktree, Participant } from "../../board/board.ts";
import { baseAt } from "../../git.ts";
import type { Pack, PackCtx, PackRefusal, PackVerbInput } from "../types.ts";
import { type Claims, claimsOf } from "./claims.ts";
import { codeStats } from "./stats.ts";
import { sweepAll, sweepLegacy, worktrees, type WorktreeRecord } from "./worktrees.ts";

const slashed = (p: string): string => p.split("\\").join("/");

/** The member's board worktree, when the board made it and it is there; null otherwise. */
const ownWorktree = (member: Participant): string | null => {
  const seatTrees = worktrees(member.repo);
  return seatTrees.owns(member.worktree) && fs.existsSync(member.worktree) ? slashed(member.worktree) : null;
};

/** Makes the member's worktree when its join only named it (G20): a member that never claims or merges gets none.
 *  A git failure is a refusal fact; nothing is written (D19). */
function makeWorktree(verb: string, member: Participant, input: PackVerbInput, ctx: PackCtx): PackRefusal | { made: boolean } {
  if (!member.worktree || !worktrees(member.repo).owns(member.worktree) || fs.existsSync(member.worktree)) return { made: false };
  const base = ctx.base ?? (typeof input.cwd === "string" ? baseAt(input.cwd) : null);
  if (!base) return { refused: { reason: "git", verb, detail: `${member.name}: no base to make the worktree from` } };
  try {
    worktrees(member.repo).forSeat(ctx.run, ctx.group, member.seat, base);
    return { made: true };
  } catch (e) {
    return { refused: { reason: "git", verb, detail: (e as Error).message } };
  }
}

/** The code pack's tables, as the board hands them in the run's context (D20). */
const tablesOf = (ctx: PackCtx): Claims => ctx.tables;

export const codePack: Pack = {
  name: "code",
  verbs: ["claim", "release", "merge-lock", "merged", "flag", "conflicts", "unclaimed", "guides"].map((name) => ({ name })),
  stats: codeStats,
  // from any run, an agreement or endorsement about a path the member holds is for it too (D26, plan D2)
  alsoFor: (member, message, ctx) =>
    (message.kind === "agreement" || message.kind === "endorsement") && message.about != null && tablesOf(ctx).holderNames(member.repo, message.about).includes(member.name),
  // an agreement with no party named binds the file's other holders (F25)
  defaultParties: (about, ctx) => tablesOf(ctx).holderNames(ctx.repo, about),
  // a member holding a claim or the merge lock is mid-work, never idle
  busy: (member, ctx) => tablesOf(ctx).holdsAny(member),

  openTables: (deps) => claimsOf(deps),

  run(verb, member, input, ctx) {
    switch (verb) {
      // where a joining seat's worktree goes, named and not made (G20)
      case "place":
        return ctx ? worktrees(ctx.repo).place(ctx.run, ctx.group, String(input.seat), String(input.cwd)) : null;
      case "claim":
      case "merge-lock":
        return member && ctx ? makeWorktree(verb, member, input, ctx) : { made: false };
      // a run's close: its worktrees go once clean and merged, each seat's link stopped first
      case "close": {
        const trees = (input.trees as MemberWorktree[]).filter((w) => worktrees(w.repo).owns(w.worktree) && fs.existsSync(w.worktree));
        return trees.map((w) => ({ worktree: slashed(w.worktree), member: w.member, ...worktrees(w.repo).release({ run: w.run, member: w.member, worktree: w.worktree }, w.base) }));
      }
      // `worktree prune`: every worktree folder of each repository the board knows, judged by its latest record
      case "prune": {
        const known = input.known as MemberWorktree[];
        const fold = (s: string) => (process.platform === "win32" ? path.resolve(s).toLowerCase() : path.resolve(s));
        const recordOf = (dir: string): WorktreeRecord | null => known.filter((k) => fold(k.worktree) === fold(dir)).at(-1) ?? null;
        return sweepAll(input.repos as string[], recordOf).map((o) => ({ ...o, worktree: slashed(o.worktree) }));
      }
      case "legacy":
        return sweepLegacy();
      default:
        return null;
    }
  },

  beforeEnd(member, ctx) {
    const mine = ownWorktree(member);
    const left = mine ? worktrees(member.repo).unmerged(mine, ctx.base) : null;
    return mine && left ? { reason: "unmerged", worktree: mine, left, base: ctx.base } : null;
  },

  afterEnd(member, ctx) {
    const mine = ownWorktree(member);
    if (!mine) return {};
    // its link goes first, inside release: Windows holds a folder a live process is in
    const why = worktrees(member.repo).release({ run: member.run, member: member.name, worktree: mine }, ctx.base).why;
    return { worktree: mine, removed: why === null, why };
  },
};
