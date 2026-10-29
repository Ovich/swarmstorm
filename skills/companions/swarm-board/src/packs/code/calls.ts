// The code pack's member verbs as typed calls over the one way in, `board.packCall` (board-split T11, D9): the CLI's
// and a test's way to claims and the merge lock, on the board itself or on its remote client alike. A refusal fact
// (D12) is thrown, its fact on the error, so a caller that did not gate the verb up front still stops.
import type { Conflicts, EditAllowed, EditHeld, Participant, RunId, Sharer } from "../../board/board.ts";
import type { Flag, MemberWorktree } from "./types.ts";
import type { PackRefusal, PackVerbInput } from "../types.ts";
import type { HeldMergeLock } from "./claims.ts";

type PackCaller = { packCall(p: Participant | null, verb: string, input: PackVerbInput): unknown };
/** A verb's answer as the board answers: at once on the board, a promise on its remote client. */
type Answer<B extends PackCaller, T> = ReturnType<B["packCall"]> extends PromiseLike<unknown> ? Promise<T> : T;

export class PackVerbRefused extends Error {
  readonly fact: PackRefusal;
  constructor(fact: PackRefusal) {
    super(`${fact.refused.verb}: refused (${fact.refused.reason})`);
    this.fact = fact;
  }
}

const isRefusal = (fact: unknown): fact is PackRefusal => typeof fact === "object" && fact !== null && "refused" in fact;
const unlessRefused = (fact: unknown): unknown => {
  if (isRefusal(fact)) throw new PackVerbRefused(fact);
  return fact;
};

export function codeVerbs<B extends PackCaller>(board: B) {
  const call = <T>(p: Participant | null, verb: string, input: PackVerbInput): Answer<B, T> => {
    const fact = board.packCall(p, verb, input);
    return (fact instanceof Promise ? fact.then(unlessRefused) : unlessRefused(fact)) as Answer<B, T>;
  };
  return {
    /** A claim before an edit of `file` (absolute, or repository-relative), `swarm claim` (D58, D40, D41). */
    checkEdit: (p: Participant, file: string, opts: { interface?: boolean } = {}) => call<EditAllowed | EditHeld>(p, "check-edit", { file, interface: opts.interface === true }),
    release: (p: Participant, file: string) => call<null | undefined>(p, "release", { file }),
    /** Paths written outside the claim: a free one claimed, a held one flagged on the thread; `generated` never flagged (G28). */
    reconcileWrites: (p: Participant, changed: string[], generated?: string[]) => call<Flag[]>(p, "reconcile", { changed, generated }),
    lockMerge: (p: Participant, onto?: string, reflogMark?: number, guides?: string[]) =>
      call<{ granted: true } | { granted: false; holder: string }>(p, "lock-merge", { onto, reflogMark, guides }),
    merged: (p: Participant, sha: string, files: string[], conflicts?: Conflicts) => call<Sharer[]>(p, "merged", { sha, files, conflicts }),
    /** The merge lock `p` holds, null when none (D33, D36). */
    heldMergeLock: (p: Participant) => call<HeldMergeLock | null>(p, "held-merge-lock", {}),
    /** Every worktree a member joined from, of `run` or of every run, closed ones included. */
    worktrees: (run?: RunId) => call<MemberWorktree[]>(null, "worktrees", run === undefined ? {} : { run }),
  };
}
