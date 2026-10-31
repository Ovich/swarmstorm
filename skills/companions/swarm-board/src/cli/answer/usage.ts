// The CLI's static help (board-rework D12): the core verbs, and the usage line of each hidden verb. The code verbs'
// help is the code pack's, in code-wording.ts. `cli` is this CLI as a member runs it.
import { CODE_IN_CORE_HELP } from "./code-wording.ts";
import type { Command } from "./wording.ts";
import { STALL_MS_DEFAULT } from "../../board/liveness.ts";

/** The core verbs' help; `events` the board's event names. */
export const coreUsage = (cli: Command, events: string[]): string =>
  [
    `usage: ${cli} <verb> [--json]        (${cli} --help code: ${CODE_IN_CORE_HELP.codeVerbs})`,
    "  open    --kind plan|brainstorm|task --group <slug> --title <t> --seats <file.json> [--link <url>] [--stall-ms <ms>] [--protocol <name>] [--authority <role,role>] [--onto <branch>]   # opens a run, registers the project's board in aiview, prints the run id, the board's URL, then the line that starts your link (orchestrator)",
    CODE_IN_CORE_HELP.ontoLine,
    `          # --stall-ms: a working member with no sign of progress this long posts stalled, default and floor ${STALL_MS_DEFAULT} ms; ends on the command that starts your link`,
    "          # --plan <slug> --seats <file.json>: the same as --kind plan --group <slug> --seats <file.json>",
    '          # the seats file: [{"id", "role"?, "area"?, "blockers": [...], "link"?: "<URL>", "on"?: ["agreement", …]}]',
    "  seat    add <id> --run <id> [--role <r>] [--area <a>] [--blockers a,b] [--link <url>] [--on <events>]   # adds a seat mid-run (orchestrator)",
    "  phase   <name> <text> [--for <seat>,…] [--watch <seat>,…] [--as <member>]   # opens phase <name>; the current phase ends with it: a separator on the thread that wakes every member of the run (orchestrator)",
    "          # --for: only those seats are woken and owe done (all-done counts them alone); the others read the phase as their next header",
    `  pause   [<text>] [--as <member>]                               # every member stops where it is and waits; ${CODE_IN_CORE_HELP.pauseRefuses}, no stalled or lost alert until resume; with --person every member carries the blocked badge, the text its reason (orchestrator)`,
    "  resume  [<message>] [--as <member>]                             # lifts the pause; every member wakes on the message and continues (orchestrator)",
    "  block   <seat> <reason> [--as <member>]                         # badge blocked: the seat waits on the person, the reason on hover; told to stop and wait (orchestrator)",
    "  unblock <seat> [--as <member>]                                  # lifts the blocked badge; told to go on (orchestrator)",
    "  park    <seat> [--until <phase>] [--as <member>]                # shown \"parked until <phase>\"; a seat only you need now (a worker between tasks, a verifier between passes): told to end its turn without end; no idle, stalled or lost for it, no badge, all-done does not wait for it, until unpark: its own calls never lift it (orchestrator)",
    "  unpark  <seat> [--as <member>]                                  # lifts a park (orchestrator)",
    "  done    <phase> [--as <member>]                                 # your part of the current phase is in: tells the orchestrator; when every member is done, the board tells it",
    `  close   --run <id> [--force]                                    # (orchestrator; --force for the orchestrators board, else refused); ${CODE_IN_CORE_HELP.closeRemoves}`,
    `  join    --run <id> --seat <id> --doing <t> [--files "<path>:interface,<path>:inside,…"]   # a file not there yet is one you create, declared from the project's root; prints the roster, how you listen (a seat waits in the foreground, a worker listens in the background), then the command that starts your link; ${CODE_IN_CORE_HELP.joinMakes}`,
    `          # --on <events>: what wakes your wait --mentions besides mentions and urgent posts, e.g. ${CODE_IN_CORE_HELP.onExample}; else the seat row's on, else the kind's defaults`,
    "  subscribe   [--as <member>] <events>                            # prints your subscriptions after",
    "  unsubscribe [--as <member>] <events>",
    "  doing   [--as <member>] <text>",
    "  post    [--as <member>] <body> | --file <path> [--about <path|decision id>] [--urgent]   # prints the seq; --urgent (orchestrator only) wakes every waiter of the run, a pause included; --file for a long body (tables, quotes), never through shell quoting",
    "  agree   [--as <member>] <terms> [--about <path|decision id>] [--with <seat>[,<seat>]]  # prints the seq; parties: its @-mentions, --with, else the file's other holders",
    "  endorse [--as <member>] <seq>                                   # backs an agreement; prints the endorsement's seq",
    "  read    <seq>",
    "  thread  [--as <member>] [<phase>]                               # every post of a phase in full (the current one by default): read it before you decide or add",
    "  thread  --run <id> [<phase>]                                    # a run read from outside, closed ones too: its phase, or every post of the run; read-only",
    "  deliver [--as <member>]                                         # what you have not had: mentions in full, the rest one line (a seat's run: every post in full)",
    "  wait    [--as <member>] [--timeout <ms>] [--mentions]           # blocks until a message for you, then says how to re-arm; nothing on timeout or end; a newer wait supersedes it",
    "          # once your run is closed, wait, deliver, read, roster --as, post, agree, endorse, doing and done answer: run <id> closed: run end …",
    "          # --mentions: only a mention of you, an urgent post or an event you subscribed to ends it; the rest stays for deliver (a seat's run: the wake brings every unread post)",
    "  roster  [--project <path>] [--as <member>]",
    "  end     [--as <member>]                                         # once your run is closed; refused to a member while it is open (a member never ends itself)",
    "  end     --seat <id> [--as <member>]                              # ends a seat's member while the run is open, its context spent, before a fresh agent joins it (orchestrator)",
    "  status                                                          # data home, open runs, each run's phase and its n/m done; a run idle a day is flagged with its close command; each run not on the orchestrators board, with the command registering it",
    "  config  retention [<days>]                                      # prints, or sets then prints, how many days closed runs and main's talk are kept",
    "  lock    <name> [--note <t>] [--as <member>]                     # a shared resource of the machine, before you use it: port:<n>, app:<name>, db:<name>, browser:<profile>; held: who, then how to wait",
    "  unlock  <name> [--as <member>]                                  # releases it; its waiters are told (end, lost and close release too)",
    "  locks                                                           # every held lock: holder, since, waiters, and for a port what listens on it now",
    CODE_IN_CORE_HELP.pruneLine,
    `events: ${events.join(", ")}; any:<event> for one posted in any run`,
    `a member is <group>/<seat>, the orchestrator <group>/orchestrator; without --as, ${CODE_IN_CORE_HELP.withoutAs}`,
  ].join("\n");

/** A hidden verb's own help line: `serve` and `link` start nothing when asked for help. */
export const hiddenUsage = (cli: Command, verb: "serve" | "link"): string =>
  verb === "serve"
    ? `usage: ${cli} serve [stop]   # the board server of the data home, started on demand by any verb; \`serve stop\` ends it`
    : `usage: ${cli} link --run <id> --as <member>   # a member's link, started by its agent from the line join or open prints`;
