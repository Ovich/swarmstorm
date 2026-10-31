// The CLI's static help (board-rework D12): the core verbs, and the usage line of each hidden verb. The code verbs'
// help is the code pack's, in code-wording.ts. `cli` is this CLI as a member runs it.
import { CODE_IN_CORE_HELP } from "./code-wording.ts";
import type { Command } from "./wording.ts";
import { STALL_MS_DEFAULT } from "../../board/liveness.ts";

/** The core verbs' help. */
export const coreUsage = (cli: Command): string =>
  [
    `usage: ${cli} <verb> [--json]        (${cli} --help code: ${CODE_IN_CORE_HELP.codeVerbs})`,
    "  open    --kind plan|brainstorm|task --group <slug> --title <t> --seats <file.json> [--link <url>] [--stall-ms <ms>] [--protocol <name>] [--authority <role,role>] [--onto <branch>]   # opens a run, registers the project's board in aiview, prints the run id, the board's URL, then the line that starts your link (orchestrator)",
    CODE_IN_CORE_HELP.ontoLine,
    `          # --stall-ms: a working member with no sign of progress this long posts stalled, default and floor ${STALL_MS_DEFAULT} ms; ends on the command that starts your link`,
    "          # --plan <slug> --seats <file.json>: the same as --kind plan --group <slug> --seats <file.json>",
    '          # the seats file: [{"id", "role"?, "area"?, "blockers": [...], "link"?: "<URL>"}]',
    "  seat    add <id> --run <id> [--role <r>] [--area <a>] [--blockers a,b] [--link <url>]   # adds a seat mid-run (orchestrator)",
    "  phase   <name> <text> [--for <seat>,…] [--watch <seat>,…] [--as <member>]   # opens phase <name>; the current phase ends with it: a separator on the thread that wakes every member of the run (orchestrator)",
    "          # --for: only those seats are woken and owe done (all-done counts them alone); the others read the phase as their next header",
    `  pause   [<text>] [--as <member>]                               # every member stops where it is and waits; ${CODE_IN_CORE_HELP.pauseRefuses}, no stalled or lost alert until resume; with --person it waits on the person, the text its reason (orchestrator)`,
    "  resume  [<message>] [--as <member>]                             # lifts the pause; every member wakes on the message and continues (orchestrator)",
    "  done    <phase> [--as <member>]                                 # your part of the current phase is in: tells the orchestrator; when every member is done, the board tells it",
    `  close   --run <id> [--force]                                    # (orchestrator; --force for the orchestrators board, else refused); ${CODE_IN_CORE_HELP.closeRemoves}`,
    `  join    --run <id> --seat <id> --doing <t> [--files "<path>:interface,<path>:inside,…"]   # a file not there yet is one you create, declared from the project's root; prints the roster, how you listen (a seat waits in the foreground, a worker listens in the background), then the command that starts your link; ${CODE_IN_CORE_HELP.joinMakes}`,
    "  doing   [--as <member>] <text>",
    "  post    [--as <member>] <body> | --file <path> [--about <path|decision id>] [--urgent]   # prints the seq; --urgent (orchestrator only) wakes every waiter of the run, a pause included; --file for a long body (tables, quotes), never through shell quoting",
    "  agree   [--as <member>] <terms> [--about <path|decision id>] [--with <seat>[,<seat>]]  # prints the seq; parties: its @-mentions, --with, else the file's other holders",
    "  endorse [--as <member>] <seq>                                   # backs an agreement; prints the endorsement's seq",
    "  wait    [--as <member>] [--timeout <ms>] [--mentions]           # blocks until a message to you (a mention, an event addressed to you) or an urgent post, then says how to re-arm; nothing on timeout or end; a newer wait supersedes it",
    "          # once your run is closed, wait, roster --as, post, agree, endorse, doing and done answer: run <id> closed: run end …",
    "          # --mentions: you listen while you work rather than wait; a seat's run: the wake brings every unread post of the run",
    "  roster  [--project <path>] [--as <member>]",
    "  end     [--as <member>]                                         # once your run is closed; refused to a member while it is open (a member never ends itself)",
    "  end     --seat <id> [--as <member>]                              # ends a seat's member while the run is open, its context spent, before a fresh agent joins it (orchestrator)",
    "  status                                                          # data home, open runs, each run's phase and its n/m done; a run idle a day is flagged with its close command; each run not on the orchestrators board, with the command registering it",
    CODE_IN_CORE_HELP.pruneLine,
    `a member is <group>/<seat>, the orchestrator <group>/orchestrator; without --as, ${CODE_IN_CORE_HELP.withoutAs}`,
  ].join("\n");

/** A hidden verb's own help line: `serve` and `link` start nothing when asked for help. */
export const hiddenUsage = (cli: Command, verb: "serve" | "link"): string =>
  verb === "serve"
    ? `usage: ${cli} serve [stop]   # the board server of the data home, started on demand by any verb; \`serve stop\` ends it`
    : `usage: ${cli} link --run <id> --as <member>   # a member's link, started by its agent from the line join or open prints`;
