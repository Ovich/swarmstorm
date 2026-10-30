// The code pack's entry (board-split#D1, D18): claims, merges and worktrees, the verbs a worker of a code run has.
// Its tables are the claims store (D20); its worktrees are made at the first claim or merge-lock, in the board
// server, before any transaction opens (D19); its end refuses work not merged and removes the worktree after (D38).
import fs from "node:fs";
import path from "node:path";
import type { Conflicts, Participant } from "../../board/board.ts";
import { baseAt } from "../../git.ts";
import { LOCK_HELD_MS } from "../../board/liveness.ts";
import type { Pack, PackCtx, PackRefusal, PackVerbInput, PackWrite } from "../types.ts";
import { type Claims, claimsOf } from "./claims.ts";
import { codeSnapshotOf, everClaimedOf, heldOf } from "./snapshot.ts";
import { forgetMemberRows, forgetRunRows, migrateCodeTables } from "./schema.ts";
import { CODE_EVENTS } from "./events.ts";
import { codeStats } from "./stats.ts";
import { sweepAll, sweepLegacy, worktrees, type WorktreeRecord } from "./worktrees.ts";

const slashed = (p: string): string => p.split("\\").join("/");

/** The member's board worktree, when the board made it and it is there; null otherwise. */
const ownWorktree = (member: Participant): string | null => {
  const seatTrees = worktrees(member.repo);
  return seatTrees.owns(member.place) && fs.existsSync(member.place) ? slashed(member.place) : null;
};

/** Makes the member's worktree when its join only named it (G20): a member that never claims or merges gets none.
 *  A git failure is a refusal fact; nothing is written (D19). */
function makeWorktree(verb: string, member: Participant, input: PackVerbInput, ctx: PackCtx): PackRefusal | { made: boolean } {
  if (!member.place || !worktrees(member.repo).owns(member.place) || fs.existsSync(member.place)) return { made: false };
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

/** A member's verb on the claims tables, its input as the CLI sends it; the call is counted under `countedAs`. */
const tableWrite = (countedAs: string | null, apply: (claims: Claims, member: Participant, input: PackVerbInput) => unknown, progress = false): PackWrite => ({
  countedAs,
  progress,
  apply: (member, input, ctx) => apply(tablesOf(ctx), member, input),
});
const optional = <T>(v: unknown): T | undefined => (v === null || v === undefined ? undefined : (v as T));

/** The claims verbs a member calls through `packCall` (board-split T11, D9): the core's transaction around each. */
const CLAIM_WRITES: Record<string, PackWrite> = {
  "check-edit": tableWrite("checkEdit", (c, m, i) => c.checkEdit(m, String(i.file), { interface: i.interface === true })),
  release: tableWrite("release", (c, m, i) => c.release(m, String(i.file))),
  // part of merge-lock and end, not a call of its own
  reconcile: tableWrite(null, (c, m, i) => c.reconcileWrites(m, i.changed as string[], optional<string[]>(i.generated))),
  "lock-merge": tableWrite("lockMerge", (c, m, i) => c.lockMerge(m, optional<string>(i.onto), optional<number>(i.reflogMark), optional<string[]>(i.guides))),
  merged: tableWrite("merged", (c, m, i) => c.merged(m, String(i.sha), i.files as string[], optional<Conflicts>(i.conflicts)), true),
};

export const codePack: Pack = {
  name: "code",
  events: CODE_EVENTS,
  verbs: ["claim", "release", "merge-lock", "merged", "flag", "conflicts", "unclaimed", "guides"].map((name) => ({ name })),
  stats: codeStats,
  // from any run, an agreement or endorsement about a path the member holds is for it too (D26, plan D2)
  alsoFor: (member, message, ctx) =>
    (message.kind === "agreement" || message.kind === "endorsement") && message.about != null && tablesOf(ctx).holderNames(member.repo, message.about).includes(member.name),
  // an agreement with no party named binds the file's other holders (F25)
  defaultParties: (about, ctx) => tablesOf(ctx).holderNames(ctx.repo, about),
  // a member holding a claim or the merge lock is mid-work, never idle
  busy: (member, ctx) => tablesOf(ctx).holdsAny(member),
  // holding the merge lock, the member is merging (D36), whatever its core state says
  memberFact: (member, ctx) => (tablesOf(ctx).heldMergeLock(member) ? "merging" : null),
  // board-split D52: the merge lock is held only to rebase, check and fast-forward; held past LOCK_HELD_MS it is a stall
  memberStall: (member, ctx, t) => {
    const lock = tablesOf(ctx).heldMergeLock(member);
    if (!lock) return null;
    const since = Date.parse(lock.grantedAt);
    // board-split D55: the fact alone; the board's reasonOf adds the state word and the age
    return t - since >= LOCK_HELD_MS ? { reason: "holds the merge lock", since } : null;
  },

  // the code tables' DDL and an older store's upkeep, then the store over them (D20)
  openTables: (deps) => {
    migrateCodeTables(deps.db);
    return claimsOf(deps);
  },
  snapshot: (deps, repo, people, orchestratorSeat) => codeSnapshotOf(deps, repo, people, orchestratorSeat),
  held: (db, member) => heldOf(db, member),
  everClaimed: (db, member) => everClaimedOf(db, member),
  forget: (db, scope) => ("member" in scope ? forgetMemberRows(db, scope.member) : forgetRunRows(db, scope.run)),
  writes: CLAIM_WRITES,

  run(verb, member, input, ctx, tables) {
    switch (verb) {
      // where a joining seat's worktree goes, named and not made (G20)
      case "place":
        return ctx ? worktrees(ctx.repo).place(ctx.run, ctx.group, String(input.seat), String(input.cwd)) : null;
      case "claim":
      case "merge-lock":
        return member && ctx ? makeWorktree(verb, member, input, ctx) : { made: false };
      // the merge lock the member holds, read for merged's replay (D33, D36); never counted
      case "held-merge-lock":
        return member && ctx ? tablesOf(ctx).heldMergeLock(member) : null;
      // the worktrees members joined from, of the run given or every run
      case "worktrees":
        return tables.seatWorktrees(typeof input.run === "number" ? input.run : undefined);
      // a run's close: its worktrees go once clean and merged, each seat's link stopped first
      case "close": {
        const trees = tables.seatWorktrees(Number(input.run)).filter((w) => worktrees(w.repo).owns(w.worktree) && fs.existsSync(w.worktree));
        return trees.map((w) => ({ worktree: slashed(w.worktree), member: w.member, ...worktrees(w.repo).release({ run: w.run, member: w.member, worktree: w.worktree }, w.base) }));
      }
      // `worktree prune`: every worktree folder of each repository the board knows, judged by its latest record
      case "prune": {
        const known = tables.seatWorktrees();
        const repos = [...new Set([...known.map((k) => k.repo), ...(input.repos as string[])])];
        const fold = (s: string) => (process.platform === "win32" ? path.resolve(s).toLowerCase() : path.resolve(s));
        const recordOf = (dir: string): WorktreeRecord | null => known.filter((k) => fold(k.worktree) === fold(dir)).at(-1) ?? null;
        return sweepAll(repos, recordOf).map((o) => ({ ...o, worktree: slashed(o.worktree) }));
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

  onJoin(member, ctx, declared) {
    // a re-join starts the seat's record fresh: merged since this join only (D66)
    tablesOf(ctx).seated(member, declared);
    return {};
  },

  onPost(member, message, ctx) {
    // posting is claiming (D7)
    const claimed = tablesOf(ctx).claimByPost(member, message);
    return claimed ? { claimed } : null;
  },

  onEnded(member, ctx) {
    // a held lock released by the end frees whoever was refused it (D65); its claims go with it
    const waiters = tablesOf(ctx).lockWaitersFreedBy(member);
    tablesOf(ctx).releaseAll(member.id);
    return {
      note: waiters.length ? `the merge lock is free: ${waiters.map((n) => `@${n}`).join(" ")}` : null,
      mentions: waiters,
      lastDoing: tablesOf(ctx).mergedSinceJoin(member.id) ? "merged and ended" : "ended",
    };
  },

  afterEnd(member, ctx) {
    const mine = ownWorktree(member);
    if (!mine) return {};
    // its link goes first, inside release: Windows holds a folder a live process is in
    const why = worktrees(member.repo).release({ run: member.run, member: member.name, worktree: mine }, ctx.base).why;
    return { worktree: mine, removed: why === null, why };
  },
};
