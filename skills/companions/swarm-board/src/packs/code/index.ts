// The code pack's entry (board-split#D1, D18): claims, merges and worktrees, the verbs a worker of a code run has.
// Inert in phase 2: its verbs are listed, its pack methods absent; phase 3 moves the work behind them.
import type { Claims } from "../../board/claims.ts";
import type { Pack, PackCtx } from "../types.ts";
import { codeStats } from "./stats.ts";

/** The code pack's tables, as the board hands them in the run's context (D20). */
const claimsOf = (ctx: PackCtx): Claims => ctx.tables as Claims;

export const codePack: Pack = {
  name: "code",
  verbs: ["claim", "release", "merge-lock", "merged", "flag", "conflicts", "unclaimed", "guides"].map((name) => ({ name })),
  stats: codeStats,
  // from any run, an agreement or endorsement about a path the member holds is for it too (D26, plan D2)
  alsoFor: (member, message, ctx) =>
    (message.kind === "agreement" || message.kind === "endorsement") && message.about != null && claimsOf(ctx).holderNames(member.repo, message.about).includes(member.name),
  // an agreement with no party named binds the file's other holders (F25)
  defaultParties: (about, ctx) => claimsOf(ctx).holderNames(ctx.repo, about),
  // a member holding a claim or the merge lock is mid-work, never idle
  busy: (member, ctx) => claimsOf(ctx).holdsAny(member),
};
