// The run's answer wording (product-shape#D20): the lines of open, seat, close, pause, resume and status, the run's
// page and the orchestrators board. Spread into WORDING (wording.ts), which every caller reads.
import { FOREGROUND_NOTE, type Command } from "./command.ts";

export const RUN_WORDING = {

  /** board-split D55 (amended): `open --stall-ms` under the floor, raised to it */
  stallClamped: (askedMs: number, floorMs: number): string => `--stall-ms ${askedMs} is under the ${floorMs} ms floor of the stall window: the run uses ${floorMs}`,

  // ── the run's page ──
  /** board-split D41: the run's tab on aiview's board, the board's scoped URL (`#board&project=<name>`, D47), as aiview gives it, with the run in it */
  runBoardUrl: (boardUrl: string, run: number): string => `${boardUrl}${boardUrl.includes("#") ? "&" : "#"}run=${run}`,
  /** trust-adaptations#D5: `close` and `seat add` resolve their caller, and only the run's orchestrator may run them */
  orchestratorOnly: (verb: "close" | "seat add", run: number, caller: string | null, rerun: Command) =>
    `${verb}: refused: only the orchestrator of run ${run} may ${verb === "close" ? "close it" : "add a seat to it"}${caller ? `, and ${caller} is not` : ""}. Run it as the orchestrator: ${rerun}`,
  closeRun: (cli: Command, run: number, as: string): Command => `${cli} close --run ${run} --as ${as}`,
  /** board-fixes#D6: the second step of a close, the one that closes */
  closeConfirm: (cli: Command, run: number, as: string): Command => `${cli} close --run ${run} --confirm --as ${as}`,
  closeWaitRunning: (run: number, owing: string[], finish = "reported, done") =>
    `close: not yet, run ${run} has members still owing work: ${owing.join(", ")}. Post no new task; let them finish (${finish}), then run close again`,
  closeSteps: (run: number, confirm: Command, columns = "| task | seat | state | result |") =>
    `close: one step first. Post the closing table to the run, written from status: one row per task, ${columns}, then the next steps (what is left, what follows). Then close run ${run}: ${confirm}`,
  seatAdd: (cli: Command, seat: string, run: number, as: string): Command => `${cli} seat add ${seat} --run ${run} --as ${as}`,
  /** break-flow V-29: a seat's state as status prints it, in the roster's word: a seat whose member ended reads ended */
  seatState: (state: string) => (state === "done" ? "ended" : state),
  // board-split D65: a paused run's header in status and roster; on the person, it says whose move it is
  runPausedShown: (paused: string | null, onPerson: boolean) =>
    paused == null ? "" : onPerson ? `  paused · on you: ${paused || "your decision"}` : `  paused${paused ? `: ${paused}` : ""}`,
  pauseWhy: (person: boolean, text: string) => (person ? `: waiting on the person: ${text || "their decision"}` : text ? `: ${text}` : ""),
  pausedAll: (run: number, person: string | null, cli: Command, as: string) =>
    `every member of run ${run} is told to stop and wait${person !== null ? `, waiting on the person: ${person}` : ""}; nothing wakes you but an urgent post until the resume, which gives you every line held meanwhile. Resume, with a message if they need one: ${cli} resume "<message>" --as ${as}`,
  resumed: (run: number, held: number, cli: Command, as: string) =>
    `run ${run} resumed${held ? `; ${held} held while paused, above` : ""}; listen again in the background: ${cli} wait --mentions --as ${as}`,

  // ── the run ──
  // the orchestrator's own run is paused: said first at each of its verbs until the resume, so a pause is never forgotten
  stillPaused: (run: number, why: string, cli: Command, as: string) =>
    `run ${run} is PAUSED${why}: no member acts on this until you resume (${cli} resume "<message>" --as ${as})`,
  paused: (run: number, why: string, wait: Command) =>
    `run ${run} is paused${why}. Stop where you are: start nothing new and land nothing; wait in the foreground for the resume (${FOREGROUND_NOTE}): ${wait}`,
  closed: (run: number, end: Command) =>
    `run ${run} closed: run end and return your summary: ${end}; your link and listener background tasks end on their own now, and their end notices are not news`,
  pauseStop: (person: string | null, wait: Command) =>
    `${person !== null ? `waiting on the person: ${person || "their decision"}; ` : ""}stop where you are: start nothing new and land nothing; wait in the foreground for the resume (${FOREGROUND_NOTE}): ${wait}`,
  resumeGoOn: "the run resumed: continue where you stopped, as the resume's message says",
  noRunIn: (repo: string) => `no open run in ${repo}`,
  /** board-split#D28: a run's authority after its title, nothing when it names none */
  authorityShown: (roles: string[]) => (roles.length ? `  authority ${roles.join(",")}` : ""),
  // ── board-split D36: a seat's state is derived, never set ──
  forgottenRun: (days: number, cli: Command, run: number, orchestrator: string) => `  no activity for ${days} d: likely left open; ask the person, then archive it: ${cli} close --run ${run} --as ${orchestrator}`,

  // ── the orchestrators board: every orchestrator registers there, whatever its roles; never closed ──
  orchestratorsOpen: (cli: Command, title: string, seatsFile: string): Command => `${cli} open --kind brainstorm --group orchestrators --title ${title} --seats ${seatsFile}`,
  orchestratorsSeatAdd: (cli: Command, run: number, seat: string, roles?: string): Command => `${cli} seat add ${seat} --run ${run}${roles ? ` --role ${roles}` : ""}`,
  orchestratorsNeeded: (open: Command) =>
    `register on the project's orchestrators board, which every orchestrator joins and nobody closes; it is not open yet: open it (the board wrote its seats file, a seat per open run), then join your seat: ${open}`,
  orchestratorsRegister: (board: number, commands: Command[]) =>
    `register on the project's orchestrators board, run ${board}, which every orchestrator joins and nobody closes: ${commands.join(" ; ")}`,
  orchestratorsNeverClosed: (cli: Command, run: number) =>
    `close: refused: run ${run} is the project's orchestrators board, which stays open; each orchestrator leaves it with end. Closing it on purpose: ${cli} close --run ${run} --force`,
  orchestratorsRejoin: (board: number, joins: Command[]) =>
    `your seat is on the project's orchestrators board, run ${board}; take it back: ${joins.join(" ; ")}`,
  /** V-18: aiview's project add, with the same env prefix as every other command line */
  aiviewProjectAdd: (envPrefix: string, launcher: string, cwd: string): Command => `${envPrefix}node ${launcher} project add <slug> --path ${cwd}`,
  // ── T51 (board-split#D58): open and the run's identity ──
  /** a second open of a group already open on the project: refused, as `--as <group>/<seat>` would name two members */
  /** An open that failed after the board began the run: the run closed again, so none is left half-opened. */
  openFailedUndone: (why: string, run: number) => `open: failed (${why}); run ${run} it began is closed again, no run is left: open again`,
  /** An open that failed and whose run could not be closed again: how to close it by hand. */
  openFailedLeft: (why: string, group: string, cli: Command) =>
    `open: failed (${why}), and the run it began for group ${group} could not be closed again: find it (${cli} roster) and close it (${cli} close --run <run> --as ${group}/orchestrator), then open again`,
  groupAlreadyOpen: (group: string, run: number, cli: Command) =>
    `open: refused: group ${group} already has run ${run} open on this project, and --as ${group}/<seat> names one member. Close it first (${cli} close --run ${run} --as ${group}/orchestrator), or open under another --group`,
  /** V-16 (AGENTS rule 10): how each declared seat joins, its member running it as printed */
  seatsJoin: (seats: string[], join: Command) => `each seat joins with this, run first by its member, <seat> one of ${seats.join(", ")}: ${join}`,
  seatJoin: (cli: Command, run: number, group: string, doing: string, seat = "<seat>"): Command => `${cli} join --run ${run} --seat ${seat} --doing ${doing} --as ${group}/${seat}`,
} as const;
