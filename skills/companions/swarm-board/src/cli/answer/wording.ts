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

  // ── the run's page ──
  /** board-split D41: the run's tab on aiview's board, the board's scoped URL (`#board&repo=<key>`) with the run in it;
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
  ended: (run: number) => `you have ended in run ${run}: this listener stops; nothing to re-arm`,
  delivered: "these lines are delivered; the task-end notice is the same event",

  // ── the phase ──
  phaseWhole: (name: string, text: string) => `phase ${name}: ${text}`,
  phaseShort: (name: string, thread: Command) => `phase ${name} (unchanged; its text: ${thread})`,
  phasePaused: (head: string | null, why: string) => [head, `PAUSED${why}`].filter(Boolean).join("  "),
  pauseWhy: (person: boolean, text: string) => (person ? `: waiting on the person: ${text || "their decision"}` : text ? `: ${text}` : ""),
  owedOpen: (name: string, text: string, read: string, done: Command) => `phase ${name} is open and asks: ${text}. ${read}Do your part now, then: ${done}`,
  owedBrief: (name: string, read: string, done: Command) => `phase ${name} is yours: ${read}Do your part now, then: ${done}`,
  readWholePhase: (thread: Command) => `Read the whole phase first: ${thread}. `,
  noPostYet: (name: string) => `no post yet in phase ${name}`,
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
  dormant: (seat: string) => `${seat} is dormant: dispatch a member into it (join the same seat) or resume it with SendMessage`,
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
    `${verb}: refused, a ${seatKind} has no code pack: ${verb} is a worker's verb; your verbs are in --help`,
  /** board-split D30, D38: a member's own end while its run is open */
  endRefused: (run: number, wait: Command) =>
    `end: refused, run ${run} is open: a member never ends itself; your seat stays, wait in the foreground for your next task (${FOREGROUND_NOTE}): ${wait}`,
  openNextPhase: (cli: Command, as: string, run: number) => `open the next phase: ${cli} phase <name> "<text>" --as ${as}; after the last, ${cli} close --run ${run}`,
  swarmQuiet: (cli: Command, as: string) => `every member waits: open the next phase if all are done (${cli} phase <name> "<text>" --as ${as}), else wait again`,
  allJoined: (cli: Command, as: string) => `every declared seat has joined: post the tasks, or open the first phase (${cli} phase <name> "<text>" --as ${as})`,
  lockFree: (cli: Command, name: string, as: string) => `it is free: lock it now: ${cli} lock ${name} --as ${as}`,
  breachOwn: "stop only the PIDs you started, or lock the port first: machine.md",
  breachOther: (member: string) => `SendMessage ${member} "stop only the PIDs you started, or lock the port first: machine.md"`,
  lostMove: "its agent is not running: dispatch it again, or close its seat",
  /** board-split D44: block and unblock, to the seat they name */
  blockedWait: "you are blocked on the person: stop where you are, change nothing, and wait in the foreground until unblock",
  unblockedGoOn: "unblocked: go on with your task",
  blockedSet: (member: string, cli: Command, seat: string, as: string) =>
    `${member} is blocked: its badge says so, it stops and waits; once the person answers, ${cli} unblock ${seat} --as ${as}`,
  unblockedSet: (member: string) => `${member} is unblocked: told to go on`,
  /** board-split D36: a subscription naming an event under its old name, read as the new one */
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
  stalledOwing: (cli: Command, post: string, as: string) => `${cli} post ${post} --as ${as}: its wait returns on it`,
  stalledLock: (holder: string, lock: string, cli: Command, post: string, as: string) => `ask ${holder} to unlock ${lock}, or to stop what it holds: ${cli} post ${post} --as ${as}`,
  stalledAny: (cli: Command, as: string) => `read the thread, then address the member who owes a move (${cli} post "@<member> <what you need>" --as ${as})`,
  /** several members stalled at one tick: each member's move after its name */
  stalledEach: (moves: { member: string; move: string }[]) => moves.map((m) => `${m.member}: ${m.move}`).join("; "),

  // ── the seat's commands at its join (D21, D36) ──
  /** board-split D11, D12: a verifier's join: no worktree, the merged branch read from where it is served, findings posted */
  verifierAs: (as: string) =>
    `pass --as ${as} on every call: you have no checkout of your own and hold no files; you judge the branch the phase names, in your own instance, and report by post`,
  verifierCommands: (cli: Command, as: string, holdMs: number) => [
    `${cli} post --file <findings.md> --as ${as}    # your verdict and findings table, to @orchestrator`,
    `${cli} post "@<seat> <question>" --about <path> --as ${as}    # a question to a builder about a file`,
    `${cli} done <phase> --as ${as}`,
    `${cli} wait --mentions --as ${as} --timeout ${holdMs}    # in the foreground, when waiting; ${FOREGROUND_NOTE}`,
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
  seatStateDerived: (cli: Command, seat: string) =>
    `seat: --state is gone (D36): a seat is ready, running or done as its member is. Waiting on the person: ${cli} block ${seat} "<reason>" (${cli} unblock ${seat} lifts it); finished: ${cli} end --seat ${seat}; kept with no agent: ${cli} park ${seat}`,
  forgottenRun: (days: number, cli: Command, run: number) => `  no activity for ${days} d: likely left open; ask the person, then archive it: ${cli} close --run ${run}`,
} as const;

/** A POSIX shell word, double-quoted when it holds anything else than plain characters: a command runs as printed. */
export const shellWord = (w: string): string => (/^[\w@%+=:,./-]+$/.test(w) ? w : `"${w.replace(/(["\\$`])/g, "\\$1")}"`);
