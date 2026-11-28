// The answer module's wording (board-rework D1): every line and command template of the wait cluster's answers, in one
// typed table. A placeholder is a typed parameter, so a template called with a missing or wrong value does not compile.
// The rules choosing which line a member reads are in rules.ts; no verb writes these lines itself. Each feature's lines
// are in its own file (run.ts, members.ts, conversation.ts, phases.ts; product-shape#D20), spread in here; what no one
// feature owns is written here.
import { shellWord, type Command } from "./command.ts";
import { CONVERSATION_WORDING } from "./conversation.ts";
import { MEMBERS_WORDING } from "./members.ts";
import { PHASES_WORDING } from "./phases.ts";
import { RUN_WORDING } from "./run.ts";

export { shellWord, type Command, type VerbUsage } from "./command.ts";

export const WORDING = {
  // ── commands ──
  /** `wait --mentions`, foreground carrying its hold */
  wait: (cli: Command, as: string, holdMs?: number): Command => `${cli} wait --mentions --as ${as}${holdMs ? ` --timeout ${holdMs}` : ""}`,
  done: (cli: Command, phase: string, as: string): Command => `${cli} done ${phase} --as ${as}`,
  status: (cli: Command): Command => `${cli} status`,
  end: (cli: Command, as: string): Command => `${cli} end --as ${as}`,

  // ── a call the server's connection dropped (board-fixes §2) ──
  retryReading: (verb: string): string => `the call did not complete: run the same ${verb} again, as is`,
  retryWriting: (verb: string, status: Command): string =>
    `the ${verb} may or may not have landed: check with ${status} first, and run it again only if it is not there`,
  /** break-flow V-4, V-17 (D61): every verb of a member that has ended, its run still open, answers this first */
  endedMember: (run: number) =>
    `you have ended in run ${run}: nothing more to do here; return your summary now (your link and listener background tasks end on their own, and their end notices are not news)`,
  /** trust-adaptations#D23: `--as` naming another participant than the live member whose folder the command runs in */
  /** `words`: the verb and its arguments as given, each already a shell word; its --as value becomes the owner */
  asAnotherMember: (cli: Command, words: string[], as: string, owner: string) => {
    const rerun = words.map((w, i) => (words[i - 1] === "--as" ? shellWord(owner) : w));
    return `--as ${as}: refused: the folder you run in is ${owner}'s, and a member acts only as itself. Run it as ${owner}: ${[cli, ...rerun].join(" ")}`;
  },
  /** D65: a verb the member may not run now (paused), refused with the line saying why */
  verbRefused: (verb: string, why: string) => `${verb} refused: ${why}`,
  /** board-split D12: a code-pack verb from a member whose seat carries no code pack */
  packVerbRefused: (verb: string, seatKind: string) =>
    `${verb}: refused: ${verb} is a worker's verb, and a ${seatKind} holds no files; your verbs are in --help`,
  /** a member's end with messages to it not yet read: it reads them first, its wait returning them at once */
  /** told at every other verb of a worker holding undelivered messages: its listener may have lapsed */
  unreadNow: (unread: number, wait: Command) => `you have ${unread} unread message${unread === 1 ? "" : "s"} for you: read ${unread === 1 ? "it" : "them"} now, then start your listener again, in the background: ${wait}`,
  breachKill: "you ran a kill by pattern: stop only PIDs you started, and say what you stopped in your report",
  /** board-split D47: `--repo` is read as `--project`, the one word for what a run sits in */
  /** board-split D47 (verify 3 F15): --project names a project as aiview does, or a path in it */
  noProject: (name: string) => `no project ${name}: --project takes an aiview project's name or a path inside a repository`,
  /** verify 3 F17: roster on a project with no open run says so, never nothing */
  /** verify-decisions F20: a verb run outside any repository names the flag that picks a project */
  notInRepository: (dir: string) => `${dir} is in no repository: name the project with --project <name> (an aiview project) or --project <path>`,
  /** V-48: a word that is no verb of this CLI, for every caller */
  unknownVerb: (word: string, cli: Command) => `${word}: no such verb; the verbs are in ${cli} --help, the code verbs in ${cli} --help code`,
  ...RUN_WORDING,
  ...MEMBERS_WORDING,
  ...CONVERSATION_WORDING,
  ...PHASES_WORDING,
} as const;
