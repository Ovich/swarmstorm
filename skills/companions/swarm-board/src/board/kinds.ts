// What kind of work a run is, and its run traits (D25, D40). A new kind is a row here; what a member of it is given
// (claims, merges, a worktree) is the pack registry's (board-split#D22, D23).

export type Kind = "plan" | "brainstorm" | "task";

export interface KindProfile {
  kind: Kind;
  /** what join and the help call a member */
  member: "worker" | "seat";
  /** every member's post is everyone's: delivered in full, never as one line, and a wake brings the run's whole
   *  unread thread, so no member writes past a point another made */
  wholeThread: boolean;
}

export const PROFILES: Record<Kind, KindProfile> = {
  plan: { kind: "plan", member: "worker", wholeThread: false },
  brainstorm: { kind: "brainstorm", member: "seat", wholeThread: true },
  // a swarm without a plan (the `swarm` skill): workers in worktrees take tasks posted to them, as a plan's do slices
  task: { kind: "task", member: "worker", wholeThread: false },
};

/** The profile of `kind`; throws on an unknown kind, listing the known ones. */
export function profileOf(kind: string): KindProfile {
  const profile = (PROFILES as Record<string, KindProfile | undefined>)[kind];
  if (!profile || !Object.hasOwn(PROFILES, kind)) throw new Error(`unknown kind ${kind}: the kinds are ${Object.keys(PROFILES).join(", ")}`);
  return profile;
}
