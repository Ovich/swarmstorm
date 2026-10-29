// CLI dispatch — the agent-facing surface of the board. Human output is short lines an
// agent reads; --json prints the same data as one object; errors go to stderr, exit 1.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { openBoard, progressText, type Declared, type Delivery, type Flag, type Kind, type Message, type Participant, type PhaseProgress, type RosterEntry, type RunStats, type SeatSpec, type SeatState } from "../board/board.ts";
import { profileOf } from "../board/kinds.ts";
import { EVENTS, FOREGROUND_NOTE, FOREGROUND_WAIT_MS, eventOf, formatSubscriptions, parseSubscriptions, type Subscription } from "../board/events.ts";
import { DATA_ROOT, SQLITE_PATH } from "../board/home.ts";
import { bindingOf, connectBoard, linkVerbArgs, type BoardMember, type ConnectedBoard } from "../client/remote.ts";
import { parseArgs } from "./args.ts";
import { fullText, seqLine } from "./format.ts";
import { nameHandle, unmatchedMentions } from "../board/mentions.ts";
import { boardHome, registerBoard } from "./aiview-board.ts";
import { unclaimedLines, type Rename } from "./unclaimed.ts";
import { git, worktreeHolding } from "./git.ts";
import { conflictsOf, headReflogLength } from "./conflicts.ts";
import { runLink } from "../link/link.ts";

const args = parseArgs(process.argv.slice(2));
const asJson = args.has("--json");
/** An open run idle this long is shown by status as likely forgotten, with its close command. */
const FORGOTTEN_MS = 24 * 60 * 60 * 1000;

const USAGE = [
  "usage: swarm <verb> [--json]        (swarm --help code: the claim and merge verbs)",
  "  open    --kind plan|brainstorm|task --group <slug> --title <t> --seats <file.json> [--link <url>] [--stall-ms <ms>] [--protocol <name>]   # opens a run, registers the project's board in aiview, prints the run id, the board's URL, then the line that starts your link (orchestrator)",
  "          # --stall-ms: no counter moved this long posts stalled, default 60000; ends on the command that starts your link",
  "          # --plan <slug> --seats <file.json>: the same as --kind plan --group <slug> --seats <file.json>",
  '          # the seats file: [{"id", "role"?, "area"?, "blockers": [...], "link"?: "<URL>", "on"?: ["agreement", …], "busyMax"?: <ms, its bound on a non-shell call; a verifier\'s 300000>}]',
  "  seat    <id> --run <id> --state ready|running|done|blocked     # (orchestrator)",
  "  seat    add <id> --run <id> [--role <r>] [--area <a>] [--blockers a,b] [--link <url>] [--on <events>] [--busy-max <ms>]   # adds a seat mid-run (orchestrator); --busy-max: its bound on a non-shell call (a verifier's 300000)",
  "  phase   <name> <text> [--for <seat>,…] [--watch <seat>,…] [--as <member>]   # opens phase <name>; the current phase ends with it: a separator on the thread that wakes every member of the run (orchestrator)",
  "          # --for: only those seats are woken and owe done (all-done counts them alone); the others read the phase as their next header",
  "  pause   [<text>] [--as <member>]                               # every member stops where it is and waits; claim and merge-lock refused, no stall, quiet or stale alert until resume (orchestrator)",
  "  resume  [<message>] [--as <member>]                             # lifts the pause; every member wakes on the message and continues (orchestrator)",
  "  done    <phase> [--as <member>]                                 # your part of the current phase is in: tells the orchestrator; when every member is done, the board tells it",
  "  close   --run <id>                                              # (orchestrator)",
  '  join    --run <id> --seat <id> --doing <t> [--files "<path>:interface,<path>:inside,…"]   # a file not there yet is one you create, declared from the repository root; prints the roster, how you listen (a seat waits in the foreground, a worker listens in the background), then the command that starts your link',
  "          # --on <events>: what wakes your wait --mentions besides mentions and urgent posts, e.g. agreement,any:merged; else the seat row's on, else the kind's defaults",
  "  subscribe   [--as <member>] <events>                            # prints your subscriptions after",
  "  unsubscribe [--as <member>] <events>",
  "  doing   [--as <member>] <text>",
  "  post    [--as <member>] <body> | --file <path> [--about <path|decision id>] [--urgent]   # prints the seq; --urgent (orchestrator only) wakes every waiter of the run, a pause included; --file for a long body (tables, quotes), never through shell quoting",
  "  agree   [--as <member>] <terms> [--about <path|decision id>] [--with <seat>[,<seat>]]  # prints the seq; parties: its @-mentions, --with, else the file's other holders",
  "  endorse [--as <member>] <seq>                                   # backs an agreement; prints the endorsement's seq",
  "  read    <seq>",
  "  thread  [--as <member>] [<phase>]                               # every post of a phase in full (the current one by default): read it before you decide or add",
  "  deliver [--as <member>]                                         # what you have not had: mentions in full, the rest one line (a seat's run: every post in full)",
  "  wait    [--as <member>] [--timeout <ms>] [--mentions]           # blocks until a message for you, then says how to re-arm; nothing on timeout or end; a newer wait supersedes it",
  "          # once your run is closed, wait, deliver, read, roster --as, post, agree, endorse, doing and done answer: run <id> closed: run end …",
  "          # --mentions: only a mention of you, an urgent post or an event you subscribed to ends it; the rest stays for deliver (a seat's run: the wake brings every unread post)",
  "  roster  [--repo <path>] [--as <member>]",
  "  end     [--as <member>]                                         # claims or flags what you wrote unclaimed, then releases your claims and the lock",
  "  status                                                          # data home, open runs, each run's phase and its n/m done; a run idle a day is flagged with its close command",
  "  config  retention [<days>]                                      # prints, or sets then prints, how many days closed runs and main's talk are kept",
  "  lock    <name> [--note <t>] [--as <member>]                     # a shared resource of the machine, before you use it: port:<n>, app:<name>, db:<name>, browser:<profile>; held: who, then how to wait",
  "  unlock  <name> [--as <member>]                                  # releases it; its waiters are told (end, gone and close release too)",
  "  locks                                                           # every held lock: holder, since, waiters, and for a port what listens on it now",
  `events: ${Object.keys(EVENTS).join(", ")}; any:<event> for one posted in any run`,
  "a member is <group>/<seat>, the orchestrator <group>/orchestrator; without --as, the member joined from this worktree",
].join("\n");

/** The verbs of a kind with claims (a plan run's), apart from the core (D22). */
const CODE_USAGE = [
  "usage: swarm <verb> [--json]        the code verbs; refused on a run whose kind has no claims",
  "  claim   [--as <member>] <path> [--interface] [--new]            # before editing a file: exit 0 claimed, 3 held until you post about it (the post claims it); --new: a file you create",
  "  release [--as <member>] <path>... | --all                        # gives up a claim; --all: every claim you hold",
  "  merge-lock --onto <branch> [--as <member>]                      # one merge at a time per repository; claims or flags what your branch wrote unclaimed",
  "  merged  [--as <member>] <sha> --files <path>... --report <text>|-   # releases the lock, tells who must rebase and who was refused the lock, names whom to tell of a resolved conflict; posts \"@orchestrator merged <sha>: <text>\", your report and its one wake; --report - merges silently",
].join("\n");

/** `stats` is for an outside reader, never a member: not in USAGE, its own help (D33). */
const STATS_USAGE = [
  "usage: swarm stats [--repo <path>] [--run <id>] [--since 30d|<ISO> | --all] [--closed] [--kind plan|brainstorm|task[,…]] [--json]",
  "  the figures of a repository's runs, oldest first, with the scope's totals; a figure not recorded or not computed yet is null, never 0",
  "  --since: runs open, or closed since then, default 30d, none with --run; --all: every run kept; --closed: closed runs only",
  "  without --json: one line per run; --json carries every figure, with the run ids, members and seqs to follow with swarm read <seq>",
].join("\n");

/** A length as an agent reads it: `2h 05m`, `12m`, `40s`; `—` when not known. */
const lengthText = (ms: number | null): string => {
  if (ms === null) return "—";
  const minutes = Math.floor(ms / 60_000);
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
  return minutes >= 1 ? `${minutes}m` : `${Math.round(ms / 1000)}s`;
};
/** `stats`' line for a run (D34, D35): `<code> <title> · <kind> · <length> · <open|closed> · conflicts <n|unknown>`. */
const statsLine = (r: RunStats): string => {
  const c = r.plan?.conflicts;
  // no merge: —; not recorded: unknown; some merges unknown: <n> + <m> unknown
  const conflicts =
    !c || (r.recorded && r.firstMergeAtMs === null)
      ? "—"
      : c.known === null
        ? "unknown"
        : c.unknownMerges
          ? `${c.known} + ${c.unknownMerges} unknown`
          : String(c.known);
  return `${r.code} ${r.title} · ${r.kind} · ${lengthText(r.lengthMs)} · ${r.closedAt === null ? "open" : "closed"} · conflicts ${conflicts}`;
};

class CliError extends Error {}
const fail = (msg: string): never => {
  throw new CliError(msg);
};

const emit = (json: unknown, human: string | (() => void)): void => {
  if (asJson) console.log(JSON.stringify(json));
  else if (typeof human === "string") {
    if (human) console.log(human);
  } else human();
};

/** The flag D24 removed: no member, and no orchestrator, ever names a transcript; the link finds it. */
const refuseTranscriptFlag = (verb: string): void => {
  if (args.has("--transcript")) fail(`${verb}: unknown flag --transcript\n${USAGE}`);
};

/** The repository (D29): its common git dir, so every worktree of one repository is one. */
function repoOf(dir: string): string {
  const common = git(dir, "rev-parse", "--git-common-dir");
  if (!common) fail(`not in a git repository: ${dir}`);
  const abs = path.resolve(dir, common as string);
  try {
    return fs.realpathSync.native(abs);
  } catch {
    return abs;
  }
}

/** The worktree the CLI runs in, as registered at join (D28). */
function worktreeOf(dir: string): string | null {
  const top = git(dir, "rev-parse", "--show-toplevel");
  return top ? path.resolve(top) : null;
}

/** Paths `git status` shows changed in a worktree, as it gives them; a rename gives both (D31). */
function changedIn(worktree: string): string[] {
  const r = spawnSync("git", ["status", "--porcelain", "-z", "--untracked-files=all"], { cwd: worktree, encoding: "utf8" });
  if (r.status !== 0) return fail(`git status failed in ${worktree}: ${r.stderr.trim()}`);
  const parts = r.stdout.split("\0");
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    out.push(e.slice(3));
    if (/[RC]/.test(e.slice(0, 2)) && parts[i + 1]) out.push(parts[++i]); // -z: "R  new\0old\0"
  }
  return out;
}

/** Paths the worktree's branch changed since it left `onto`, committed or not; a rename gives both (D59). */
function branchChangedIn(worktree: string, onto: string): string[] {
  const base = git(worktree, "merge-base", onto, "HEAD") ?? fail(`no merge base between ${onto} and HEAD in ${worktree}: is --onto the branch you merge into?`);
  // --no-renames: a rename is its deletion and its addition, both paths
  const r = spawnSync("git", ["diff", "--name-only", "-z", "--no-renames", `${base}..HEAD`], { cwd: worktree, encoding: "utf8" });
  if (r.status !== 0) return fail(`git diff failed in ${worktree}: ${r.stderr.trim()}`);
  const committed = r.stdout.split("\0").filter(Boolean);
  return [...new Set([...committed, ...changedIn(worktree)])];
}

/** The renames git detects between `base` and the worktree, committed or not: a rename is two claims, the old path and the new. */
function renamesIn(worktree: string, base: string): Rename[] {
  const r = spawnSync("git", ["diff", "--name-status", "-z", "-M", base], { cwd: worktree, encoding: "utf8" });
  if (r.status !== 0) return [];
  const parts = r.stdout.split("\0");
  const out: Rename[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (/^[RC]\d*$/.test(parts[i])) {
      if (parts[i].startsWith("R")) out.push([parts[i + 1], parts[i + 2]]);
      i += 2;
    } else if (/^[A-Z]$/.test(parts[i])) i += 1;
  }
  return out;
}

/** The reconcile's lines: one summary of the unclaimed writes, then each flag on the thread (D58, D59, F24). */
const printReconciled = (unclaimed: string[], flags: Flag[], renames: Rename[] = []): void => {
  const lines = unclaimedLines(unclaimed, renames);
  for (const line of lines) console.log(line);
  // F16: what the line means
  if (lines.length) console.log("(not a flag: a write without a claim is allowed, and was claimed for you; only a file another member holds raises a flag, below)");
  for (const f of flags) console.log(`#${f.seq} flagged: you wrote ${f.path} outside your claim; ${f.holder} holds it. Settle it with @${f.holder} on the thread.`);
};

/** The tool's folder (swarm.mjs's), the aiview skill beside it. */
const toolRoot = (): string => process.env.SWARM_ROOT ?? path.dirname(path.resolve(process.argv[1]));

const need = (flag: string): string => args.flag(flag) ?? fail(`${flag} is required\n${USAGE}`);

const runArg = (): number => {
  const raw = need("--run");
  const id = Number(raw);
  if (!Number.isInteger(id)) fail(`--run takes a run id, got ${raw}`);
  return id;
};

/** The board a verb talks to: straight to the server until `caller` binds it to the caller's link (D29). */
let board!: ConnectedBoard;
/** The caller whose link did not answer in a harness session: the verb ends on the line that starts it (D39). */
let linkToStart: BoardMember | null = null;

/** The caller: --as names it; otherwise the member that joined from this worktree, asked of the server
 *  directly (D29). From then on the verb's calls go through that member's link. */
async function caller(): Promise<Participant> {
  const as = args.flag("--as");
  const wt = as ? null : worktreeOf(process.cwd());
  const p = as
    ? ((await board.participant(as)) ?? fail(`unknown member ${as}`))
    : ((wt ? await board.identify({ worktree: wt }) : null) ?? fail("who is calling? no single member joined from this worktree; pass --as <group>/<seat>"));
  const direct = board;
  const member = { name: p.name, run: p.run };
  // S62: a member ended, or of a closed run, has no link: its verb stays on the server, waits for no link and never
  // prints the link line; it answers the closed line, or end its summary prompt
  if (p.ended || !(await direct.runs()).some((r) => r.id === p.run)) return p;
  board = await connectBoard({ dataRoot: DATA_ROOT, member });
  if (board.linkMissing) linkToStart = member;
  direct.close();
  return p;
}

/** How long ago an ms epoch was, short: `12s`, `4m`, `2h`; `never` for null. */
const ago = (at: number | null): string => {
  if (at == null) return "never";
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  return s < 120 ? `${s}s` : s < 7200 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
};
/** A member's state (swarm-relay D9) and the tool it is in or last ran: `busy (Bash npm test)`; with `ages`, its two
 *  ages after it (D38): `busy (Bash npm test)  progress 12s ago, link 0s ago`. */
const stateLine = (r: Pick<RosterEntry, "state" | "activity" | "progressAt" | "aliveAt">, ages = false): string =>
  `${r.state}${r.activity ? ` (${r.activity})` : ""}` +
  (ages ? `  progress ${ago(r.progressAt)}${r.progressAt == null ? "" : " ago"}, link ${ago(r.aliveAt)}${r.aliveAt == null ? "" : " ago"}` : "");

/** F27: a member's held files, the first few and how many more. */
const HELD_SHOWN = 3;
const heldLine = (files: { path: string; interface: boolean }[]): string => {
  const shown = files.slice(0, HELD_SHOWN).map((f) => (f.interface ? `${f.path} (interface)` : f.path)).join(", ");
  return files.length > HELD_SHOWN ? `${shown} +${files.length - HELD_SHOWN} more (${files.length})` : shown;
};

const rosterLine = (r: RosterEntry, ages = false): string => {
  const files = heldLine(r.held);
  // the funny name beside the member (D43); an orchestrator is its name alone
  const who = r.seat === "orchestrator" ? r.name : `${r.nick} · ${r.name}`;
  const on = r.subscriptions.length ? `  on: ${formatSubscriptions(r.subscriptions)}` : "";
  // a seat's own bound on a non-shell call, shown only when it differs from the default (idea 5)
  const bound = r.busyMax != null ? `  busy max: ${Math.round(r.busyMax / 1000)} s (non-shell calls)` : "";
  return `${who}${r.stale ? " (stale)" : ""}  run ${r.run}  ${stateLine(r, ages)}${r.unread ? `  ${r.unread} unread` : ""}  doing: ${r.doing || "-"}${files ? `  files: ${files}` : ""}${on}${bound}`;
};

/** The run's current phase as the header of what a member reads: `phase <name>: <text>`; null before the first phase.
 *  `shownTo`: a member's wait, deliver or read, which gets the full text the first time in a phase, then the short
 *  header naming where its text is (B15); the owed line stays whole elsewhere. */
const phaseHeader = async (run: number, shownTo?: Participant): Promise<string | null> => (await phaseHeaders(run, shownTo)).printed;
/** The phase header twice: `printed`, short after a member's first return in the phase (B15); `full`, always whole, for --json (F7). */
const phaseHeaders = async (run: number, shownTo?: Participant, showPause = true): Promise<{ printed: string | null; full: string | null }> => {
  const shown = shownTo ? await board.showPhase(shownTo) : null;
  const ph = shown ? shown.phase : await board.currentPhase(run);
  const r = (await board.runs()).find((x) => x.id === run);
  const whole = ph ? `phase ${ph.name}: ${ph.text}` : null;
  const short = ph && shown && !shown.first ? `phase ${ph.name} (unchanged; its text: ${[...self(), "thread", "--as", shellWord(shownTo!.name)].join(" ")})` : whole;
  if (r?.paused == null || !showPause) return { printed: short, full: whole };
  const why = r.pausedPerson ? `: waiting on the person: ${r.paused || "their decision"}` : r.paused ? `: ${r.paused}` : "";
  const withPause = (head: string | null) => [head, `PAUSED${why}`].filter(Boolean).join("  ");
  return { printed: withPause(short), full: withPause(whole) };
};
/** `phase <name>: <text>  <n>/<m> done[, <k> gone]` beside a run's title, or nothing before its first phase. */
const phaseSuffix = (phase: { name: string; text: string } | null, progress: PhaseProgress | null): string =>
  phase ? `  phase ${phase.name}: ${phase.text}${progress ? `  ${progressText(progress)}` : ""}` : "";

/** A delivery as the member reads it: each event followed by the line its registry row gives (D36, D59). */
const withNext = (me: Participant, d: Delivery): Delivery & { full: (Message & { endorse?: string })[] } => ({
  ...d,
  full: d.full.map((m) => {
    const e = eventOf(m);
    const line = e ? (EVENTS[e].next?.(m, me, self().join(" ")) ?? null) : null;
    // `endorse`: the JSON field the back-it line has always had
    return line ? { ...m, endorse: line } : m;
  }),
});

const printDelivery = (d: Delivery & { full: (Message & { endorse?: string })[] }): void => {
  for (const m of d.full) {
    console.log(fullText(m));
    if (m.endorse) console.log(m.endorse);
  }
  for (const l of d.lines) console.log(l);
};

/** A word of a POSIX command line, double-quoted when it holds anything else than plain characters. */
const shellWord = (w: string): string => (/^[\w@%+=:,./-]+$/.test(w) ? w : `"${w.replace(/(["\\$`])/g, "\\$1")}"`);

/** This CLI as a member calls it: `node <skill-dir>/swarm.mjs`, as the skill writes it and the allow
 *  rule matches it; forward slashes, which Node takes on Windows too and no shell eats (D49). */
const self = (): string[] => ["node", shellWord(process.argv[1].replace(/\\/g, "/"))];

/** How a member listens, the one source the docs point at: a seat waits in the foreground (a subagent
 *  that ends its turn is gone, no background listener wakes it); the orchestrator and a worker
 *  listen in the background while they work. */
/** The link line of join and open, before any listener or wait line (D32, swarm-relay D33, AGENTS rule 10): the member's link, run as its agent's own
 *  background task, so a stopped agent takes it down; a verb that finds none spawns one detached outside a harness session,
 *  and inside one ends on this line (D39). */
const startLinkLine = (member: BoardMember): string =>
  `start your link now, in the background (your harness's background task): ${[...self(), ...linkVerbArgs(member).map(shellWord)].join(" ")}`;
const SHELL_TOOL_TIMEOUT = FOREGROUND_NOTE;
/** The wait a member runs: a background listener holds until something comes; a foreground wait carries its hold and the tool timeout to give it. */
const waitCommand = (name: string, foreground = false): string => {
  const line = [...self(), "wait", "--mentions", "--as", shellWord(name)].join(" ");
  // the command alone, so it runs as copied (F6); the tool-timeout sentence sits in the prose before the colon
  return foreground ? `${line} --timeout ${FOREGROUND_WAIT_MS}` : line;
};
const listensInForeground = (p: Pick<Participant, "seat" | "kind">): boolean => p.seat !== "orchestrator" && profileOf(p.kind).member !== "worker";
/** The line that starts a member's listener: the exact command, --as included (D61); `afterPhase`: it
 *  follows the owed-phase line, so a seat waits only once its part is in. */
const listenNow = (p: Pick<Participant, "name" | "seat" | "kind">, afterPhase = false): string =>
  listensInForeground(p)
    ? `${afterPhase ? "only then wait" : "wait now"}, in the foreground (never a background listener: a seat that ends its turn is gone; ${SHELL_TOOL_TIMEOUT}): ${waitCommand(p.name, true)}`
    : `start your listener now, in the background (your harness's background task): ${waitCommand(p.name)}`;

/** The step a member owing the run's open phase takes before any wait: a member that joined, or woke,
 *  after the phase event passed does its part now, never sleeps through it; null when it owes none. */
const owedLine = async (p: Participant, thread = true): Promise<string | null> => {
  const paused = await pausedLine(p);
  if (paused) return paused;
  const ph = await board.owedPhase(p);
  if (!ph) return null;
  // in a whole-thread run the part starts from the phase's whole discussion, never from the last post alone
  const read = thread && profileOf(p.kind).wholeThread ? `Read the whole phase first: ${[...self(), "thread", "--as", shellWord(p.name)].join(" ")}. ` : "";
  return `phase ${ph.name} is open and asks: ${ph.text}. ${read}Do your part now, then: ${[...self(), "done", shellWord(ph.name), "--as", shellWord(p.name)].join(" ")}`;
};
/** A member's one step while its run is paused: stop and wait in the foreground for the resume; null when the
 *  run is not paused, for the orchestrator and for an ended member. */
const pausedLine = async (p: Participant): Promise<string | null> => {
  if (p.seat === "orchestrator" || p.ended) return null;
  const run = (await board.runs()).find((r) => r.id === p.run);
  if (!run || run.paused == null) return null;
  // a pause waiting on the person says so (idea 2, B12); any other reads as before
  const why = run.pausedPerson ? `: waiting on the person: ${run.paused || "their decision"}` : run.paused ? `: ${run.paused}` : "";
  return `run ${p.run} is paused${why}. Stop where you are: start nothing new, claim and merge nothing; wait in the foreground for the resume (${SHELL_TOOL_TIMEOUT}): ${waitCommand(p.name, true)}`;
};
/** True, having printed the paused line with exit 4, when `p`'s run is paused: the verb does nothing. */
const refusedPaused = async (p: Participant, verb: string): Promise<boolean> => {
  const line = await pausedLine(p);
  if (!line) return false;
  process.exitCode = 4;
  emit({ run: p.run, paused: true, refused: verb, next: line }, `${verb} refused: ${line}`);
  return true;
};
/** `--protocol none`: a run phaseless on purpose. */
const PHASELESS = "none";

// ── locks (idea 4): a shared resource of the machine, honoured; for a port, what listens on it read from the OS ──
const LOCK_PORT = /^port:(\d{1,5})$/;
/** The PIDs listening on a TCP port now, from the OS on demand: `netstat -ano` on Windows, `lsof` elsewhere; [] when none or unreadable. */
function listenersOn(port: number): number[] {
  const found = new Set<number>();
  if (process.platform === "win32") {
    const out = spawnSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8", windowsHide: true }).stdout ?? "";
    for (const line of out.split(/\r?\n/)) {
      const cols = line.trim().split(/\s+/);
      // Proto  Local  Foreign  State  PID
      if (cols.length >= 5 && /LISTEN/i.test(cols[3]) && cols[1].endsWith(`:${port}`)) found.add(Number(cols[4]));
    }
  } else {
    const out = spawnSync("lsof", [`-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" }).stdout ?? "";
    for (const line of out.split(/\r?\n/)) if (/^\d+$/.test(line.trim())) found.add(Number(line.trim()));
  }
  return [...found].filter((pid) => pid > 0).sort((a, b) => a - b);
}
/** When each of these processes started (ms epoch), from the OS; a PID it cannot read is left out. About 1 s on Windows, so read only when listeners exist. */
function processStarts(pids: number[]): Map<number, number> {
  const starts = new Map<number, number>();
  if (!pids.length) return starts;
  if (process.platform === "win32") {
    const filter = pids.map((pid) => `ProcessId=${pid}`).join(" or ");
    const script = `Get-CimInstance Win32_Process -Filter '${filter}' | ForEach-Object { "$($_.ProcessId) $($_.CreationDate.ToUniversalTime().ToString('o'))" }`;
    const out = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true }).stdout ?? "";
    for (const line of out.split(/\r?\n/)) {
      const [pid, at] = line.trim().split(/\s+/);
      if (pid && at && Number.isFinite(Date.parse(at))) starts.set(Number(pid), Date.parse(at));
    }
  } else {
    const out = spawnSync("ps", ["-o", "pid=,lstart=", "-p", pids.join(",")], { encoding: "utf8" }).stdout ?? "";
    for (const line of out.split(/\r?\n/)) {
      const m = /^\s*(\d+)\s+(.+)$/.exec(line);
      if (m && Number.isFinite(Date.parse(m[2]))) starts.set(Number(m[1]), Date.parse(m[2]));
    }
  }
  return starts;
}
/** F12: a port grant's listeners, told apart by the name's last release. Left running by that release (started before it):
 *  stop it only if it is yours. Started after it, or with no release at all: by someone without the lock, ask first. */
function grantListeners(port: number, pids: number[], released: { at: string; by: string } | undefined): { lines: string[]; stoppable: number[] } {
  const starts = processStarts(pids);
  const releasedAt = released ? Date.parse(released.at) : NaN;
  const left = pids.filter((pid) => Number.isFinite(releasedAt) && (starts.get(pid) ?? -Infinity) < releasedAt);
  const without = pids.filter((pid) => !left.includes(pid));
  const lines = [
    ...(left.length ? [`listening on ${port} now: ${left.join(", ")}, left running by ${released!.by}'s release: stop it only if it is yours to stop`] : []),
    ...(without.length ? [`listening on ${port} now: ${without.join(", ")}, started by someone without the lock: ask on the board before you stop it`] : []),
  ];
  return { lines, stoppable: left };
}
/** The line that stops exactly these PIDs, per platform: by PID, never by name. */
const stopLine = (pids: number[]): string =>
  process.platform === "win32" ? pids.map((pid) => `taskkill /PID ${pid} /T /F`).join("; ") : `kill ${pids.join(" ")}`;
/** For a `port:<n>` lock, the port and what listens on it now; null for any other name. */
const portListeners = (name: string): { port: number; pids: number[] } | null => {
  const m = LOCK_PORT.exec(name);
  return m ? { port: Number(m[1]), pids: listenersOn(Number(m[1])) } : null;
};
/** One held lock as a line: name, holder, since, waiters, and for a port what listens on it. */
const lockLine = (l: { name: string; member: string; run: number; since: string; note: string | null; waiters: string[] }, listening: number[] | null): string =>
  `${l.name}  held by ${l.member} (run ${l.run}) since ${l.since}${l.note ? `  note: ${l.note}` : ""}${l.waiters.length ? `  waiters: ${l.waiters.join(", ")}` : ""}${listening ? `  listening: ${listening.length ? listening.join(", ") : "none"}` : ""}`;

/** The orchestrator's step after `open` of a task or plan run (idea 3): open the protocol's first phase before any
 *  task, or, with none, why there are no phases; null for a kind that opens on its phases already (a brainswarm).
 *  The reading pointer sits before the colon, the command last (F6). */
const firstPhaseLine = (kind: Kind, group: string, protocol: string | null): string | null => {
  if (kind !== "task" && kind !== "plan") return null;
  // --protocol none: phaseless on purpose, so no reminder (the person's addition to idea 3)
  if (protocol === PHASELESS) return "next: phaseless: the workers take tasks on call";
  const command = `${self().join(" ")} phase <name> "<its message>" --as ${shellWord(`${group}/orchestrator`)}`;
  const pointer = "(its protocol.md's phase table names them)";
  return protocol
    ? `next: open ${protocol}'s first phase before any task ${pointer}: ${command}`
    : `next: no protocol, so the workers take tasks on call with no phases; if the approved proposal names a protocol, open its first phase before any task ${pointer}: ${command}`;
};

/** The first-phase line once more, on the orchestrator's first post of its task or plan run while no phase is open
 *  (idea 3, C3, as d1 restated it #12346); null on any later post, with a phase open, or for any other author.
 *  "First" is the run's own count of the orchestrator's posts, from stats: 1 once this post is in. */
const firstTaskPostLine = async (p: Participant): Promise<string | null> => {
  if (p.seat !== "orchestrator") return null;
  const run = (await board.runs()).find((r) => r.id === p.run);
  if (!run || (run.kind !== "task" && run.kind !== "plan") || run.protocol === PHASELESS || (await board.currentPhase(p.run))) return null;
  const mine = (await board.stats({ repo: p.repo, run: p.run })).runs.find((r) => r.run === p.run)?.members.find((x) => x.member === p.name);
  return mine?.posts === 1 ? firstPhaseLine(run.kind, run.group, run.protocol) : null;
};

/** A member's next step where it would be told to listen: the pause first, then the owed phase. */
const nextStep = async (p: Participant): Promise<string> => {
  const paused = await pausedLine(p);
  if (paused) return paused;
  const owed = await owedLine(p);
  return owed ? `${owed}\n${listenNow(p, true)}` : listenNow(p);
};
/** What a verb that heard from the member ends on (D9): a member that listens in the foreground waits only when idle, so no
 *  wait line follows a post or a claim, only the pause or the phase it owes; a member that listens in the background is told
 *  to start its listener when none is running. */
const heardStep = async (p: Participant): Promise<string | null> => {
  if (p.ended || p.listening) return null;
  if (!listensInForeground(p)) return nextStep(p);
  return (await pausedLine(p)) ?? (await owedLine(p));
};

/** A member whose run is closed (the close ended it): every member verb answers with this one line, exit 0. */
const closedLine = (p: Participant): string =>
  `run ${p.run} closed: run end and return your summary: ${[...self(), "end", "--as", shellWord(p.name)].join(" ")}; your link and listener background tasks end on their own now, and their end notices are not news`;
/** True, having printed the closed line, when `p`'s run is closed: the verb writes nothing more. */
const answeredClosed = async (p: Participant): Promise<boolean> => {
  if ((await board.runs()).some((r) => r.id === p.run)) return false;
  const line = closedLine(p);
  emit({ run: p.run, closed: true, next: line }, line);
  return true;
};

/** A verb's output, then the listener line when the caller has no `wait --mentions` pending and has
 *  not ended (D61), once per call; --json carries it as `next`. */
/** One line per `@…` of `body` that names no member (D63): the closest active names, at most three. */
const unmatchedLines = async (p: Participant, body: string): Promise<string[]> => {
  const roster = await board.roster(p.repo);
  const members = roster.filter((r) => r.seat !== "orchestrator");
  const plans = [...new Set(roster.map((r) => r.plan))];
  const names = new Map(members.map((r) => [nameHandle(r.nick), r.name]));
  const nickOf = new Map(members.map((r) => [r.name, r.nick.replace(/\s+/g, "")]));
  const ended = new Set(await board.endedMembers(p.repo));
  return unmatchedMentions(body, p.plan, plans, names).map(({ name, closest }) => {
    const member = name.includes("/") ? name : `${p.plan}/${name}`;
    if (ended.has(member)) return `@${name} has ended: the post stays on the thread, but they will not read it`;
    const guesses = closest.map((c) => (nickOf.has(c) ? `@${c} or @${nickOf.get(c)}` : `@${c}`));
    return `@${name} matched nobody on the board${guesses.length ? `: did you mean ${guesses.join(", ")}?` : ""}`;
  });
};

const emitHeard = async (p: Participant, json: object, human: string | (() => void)): Promise<void> => {
  const next = await heardStep(p);
  emit(next ? { ...json, next } : json, () => {
    if (typeof human === "string") console.log(human);
    else human();
    if (next) console.log(next);
  });
};

/** The last line of a `wait --mentions` that delivered (F28). */
export const DELIVERED_LINE = "these lines are delivered; the task-end notice is the same event";

/** The file a relative path means (D6): from the current folder when it exists there, else from
 *  the repository root when it exists there; neither refuses, unless `--new` creates it here. */
function resolveClaimPath(file: string, about = false): string {
  if (path.isAbsolute(file)) return file;
  const here = path.resolve(file);
  if (fs.existsSync(here)) return here;
  const root = worktreeOf(process.cwd());
  const fromRoot = root ? path.resolve(root, file) : null;
  if (fromRoot && fs.existsSync(fromRoot)) return fromRoot;
  if (args.has("--new")) return here;
  return fail(`no such file: ${here}${fromRoot && fromRoot !== here ? ` nor ${fromRoot}` : ""}; pass --new if you are creating it${about ? " (--about takes a file not yet on disk with --new)" : ""}`);
}

/** Repository-relative, forward slashes: what the board stores and every answer names. */
function repoRelative(abs: string): string {
  const root = worktreeOf(process.cwd());
  const rel = root ? path.relative(root, abs) : abs;
  return rel.split(path.sep).join("/");
}

/** `--about`: a path (it has a slash) resolved and made repository-relative; a decision id or a bare name as given. */
function aboutArg(): string | undefined {
  const about = args.flag("--about");
  if (about === undefined || !/[\\/]/.test(about)) return about;
  return repoRelative(resolveClaimPath(about, true));
}

/** `<path>`, `<path>:inside` or `<path>:interface`, the path resolved (D6); a file not there yet is one the
 *  seat creates, declared from the repository root. */
function parseFile(spec: string): Declared {
  const m = spec.match(/^(.*):(interface|inside)$/);
  const d = m ? { path: m[1], interface: m[2] === "interface" } : { path: spec, interface: false };
  return { ...d, path: repoRelative(declaredPath(d.path)) };
}

function declaredPath(file: string): string {
  if (path.isAbsolute(file)) return file;
  const here = path.resolve(file);
  if (fs.existsSync(here)) return here;
  const root = worktreeOf(process.cwd());
  return root ? path.resolve(root, file) : here;
}

function readSeats(file: string): SeatSpec[] {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  } catch (e) {
    return fail(`cannot read seats from ${file}: ${(e as Error).message}`);
  }
  const list = Array.isArray(raw) ? raw : (raw as { seats?: unknown }).seats;
  if (!Array.isArray(list)) return fail(`${file}: expected an array of {id, role, area, blockers}`);
  return list.map((s: { id?: unknown; role?: unknown; area?: unknown; blockers?: unknown; link?: unknown; on?: unknown; busyMax?: unknown }) => {
    if (typeof s.id !== "string") fail(`${file}: a seat without an id`);
    // D24: the link finds each member's transcript; a seat row naming one is refused
    if ("title" in s) fail(`${file}: unknown field title in ${s.id}; a seat has id, role, area`);
    if ("transcript" in s) fail(`${file}: unknown field transcript in ${s.id}`);
    // busyMax: the seat's bound on a non-shell call (idea 5), validated as seat add --busy-max is
    if (s.busyMax !== undefined && !(Number.isInteger(s.busyMax) && (s.busyMax as number) > 0)) fail(`${file}: busyMax of ${s.id} takes a positive whole number of ms, got ${JSON.stringify(s.busyMax)}`);
    return {
      ...(s.busyMax !== undefined ? { busyMax: s.busyMax as number } : {}),
      id: String(s.id),
      ...(typeof s.role === "string" && s.role ? { role: s.role } : {}),
      ...(typeof s.area === "string" && s.area ? { area: s.area } : {}),
      blockers: Array.isArray(s.blockers) ? s.blockers.map(String) : [],
      link: typeof s.link === "string" && s.link ? s.link : null,
      ...(Array.isArray(s.on) ? { on: s.on.map(String) } : {}),
    };
  });
}

/** `open`'s kind and group: `--plan <slug>` is `--kind plan --group <slug>` (D22). */
function openKindAndGroup(): { kind: Kind; group: string } {
  const raw = args.flag("--kind") ?? "plan";
  let kind: Kind;
  try {
    kind = profileOf(raw).kind;
  } catch (e) {
    return fail(`open: ${(e as Error).message}`);
  }
  const plan = args.flag("--plan");
  if (plan !== undefined && kind !== "plan") fail(`open: --plan means --kind plan; a ${kind} run takes --group <slug>`);
  const group = args.flag("--group") ?? plan ?? fail(`open: --group <slug> is required (or --plan <slug> for a plan run)\n${USAGE}`);
  return { kind, group };
}

/** `join`'s member id: `--seat`. */
function joinedSeat(): string {
  const seat = args.flag("--seat");
  return seat ?? fail(`--seat is required\n${USAGE}`);
}

/** What a seat's join tells it of its posts, before the listener line (D2). */
const POSTS_MARKDOWN = "posts are markdown, rendered on the board: steps as a list, options as a table, a task or a report in short headed parts, a flow or a structure as a mermaid block; more than one line goes through post --file <path>";

/** The commands a member of a kind without worktree runs next, `--as` filled in (D21, D36). */
const seatCommands = (as: string): string[] => {
  const cli = self().join(" ");
  const who = `--as ${shellWord(as)}`;
  return [
    `${cli} post "…" --about <D id> ${who}`,
    `${cli} agree "…" --about <D id> ${who}`,
    `${cli} endorse <seq> ${who}`,
    `${cli} wait --mentions ${who} --timeout ${FOREGROUND_WAIT_MS}    # in the foreground, when waiting; ${SHELL_TOOL_TIMEOUT}`,
  ];
};

/** `--on`/`subscribe`'s events; an unknown name fails, listing the known ones (D59). */
const subscriptionsArg = (spec: string): Subscription[] => {
  try {
    return parseSubscriptions(spec);
  } catch (e) {
    return fail((e as Error).message);
  }
};

/** Main is gone (D12): the conversation is one, a mention says who is meant. */
const NO_MAIN = "there is no Main any more: the conversation is one; mention who you mean (@IW, @IW·SL3, @swarm)";

async function main(): Promise<void> {
  if ((args.verb === "post" || args.verb === "agree" || args.verb === "endorse") && args.has("--main")) {
    console.error(NO_MAIN);
    process.exitCode = 2;
    return;
  }
  switch (args.verb) {
    case "config": {
      const setting = args.positional[0];
      if (setting !== "retention") fail(`config: the one setting is retention\n${USAGE}`);
      const raw = args.positional[1];
      const value = raw === undefined ? undefined : Number(raw);
      const days = await board.setting("retention-days", value);
      emit({ retention: days }, String(days));
      break;
    }
    case "open": {
      const { kind, group } = openKindAndGroup();
      const plan = group;
      const seatsFile = args.flag("--seats") ?? fail(`open: --seats <file.json> is required\n${USAGE}`);
      const rawStall = args.flag("--stall-ms");
      const stallMs = rawStall === undefined ? undefined : Number(rawStall);
      if (stallMs !== undefined && !(Number.isInteger(stallMs) && stallMs > 0)) fail(`--stall-ms takes a positive whole number of ms, got ${rawStall}`);
      refuseTranscriptFlag("open");
      const protocol = args.flag("--protocol");
      if (protocol !== undefined && !/^[a-z0-9][a-z0-9-]*$/.test(protocol)) fail(`--protocol takes a name in lower case, digits and dashes (build-verify), got ${protocol}`);
      // aiview installed but no project here: the run's board would show nowhere, so refuse before opening
      const home = boardHome({ toolRoot: toolRoot(), cwd: process.cwd() });
      if (!home.found && home.launcher)
        fail(
          `open: no aiview project covers ${process.cwd()}, so the run's board would show nowhere. Declare it, then open again:
` +
            `  node ${home.launcher} project add <slug> --path ${process.cwd()}`,
        );
      const run = await board.openRun({
        repo: repoOf(process.cwd()),
        kind,
        group,
        title: need("--title"),
        link: args.flag("--link") ?? null,
        seats: readSeats(seatsFile),
        ...(stallMs !== undefined ? { stallMs } : {}),
        ...(protocol !== undefined ? { protocol } : {}),
      });
      // the orchestrator's link, from now on how its verbs reach the board (D29), started by its agent (D32)
      const link = startLinkLine({ name: `${run.group}/orchestrator`, run: run.id });
      // the person watches the project's board on aiview's /board page
      const doc = registerBoard({ home, cwd: process.cwd(), repo: run.repo });
      // the orchestrator's next step, the answer's last line (idea 3): the first phase, or why there is none
      const next = firstPhaseLine(run.kind, run.group, protocol ?? null);
      const lines = (url: string | null) => [String(run.id), url, link, next].filter((l): l is string => l !== null).join("\n");
      if (!doc.registered) {
        // the run is open all the same; swarm has no page of its own (companions-merge D13)
        console.error(`swarm: ${doc.reason}: the run is open; its board is read in aiview once aiview is installed and knows this project`);
        emit({ run: run.id, repo: run.repo, kind: run.kind, group: run.group, plan: run.plan, url: null, link, ...(next ? { next } : {}) }, lines(null));
        break;
      }
      emit({ run: run.id, repo: run.repo, kind: run.kind, group: run.group, plan: run.plan, url: doc.url, link, ...(next ? { next } : {}) }, lines(doc.url));
      break;
    }
    case "slice": // AGENTS rule 12: the old name of `seat`, accepted silently, never shown in --help
    case "seat": {
      if (args.positional[0] === "add") {
        const id = args.positional[1] ?? fail(`seat add: which id?\n${USAGE}`);
        const run = runArg();
        const on = args.flag("--on");
        if (on !== undefined) subscriptionsArg(on);
        const role = args.flag("--role");
        const area = args.flag("--area");
        // --busy-max: the seat's bound on a non-shell call (a browser or MCP step), as a seat row's busyMax (idea 5)
        const rawBusyMax = args.flag("--busy-max");
        const busyMax = rawBusyMax === undefined ? undefined : Number(rawBusyMax);
        if (busyMax !== undefined && !(Number.isInteger(busyMax) && busyMax > 0)) fail(`--busy-max takes a positive whole number of ms, got ${rawBusyMax}`);
        const added = await board.addSeat(run, {
          id,
          ...(role ? { role } : {}),
          ...(area ? { area } : {}),
          ...(busyMax !== undefined ? { busyMax } : {}),
          blockers: args.list("--blockers"),
          link: args.flag("--link") ?? null,
          ...(on !== undefined ? { on: on.split(",").map((x) => x.trim()).filter(Boolean) } : {}),
        });
        emit({ run, seat: added }, `${id} added`);
        break;
      }
      const id = args.positional[0] ?? fail(`seat: which seat?\n${USAGE}`);
      const run = runArg();
      refuseTranscriptFlag("seat");
      const state = need("--state") as SeatState;
      await board.setSeatState(run, id, state);
      emit({ run, seat: id, state }, `${id} ${state}`);
      break;
    }
    case "close": {
      const run = runArg();
      await board.closeRun(run);
      emit({ run, state: "closed" }, `run ${run} closed`);
      break;
    }
    case "phase": {
      const p = await caller();
      const [name, ...said] = args.positional;
      if (!name) fail(`phase: which phase?
${USAGE}`);
      const text = said.join(" ") || fail(`phase ${name}: what does it ask?`);
      // --watch: the members whose done wakes the orchestrator the moment it lands (idea 2, §3)
      const watch = args.list("--watch");
      // --for: only these seats are woken and owe their done; a seat with nothing to do is not woken (tokens)
      const only = args.list("--for");
      const m = await board.phase(p, name, text, watch.length || only.length ? { ...(watch.length ? { watch } : {}), ...(only.length ? { for: only } : {}) } : undefined);
      // the orchestrator's next step (rule 10): a done is carried to its next wake, a watched one wakes it; the board says when all are in
      const cli = self().join(" ");
      const heard = watch.length
        ? `the done of ${watch.join(", ")} wakes you; every other done rides on your next wake`
        : `each member's done rides on your next wake; to hear one the moment it lands, open the phase with --watch <ids>`;
      const forWhom = only.length ? ` for ${only.join(", ")} alone (the others are not woken and owe no done)` : "";
      const next = `phase ${name} is open${forWhom}; ${heard}. Listen in the background: ${cli} wait --mentions --as ${shellWord(p.name)}. When the board says every member is done, open the next phase: ${cli} phase <name> "<text>" --as ${shellWord(p.name)}; after the last, ${cli} close --run ${m.run}`;
      // the person follows from the session they talk to, not the board: a few lines there at every phase (rule 10)
      const brief = "brief the person: the list of what is done since the session began, one short phrase each, then what comes next";
      // a seat whose member ended still owes this phase: all-done waits for it, so it is named with how to wake it
      const dormant = ((await board.phaseProgress(m.run))?.dormant ?? []).map((s) => `${s.slice(s.lastIndexOf("/") + 1)} is dormant: dispatch a member into it (join the same seat) or resume it with SendMessage`);
      emit({ seq: m.seq, run: m.run, phase: name, brief, dormant, next }, () => {
        console.log(seqLine(m));
        for (const line of dormant) console.log(line);
        console.log(brief);
        console.log(next);
      });
      break;
    }
    case "pause":
    case "resume": {
      const p = await caller();
      // pause --person "<what they decide>": a pause waiting on the person (idea 2, B12)
      const person = args.verb === "pause" ? args.flag("--person") : undefined;
      const text = person ?? args.positional.join(" ");
      const cli = self().join(" ");
      if (args.verb === "pause") {
        const m = await board.pause(p, text, person !== undefined ? { person: true } : undefined);
        const next = `every member of run ${m.run} is told to stop and wait${person !== undefined ? `, waiting on the person: ${text}` : ""}; nothing wakes you but an urgent post until the resume, which gives you every line held meanwhile. Resume, with a message if they need one: ${cli} resume "<message>" --as ${shellWord(p.name)}`;
        emit({ seq: m.seq, run: m.run, paused: true, person: person !== undefined, next }, () => {
          console.log(seqLine(m));
          console.log(next);
        });
        break;
      }
      const m = await board.resume(p, text);
      // what the pause held from the orchestrator, one line each, given once (idea 2, judgment 1)
      const next = `run ${m.run} resumed${m.held.length ? `; ${m.held.length} held while paused, above` : ""}; listen again in the background: ${cli} wait --mentions --as ${shellWord(p.name)}`;
      emit({ seq: m.seq, run: m.run, paused: false, held: m.held, next }, () => {
        console.log(seqLine(m));
        for (const line of m.held) console.log(line);
        console.log(next);
      });
      break;
    }
    case "done": {
      const p = await caller();
      if (await answeredClosed(p)) break;
      const name = args.positional[0] ?? fail(`done: which phase?\n${USAGE}`);
      let r;
      try {
        r = await board.done(p, name);
      } catch (e) {
        // F20: a done with no phase open marks nothing, and is not an error
        if (!/no phase is open/.test((e as Error).message)) throw e;
        emit({ member: p.name, phase: name, done: null, none: true }, "no phase is open: nothing to mark");
        break;
      }
      // the member's next step (rule 10): wait for the next phase
      const next = `wait for the next phase, in the foreground (${SHELL_TOOL_TIMEOUT}): ${waitCommand(p.name, true)}`;
      emit({ member: p.name, phase: name, done: r.progress.done, of: r.progress.of, gone: r.progress.gone, all: r.all, already: r.already, late: r.late, next }, () => {
        // a done for a phase no longer current is accepted and told to the orchestrator (idea 2, §3: overlapping phases)
        const late = r.late ? `late done ${name} (not the current phase), recorded; the orchestrator is told` : null;
        console.log(late ?? `${r.already ? "already done" : "done"} ${name}: ${r.progress.done}/${r.progress.of} members done${r.progress.gone.length ? `, ${r.progress.gone.length} gone` : ""}${r.all ? "; the orchestrator is told every member is done" : ""}`);
        console.log(next);
      });
      break;
    }
    case "join": {
      const { member, roster, composition } = await board.join({
        run: runArg(),
        seat: joinedSeat(),
        doing: need("--doing"),
        files: [...args.list("--files"), ...args.flags("--file")].map(parseFile),
        worktree: worktreeOf(process.cwd()) ?? undefined,
        ...(args.flag("--on") !== undefined ? { on: subscriptionsArg(args.flag("--on")!) } : {}),
      });
      // the member's link, from now on how its verbs reach the board (D29), started by its agent (D32)
      const link = startLinkLine({ name: member.name, run: member.run });
      // the member's next step, after its link: the open phase it owes, then its listener (D61); the link
      // comes first, so the agent starts it before a wait blocks it (swarm-relay D33)
      const next = await nextStep(member);
      // a kind without worktree: the checkout is shared, so every call names the member (D21, D36)
      const shared = !profileOf(member.kind).worktree;
      const as = shared ? `pass --as ${member.name} on every call: this checkout is shared, the board cannot tell you apart` : null;
      const commands = shared ? seatCommands(member.name) : null;
      // every member posts markdown shaped to what it says: agents do what the board prints (D2)
      const drawing = POSTS_MARKDOWN;
      // the run's current phase after the roster: a late or restarted member starts in it
      const phase = await phaseHeader(member.run);
      emit({ member: member.name, nick: member.nick, roster, composition, phase, ...(shared ? { as: member.name, commands } : {}), ...(drawing ? { drawing } : {}), link, next }, () => {
        console.log(`you are ${member.name}, ${member.nick}: @${member.seat} or @${member.nick.replace(/\s+/g, "")} mentions you`);
        for (const l of composition.lines) console.log(l);
        for (const r of roster) console.log(rosterLine(r));
        if (phase) console.log(phase);
        if (as) console.log(as);
        for (const c of commands ?? []) console.log(c);
        if (drawing) console.log(drawing);
        console.log(link);
        if (next) console.log(next);
      });
      break;
    }
    case "subscribe":
    case "unsubscribe": {
      const p = await caller();
      const subs = subscriptionsArg(args.positional.join(",") || fail(`${args.verb}: which events?`));
      const after = args.verb === "subscribe" ? await board.subscribe(p, subs) : await board.unsubscribe(p, subs);
      await emitHeard(p, { member: p.name, subscriptions: after }, `${p.name} wakes on: ${formatSubscriptions(after) || "mentions and urgent posts only"}`);
      break;
    }
    case "doing": {
      const p = await caller();
      if (await answeredClosed(p)) break;
      const text = args.positional.join(" ") || fail("doing: what?");
      await board.setDoing(p, text);
      await emitHeard(p, { member: p.name, doing: text }, `${p.name} doing: ${text}`);
      break;
    }
    case "post":
    case "agree": {
      const p = await caller();
      if (await answeredClosed(p)) break;
      // --file: a long body (a table, quotes, guillemets) read from a file, never through the shell's quoting
      const file = args.flag("--file");
      const body = (file ? fs.readFileSync(file, "utf8").trim() : args.positional.join(" ")) || fail(`${args.verb}: nothing to say`);
      const urgent = args.has("--urgent");
      if (urgent && args.verb !== "post") fail("--urgent is for post");
      if (args.verb !== "agree" && args.has("--with")) fail("--with is for agree");
      if (urgent && p.seat !== "orchestrator") fail("--urgent is the orchestrator's: it wakes every waiter of the run, even in a pause; ask @orchestrator on the thread instead");
      const m = await board.post(p, body, {
        about: aboutArg(),
        kind: args.verb === "agree" ? "agreement" : urgent ? "urgent" : "msg",
        ...(args.verb === "agree" && args.flag("--with") ? { with: args.flag("--with")!.split(",") } : {}),
      });
      const unmatched = await unmatchedLines(p, body);
      // the orchestrator's first task post into a run with no phase open ends on the first-phase line, once (idea 3)
      const phaseNext = args.verb === "post" ? await firstTaskPostLine(p) : null;
      const json = { seq: m.seq, mentions: m.mentions, run: m.run, ...(unmatched.length ? { unmatched } : {}), ...(m.claimed ? { claimed: m.claimed } : {}) };
      const human = () => {
        console.log(seqLine(m));
        // posting is claiming (D7)
        if (m.claimed) console.log(`claimed ${m.claimed.path}, shared with ${m.claimed.sharedWith.join(", ")}`);
        for (const line of unmatched) console.log(line);
        if (args.verb === "agree" && m.mentions?.length) console.log(`parties: ${m.mentions.join(", ")}, woken when its file merges`);
      };
      if (phaseNext) {
        // its own last line: a listener line, when one is due, comes before it
        const listen = await heardStep(p);
        emit({ ...json, ...(listen ? { listen } : {}), next: phaseNext }, () => {
          human();
          if (listen) console.log(listen);
          console.log(phaseNext);
        });
      }
      else await emitHeard(p, json, human);
      break;
    }
    case "endorse": {
      const p = await caller();
      if (await answeredClosed(p)) break;
      const raw = (args.positional[0] ?? fail("endorse: which seq?")).replace(/^#/, "");
      const seq = Number(raw);
      if (!Number.isInteger(seq)) fail(`endorse takes a seq, got ${raw}`);
      const m = await board.endorse(p, seq);
      await emitHeard(p, { seq: m.seq, endorses: m.endorses, run: m.run }, seqLine(m));
      break;
    }
    case "read": {
      const raw = (args.positional[0] ?? fail("read: which seq?")).replace(/^#/, "");
      const seq = Number(raw);
      if (!Number.isInteger(seq)) fail(`read takes a seq, got ${raw}`);
      // a member's read is a call of its own (D66); a reader no member answers to reads all the same
      let by: Participant | undefined;
      try {
        by = await caller();
      } catch (e) {
        if (!(e instanceof CliError)) throw e;
      }
      if (by && (await answeredClosed(by))) break;
      const m = await board.read(seq, by);
      // the phase the message's run is in, first (the caller's run when one is known)
      const { printed: phase, full: phaseFull } = await phaseHeaders(by?.run ?? m.run, by);
      // a member owing the open phase is told to do it, last
      const owes = by ? await owedLine(by) : null;
      emit({ ...m, phase: phaseFull, ...(owes ? { next: owes } : {}) }, () => {
        if (phase) console.log(phase);
        console.log(fullText(m));
        if (owes) console.log(owes);
      });
      break;
    }
    case "thread": {
      const me = await caller();
      if (await answeredClosed(me)) break;
      const name = args.positional[0];
      const posts = await board.thread(me, name);
      const current = name === undefined && !posts.length ? await board.currentPhase(me.run) : null;
      const phase = await phaseHeader(me.run);
      const owes = await owedLine(me, false);
      emit({ phase, posts, ...(owes ? { next: owes } : {}) }, () => {
        if (phase) console.log(phase);
        if (!posts.length) console.log(`no post yet in phase ${name ?? current?.name ?? "-"}`);
        for (const m of posts) console.log(fullText(m));
        if (owes) console.log(owes);
      });
      break;
    }
    case "deliver": {
      const me = await caller();
      if (await answeredClosed(me)) break;
      // --mentions: only what is for the member (a mention, an urgent post, a subscribed event), never blocking
      const mentionsOnly = args.has("--mentions");
      const d = withNext(me, await (mentionsOnly ? board.deliverMentions(me) : board.deliver(me)));
      // the run's phase heads every delivery that carries something
      const { printed: phase, full: phaseFull } = d.full.length || d.lines.length ? await phaseHeaders(me.run, me) : { printed: null, full: null };
      // a member owing the open phase is told to do it, last
      const owes = mentionsOnly ? null : await owedLine(me);
      emit({ phase: phaseFull, ...d, ...(owes ? { next: owes } : {}) }, () => {
        if (phase) console.log(phase);
        printDelivery(d);
        if (owes) console.log(owes);
      });
      break;
    }
    case "wait": {
      const p = await caller();
      if (await answeredClosed(p)) break;
      const raw = args.flag("--timeout");
      const timeout = raw === undefined ? undefined : Number(raw);
      if (timeout !== undefined && !(timeout >= 0)) fail(`--timeout takes milliseconds, got ${raw}`);
      const mentionsOnly = args.has("--mentions");
      const d = withNext(p, await board.wait(p, { timeoutMs: timeout, mentionsOnly }));
      // the run closed while this wait was pending: the close ended the member
      if (await answeredClosed(p)) break;
      if (d.superseded) {
        emit(d, "superseded by a newer wait"); // a newer wait of this member gets what arrives (D64)
        break;
      }
      // the member's next step, before the message: the exact command that re-arms this listener (D49)
      const again = [...self(), "wait"];
      if (mentionsOnly) again.push("--mentions");
      if (args.flag("--as")) again.push("--as", shellWord(args.flag("--as")!));
      if (raw !== undefined) again.push("--timeout", raw);
      if (asJson) again.push("--json");
      // every foreground re-arm holds 170000, under the 180 s a harness lets a foreground command run (F22), whatever the caller gave: an old 110000
      // habit stays on 2-min turns otherwise (v1-c); a background listener (the orchestrator's) keeps its own form
      const foregroundLine = [...again.filter((w, i) => w !== "--timeout" && again[i - 1] !== "--timeout"), "--timeout", String(FOREGROUND_WAIT_MS)].join(" ");
      if (!d.full.length && !d.lines.length) {
        // a timeout: the line to run again (B7); the member ended: nothing to re-arm
        const ended = (await board.participant(p.name))?.ended ?? true;
        if (ended) emit(d, "");
        else if (mentionsOnly && (await board.idle(p))) {
          // a member with nothing to do ends rather than wake every 170 s (tokens); the orchestrator dispatches it again
          const next = `nothing for you: run ${[...self(), "end", "--as", shellWord(p.name)].join(" ")} and return; the orchestrator dispatches you again when it has work`;
          emit({ ...d, idle: true, next }, next);
        } else {
          const next = (await pausedLine(p)) ?? (p.seat === "orchestrator" ? `nothing yet; wait again: ${again.join(" ")}` : `nothing yet; wait again (${SHELL_TOOL_TIMEOUT}): ${foregroundLine}`);
          emit({ ...d, next }, next);
        }
        break;
      }
      // a member owing the open phase does it before it waits again
      const owes = await owedLine(p);
      const pausedNow = await pausedLine(p);
      const rearm = pausedNow
        ? pausedNow
        : listensInForeground(p)
        ? owes
          ? `${owes}
only then wait again, in the foreground (${SHELL_TOOL_TIMEOUT}): ${foregroundLine}`
          : `wait again, in the foreground (${SHELL_TOOL_TIMEOUT}): ${foregroundLine}`
        : p.seat === "orchestrator"
          ? `act on it, then start this listener again, in the background: ${again.join(" ")}`
          : `start this listener again, in the background while you work, in the foreground when you are waiting (${SHELL_TOOL_TIMEOUT}): ${foregroundLine}`;
      const next = owes && !pausedNow && !listensInForeground(p) ? `${owes}
${rearm}` : rearm;
      // the run's phase first, so a member always knows which phase it answers in
      const { printed: phase, full: phaseFull } = await phaseHeaders(p.run, p, !pausedNow);
      // F28: a background listener's end is also announced by the harness; the same event, already delivered here
      const delivered = mentionsOnly ? DELIVERED_LINE : null;
      emit({ phase: phaseFull, next, ...d, ...(delivered ? { delivered } : {}) }, () => {
        if (phase) console.log(phase);
        console.log(next);
        printDelivery(d);
        if (delivered) console.log(delivered);
      });
      break;
    }
    case "roster": {
      // a member asking (--as) learns its run closed
      if (args.flag("--as") && (await answeredClosed(await caller()))) break;
      const repo = repoOf(path.resolve(args.flag("--repo") ?? process.cwd()));
      const roster = await board.roster(repo);
      // each run's title and phase above its members
      const runs = new Map((await board.runs()).filter((r) => r.repo === repo).map((r) => [r.id, r]));
      const progress = new Map(await Promise.all([...runs.keys()].map(async (id) => [id, await board.phaseProgress(id)] as const)));
      // the locks this repository's members hold or wait on (idea 4)
      const names = new Set(roster.map((r) => r.name));
      const held = (await board.locks()).filter((l) => names.has(l.member) || l.waiters.some((w) => names.has(w)));
      const compositions = new Map(await Promise.all([...runs.keys()].map(async (id) => [id, await board.composition(id)] as const)));
      emit({ repo, roster, compositions: [...compositions.values()], runs: [...runs.values()].map((r) => ({ run: r.id, title: r.title, phase: r.phase, progress: progress.get(r.id) ?? null })), locks: held }, () => {
        for (const l of held) console.log(`lock ${lockLine(l, null)}`);
        let shown: number | null = null;
        for (const r of roster) {
          const run = runs.get(r.run);
          if (run && r.run !== shown) console.log(`run ${run.id}  ${run.title}${phaseSuffix(run.phase, progress.get(run.id) ?? null)}`);
          shown = r.run;
          console.log(rosterLine(r, true));
          if (roster.filter((x) => x.run === r.run).at(-1) === r) for (const l of compositions.get(r.run)?.lines ?? []) console.log(`  seat ${l}`);
        }
      });
      break;
    }
    case "claim": {
      const p = await caller();
      if (await refusedPaused(p, "claim")) break;
      const file = args.positional[0] ?? fail("claim: which path?");
      const abs = resolveClaimPath(file);
      const rel = repoRelative(abs);
      const verdict = await board.checkEdit(p, abs, { interface: args.has("--interface") });
      // held (D41): exit 3, the member posts about the path and claims again
      if (!verdict.allowed) process.exitCode = 3;
      // the other holders are named once per member and path, when the board says so (D40)
      const also =
        verdict.allowed && verdict.notice
          ? (await Promise.all(verdict.sharedWith.map(async (o) => `${o.member} · ${(await board.participant(o.member))?.nick ?? "?"}: ${o.doing}`))).join("; ")
          : "";
      await emitHeard(p, verdict, () => {
        if (!verdict.allowed) return console.log(verdict.refusal);
        console.log(also ? `claimed ${rel}, also held by ${also}` : `claimed ${rel}`);
      });
      break;
    }
    case "release": {
      const p = await caller();
      const all = args.has("--all");
      if (!all && !args.positional.length) fail("release: which path? (or --all, every claim you hold)");
      // F15: every path given is released; F27: --all, every claim the caller holds
      const released: string[] = [];
      const targets = all ? (await board.heldBy(p)).map((f) => path.resolve(worktreeOf(process.cwd()) ?? process.cwd(), f)) : args.positional.map((f) => resolveClaimPath(f));
      if (all && !targets.length) {
        emit({ member: p.name, released: [] }, `${p.name} holds no claim`);
        break;
      }
      for (const abs of targets) {
        await board.release(p, abs);
        released.push(repoRelative(abs));
      }
      emit({ member: p.name, released: released.length === 1 ? released[0] : released }, released.map((r) => `${p.name} released ${r}`).join("\n"));
      break;
    }
    case "merge-lock": {
      const p = await caller();
      if (await refusedPaused(p, "merge-lock")) break;
      // the branch merged into: a worktree does not say which branch it left, so the member names it (D59)
      const onto = need("--onto");
      // a branch checked out in a worktree refuses the push: say where, grant nothing (validation finding 4)
      const holding = p.worktree ? worktreeHolding(p.worktree, onto) : null;
      if (holding) {
        process.exitCode = 5;
        const line = `${onto} is checked out at ${holding}: ask the orchestrator to detach it, then run merge-lock again`;
        emit({ member: p.name, granted: false, checkedOutAt: holding, next: line }, line);
        break;
      }
      // what the branch wrote without a claim, committed or not, before the lock; a flag informs, never blocks
      const reconciled = p.worktree ? branchChangedIn(p.worktree, onto) : [];
      // what it held before the reconcile claims the rest: only those written without a claim are told
      const held = new Set(await board.heldBy(p));
      const unclaimed = reconciled.filter((f) => !held.has(f));
      const flags = reconciled.length ? await board.reconcileWrites(p, reconciled) : [];
      const renames = p.worktree && unclaimed.length ? renamesIn(p.worktree, git(p.worktree, "merge-base", onto, "HEAD") ?? "HEAD") : [];
      // where the worktree's HEAD reflog stands: merged replays only a rebase past it (D36)
      const reflogMark = p.worktree ? (headReflogLength(p.worktree) ?? undefined) : undefined;
      const r = await board.lockMerge(p, onto, reflogMark);
      emit({ member: p.name, ...r, reconciled, flags }, () => {
        printReconciled(unclaimed, flags, renames);
        console.log(r.granted ? "granted: merge, then swarm merged <sha> --files <path>..." : `held by ${r.holder}: swarm wait --mentions for its merged event`);
      });
      break;
    }
    case "merged": {
      const p = await caller();
      const sha = args.positional[0] ?? fail("merged: which sha?");
      // the report rides on the merge: one post, the orchestrator's one wake; "-" merges silently, recorded in the run only
      const report = args.flag("--report")?.trim() || fail('merged: --report "<what you did>" is your report to the orchestrator, its one wake; --report - merges silently');
      const files = args.list("--files");
      // what a rebase since the lock's grant met, read before the lock goes (D3, D25, D36); no worktree, no lock or no mark: unknown (D33)
      const lock = await board.heldMergeLock(p);
      const conflicts = p.worktree && lock && lock.reflogMark !== null ? conflictsOf(p.worktree, lock.onto ?? "", lock.reflogMark) : undefined;
      const sharers = await board.merged(p, sha, files.map((f) => path.resolve(f)), conflicts);
      const reported = report === "-" ? null : await board.post(p, `@orchestrator merged ${sha}: ${report}`, { kind: "msg" });
      // the post after a resolved conflict, prompted by the command just run (D63)
      const ended = new Set(await board.endedMembers(p.repo));
      const tell = sharers.map((o) =>
        ended.has(o.member)
          ? `if you resolved a conflict in ${o.path}: ${o.member} has ended, so say how in your report`
          : `if you resolved a conflict in ${o.path}, tell them: swarm post "@${o.member} I resolved ${o.path}: <how>" --about ${o.path}`,
      );
      emit({ member: p.name, sha, files, tell, ...(reported ? { reported: reported.seq } : {}) }, () => {
        console.log(`merged ${sha}: lock released${reported ? `; reported as #${reported.seq}` : ""}`);
        for (const line of tell) console.log(line);
      });
      break;
    }
    case "end": {
      const p = await caller();
      // its run closed: the close ended it; end answers what the closed line promised, the summary to return
      if ((await board.runs()).every((r) => r.id !== p.run)) {
        const line = `run ${p.run} closed: ${p.name} ended; return your summary now (your link and listener background tasks end on their own, and their end notices are not news)`;
        emit({ member: p.name, ended: true, closed: true, next: line }, line);
        break;
      }
      // a member already ended: nothing to do, nothing to say
      if (p.ended) break;
      // a mention landed since its last look: it reads it before it ends
      const unread = await board.unreadMentions(p);
      if (unread > 0) fail(`you have ${unread} unread mention${unread === 1 ? "" : "s"}: run \`${[...self(), "deliver", "--as", shellWord(p.name)].join(" ")}\` first`);
      // what the member wrote without claiming it, once, before its claims go (D58)
      const reconciled = p.worktree ? changedIn(p.worktree) : [];
      // what it held before the reconcile claims the rest: only those written without a claim are told
      const held = new Set(await board.heldBy(p));
      const unclaimed = reconciled.filter((f) => !held.has(f));
      const flags = reconciled.length ? await board.reconcileWrites(p, reconciled) : [];
      const renames = p.worktree && unclaimed.length ? renamesIn(p.worktree, "HEAD") : [];
      await board.end(p);
      emit({ member: p.name, ended: true, reconciled, flags }, () => {
        printReconciled(unclaimed, flags, renames);
        console.log(`${p.name} ended`);
      });
      break;
    }
    case "stats": {
      // an outside reader's verb: no member identity, no write of its own (board D6)
      const raw = args.flag("--run");
      const run = raw === undefined ? undefined : Number(raw);
      if (run !== undefined && !Number.isInteger(run)) fail(`--run takes a run id, got ${raw}`);
      const all = args.has("--all");
      const since = args.flag("--since");
      if (all && args.has("--since")) fail("stats: --since or --all, not both");
      const kinds = args.list("--kind").map((k) => {
        try {
          return profileOf(k).kind;
        } catch (e) {
          return fail(`stats: ${(e as Error).message}`);
        }
      });
      const stats = await board.stats({
        repo: repoOf(path.resolve(args.flag("--repo") ?? process.cwd())),
        ...(run !== undefined ? { run } : {}),
        // a named run is read whatever its age: no default period (plan D40)
        ...(all ? {} : since !== undefined ? { since } : run !== undefined ? {} : { since: "30d" }),
        ...(kinds.length ? { kinds } : {}),
        ...(args.has("--closed") ? { closedOnly: true } : {}),
      });
      emit(stats, () => {
        if (!stats.runs.length) console.log("no run in this scope");
        for (const r of stats.runs) console.log(statsLine(r));
        console.log("swarm stats --json for every figure");
      });
      break;
    }
    case "lock": {
      const p = await caller();
      if (await refusedPaused(p, "lock")) break;
      const name = args.positional[0] ?? fail(`lock: which resource? port:<n>, app:<name>, db:<name>, browser:<profile>\n${USAGE}`);
      const r = await board.lock(p, name, args.flag("--note"));
      const cli = self().join(" ");
      const who = shellWord(p.name);
      if (!r.granted) {
        // held: who holds it, then how to wait for its unlocked event (exit 3, as a held claim)
        process.exitCode = 3;
        const h = r.holder;
        const held = `held by ${h.nick} (${h.code}·${h.member.split("/").pop()}, ${h.state}) since ${h.since}${h.doing ? `, doing: ${h.doing}` : ""}`;
        const next = `next: wait for its unlocked event, then lock again (${cli} lock ${shellWord(name)} --as ${who}); in the foreground (${SHELL_TOOL_TIMEOUT}): ${waitCommand(p.name, true)}`;
        emit({ name, granted: false, holder: h, next }, () => {
          console.log(held);
          console.log(next);
        });
        break;
      }
      // a port lock makes what listens on it yours to stop: its PIDs now, and the line that stops exactly them
      const port = portListeners(name);
      // F12: no listener reads plain; one left by the last release, or started without the lock, reads as such
      const told = port && port.pids.length ? grantListeners(port.port, port.pids, r.released) : null;
      const next =
        told && told.stoppable.length
          ? `next: to restart what listens on ${port!.port}, stop exactly these: ${stopLine(told.stoppable)}`
          : `next: unlock it once you are done: ${cli} unlock ${shellWord(name)} --as ${who}`;
      emit({ name, granted: true, ...(port ? { port: port.port, listening: port.pids } : {}), ...(r.released ? { released: r.released } : {}), next }, () => {
        console.log(`granted ${name}`);
        for (const line of told?.lines ?? []) console.log(line);
        console.log(next);
      });
      break;
    }
    case "unlock": {
      const p = await caller();
      const name = args.positional[0] ?? fail(`unlock: which resource?\n${USAGE}`);
      const r = await board.unlock(p, name);
      emit({ name, ...r }, r.released ? `released ${name}${r.waiters.length ? `; told its waiters: ${r.waiters.join(", ")}` : ""}` : `you hold no lock ${name}`);
      break;
    }
    case "locks": {
      const held = await board.locks();
      const listening = new Map(held.map((l) => [l.name, portListeners(l.name)?.pids ?? null]));
      emit({ locks: held.map((l) => ({ ...l, listening: listening.get(l.name) ?? null })) }, () => {
        if (!held.length) console.log("no lock held");
        for (const l of held) console.log(lockLine(l, listening.get(l.name) ?? null));
      });
      break;
    }
    case "status": {
      const runs = await board.runs();
      // each member's worktree, null for a seat or an orchestrator (D64)
      const membersOf = async (r: (typeof runs)[number]) => (await board.roster(r.repo)).filter((m) => m.run === r.id).map((m) => ({ name: m.name, nick: m.nick, worktree: m.worktree, state: m.state, activity: m.activity, progressAt: m.progressAt, aliveAt: m.aliveAt, files: m.held }));
      const cli = self().join(" ");
      const open = await Promise.all(
        runs.map(async (r) => {
          const lastActivity = await board.lastActivity(r.id);
          // a run with no activity for a day is likely forgotten: its orchestrator ended without close
          const idleMs = Date.now() - Date.parse(lastActivity);
          return { run: r.id, kind: r.kind, protocol: r.protocol ?? null, group: r.plan, title: r.title, phase: r.phase, progress: await board.phaseProgress(r.id), members: await membersOf(r), lastActivity, forgotten: idleMs >= FORGOTTEN_MS, idleMs };
        }),
      );
      // the machine's held locks (idea 4): store-wide, so listed once above the runs
      const held = await board.locks();
      emit({ home: DATA_ROOT, sqlite: SQLITE_PATH, runs: runs.length, open: open.map(({ idleMs: _, ...o }) => o), locks: held }, () => {
        console.log(`home    ${DATA_ROOT}`);
        console.log(`sqlite  ${SQLITE_PATH}`);
        for (const l of held) console.log(`lock    ${lockLine(l, null)}`);
        if (!runs.length) console.log("no open run");
        for (const [i, r] of runs.entries()) {
          console.log(`run ${r.id}  ${r.kind}  ${r.plan}  ${r.title}${phaseSuffix(r.phase, open[i].progress)}  ${r.repo}`);
          for (const s of r.seats) console.log(`  ${s.id} ${s.state}${s.role ? `  ${s.role}` : ""}${s.blockers.length ? `  blocked by ${s.blockers.join(", ")}` : ""}`);
          for (const m of open[i].members) {
            const files = heldLine(m.files);
            console.log(`  ${m.name}  ${stateLine(m, true)}${files ? `  files: ${files}` : ""}`);
          }
          const idle = open[i].idleMs;
          if (idle >= FORGOTTEN_MS)
            console.log(`  no activity for ${Math.floor(idle / 86400000)} d: likely left open; ask the person, then archive it: ${cli} close --run ${r.id}`);
        }
      });
      break;
    }
    default:
      fail(USAGE);
  }
}

if (!args.verb) {
  console.error(USAGE);
  process.exit(1);
}
if (args.verb === "stats" && args.has("--help")) {
  console.log(STATS_USAGE);
  process.exit(0);
}
// a hidden verb's help never starts it (run 75: `serve --help` took the start lock and logged a start)
if ((args.verb === "serve" || args.verb === "link") && (args.has("--help") || args.has("-h"))) {
  console.log(
    args.verb === "serve"
      ? "usage: swarm serve [stop]   # the board server of the data home, started on demand by any verb; `serve stop` ends it"
      : "usage: swarm link --run <id> --as <member>   # a member's link, started by its agent from the line join or open prints",
  );
  process.exit(0);
}
if (args.verb === "--help") {
  // the core verbs; `--help code` the claim and merge verbs (D22)
  console.log(args.positional[0] === "code" ? CODE_USAGE : USAGE);
  process.exit(0);
}
if (args.verb === "link") {
  // a member's link, started by its agent from join's or open's last line, or detached by a verb that
  // found none (D32): not a member's verb, so not in the usage
  try {
    const member = { name: args.flag("--as") ?? "", run: Number(args.flag("--run")) };
    await runLink({ dataRoot: DATA_ROOT, member: member.name, run: member.run, binding: bindingOf(member) });
    process.exit(0);
  } catch (e) {
    console.error(`swarm link: ${(e as Error).message}`);
    process.exit(1);
  }
}
if (args.verb === "serve") {
  // the board server (swarm-relay D2, D6): a hidden verb; `serve stop` ends the running one (D27)
  const { startBoardServer, stopBoardServer, onBoardServerClosed } = await import("../server/server.ts");
  if (args.positional[0] === "stop") process.exit((await stopBoardServer(DATA_ROOT)) ? 0 : 1);
  const server = await startBoardServer({ dataRoot: DATA_ROOT });
  onBoardServerClosed(DATA_ROOT, () => process.exit(0));
  console.log(server.url);
} else {
  try {
    // every verb reaches the board through the server, started on demand (D6, D19); the poller reads the store itself
    if (args.verb !== "poll") board = await connectBoard({ dataRoot: DATA_ROOT });
    await main();
    // D39: the call went straight to the server; the agent starts its own link (on stderr under --json, which stays parseable)
    if (linkToStart) (asJson ? console.error : console.log)(startLinkLine(linkToStart));
  } catch (e) {
    const said = (e as Error).message;
    console.error(e instanceof CliError || said.startsWith("swarm: ") ? said : `swarm: ${said}`);
    process.exitCode = 1;
  } finally {
    board?.close();
  }
}
