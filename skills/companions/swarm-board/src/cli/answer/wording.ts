// The answer module's wording (board-rework D1): every line and command template of the wait cluster's answers, in one
// typed table. A placeholder is a typed parameter, so a template called with a missing or wrong value does not compile.
// The rules choosing which line a member reads are in rules.ts; no verb writes these lines itself.
import { FOREGROUND_NOTE } from "../../board/events.ts";

/** A command as printed: the words joined, ready to copy. */
export type Command = string;

export const WORDING = {
  // ── commands ──
  /** `wait --mentions`, foreground carrying its hold */
  wait: (cli: Command, as: string, holdMs?: number): Command => `${cli} wait --mentions --as ${as}${holdMs ? ` --timeout ${holdMs}` : ""}`,
  done: (cli: Command, phase: string, as: string): Command => `${cli} done ${phase} --as ${as}`,
  thread: (cli: Command, as: string): Command => `${cli} thread --as ${as}`,
  end: (cli: Command, as: string): Command => `${cli} end --as ${as}`,

  /** board-split D55 (amended): `open --stall-ms` under the floor, raised to it */
  stallClamped: (askedMs: number, floorMs: number): string => `--stall-ms ${askedMs} is under the ${floorMs} ms floor of the stall window: the run uses ${floorMs}`,

  // ── the run's page ──
  /** board-split D41: the run's tab on aiview's board, the board's scoped URL (`#board&project=<name>`, D47), as aiview gives it, with the run in it;
   *  an older aiview's `/board` takes it as its hash */
  runBoardUrl: (boardUrl: string, run: number): string => `${boardUrl}${boardUrl.includes("#") ? "&" : "#"}run=${run}`,

  // ── the link and the listener ──
  linkStart: (link: Command) => `start your link now, in the background (your harness's background task): ${link}`,
  listenerStart: (wait: Command) => `start your listener now, in the background (your harness's background task): ${wait}`,
  waitNow: (afterPhase: boolean, wait: Command) =>
    `${afterPhase ? "only then wait" : "wait now"}, in the foreground (never a background listener: a seat that ends its turn is lost; ${FOREGROUND_NOTE}): ${wait}`,
  rearmBackground: (wait: Command) => `start this listener again, in the background while you work, in the foreground when you are waiting (${FOREGROUND_NOTE}): ${wait}`,
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
  /** break-flow V-4, V-17 (D61): every verb of a member that has ended, its run still open, answers this first */
  endedMember: (run: number) =>
    `you have ended in run ${run}: nothing more to do here; return your summary now (your link and listener background tasks end on their own, and their end notices are not news)`,
  /** break-flow V-29: `end --seat`, to the orchestrator: the state its member was in, and the line it reads now */
  seatEnded: (member: string, was: string, told: string) => `${member} ended; it was ${was}; its next call answers: ${told}`,
  /** break-flow V-29: a seat's state as status prints it, in the roster's word: a seat whose member ended reads ended */
  seatState: (state: string) => (state === "done" ? "ended" : state),
  /** D60, D65: a verb the member may not run now (parked, paused), refused with the line saying why */
  verbRefused: (verb: string, why: string) => `${verb} refused: ${why}`,
  // V-12: told only to a background listener (the orchestrator's), whose end its harness announces too
  delivered: "these lines are delivered; the task-end notice is the same event",

  // ── the phase ──
  phaseWhole: (name: string, text: string) => `phase ${name}: ${text}`,
  phaseShort: (name: string, thread: Command) => `phase ${name} (unchanged; its text: ${thread})`,
  phasePaused: (head: string | null, why: string) => [head, `PAUSED${why}`].filter(Boolean).join("  "),
  // board-split D65: a paused run's header in status and roster; on the person, it says whose move it is
  runPausedShown: (paused: string | null, onPerson: boolean) =>
    paused == null ? "" : onPerson ? `  paused · on you: ${paused || "your decision"}` : `  paused${paused ? `: ${paused}` : ""}`,
  // board-split D65: a phase opened during a pause is open, but nothing wakes the members before the resume
  phaseOpenedPaused: (name: string, run: number) => `run ${run} is paused: phase ${name} is open, and its members hear it at resume`,
  pauseWhy: (person: boolean, text: string) => (person ? `: waiting on the person: ${text || "their decision"}` : text ? `: ${text}` : ""),
  owedOpen: (name: string, text: string, read: string, done: Command) => `phase ${name} is open and asks: ${text}. ${read}Do your part now, then mark it done: ${done}`,
  owedBrief: (name: string, read: string, done: Command) => `you owe phase ${name}: ${read}${read ? "Do" : "do"} your part, then mark it done: ${done}`,
  readWholePhase: (thread: Command) => `Read the whole phase first: ${thread}. `,
  noPostYet: (name: string | null) => (name === null ? "no post yet in this run" : `no post yet in phase ${name}`),
  doneWaitNext: (wait: Command) => `wait for the next phase, in the foreground (${FOREGROUND_NOTE}): ${wait}`,
  doneNone: "no phase is open: nothing to mark",

  // ── a post's @-names (D63) ──
  // S23: an ended member's seat may be joined again, and its join delivers what waited for it (S1)
  mentionEnded: (name: string) => `@${name} has ended: the post stays on the thread, read at the seat's next join`,
  mentionNotJoined: (name: string) => `@${name} has not joined yet: the post waits for it, read at its join`,
  mentionNobody: (name: string, guesses: string[]) => `@${name} matched nobody on the board${guesses.length ? `: did you mean ${guesses.join(", ")}?` : ""}`,

  // ── agree ──
  /** S5: every party, the author marked, sorted by name so the line reads the same whoever agrees */
  agreeParties: (author: string, others: string[]) =>
    `parties: ${[...new Set([author, ...others])].sort().map((n) => (n === author ? `${n} (you)` : n)).join(", ")}; woken when its file merges`,

  // ── the orchestrator's verbs ──
  phaseHeard: (watch: string[]) =>
    watch.length
      ? `the done of ${watch.join(", ")} wakes you; every other done rides on your next wake`
      : "each member's done rides on your next wake; to hear one the moment it lands, open the phase with --watch <ids>",
  phaseFor: (only: string[]) => (only.length ? ` for ${only.join(", ")} alone (the others are not woken and owe no done)` : ""),
  phaseOpened: (name: string, forWhom: string, heard: string, cli: Command, as: string, run: number) =>
    `phase ${name} is open${forWhom}; ${heard}. Listen in the background: ${cli} wait --mentions --as ${as}. When the board says every member is done, open the next phase: ${cli} phase <name> "<text>" --as ${as}; after the last, ${cli} close --run ${run}`,
  briefThePerson: "brief the person: the list of what is done since the session began, one short phrase each, then what comes next",
  seatIdleEnded: (seat: string) => `${seat} ended idle and still owes this phase: dispatch a member into it (join the same seat) or resume it with SendMessage`,
  pausedAll: (run: number, person: string | null, cli: Command, as: string) =>
    `every member of run ${run} is told to stop and wait${person !== null ? `, waiting on the person: ${person}` : ""}; nothing wakes you but an urgent post until the resume, which gives you every line held meanwhile. Resume, with a message if they need one: ${cli} resume "<message>" --as ${as}`,
  resumed: (run: number, held: number, cli: Command, as: string) =>
    `run ${run} resumed${held ? `; ${held} held while paused, above` : ""}; listen again in the background: ${cli} wait --mentions --as ${as}`,
  lockHeldNext: (cli: Command, name: string, as: string, wait: Command) =>
    `next: wait for its unlocked event, then lock again (${cli} lock ${name} --as ${as}); in the foreground (${FOREGROUND_NOTE}): ${wait}`,

  // ── the run ──
  paused: (run: number, why: string, wait: Command) =>
    `run ${run} is paused${why}. Stop where you are: start nothing new and land nothing; wait in the foreground for the resume (${FOREGROUND_NOTE}): ${wait}`,
  closed: (run: number, end: Command) =>
    `run ${run} closed: run end and return your summary: ${end}; your link and listener background tasks end on their own now, and their end notices are not news`,
  // ── the line under an event, for the member it woke (D36, D59); the board posts the fact, these word it ──
  backIt: (cli: Command, seq: number, as: string) => `back it: ${cli} endorse ${seq} --as ${as}`,
  phaseDoneWhen: (name: string, tasks: string[], done: Command) =>
    `when your part of ${name}${tasks.length ? ` (your task${tasks.length > 1 ? "s" : ""} ${tasks.join(", ")})` : ""} is posted: ${done}`,
  pauseStop: (person: string | null, wait: Command) =>
    `${person !== null ? `waiting on the person: ${person || "their decision"}; ` : ""}stop where you are: start nothing new and land nothing; wait in the foreground for the resume (${FOREGROUND_NOTE}): ${wait}`,
  resumeGoOn: "the run resumed: continue where you stopped, as the resume's message says",
  // board-split D30: parked by the orchestrator; ending the turn is the member's, `end` the orchestrator's alone
  parkedStop: "you are parked: end your turn now, without end; the orchestrator resumes you at your next task",
  parked: (member: string, cli: Command, seat: string, as: string) =>
    `${member} is parked: it raises nothing and all-done does not wait for it; resume it with SendMessage at its next task, or ${cli} unpark ${seat} --as ${as}`,
  unparked: (member: string) => `${member} is unparked: its alerts and its share of all-done are back`,
  /** board-split D12: a code-pack verb from a member whose seat carries no code pack */
  packVerbRefused: (verb: string, seatKind: string) =>
    `${verb}: refused: ${verb} is a worker's verb, and a ${seatKind} holds no files; your verbs are in --help`,
  /** board-split D30, D38: a member's own end while its run is open */
  endRefused: (run: number, wait: Command) =>
    `end: refused, run ${run} is open: a member never ends itself; your seat stays, wait in the foreground for your next task (${FOREGROUND_NOTE}): ${wait}`,
  openNextPhase: (cli: Command, as: string, run: number) => `open the next phase: ${cli} phase <name> "<text>" --as ${as}; after the last, ${cli} close --run ${run}`,
  swarmQuiet: (cli: Command, as: string) => `every member waits: open the next phase if all are done (${cli} phase <name> "<text>" --as ${as}), else wait again`,
  allJoined: (cli: Command, as: string) => `every declared seat has joined: post the tasks, or open the first phase (${cli} phase <name> "<text>" --as ${as})`,
  lockFree: (cli: Command, name: string, as: string) => `it is free: lock it now: ${cli} lock ${name} --as ${as}`,
  breachOwn: "stop only the PIDs you started, or lock the port first: machine.md",
  breachOther: (member: string) => `SendMessage ${member} "stop only the PIDs you started, or lock the port first: machine.md"`,
  /** break-flow V-17: the end verb as it runs, never "close its seat" */
  lostMove: (cli: Command, seat: string, as: string) => `its agent is not running: dispatch it again, or end its seat: ${cli} end --seat ${seat} --as ${as}`,
  /** board-split D44: block and unblock, to the seat they name */
  blockedWait: "you are blocked on the person: stop where you are, change nothing, and wait in the foreground until unblock",
  unblockedGoOn: "unblocked: go on with your task",
  blockedSet: (member: string, cli: Command, seat: string, as: string) =>
    `${member} is blocked: its badge says so, it stops and waits; once the person answers, ${cli} unblock ${seat} --as ${as}`,
  unblockedSet: (member: string) => `${member} is unblocked: told to go on`,
  /** board-split D36: a subscription naming an event under its old name, read as the new one */
  /** board-split D47: `--repo` is read as `--project`, the one word for what a run sits in */
  /** board-split D47 (verify 3 F15): --project names a project as aiview does, or a path in it */
  noProject: (name: string) => `no project ${name}: --project takes an aiview project's name or a path inside a repository`,
  /** verify 3 F17: roster on a project with no open run says so, never nothing */
  /** verify-decisions F20: a verb run outside any repository names the flag that picks a project */
  notInRepository: (dir: string) => `${dir} is in no repository: name the project with --project <name> (an aiview project) or --project <path>`,
  noRunIn: (repo: string) => `no open run in ${repo}`,
  /** board-split#D28: a run's authority after its title, nothing when it names none */
  authorityShown: (roles: string[]) => (roles.length ? `  authority ${roles.join(",")}` : ""),
  optionRenamed: (old: string, now: string) => `${old} is now ${now}: read as ${now}, write that next time`,
  eventRenamed: (renamed: { old: string; now: string }[]) =>
    `${renamed.map((r) => `${r.old} is now ${r.now}`).join(", ")}: trouble is a badge (stalled, lost, blocked), its event named for it; read as ${[...new Set(renamed.map((r) => r.now))].join(", ")}, write that next time`,
  /** board-split D36: a member's badge beside its state in the roster, its reason after it */
  badgeShown: (badge: { name: string; reason: string }) => ` [${badge.name}: ${badge.reason}]`,
  restartLink: (member: string, cli: Command, run: number, as: string) => `SendMessage ${member} to restart its link, in the background: ${cli} link --run ${run} --as ${as}`,
  /** a stall's move, by the rule that badged its member stalled (idea 1, rule 6) */
  stalledEnded: "a post does not wake it: SendMessage it, or dispatch it again",
  stalledInTurn: "SendMessage it; if it does not answer, dispatch it again",
  stalledBackground: (cli: Command, post: string, as: string) => `ask it: ${cli} post ${post} --as ${as}, or SendMessage it if its turn ended`,
  stalledCall: "SendMessage it to stop the call",
  /** board-split D49: owing the phase out of a wait, no board call for the stall time */
  stalledSilent: (cli: Command, post: string, as: string) => `ask it: ${cli} post ${post} --as ${as}; if its turn ended, SendMessage it or dispatch it again`,
  // V-24 (D64): with no phase open, the stalled member owes its task's report, never a phase
  stalledAsk: (id: string, phase: string | undefined) => (phase ? `@${id} your part of ${phase}` : `@${id} your task: your report?`),
  stalledOwing: (cli: Command, post: string, as: string) => `${cli} post ${post} --as ${as}: its wait returns on it`,
  stalledLock: (holder: string, lock: string, cli: Command, post: string, as: string) => `ask ${holder} to unlock ${lock}, or to stop what it holds: ${cli} post ${post} --as ${as}`,
  stalledAny: (cli: Command, as: string) => `read the thread, then address the member who owes a move (${cli} post "@<member> <what you need>" --as ${as})`,
  /** several members stalled at one tick: each member's move after its name */
  stalledEach: (moves: { member: string; move: string }[]) => moves.map((m) => `${m.member}: ${m.move}`).join("; "),

  // ── the seat's commands at its join (D21, D36) ──
  /** board-split D11, D12: a verifier's join: no worktree, the merged branch read from where it is served, findings posted */
  verifierAs: (as: string) =>
    `pass --as ${as} on every call: you have no checkout of your own and hold no files; you judge the branch the phase names, in your own instance, and report by post`,
  verifierCommands: (cli: Command, as: string) => [
    `${cli} post --file <findings.md> --as ${as}    # your verdict and findings table, to @orchestrator`,
    `${cli} post "@<seat> <question>" --about <path> --as ${as}    # a question to a builder about a file`,
    `${cli} done <phase> --as ${as}`,
  ],
  seatCommands: (cli: Command, as: string, holdMs: number) => [
    `${cli} post "…" --about <D id> --as ${as}`,
    `${cli} agree "…" --about <D id> --as ${as}`,
    `${cli} endorse <seq> --as ${as}`,
    `${cli} wait --mentions --as ${as} --timeout ${holdMs}    # in the foreground, when waiting; ${FOREGROUND_NOTE}`,
  ],
  // ── a lock granted, and status's forgotten run ──
  unlockWhenDone: (cli: Command, name: string, as: string) => `next: unlock it once you are done: ${cli} unlock ${name} --as ${as}`,
  // ── board-split D36: a seat's state is derived, never set ──
  seatStateDerived: (cli: Command, seat: string, as: string) =>
    `seat: --state is gone: a seat is ready, running or done as its member is. Waiting on the person: ${cli} block ${seat} "<reason>" --as ${as} (${cli} unblock ${seat} --as ${as} lifts it); finished: ${cli} end --seat ${seat} --as ${as}; kept with no agent: ${cli} park ${seat} --as ${as}`,
  /** D34 (T36): a parked member's state on its roster line, as its card says it */
  parkedUntil: (phase: string) => `parked until ${phase}`,
  forgottenRun: (days: number, cli: Command, run: number) => `  no activity for ${days} d: likely left open; ask the person, then archive it: ${cli} close --run ${run}`,

  // ── board-split D28, D29: two runs holding decision authority, and the decisions run ──
  decisionsOpen: (cli: Command, title: string, seatsFile: string): Command => `${cli} open --kind brainstorm --group decisions --title ${title} --seats ${seatsFile}`,
  decisionsSeatAdd: (cli: Command, run: number, seat: string, roles: string): Command => `${cli} seat add ${seat} --run ${run} --role ${roles}`,
  decisionsRunNeeded: (runs: { run: number; group: string; roles: string[] }[], open: Command) =>
    `decision authority held by ${decisionHolders(runs)}: settle your common decisions in the decisions run; open it (the board wrote its seats file, a seat per run, its roles the seat's role): ${open}`,
  decisionsRunOpen: (runs: { run: number; group: string; roles: string[] }[], decisionsRun: number, seatAdds: Command[]) =>
    `decision authority held by ${decisionHolders(runs)}: settle your common decisions in the decisions run, run ${decisionsRun}` +
    (seatAdds.length ? `; add the missing seat${seatAdds.length > 1 ? "s" : ""}: ${seatAdds.join(" ; ")}` : ""),

  // ── w4 (board-split D62, D47): the done count, the phase that replaces an owed one, the project word ──
  /** a done of the open phase: the one count (owing.ts), the lost named in it */
  doneCounted: (phase: string, progress: string, all: boolean) => `done ${phase}: ${progress}${all ? "; the orchestrator is told every member is done" : ""}`,
  /** V-34 (D70): a member parked until the phase just opened, or named in its --for: it stays parked until unparked */
  phaseParkedMember: (member: string, cli: Command, seat: string, as: string) =>
    `${member} is parked and not counted in this phase: unpark it when it should take its part: ${cli} unpark ${seat} --as ${as}`,
  /** V-35: a member owing the phase just opened whose agent is lost */
  phaseLostMember: (member: string, move: string) => `${member} owes this phase and is lost: ${move}`,
  /** V-28: a done from a seat the open phase's count leaves out: recorded, and why it is not counted */
  doneNotOwed: (phase: string, why: { parked: true } | { forSeats: string[] }) =>
    `done ${phase} recorded; ${"parked" in why ? "you are parked: not counted until unparked" : `you do not owe ${phase} (it is for ${why.forSeats.join(", ")})`}`,
  /** a done run again for the same phase: nothing new recorded; for a phase no longer open, what the member owes now */
  doneAlready: (phase: string, progress: string | null, late: { owesNow: string | null } | null) =>
    `already done ${phase}${progress ? `: ${progress}` : ""}; nothing new recorded${late && !late.owesNow ? "; you owe nothing now" : ""}`,
  /** V-5: a done for a phase no longer open: recorded; the owed line after it names the phase owed now, else this says none is */
  doneLate: (phase: string, current: string, owesNow: string | null) =>
    `done ${phase} recorded late (the open phase is ${current}; the orchestrator is told)${owesNow ? "" : "; you owe nothing now"}`,
  /** V-6: a phase opened while members still owed the one it replaces */
  phaseStillOwed: (previous: string, members: string[]) => `${members.join(", ")} had not run done for ${previous}; ask each whether its part landed before you count on it`,
  /** V-18: aiview's project add, with the same env prefix as every other command line */
  aiviewProjectAdd: (envPrefix: string, launcher: string, cwd: string): Command => `${envPrefix}node ${launcher} project add <slug> --path ${cwd}`,
  /** V-31 (AGENTS rule 10): stats' last line, the --json command as this CLI runs */
  statsJson: (cli: Command): Command => `${cli} stats --json for every figure`,
  // ── T51 (board-split#D58): open and the run's identity ──
  /** a second open of a group already open on the project: refused, as `--as <group>/<seat>` would name two members */
  groupAlreadyOpen: (group: string, run: number, cli: Command) =>
    `open: refused: group ${group} already has run ${run} open on this project, and --as ${group}/<seat> names one member. Close it first (${cli} close --run ${run}), or open under another --group`,
  /** V-16 (AGENTS rule 10): how each declared seat joins, its member running it as printed */
  seatsJoin: (seats: string[], join: Command) => `each seat joins with this, run first by its member, <seat> one of ${seats.join(", ")}: ${join}`,
  seatJoin: (cli: Command, run: number, group: string, doing: string): Command => `${cli} join --run ${run} --seat <seat> --doing ${doing} --as ${group}/<seat>`,
} as const;

/** `run 7 board-split (architect, tech-lead) and run 8 shop (architect)`: each run holding decision authority, its roles. */
function decisionHolders(runs: { run: number; group: string; roles: string[] }[]): string {
  const each = runs.map((r) => `run ${r.run} ${r.group} (${r.roles.join(", ")})`);
  return each.length > 1 ? `${each.slice(0, -1).join(", ")} and ${each[each.length - 1]}` : each.join("");
}

/** A POSIX shell word, double-quoted when it holds anything else than plain characters: a command runs as printed. */
export const shellWord = (w: string): string => (/^[\w@%+=:,./-]+$/.test(w) ? w : `"${w.replace(/(["\\$`])/g, "\\$1")}"`);
