// The code pack's entry (board-split#D1, D18): claims, merges and worktrees, the verbs a worker of a code run has.
// Inert in phase 2: its verbs are listed, its pack methods absent; phase 3 moves the work behind them.
import type { Pack } from "../types.ts";
import { codeStats } from "./stats.ts";

export const codePack: Pack = {
  name: "code",
  verbs: ["claim", "release", "merge-lock", "merged", "flag", "conflicts", "unclaimed", "guides"].map((name) => ({ name })),
  stats: codeStats,
};
