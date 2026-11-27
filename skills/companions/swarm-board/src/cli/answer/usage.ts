// The CLI's static help (board-rework D12; codebase-rework#D12): one record, VERB_USAGE, keyed by verb name, holding each
// verb's help lines and the corrected form an argument error offers; the core help, the code help, a hidden verb's
// help and one verb's own usage all render from it. The code verbs' entries are the code pack's, in code-wording.ts.
// `cli` is this CLI as a member runs it.
import { CODE_IN_CORE_HELP, CODE_IN_CORE_VERB_USAGE, CODE_VERB_USAGE, CODE_WORDING } from "./code-wording.ts";
import type { Command, VerbUsage } from "./wording.ts";
import { STALL_MS_DEFAULT } from "../../board/liveness.ts";
import { THREAD_LIMIT } from "../../board/board.ts";

/** The core help's verbs, in help order. */
const CORE_VERB_USAGE = {
  open: {
    lines: () => [
      "  open    --kind plan|brainstorm|task --group <slug> --title <t> --seats <file.json> [--link <url>] [--stall-ms <ms>] [--protocol <name>] [--authority <role,role>] [--onto <branch>]   # opens a run, registers the project's board in aiview, prints the run id, the board's URL, then the line that starts your link (orchestrator)",
      CODE_IN_CORE_HELP.ontoLine,
      `          # --stall-ms: a working member with no sign of progress this long posts stalled, default and floor ${STALL_MS_DEFAULT} ms; ends on the command that starts your link`,
      "          # --plan <slug> --seats <file.json>: the same as --kind plan --group <slug> --seats <file.json>",
      '          # the seats file: [{"id", "role"?, "area"?, "blockers": [...], "link"?: "<URL>"}]',
    ],
    example: () => `open --kind task --group my-team --title "the work" --seats seats.json`,
  },
  seat: {
    lines: () => ["  seat    add <id> --run <id> [--role <r>] [--area <a>] [--blockers a,b] [--link <url>] [--as <member>]   # adds a seat mid-run (orchestrator; any team orchestrator on the orchestrators board)"],
    example: () => "seat add w1 --run 3 --as my-team/orchestrator",
  },
  phase: {
    lines: () => [
      "  phase   <name> <text> [--for <seat>,…] [--watch <seat>,…] [--confirm] [--as <member>]   # without --confirm: the opt-in phases to weigh and the confirming call; with it, opens phase <name>; the current phase ends with it: a separator on the thread that wakes every member of the run (orchestrator)",
      "          # --for: only those seats are woken and owe done (all-done counts them alone); the others read the phase as their next header",
    ],
    example: (as) => `phase build "build the slices" --as ${as}`,
  },
  pause: {
    lines: () => [`  pause   [<text>] [--as <member>]                               # every member stops where it is and waits; ${CODE_IN_CORE_HELP.pauseRefuses}, no stalled or lost alert until resume; with --person it waits on the person, the text its reason (orchestrator)`],
  },
  resume: { lines: () => ["  resume  [<message>] [--as <member>]                             # lifts the pause; every member wakes on the message and continues (orchestrator)"] },
  done: { lines: () => ["  done    <phase> [--as <member>]                                 # your part of the current phase is in: tells the orchestrator; when every member is done, the board tells it"] },
  close: {
    lines: () => [`  close   --run <id> [--force] [--as <member>]                    # (orchestrator; --force for the orchestrators board, else refused); ${CODE_IN_CORE_HELP.closeRemoves}`],
    example: () => "close --run 3 --as my-team/orchestrator",
  },
  join: {
    lines: () => [`  join    --run <id> --seat <id> --doing <t> [--files "<path>,<path>,…"]   # a file not there yet is one you create, declared from the project's root; prints the roster, how you listen (a seat waits in the foreground, a worker listens in the background), then the command that starts your link; ${CODE_IN_CORE_HELP.joinMakes}`],
    example: () => `join --run 3 --seat w1 --doing "joining" --as my-team/w1`,
  },
  doing: { lines: () => ["  doing   [--as <member>] <text>"] },
  post: {
    lines: () => ["  post    [--as <member>] <body> | --file <path> [--about <path|decision id>] [--urgent] [--task] [--after <seats>]   # prints the seq; --task (orchestrator): the post is the one seat it mentions's task, owed until its done; --after w1,w2 implies it and wakes that seat as each of them lands its work, is done or leaves; --urgent (orchestrator only) wakes every waiter of the run, a pause included; --file for a long body (tables, quotes), never through shell quoting"],
  },
  agree: { lines: () => ["  agree   [--as <member>] <terms> [--about <path|decision id>] [--with <seat>[,<seat>]]  # prints the seq; parties: its @-mentions, --with, else the file's other holders"] },
  endorse: { lines: () => ["  endorse [--as <member>] <seq>                                   # backs an agreement; prints the endorsement's seq"] },
  wait: {
    lines: () => [
      "  wait    [--as <member>] [--timeout <ms>] [--mentions]           # blocks until a message to you (a mention, an event addressed to you) or an urgent post, then says how to re-arm; nothing on timeout or end; a newer wait supersedes it",
      "          # once your run is closed, wait, roster --as, post, agree, endorse, doing and done answer: run <id> closed: run end …",
      "          # --mentions: you listen while you work rather than wait; a seat's run: the wake brings every unread post of the run",
    ],
  },
  roster: { lines: () => ["  roster  [--project <path>] [--as <member>]"] },
  phases: { lines: () => ["  phases  [--run <id>] [--as <member>]                             # the run's phases, one line each: opened when, its posts, urgent posts and members done"] },
  thread: {
    lines: () => [
      "  thread  [--run <id>] [--phase current|all|<name>] [--by <seat>] [--to <seat>] [--with <seat>] [--about <path|decision id>] [--limit <n>] [--before <seq>] [--from <seq>] [--events] [--as <member>]",
      `          # reads the thread back, one line per post, the last ${THREAD_LIMIT} of the current phase by default; --with: a seat's posts and those to it; prints the next page's command`,
    ],
  },
  read: { lines: () => ["  read    <seq>                                                   # one post in full"] },
  end: {
    lines: () => [
      "  end     [--as <member>]                                         # once your run is closed; refused to a member while it is open (a member never ends itself)",
      "  end     --seat <id> [--as <member>]                              # ends a seat's member while the run is open, its context spent, before a fresh agent joins it (orchestrator)",
    ],
  },
  "log-level": { lines: () => ["  log-level [off|info|debug|debug-extended]                       # info (default): the swarm's health as logfmt lines in <data home>/swarm-server.log; debug: every event too, in <data home>/logs/<day>/events.jsonl; debug-extended: each post's text too; 30 days kept"] },
  status: { lines: () => ["  status                                                          # data home, open runs, each run's phase and its n/m done; a run idle a day is flagged with its close command; each run not on the orchestrators board, with the command registering it"] },
  ...CODE_IN_CORE_VERB_USAGE,
} satisfies Record<string, VerbUsage>;

/** The hidden verbs: no line in either help; their own help never starts them. */
const HIDDEN_VERB_USAGE = {
  serve: { lines: (cli) => [`usage: ${cli} serve [stop]   # the board server of the data home, started on demand by any verb; \`serve stop\` ends it`] },
  link: { lines: (cli) => [`usage: ${cli} link --run <id> --as <member>   # a member's link, started by its agent from the line join or open prints`] },
} satisfies Record<string, VerbUsage>;

/** Every verb of the CLI, keyed by its name: the core help's, the code pack's, the hidden ones. */
export const VERB_USAGE = { ...CORE_VERB_USAGE, ...CODE_VERB_USAGE, ...HIDDEN_VERB_USAGE } satisfies Record<string, VerbUsage>;
type VerbName = keyof typeof VERB_USAGE;

/** The core verbs' help. */
export const coreUsage = (cli: Command): string =>
  [
    `usage: ${cli} <verb> [--json]        (${cli} --help code: ${CODE_IN_CORE_HELP.codeVerbs})`,
    ...Object.values(CORE_VERB_USAGE).flatMap((u: VerbUsage) => u.lines(cli)),
    `a member is <group>/<seat>, the orchestrator <group>/orchestrator; without --as, ${CODE_IN_CORE_HELP.withoutAs}`,
  ].join("\n");

/** The code verbs' help, apart from the core (D22). */
export const codeUsage = (cli: Command): string => [CODE_WORDING.usageHead(cli), ...Object.values(CODE_VERB_USAGE).flatMap((u: VerbUsage) => u.lines(cli))].join("\n");

/** A hidden verb's own help line: `serve` and `link` start nothing when asked for help. */
export const hiddenUsage = (cli: Command, verb: keyof typeof HIDDEN_VERB_USAGE): string => HIDDEN_VERB_USAGE[verb].lines(cli).join("\n");

/** V9: the usage of the verb being called alone, from its help line, and one corrected form, `as` the caller's --as in
 *  it; never the whole help, unless the verb has no help line. */
export const verbHelp = (cli: Command, verb: string, as: string): string => {
  const usage: VerbUsage | undefined = Object.hasOwn(VERB_USAGE, verb) ? VERB_USAGE[verb as VerbName] : undefined;
  const line = usage?.lines(cli).find((l) => l.startsWith(`  ${verb} `));
  if (!line) return coreUsage(cli);
  const own = `usage: ${cli} ${line.trim().replace(/\s+#.*$/, "")}`;
  const example = usage?.example?.(as);
  return example ? `${own}\ne.g. ${cli} ${example}` : own;
};
