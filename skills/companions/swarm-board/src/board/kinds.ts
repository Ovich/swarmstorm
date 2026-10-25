import type { Subscription } from "./events.ts";

// What kind of work a run is, and what that kind allows (D25, D40). A new kind is a row here.

export type Kind = "plan" | "brainstorm" | "task";

export interface KindProfile {
  kind: Kind;
  /** claim, release, merge-lock, merged allowed */
  claims: boolean;
  mergeLock: boolean;
  /** join records the worktree; end and merge-lock read git */
  worktree: boolean;
  /** what join and the help call a member */
  member: "runner" | "seat";
  /** every member's post is everyone's: delivered in full, never as one line, and a wake brings the run's whole
   *  unread thread, so no member writes past a point another made */
  wholeThread: boolean;
  /** the subscriptions a member gets when neither `--on` nor its seat row names any (D59) */
  defaults: { member: Subscription[]; orchestrator: Subscription[] };
}

const run = (...events: Subscription["event"][]): Subscription[] => events.map((event) => ({ event, scope: "run" }));
/** Events carried to the orchestrator, never waking it alone (idea 2): one line on its next wake, or due after CARRY_MAX_MS. */
const carried = (...events: Subscription["event"][]): Subscription[] => events.map((event) => ({ event, scope: "run", carry: true }));

export const PROFILES: Record<Kind, KindProfile> = {
  plan: { kind: "plan", claims: true, mergeLock: true, worktree: true, member: "runner", wholeThread: false, defaults: { member: [], orchestrator: [...run("ended", "stale"), ...carried("merged", "done", "joined", "idle")] } },
  brainstorm: {
    kind: "brainstorm",
    claims: false,
    mergeLock: false,
    worktree: false,
    member: "seat",
    wholeThread: true,
    defaults: { member: [], orchestrator: [...run("agreement", "endorsement", "ended", "stale"), ...carried("done", "joined", "idle")] },
  },
  // a swarm without a plan (the `swarm` skill): workers in worktrees take tasks posted to them, as a plan's do slices
  task: { kind: "task", claims: true, mergeLock: true, worktree: true, member: "runner", wholeThread: false, defaults: { member: [], orchestrator: [...run("ended", "stale"), ...carried("merged", "done", "joined", "idle")] } },
};

/** The profile of `kind`; throws on an unknown kind, listing the known ones. */
export function profileOf(kind: string): KindProfile {
  const profile = (PROFILES as Record<string, KindProfile | undefined>)[kind];
  if (!profile || !Object.hasOwn(PROFILES, kind)) throw new Error(`unknown kind ${kind}: the kinds are ${Object.keys(PROFILES).join(", ")}`);
  return profile;
}
