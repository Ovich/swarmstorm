// The members' answer wording (product-shape#D20): the lines of join, end, roster, doing and link, and of a member's
// liveness. Spread into WORDING (wording.ts), which every caller reads.
import { FOREGROUND_NOTE, type Command } from "./command.ts";

export const MEMBERS_WORDING = {

  // ── the link and the listener ──
  linkStart: (link: Command) => `start your link now, in the background (your harness's background task): ${link}`,
  /** break-flow V-29: `end --seat`, to the orchestrator: the state its member was in, and the line it reads now */
  seatEnded: (member: string, was: string, told: string) => `${member} ended; it was ${was}; its next call answers: ${told}`,
  /** break-flow V-41: a lost member's state at its end, never its activity from before it was lost */
  wasLost: (reason: string) => `lost (${reason})`,
  /** break-flow V-38 (D73): `end --seat orchestrator` while the run is open */
  endOrchestratorRefused: (run: number, cli: Command, as: string) =>
    `end --seat orchestrator: refused, run ${run} is open: the orchestrator's seat ends with its run: ${cli} close --run ${run} --as ${as}`,
  /** trust-adaptations#D23 (v1-F1): a join naming another member than the live one whose folder the command runs in */
  joinAsAnotherMember: (joining: string, owner: string) =>
    `join: refused: the folder you run in is ${owner}'s, a live member, and a folder joins only as its own member. Join ${joining} from its own folder, or from the project's checkout`,
  // board-fixes#D5: the roster's doing, its age once a minute old, `stale` once its work landed or an event to it came after it
  doingAge: (ms: number, stale: boolean) => {
    const min = Math.floor(Math.max(0, ms) / 60_000);
    const parts = [...(min >= 1 ? [`${min} min`] : []), ...(stale ? ["stale"] : [])];
    return parts.length ? ` (${parts.join(", ")})` : "";
  },
  // product-shape#D1: how full a member is, in thousands of tokens, and how old that reading is (`ago` worded by the caller)
  contextShown: (context: { tokens: number; at: number } | null, ago: (at: number) => string) =>
    context ? `  context ${Math.round(context.tokens / 1000)}k (${ago(context.at)} ago)` : "  context unknown",
  /** break-flow V-46: a second link of one member: the first runs on */
  linkRunning: (member: string) => `${member}'s link already runs: nothing to start`,
  unreadBeforeEnd: (unread: number, wait: Command) => `you have ${unread} unread mention${unread === 1 ? "" : "s"}: run \`${wait}\` first`,
  /** board-split D30, D38: a member's own end while its run is open */
  endRefused: (run: number, wait: Command) =>
    `end: refused, run ${run} is open: a member never ends itself; your seat stays, wait in the foreground for your next task (${FOREGROUND_NOTE}): ${wait}`,
  swarmStopped: (cli: Command, as: string) => `no member is moving: read the board (its page, status), then post the next task, open the next phase (${cli} phase <name> "<text>" --as ${as}) or resume the members by message`,
  allJoined: (cli: Command, as: string) => `every declared seat has joined: post the tasks, or open the first phase (${cli} phase <name> "<text>" --as ${as})`,
  allJoinedTasked: (cli: Command, as: string) => `every declared seat has joined, its tasks already posted: open the first phase if the run has one (${cli} phase <name> "<text>" --as ${as})`,
  /** break-flow V-17: the end verb as it runs, never "close its seat" */
  lostMove: (cli: Command, seat: string, as: string) => `its agent is not running: dispatch it again, or end its seat: ${cli} end --seat ${seat} --as ${as}`,
  /** board-split D36: a member's badge beside its state in the roster, its reason after it */
  badgeShown: (badge: { name: string; reason: string }) => ` [${badge.name}: ${badge.reason}]`,

  // ── the seat's commands at its join (D21, D36) ──
  /** board-split D11, D12: a verifier's join: no worktree, the merged branch read from where it is served, findings posted */
  verifierAs: (as: string) =>
    `pass --as ${as} on every call: you have no checkout of your own and hold no files; you judge the branch the phase names, in your own instance, and report by post`,
  verifierCommands: (cli: Command, as: string) => [
    `${cli} post "@orchestrator <your verdict and findings table>" --as ${as}    # your report: a finding at a stop, or the table at the walk's end`,
    `${cli} post "@<seat> <question>" --about <path> --as ${as}    # a question to a builder about a file`,
    `${cli} done <phase> --as ${as}`,
  ],
  seatCommands: (cli: Command, as: string, holdMs: number) => [
    `${cli} post "…" --about <D id> --as ${as}`,
    `${cli} agree "…" --about <D id> --as ${as}`,
    `${cli} endorse <seq> --as ${as}`,
    `${cli} wait --mentions --as ${as} --timeout ${holdMs}    # in the foreground, when waiting; ${FOREGROUND_NOTE}`,
  ],
  /** a member joining a run already under way: what its seat said and was told before it, read when it needs it */
  seatHistory: (cli: Command, run: number, seat: string): string =>
    `before you: what this seat said and was told: ${cli} thread --run ${run} --with ${seat} --phase all; the run's phases: ${cli} phases --run ${run}`,
  /** V-42 (D58): a join whose --as names another group than the run's; the corrected line runs as printed */
  joinAsOtherGroup: (given: string, run: number, group: string, corrected: Command) =>
    `join: refused: --as ${given} is not this seat of run ${run}, whose group is ${group}: ${corrected}`,
  /** D21, D36: a member of a kind without worktree, at join: the checkout is shared, so every call names it */
  sharedCheckoutAs: (member: string) => `pass --as ${member} on every call: this checkout is shared, the board cannot tell you apart`,
  /** `end` once the run closed: the close ended the member; it returns its summary */
  closedEndSummary: (run: number, member: string) =>
    `run ${run} closed: ${member} ended; return your summary now (your link and listener background tasks end on their own, and their end notices are not news)`,
} as const;
