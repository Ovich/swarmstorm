// The board's one entry for who may call what (trust-adaptations#D5): each connection is bound to the member its Hello
// names, checked against the store, and every call is judged against that binding before the board runs it. The
// dispatcher never reads a call's args to decide; the kinds of every method live in one table here.
import type { Board, Participant, Run } from "../board/board.ts";
import { ORCHESTRATORS_GROUP, type Hello, type RpcMethod } from "../wire.ts";

/** The member a connection speaks for; null for an anonymous one (a reader, a CLI before it joins or opens). */
export type Bound = { id: number; name: string; run: number; seat: string } | null;

export type Authority = {
  /** At the Hello: the member it names, which must exist in that run (ended members included). */
  bind(hello: Hello): Bound | "unknown member";
  /** The refusal text for `method` called with `args` over a connection bound to `bound`, or null when allowed. */
  check(bound: Bound, method: RpcMethod, args: unknown[]): string | null;
  /** Binding by creation: what an unbound connection is bound to once its `openRun` or `join` succeeded with `value`;
   *  a bound connection is never re-bound. */
  boundAfter(bound: Bound, method: RpcMethod, value: unknown): Bound;
};

const ORCHESTRATOR_SEAT = "orchestrator";

/** A call's target participant, as the CLI sends it: the board resolves it by `id`. */
type Target = { id?: unknown; name?: unknown } | null | undefined;

type Rule = (bound: Bound, args: unknown[], method: RpcMethod) => string | null;

export function makeAuthority(board: Board): Authority {
  /** The repository a run belongs to, open or closed; null for a run the board does not list. */
  const repoOf = (run: number): string | null =>
    board.runs().find((r) => r.id === run)?.repo ?? board.repos().find((summary) => summary.runs.some((r) => r.run === run))?.repo ?? null;
  const groupOf = (run: number): string | null =>
    board.runs().find((r) => r.id === run)?.group ?? board.repos().flatMap((summary) => summary.runs).find((r) => r.run === run)?.group ?? null;
  /** `name` as a participant of `run`, ended or not; null when that run has none of that name. */
  const participantOf = (run: number, name: string): Participant | null => {
    const repo = repoOf(run);
    const found = repo === null ? null : board.participant(name, repo);
    return found && found.run === run ? found : null;
  };
  const boundTo = (p: Participant): NonNullable<Bound> => ({ id: p.id, name: p.name, run: p.run, seat: p.seat });

  const who = (bound: Bound): string => (bound ? bound.name : "an anonymous connection");
  const targetName = (target: Target): string => (typeof target?.name === "string" ? target.name : `participant ${String(target?.id)}`);
  const isSelf = (bound: Bound, target: Target): boolean => bound !== null && typeof target?.id === "number" && target.id === bound.id;
  /** The target is a seat of the bound orchestrator's own run, resolved from the store, never from the args alone. */
  const isSeatOfOwnRun = (bound: Bound, target: Target): boolean => {
    if (bound?.seat !== ORCHESTRATOR_SEAT || typeof target?.name !== "string" || typeof target.id !== "number") return false;
    return participantOf(bound.run, target.name)?.id === target.id;
  };
  const actsFor = (method: RpcMethod, bound: Bound, target: Target): string =>
    bound === null
      ? `refused: ${method} acts for ${targetName(target)}, and this connection names no member`
      : `refused: ${method} acts for ${targetName(target)}; this connection is ${bound.name}`;
  const orchestratorOnly = (method: RpcMethod, run: unknown, bound: Bound): string => `refused: ${method} on run ${String(run)} is its orchestrator's; this connection is ${who(bound)}`;

  /** Acting: the member itself only. */
  const self: Rule = (bound, args, method) => (isSelf(bound, args[0] as Target) ? null : actsFor(method, bound, args[0] as Target));
  /** Acting, the run's orchestrator excepted (`end --seat`'s calls). */
  const selfOrOwnRunsOrchestrator: Rule = (bound, args, method) => {
    const target = args[0] as Target;
    return isSelf(bound, target) || isSeatOfOwnRun(bound, target) ? null : actsFor(method, bound, target);
  };
  /** Orchestrator-only on the run `runAt` reads from the args; the orchestrators board stays open to every orchestrator. */
  const runsOrchestrator =
    (runAt: (args: unknown[]) => unknown): Rule =>
    (bound, args, method) => {
      const run = runAt(args);
      if (typeof run !== "number") return `refused: ${method} names no run`;
      if (groupOf(run) === ORCHESTRATORS_GROUP) return null;
      return bound?.seat === ORCHESTRATOR_SEAT && bound.run === run ? null : orchestratorOnly(method, run, bound);
    };
  const open: Rule = () => null;

  /** `packCall(null, verb, input)`, decided per verb: who may call each pack verb with no member. */
  const PACK_VERBS_WITHOUT_MEMBER: Record<string, Rule> = {
    // before a join: where the joining seat's folder goes
    place: open,
    // at every CLI start: the folders left by an older layout
    legacy: open,
    // with no run: every repository's folders judged
    prune: open,
    // a read of the runs' seat folders
    worktrees: open, // AGENTS EXCEPTION (D24): the code pack's verb name, as packCall receives it
    // writes run state: the run's own orchestrator, or anyone on the orchestrators board (closed with close --force)
    close: runsOrchestrator((args) => (args[2] as { run?: unknown } | undefined)?.run),
  };
  const packCall: Rule = (bound, args, method) => {
    if (args[0] != null) return selfOrOwnRunsOrchestrator(bound, args, method);
    const verb = String(args[1]);
    const rule = Object.hasOwn(PACK_VERBS_WITHOUT_MEMBER, verb) ? PACK_VERBS_WITHOUT_MEMBER[verb] : null;
    return rule ? rule(bound, args, method) : `refused: packCall ${verb} needs a member`;
  };

  /** Every method of the wire, in one kind (plan D5, section 3 Authority). */
  const METHOD_RULES: Record<RpcMethod, Rule> = {
    // acting
    setDoing: self,
    post: self,
    endorse: self,
    wait: self,
    deliverMentions: self,
    done: self,
    idle: self,
    unreadMentions: self,
    guidesUntold: self,
    showPhase: self,
    owedPhase: self,
    heldBy: self,
    end: selfOrOwnRunsOrchestrator,
    packCall,
    // orchestrator-only: acting for the orchestrator itself; that it is the orchestrator is the board's own rule
    // (board.ts phase, pause, resume), whose refusal the CLI words
    phase: self,
    pause: self,
    resume: self,
    closeRun: runsOrchestrator((args) => args[0]),
    addSeat: runsOrchestrator((args) => args[0]),
    // open: no actor, or read-only
    openRun: open,
    join: open,
    participant: open,
    identify: open,
    currentPhase: open,
    pausedOf: open,
    phaseProgress: open,
    lastActivity: open,
    runs: open,
    roster: open,
    endedMembers: open,
    owingMembers: open,
    repos: open,
    snapshot: open,
    composition: open,
  };

  return {
    bind(hello) {
      if (!hello.member) return null;
      const found = participantOf(hello.member.run, hello.member.name);
      return found ? boundTo(found) : "unknown member";
    },
    check(bound, method, args) {
      return METHOD_RULES[method](bound, args, method);
    },
    boundAfter(bound, method, value) {
      if (bound !== null) return bound;
      if (method === "openRun") {
        const opened = value as Run;
        const orchestrator = participantOf(opened.id, `${opened.group}/${ORCHESTRATOR_SEAT}`);
        return orchestrator ? boundTo(orchestrator) : null;
      }
      if (method === "join") return boundTo((value as { member: Participant }).member);
      return null;
    },
  };
}
