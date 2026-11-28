// The conversation's answer wording (product-shape#D20): the lines of post, agree, endorse, read, thread and wait, a
// post's mentions and the listener. Spread into WORDING (wording.ts), which every caller reads.
import { FOREGROUND_WAIT_MS } from "../../contract/events.ts";
import { FOREGROUND_NOTE, shellWord, type Command } from "./command.ts";
import { MEMBERS_WORDING } from "./members.ts";

export const CONVERSATION_WORDING = {
  listenerStart: (wait: Command) => `start your listener now, in the background (your harness's background task): ${wait}`,
  waitNow: (afterPhase: boolean, wait: Command) =>
    `${afterPhase ? "only then wait" : "wait now"}, in the foreground (never a background listener: a seat that ends its turn is lost; ${FOREGROUND_NOTE}): ${wait}`,
  rearmBackground: (wait: Command) => `you received a new message: before reading it, start this listener again, in the background while you work, in the foreground when you are waiting (${FOREGROUND_NOTE}): ${wait}`,
  rearmForeground: (wait: Command) => `wait again, in the foreground (${FOREGROUND_NOTE}): ${wait}`,
  rearmOrchestrator: (wait: Command) => `act on it, then start this listener again, in the background: ${wait}`,
  rearmAfterOwed: (owed: string, wait: Command) => `${owed}\nonly then wait again, in the foreground (${FOREGROUND_NOTE}): ${wait}`,
  // S30: a member's first wait reads the same as a later one: no "again" for a wait it never made
  nothingYetOrchestrator: (wait: Command) => `nothing yet; wait: ${wait}`,
  nothingYet: (wait: Command) => `nothing yet; wait, in the foreground (${FOREGROUND_NOTE}): ${wait}`,
  superseded: "superseded by a newer wait",
  // G14, S26 (board-split D30): the seat stays; an idle member only waits again, never ends itself (the orchestrator's word ends a seat)
  idle: (wait: Command) => `nothing for you now; the run is open and your seat stays in it: wait again, in the foreground (${FOREGROUND_NOTE}): ${wait}`,
  ended: (run: number) => `you have ended in run ${run}: this listener stops; nothing to re-arm; return your summary now`,
  // V-12: told only to a background listener (the orchestrator's), whose end its harness announces too
  delivered: "these lines are delivered; the task-end notice is the same event",

  // ── a post's @-names (D63) ──
  // S23: an ended member's seat may be joined again, and its join delivers what waited for it (S1)
  mentionEnded: (name: string) => `@${name} has ended: the post stays on the thread, read at the seat's next join`,
  mentionNotJoined: (name: string) => `@${name} has not joined yet: the post waits for it, read at its join`,
  // break-flow V-47: a post reaches a lost member's seat, recorded; the agent is not there to read it
  mentionLost: (member: string, move: string) => `${member} is lost: the post is recorded, but nothing reads it now; ${move}`,
  /** simple-states: the orchestrator's post to a member whose link is down, by its state */
  postToAway: (member: string) => `${member} is away: resume it by message so it reads this post`,
  postToLost: (member: string) => `${member} is lost: dispatch a fresh agent into its seat`,
  mentionNobody: (name: string, guesses: string[]) => `@${name} matched nobody on the board${guesses.length ? `: did you mean ${guesses.join(", ")}?` : ""}`,

  // ── agree ──
  /** S5: every party, the author marked, sorted by name so the line reads the same whoever agrees */
  agreeParties: (author: string, others: string[]) =>
    `parties: ${[...new Set([author, ...others])].sort().map((n) => (n === author ? `${n} (you)` : n)).join(", ")}; woken when its file merges`,
  // ── the line under an event, for the member it woke (D36, D59); the board posts the fact, these word it ──
  backIt: (cli: Command, seq: number, as: string) => `back it: ${cli} endorse ${seq} --as ${as}`,
  // board-fixes#D13: a post to one seat is no task unless posted as one
  taskHint: (member: string) =>
    `a post to ${member} alone: if it is ${member}'s task, post it with --task (or --after <seats> when it waits on others), so the board counts it owed until ${member}'s done`,
  // ── reading the thread back (pull only, in pages) ──
  readWhichRun: (verb: string) => `${verb}: which run? pass --run <id>, or --as <member>`,
  threadNone: "no post matches",
  /** `words`: the page's own query, re-listed, so the next page reads the same posts */
  threadEarlier: (cli: Command, words: string, before: number): Command => `earlier: ${cli} thread ${words} --before ${before}`,
  threadLater: (cli: Command, words: string, from: number): Command => `later: ${cli} thread ${words} --from ${from}`,
  readPost: (cli: Command): Command => `a post in full: ${cli} read <seq>`,
  noPost: (seq: number) => `read: no post #${seq} in this project`,
  /** D49: the exact command that re-arms a wait, and its foreground form, which always holds FOREGROUND_WAIT_MS (F22) */
  waitAgain: (cli: Command, w: { mentions: boolean; as?: string; timeout?: string; json: boolean }): { again: Command; foreground: Command } => {
    const words = (timeout: string | undefined): string =>
      [cli, "wait", ...(w.mentions ? ["--mentions"] : []), ...(w.as !== undefined ? ["--as", w.as] : []), ...(timeout !== undefined ? ["--timeout", timeout] : []), ...(w.json ? ["--json"] : [])].join(" ");
    return { again: words(w.timeout), foreground: `${words(undefined)} --timeout ${FOREGROUND_WAIT_MS}` };
  },
} as const;

/** Whether a post's stored mentions reach `name` (`<group>/<seat>`): by name, or by its group (`@swarm`, `@<CODE>` are stored as `<group>/*`). */
export const mentionReaches = (mentions: readonly string[], name: string): boolean =>
  mentions.includes(name) || mentions.includes(`${name.slice(0, name.lastIndexOf("/"))}/*`);

/** simple-states: what the orchestrator's post tells it of a member it mentions whose link is down, by its board state. */
export const unreachedMentionLines = (targets: { name: string; state: string }[]): string[] =>
  targets.flatMap((t) => (t.state === "away" ? [CONVERSATION_WORDING.postToAway(t.name)] : t.state === "lost" ? [CONVERSATION_WORDING.postToLost(t.name)] : []));

/** board-fixes#D13: an orchestrator's plain post to exactly one seat of its run, posted without --task, is told how a task is
 *  posted; nothing otherwise. */
export const taskHintLines = (p: { orchestrator: boolean; plain: boolean; task: boolean; mentions: string[]; group: string }): string[] => {
  const oneSeat = p.mentions.length === 1 && p.mentions[0].startsWith(`${p.group}/`) && !p.mentions[0].endsWith("/*") && !p.mentions[0].endsWith("/orchestrator");
  return p.orchestrator && p.plain && !p.task && oneSeat ? [CONVERSATION_WORDING.taskHint(p.mentions[0])] : [];
};

/** break-flow V-47: the orchestrator's post that mentions a lost member is recorded, and says so with the move, as
 *  `phase` does (V-35). `lost`: the mentioned members whose badge reads lost, `<group>/<seat>`. */
export const lostMentionLines = (lost: string[], cli: string, as: string): string[] =>
  lost.map((member) => CONVERSATION_WORDING.mentionLost(member, MEMBERS_WORDING.lostMove(cli, shellWord(member.slice(member.lastIndexOf("/") + 1)), as)));
