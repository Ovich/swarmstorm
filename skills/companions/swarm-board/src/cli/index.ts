// CLI dispatch — the agent-facing surface of the board. Human output is short lines an
// agent reads; --json prints the same data as one object; errors go to stderr, exit 1.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { openBoard, progressText, type Declared, type Delivery, type Flag, type Kind, type Message, type Participant, type PhaseProgress, type RosterEntry, type RunStats, type SeatSpec, type SeatState } from "../board/board.ts";
import { profileOf } from "../board/kinds.ts";
import { EVENTS, FOREGROUND_NOTE, FOREGROUND_WAIT_MS, eventOf, formatSubscriptions, parseSubscriptions, type Subscription } from "../board/events.ts";
import { DATA_ROOT, HOME_OVERRIDE, SQLITE_PATH } from "../board/home.ts";
import { bindingOf, connectBoard, linkVerbArgs, type BoardMember, type ConnectedBoard } from "../client/remote.ts";
import { parseArgs } from "./args.ts";
import { fullText, seqLine } from "./format.ts";
import { nameHandle, unmatchedMentions } from "../board/mentions.ts";
import { boardHome, registerBoard } from "./aiview-board.ts";
import { unclaimedLines, type Rename } from "./unclaimed.ts";
import { discoverGuides, guidesFor, guidesLine, guidesSettlement, projectGuidesAt, type Guide } from "./guides.ts";
import { baseAt, baseRef, git, gitAnswer, worktreeHolding } from "../git.ts";
import { relativeIn, repoOf as placeRepoOf, resolveIn, worktreeOf } from "../place/place.ts";
import { conflictsOf, headReflogLength } from "./conflicts.ts";
import { runLink } from "../link/link.ts";
import { answer, readSituation, WORDING, type Situation, type VerbResult } from "./answer/index.ts";
import * as rules from "./answer/rules.ts";
// board-split#D13: the CLI reaches worktrees through the entry alone, interim until P3 moves claim/merge-lock/end/close into the code pack
import { sweepAll, sweepLegacy, worktrees } from "../packs/code/worktrees.ts";

const args = parseArgs(process.argv.slice(2));
const asJson = args.has("--json");
/** An open run idle this long is shown by status as likely forgotten, with its close command. */
const FORGOTTEN_MS = 24 * 60 * 60 * 1000;

/** V1: this CLI as every usage line prints it, the way a member runs it: the data home when it is not the default,
 *  then node and this script, forward slashes, quoted when needed, so a usage line runs as printed. */
const quoted = (w: string): string => (/^[\w@%+=:,./-]+$/.test(w) ? w : `"${w.replace(/(["\\$`])/g, "\\$1")}"`);
const CLI = [...(HOME_OVERRIDE ? [`SWARMSTORM_HOME=${quoted(HOME_OVERRIDE.split("\\").join("/"))}`] : []), "node", quoted(process.argv[1].split("\\").join("/"))].join(" ");
/** V1: an argument error: what is wrong, the verb's usage, and one corrected form to copy. */
const usageError = (what: string, usage: string, example: string): never => fail(`${what}\nusage: ${CLI} ${usage}\ne.g. ${CLI} ${example}`);
/** The --as a corrected form carries: the caller's own, else the placeholder. */
const asWord = (): string => quoted(args.flag("--as") ?? "<group>/<seat>");

const USAGE = [
  `usage: ${CLI} <verb> [--json]        (${CLI} --help code: the claim and merge verbs)`,
  "  open    --kind plan|brainstorm|task --group <slug> --title <t> --seats <file.json> [--link <url>] [--stall-ms <ms>] [--protocol <name>] [--onto <branch>]   # opens a run, registers the project's board in aiview, prints the run id, the board's URL, then the line that starts your link (orchestrator)",
  "          # --onto: the branch a code run's worktrees branch from and merge into, default the checkout's branch",
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
  "  close   --run <id>                                              # (orchestrator); removes the run's worktrees that are clean and merged, names those it kept and why",
  '  join    --run <id> --seat <id> --doing <t> [--files "<path>:interface,<path>:inside,…"]   # a file not there yet is one you create, declared from the repository root; prints the roster, how you listen (a seat waits in the foreground, a worker listens in the background), then the command that starts your link; on a code run (plan, task) it makes your worktree under the data home, branch swarm/<run>-<group>/<seat>, or reuses it',
  "          # --on <events>: what wakes your wait --mentions besides mentions and urgent posts, e.g. agreement,any:merged; else the seat row's on, else the kind's defaults",
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
  "  roster  [--repo <path>] [--as <member>]",
  "  end     [--as <member>]                                         # claims or flags what you wrote unclaimed, then releases your claims and the lock",
  "  status                                                          # data home, open runs, each run's phase and its n/m done; a run idle a day is flagged with its close command",
  "  config  retention [<days>]                                      # prints, or sets then prints, how many days closed runs and main's talk are kept",
  "  lock    <name> [--note <t>] [--as <member>]                     # a shared resource of the machine, before you use it: port:<n>, app:<name>, db:<name>, browser:<profile>; held: who, then how to wait",
  "  unlock  <name> [--as <member>]                                  # releases it; its waiters are told (end, gone and close release too)",
  "  locks                                                           # every held lock: holder, since, waiters, and for a port what listens on it now",
  "  worktree prune                                                  # removes the board's worktrees of closed runs that are clean and merged; names the others and why",
  `events: ${Object.keys(EVENTS).join(", ")}; any:<event> for one posted in any run`,
  "a member is <group>/<seat>, the orchestrator <group>/orchestrator; without --as, the member joined from this worktree",
].join("\n");

/** The verbs of a kind with claims (a plan run's), apart from the core (D22). */
const CODE_USAGE = [
  `usage: ${CLI} <verb> [--json]        the code verbs; refused on a run whose kind has no claims`,
  "  claim   [--as <member>] <path>... [--interface] [--new]            # before editing a file: exit 0 claimed, 3 held until you post about it (the post claims it); --new: a file you create",
  "  release [--as <member>] <path>... | --all                        # gives up a claim; --all: every claim you hold",
  "  merge-lock --onto <branch> [--as <member>]                      # one merge at a time per repository; claims or flags what your branch wrote unclaimed",
  "  merged  [--as <member>] <sha> --files <path>... --report <text>|- [--guides \"<name>:ok|n/a <why>, ...\"] [--unlocked <why>]   # refused without the merge lock on a code run (--unlocked: the orchestrator's alone, the why posted in the run); releases the lock, tells who must rebase and who was refused the lock, names whom to tell of a resolved conflict; posts \"@orchestrator merged <sha>: <text>\", your report and its one wake; --report - merges silently",
].join("\n");

/** V9: one corrected form per verb, the caller's --as in it: what an argument error offers to copy. */
const EXAMPLES: Record<string, (as: string) => string> = {
  open: () => `open --kind task --group my-team --title "the work" --seats seats.json`,
  seat: () => "seat w1 --run 3 --state running",
  phase: (as) => `phase build "build the slices" --as ${as}`,
  join: () => `join --run 3 --seat w1 --doing "joining" --as my-team/w1`,
  "merge-lock": (as) => `merge-lock --onto main --as ${as}`,
  merged: (as) => `merged 1a2b3c4 --files src/a.ts --report "what I did" --as ${as}`,
  lock: (as) => `lock port:4399 --as ${as}`,
  unlock: (as) => `unlock port:4399 --as ${as}`,
  config: () => "config retention 30",
  worktree: () => "worktree prune",
  close: () => "close --run 3",
};
/** V9: the usage of the verb being called alone, from the help's own lines, and one corrected form; never the whole help. */
const verbHelp = (verb = args.verb ?? ""): string => {
  const line = [...USAGE.split("\n"), ...CODE_USAGE.split("\n")].find((l) => l.startsWith(`  ${verb} `));
  if (!line) return USAGE;
  const usage = `usage: ${CLI} ${line.trim().replace(/\s+#.*$/, "")}`;
  const example = EXAMPLES[verb]?.(asWord());
  return example ? `${usage}\ne.g. ${CLI} ${example}` : usage;
};

/** `stats` is for an outside reader, never a member: not in USAGE, its own help (D33). */
const STATS_USAGE = [
  `usage: ${CLI} stats [--repo <path>] [--run <id>] [--since 30d|<ISO> | --all] [--closed] [--kind plan|brainstorm|task[,…]] [--json]`,
  "  the figures of a repository's runs, oldest first, with the scope's totals; a figure not recorded or not computed yet is null, never 0",
  "  --since: runs open, or closed since then, default 30d, none with --run; --all: every run kept; --closed: closed runs only",
  `  without --json: one line per run; --json carries every figure, with the run ids, members and seqs to follow with ${CLI} read <seq>`,
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
  if (args.has("--transcript")) fail(`${verb}: unknown flag --transcript\n${verbHelp()}`);
};

/** The repository (D29): its common git dir, so every worktree of one repository is one (Place, D5). */
function repoOf(dir: string): string {
  return placeRepoOf(dir) ?? fail(`not in a git repository: ${dir}`);
}

/** Paths `git status` shows changed in a worktree, as it gives them; a rename gives both (D31). */
function changedIn(worktree: string): string[] {
  // G20: a worktree named at join and never made holds nothing
  if (!fs.existsSync(worktree)) return [];
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

const need = (flag: string): string => args.flag(flag) ?? fail(`${flag} is required\n${verbHelp()}`);

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
  if (p.worktree && fs.existsSync(p.worktree)) callerWorktree = p.worktree;
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

/** The member's situation, read once per verb, for the answer rules (board-rework D1). `show`: the verb shows the phase. */
const situation = (p: Participant, show = false): Promise<Situation> => readSituation(board, p, { cli: self().join(" "), word: shellWord, show });
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

/** Prints an answer of the cluster: its lines, or with --json the verb's own JSON with its phase and next. */
const emitAnswer = (json: Record<string, unknown>, a: { lines: string[]; next: string | null; phase?: string | null }, withPhase = true): void =>
  emit({ ...json, ...(withPhase ? { phase: a.phase ?? null } : {}), ...(a.next ? { next: a.next } : {}) }, () => {
    for (const l of a.lines) console.log(l);
  });
/** A delivery's messages as the answer shows them: each with the line its event registry row gives. */
const shownOf = (d: { full: (Message & { endorse?: string })[] }) => d.full.map((m) => ({ text: fullText(m), next: m.endorse ?? null }));

/** A word of a POSIX command line, double-quoted when it holds anything else than plain characters. */
const shellWord = (w: string): string => (/^[\w@%+=:,./-]+$/.test(w) ? w : `"${w.replace(/(["\\$`])/g, "\\$1")}"`);

/** This CLI as a member calls it: `node <skill-dir>/swarm.mjs`, as the skill writes it and the allow
 *  rule matches it; forward slashes, which Node takes on Windows too and no shell eats (D49). */
/** A path with forward slashes: git and both shells take it, and PowerShell shows no doubled backslash. */
const fwd = (p: string): string => p.split("\\").join("/");
// G3: a board on a home other than the default is reached only with that home, so every printed command carries it
const self = (): string[] => [...(HOME_OVERRIDE ? [`SWARMSTORM_HOME=${shellWord(fwd(HOME_OVERRIDE))}`] : []), "node", shellWord(process.argv[1].replace(/\\/g, "/"))];

/** How a member listens, the one source the docs point at: a seat waits in the foreground (a subagent
 *  that ends its turn is gone, no background listener wakes it); the orchestrator and a worker
 *  listen in the background while they work. */
/** The link line of join and open, before any listener or wait line (D32, swarm-relay D33, AGENTS rule 10): the member's link, run as its agent's own
 *  background task, so a stopped agent takes it down; a verb that finds none spawns one detached outside a harness session,
 *  and inside one ends on this line (D39). */
/** V11: where the board marks that a member was told to start its link: one file per member and run. */
const linkToldFile = (member: BoardMember): string => path.join(DATA_ROOT, "links", "told", `${member.run}-${member.name.replace(/[^\w.-]/g, "_")}`);
const linkTold = (member: BoardMember): boolean => fs.existsSync(linkToldFile(member));
const markLinkTold = (member: BoardMember): void => {
  try {
    fs.mkdirSync(path.dirname(linkToldFile(member)), { recursive: true });
    fs.writeFileSync(linkToldFile(member), "");
  } catch {
    // a mark not written: the line is told again next call, never lost
  }
};
const clearLinkTold = (member: BoardMember): void => fs.rmSync(linkToldFile(member), { force: true });
const startLinkLine = (member: BoardMember): string =>
  `start your link now, in the background (your harness's background task): ${[...self(), ...linkVerbArgs(member).map(shellWord)].join(" ")}`;
const SHELL_TOOL_TIMEOUT = FOREGROUND_NOTE;
/** The wait a member runs: a background listener holds until something comes; a foreground wait carries its hold. */
const waitCommand = (name: string, foreground = false): string => WORDING.wait(self().join(" "), shellWord(name), foreground ? FOREGROUND_WAIT_MS : undefined);
const listensInForeground = (p: Pick<Participant, "seat" | "kind">): boolean => p.seat !== "orchestrator" && profileOf(p.kind).member !== "worker";
/** The step a member owing the run's open phase takes before any wait; the paused line in a pause; null when it owes none. */
const owedLine = async (p: Participant, thread = true, brief = false): Promise<string | null> => rules.owedLine(await situation(p), { thread, brief });
/** A member's one step while its run is paused; null when not paused, for the orchestrator and an ended member. */
const pausedLine = async (p: Participant): Promise<string | null> => rules.pausedLine(await situation(p));
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

/** A member's next step where it would be told to listen: the pause first, then the owed phase. */
const nextStep = async (p: Participant): Promise<string> => rules.nextStep(await situation(p));
/** What a verb that heard from the member ends on (D9). */
const heardStep = async (p: Participant): Promise<string | null> => rules.heardStep(await situation(p));

/** True, having printed the closed line, when `p`'s run is closed: the verb writes nothing more. */
const answeredClosed = async (p: Participant): Promise<boolean> => {
  const s = await situation(p);
  if (!s.closed) return false;
  const line = rules.closedLine(s);
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
  // a seat an open run declares, not joined yet: the post waits for it and is read at its join (G1)
  const declared = new Set((await board.runs()).filter((r) => r.repo === p.repo).flatMap((r) => r.seats.map((s) => `${r.group}/${s.id}`)));
  return unmatchedMentions(body, p.plan, plans, names).map(({ name, closest }) => {
    const member = name.includes("/") ? name : `${p.plan}/${name}`;
    if (ended.has(member)) return `@${name} has ended: the post stays on the thread, but they will not read it`;
    if (declared.has(member)) return `@${name} has not joined yet: the post waits for it, read at its join`;
    const guesses = closest.map((c) => (nickOf.has(c) ? `@${c} or @${nickOf.get(c)}` : `@${c}`));
    return `@${name} matched nobody on the board${guesses.length ? `: did you mean ${guesses.join(", ")}?` : ""}`;
  });
};

/** A verb that heard from the member (D9): its result lines, then the step the answer rules give (D1). */
const emitHeard = async (p: Participant, json: object, result: string | string[]): Promise<void> => {
  const a = answer({ verb: "heard", lines: typeof result === "string" ? [result] : result }, await situation(p));
  emit(a.next ? { ...json, next: a.next } : json, () => {
    for (const l of a.lines) console.log(l);
  });
};

/** G28: the build outputs among `files` (repository-relative): under a `dist` or `dist-*` folder, or marked
 *  `linguist-generated` in the repository's .gitattributes. */
const generatedAmong = (worktree: string, files: string[]): string[] =>
  files.filter((f) => /(^|\/)dist(-[^/]+)?\//.test(f.replace(/\\/g, "/")) || /: linguist-generated: (set|true)$/m.test(git(worktree, "check-attr", "linguist-generated", "--", f) ?? ""));

/** A path as every answer prints it: forward slashes, on Windows too. */
const slashed = (s: string): string => s.replace(/\\/g, "/");

/** The guides of the caller's repository: shipped beside this tool, and the project's own. */
const guidesHere = (p: Participant, onto?: string): Guide[] => {
  const root = p.worktree ?? worktreeOf(process.cwd());
  // with the branch merged into: its project guides too, the ones the rebase brings (G12)
  const ofOnto = root && onto ? projectGuidesAt((spec) => git(root, "show", `${onto}:${spec}`), git(root, "ls-tree", "-d", "--name-only", `${onto}:.claude/skills`)) : [];
  return discoverGuides(toolRoot(), root, ofOnto);
};

/** The guides `files` fall under that `p` has not been told of; marked told. */
const guidesToTell = async (p: Participant, files: string[]): Promise<Guide[]> => {
  const matching = guidesFor(guidesHere(p), files);
  if (!matching.length) return [];
  const untold = new Set(await board.guidesUntold(p, matching.map((g) => g.name)));
  return matching.filter((g) => untold.has(g.name));
};

/** The last line of a `wait --mentions` that delivered (F28). */
export const DELIVERED_LINE = WORDING.delivered;

/** The worktree a member's paths are relative to: its board worktree once known, else the shell's checkout. */
let callerWorktree: string | null = null;
const pathsRoot = (): string | null => callerWorktree ?? worktreeOf(process.cwd());
/** The file a relative path means (D6), through Place: the member's worktree first; neither refuses, unless `--new`. */
function resolveClaimPath(file: string, about = false): string {
  const { abs, missing } = resolveIn(pathsRoot(), file, { create: args.has("--new") });
  if (!missing.length) return abs;
  return fail(`no such file: ${missing.join(" nor ")}; pass --new if you are creating it${about ? " (--about takes a file not yet on disk with --new)" : ""}`);
}

/** Repository-relative, forward slashes: what the board stores and every answer names. */
const repoRelative = (abs: string): string => relativeIn(pathsRoot(), abs);

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

/** A declared file: from the shell's folder when it is there, else from the repository root (created or not). */
const declaredPath = (file: string): string => {
  const root = worktreeOf(process.cwd());
  const { abs, missing } = resolveIn(root, file);
  // not there yet: one the seat creates, from the repository root
  return missing.length && root ? path.resolve(root, file) : abs;
};

/** V13: a seats file the CLI cannot take: what is wrong, then a seats file it takes. */
const seatsFail = (what: string): never =>
  fail(`${what}\ne.g. a seats file: [{"id": "w1", "role": "builder", "blockers": []}, {"id": "v1", "role": "verifier", "blockers": [], "busyMax": 300000}]`);

function readSeats(file: string): SeatSpec[] {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  } catch (e) {
    return seatsFail(`cannot read seats from ${file}: ${(e as Error).message}`);
  }
  const list = Array.isArray(raw) ? raw : (raw as { seats?: unknown }).seats;
  if (!Array.isArray(list)) return seatsFail(`${file}: expected an array of {id, role, area, blockers}`);
  return list.map((s: { id?: unknown; role?: unknown; area?: unknown; blockers?: unknown; link?: unknown; on?: unknown; busyMax?: unknown }) => {
    if (typeof s.id !== "string") seatsFail(`${file}: a seat without an id`);
    // D24: the link finds each member's transcript; a seat row naming one is refused
    if ("title" in s) seatsFail(`${file}: unknown field title in ${s.id}; a seat has id, role, area`);
    if ("transcript" in s) seatsFail(`${file}: unknown field transcript in ${s.id}`);
    // busyMax: the seat's bound on a non-shell call (idea 5), validated as seat add --busy-max is
    if (s.busyMax !== undefined && !(Number.isInteger(s.busyMax) && (s.busyMax as number) > 0)) seatsFail(`${file}: busyMax of ${s.id} takes a positive whole number of ms, got ${JSON.stringify(s.busyMax)}`);
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
  const group = args.flag("--group") ?? plan ?? fail(`open: --group <slug> is required (or --plan <slug> for a plan run)\n${verbHelp()}`);
  return { kind, group };
}

/** `join`'s member id: `--seat`. */
function joinedSeat(): string {
  const seat = args.flag("--seat");
  return seat ?? fail(`--seat is required\n${verbHelp()}`);
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

/** An open run by id; null when closed or unknown. */
const runOf = async (id: number) => (await board.runs()).find((r) => r.id === id) ?? null;

/** A code run's member gets the board's worktree, its place named at join and made at its first claim or merge-lock (G20),
 *  reused when there; a seat of a talk-only kind, an undeclared seat, or a caller already in a worktree of its own (one it
 *  made, or its harness did) gets none. */
async function memberWorktree(runId: number, seat: string): Promise<{ path: string; branch: string; base: string; reused: boolean } | null> {
  const run = await runOf(runId);
  if (!run || run.kindPack === null || !run.seats.some((s) => s.id === seat)) return null;
  const cwd = process.cwd();
  // outside a repository, or in one with no commit yet: nothing to branch from
  const base = run.base ?? baseAt(cwd);
  if (!base || !worktreeOf(cwd)) return null;
  const place = worktrees(run.repo).place(run.id, run.group, seat, cwd);
  if (!place) return null;
  if (repoOf(cwd) !== run.repo) fail(`join: run ${runId} is on ${run.repo}; join from a checkout of that repository`);
  return { ...place, base };
}

/** The caller's board worktree, made now when its join only named it (G20): a member that never claims or merges gets none. */
async function madeWorktree(p: Participant): Promise<void> {
  if (!p.worktree || !worktrees(p.repo).owns(p.worktree) || fs.existsSync(p.worktree)) return;
  const run = await runOf(p.run);
  if (!run) return;
  // any checkout of the repository adds it: the caller's, else the repository's own beside its git dir
  const cwd = worktreeOf(process.cwd()) && repoOf(process.cwd()) === p.repo ? process.cwd() : path.dirname(p.repo);
  const base = run.base ?? baseAt(cwd);
  if (!base) fail(`${p.name}: no base to make the worktree from`);
  try {
    worktrees(p.repo).forSeat(run.id, run.group, p.seat, base as string);
    // claim and release resolve paths in it from now on (G19)
    callerWorktree = p.worktree;
  } catch (e) {
    fail(`worktree: ${(e as Error).message}`);
  }
}

async function main(): Promise<void> {
  // D6: the worktrees an older board made under the data home, swept once
  for (const line of sweepLegacy()) console.error(`legacy worktree ${line}`);
  if ((args.verb === "post" || args.verb === "agree" || args.verb === "endorse") && args.has("--main")) {
    console.error(NO_MAIN);
    process.exitCode = 2;
    return;
  }
  switch (args.verb) {
    case "config": {
      const setting = args.positional[0];
      if (setting !== "retention") fail(`config: the one setting is retention\n${verbHelp()}`);
      const raw = args.positional[1];
      const value = raw === undefined ? undefined : Number(raw);
      const days = await board.setting("retention-days", value);
      emit({ retention: days }, String(days));
      break;
    }
    case "open": {
      const { kind, group } = openKindAndGroup();
      const plan = group;
      const seatsFile = args.flag("--seats") ?? fail(`open: --seats <file.json> is required\n${verbHelp()}`);
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
        // what a code run's worktrees branch from and merge into: --onto, else the checkout's branch
        base: args.flag("--onto") ?? baseAt(process.cwd()),
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
        const id = args.positional[1] ?? fail(`seat add: which id?\n${verbHelp()}`);
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
      const id = args.positional[0] ?? fail(`seat: which seat?\n${verbHelp()}`);
      const run = runArg();
      refuseTranscriptFlag("seat");
      const state = need("--state") as SeatState;
      await board.setSeatState(run, id, state);
      emit({ run, seat: id, state }, `${id} ${state}`);
      break;
    }
    case "close": {
      const run = runArg();
      const trees = (await board.worktrees(run)).filter((w) => worktrees(w.repo).owns(w.worktree) && fs.existsSync(w.worktree));
      await board.closeRun(run);
      // the run's worktrees go once clean and merged, each seat's link stopped first
      const swept = trees.map((w) => ({ worktree: slashed(w.worktree), member: w.member, ...worktrees(w.repo).release({ run, member: w.member, worktree: w.worktree }, w.base) }));
      const kept = swept.filter((w) => !w.removed);
      emit({ run, state: "closed", removed: swept.filter((w) => w.removed).map((w) => w.worktree), kept: kept.map((w) => ({ worktree: w.worktree, member: w.member, why: w.why })) }, () => {
        console.log(`run ${run} closed`);
        const n = swept.length - kept.length;
        if (n) console.log(`${n} worktree${n === 1 ? "" : "s"} removed (branches kept)`);
        for (const w of kept) console.log(`kept ${w.worktree} (${w.member}): ${w.why}; merge it or discard it, then: ${self().join(" ")} worktree prune`);
      });
      break;
    }
    case "phase": {
      const p = await caller();
      const [name, ...said] = args.positional;
      if (!name) fail(`phase: which phase?\n${verbHelp()}`);
      const text = said.join(" ") || fail(`phase ${name}: what does it ask?`);
      // --watch: the members whose done wakes the orchestrator the moment it lands (idea 2, §3)
      const watch = args.list("--watch");
      // --for: only these seats are woken and owe their done; a seat with nothing to do is not woken (tokens)
      const only = args.list("--for");
      const m = await board.phase(p, name, text, watch.length || only.length ? { ...(watch.length ? { watch } : {}), ...(only.length ? { for: only } : {}) } : undefined);
      // the orchestrator's next step (rule 10): a done is carried to its next wake, a watched one wakes it; the board says when all are in
      const cli = self().join(" ");
      const next = WORDING.phaseOpened(name, WORDING.phaseFor(only), WORDING.phaseHeard(watch), cli, shellWord(p.name), m.run);
      // the person follows from the session they talk to, not the board: a few lines there at every phase (rule 10)
      const brief = WORDING.briefThePerson;
      // a seat whose member ended still owes this phase: all-done waits for it, so it is named with how to wake it
      const dormant = ((await board.phaseProgress(m.run))?.dormant ?? []).map((s) => WORDING.dormant(s.slice(s.lastIndexOf("/") + 1)));
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
        const next = WORDING.pausedAll(m.run, person !== undefined ? text : null, cli, shellWord(p.name));
        emit({ seq: m.seq, run: m.run, paused: true, person: person !== undefined, next }, () => {
          console.log(seqLine(m));
          console.log(next);
        });
        break;
      }
      const m = await board.resume(p, text);
      // what the pause held from the orchestrator, one line each, given once (idea 2, judgment 1)
      const next = WORDING.resumed(m.run, m.held.length, cli, shellWord(p.name));
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
      const name = args.positional[0] ?? usageError("done: which phase?", "done <phase> --as <member>", `done build --as ${asWord()}`);
      let r;
      try {
        r = await board.done(p, name);
      } catch (e) {
        // F20: a done with no phase open marks nothing, and is not an error
        if (!/no phase is open/.test((e as Error).message)) throw e;
        emit({ member: p.name, phase: name, done: null, none: true }, WORDING.doneNone);
        break;
      }
      // a done for a phase no longer current is accepted and told to the orchestrator (idea 2, §3: overlapping phases)
      const line = r.late
        ? `late done ${name} (not the current phase), recorded; the orchestrator is told`
        : `${r.already ? "already done" : "done"} ${name}: members done ${r.progress.done}/${r.progress.of}${r.progress.gone.length ? `, ${r.progress.gone.length} gone` : ""}${r.all ? "; the orchestrator is told every member is done" : ""}`;
      const a = answer({ verb: "done", phase: name, line }, await situation(p));
      emitAnswer({ member: p.name, phase: name, done: r.progress.done, of: r.progress.of, gone: r.progress.gone, all: r.all, already: r.already, late: r.late }, a, false);
      break;
    }
    case "join": {
      const own = await memberWorktree(runArg(), joinedSeat());
      const { member, roster, composition } = await board.join({
        run: runArg(),
        seat: joinedSeat(),
        doing: need("--doing"),
        files: [...args.list("--files"), ...args.flags("--file")].map(parseFile),
        worktree: own?.path ?? worktreeOf(process.cwd()) ?? undefined,
        ...(args.flag("--on") !== undefined ? { on: subscriptionsArg(args.flag("--on")!) } : {}),
      });
      // the member's link, from now on how its verbs reach the board (D29), started by its agent (D32)
      const link = startLinkLine({ name: member.name, run: member.run });
      // a kind without worktree: the checkout is shared, so every call names the member (D21, D36)
      const shared = member.kindPack === null;
      const as = shared
        ? `pass --as ${member.name} on every call: this checkout is shared, the board cannot tell you apart`
        : own
          ? `your worktree: ${fwd(own.path)} (branch ${own.branch} from ${own.base}${own.reused ? ", reused" : "; made at your first claim or merge-lock"}). Work there by absolute paths and git -C ${shellWord(fwd(own.path))}, never cd into it; pass --as ${member.name} on every call`
          : null;
      const commands = shared ? seatCommands(member.name) : null;
      // every member posts markdown shaped to what it says: agents do what the board prints (D2)
      const drawing = POSTS_MARKDOWN;
      // the run's current phase after the roster: a late or restarted member starts in it; then the owed phase and the
      // listener, after the link, so the agent starts its link before a wait blocks it (swarm-relay D33)
      const head = [`you are ${member.name}, ${member.nick}: @${member.seat} or @${member.nick.replace(/\s+/g, "")} mentions you`, ...composition.lines, ...roster.map((r) => rosterLine(r))];
      const tail = [...(as ? [as] : []), ...(commands ?? []), ...(drawing ? [drawing] : []), link];
      // S1: a post for the seat made before its join is delivered here, whole, as a wait would (D8: marked delivered)
      const waiting = await board.deliverMentions(member);
      // the phase and pause events are left out: the join's own phase or paused line states them (one fact, once)
      const statedByJoin = new Set(["phase", "pause"]);
      const shown = shownOf({ full: waiting.full.filter((m) => !statedByJoin.has(eventOf(m) ?? "")) });
      const a = answer({ verb: "join", head, shown, tail }, await situation(member));
      emitAnswer({ member: member.name, nick: member.nick, roster, composition, ...(shared ? { as: member.name, commands } : {}), ...(own ? { worktree: own.path, branch: own.branch, as: member.name } : {}), ...(drawing ? { drawing } : {}), link }, a);
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
        // every --with counts, each a seat or a comma list of seats (S5)
        ...(args.verb === "agree" && args.has("--with") ? { with: args.flags("--with").flatMap((w) => w.split(",")) } : {}),
      });
      const unmatched = await unmatchedLines(p, body);
      const json = { seq: m.seq, mentions: m.mentions, run: m.run, ...(unmatched.length ? { unmatched } : {}), ...(m.claimed ? { claimed: m.claimed } : {}) };
      const human = [
        seqLine(m),
        // posting is claiming (D7)
        ...(m.claimed ? [`claimed ${m.claimed.path}, shared with ${m.claimed.sharedWith.join(", ")}`] : []),
        ...unmatched,
        ...(args.verb === "agree" && m.mentions?.length ? [WORDING.agreeParties(p.name, m.mentions)] : []),
      ];
      // V4: open's next line is said once, by open; a post never repeats it
      await emitHeard(p, json, human);
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
      const raw = (args.positional[0] ?? usageError("read: which seq?", "read <seq> [--as <member>]", `read 12 --as ${asWord()}`)).replace(/^#/, "");
      const seq = Number(raw);
      if (!Number.isInteger(seq)) usageError(`read takes a seq, got ${raw}`, "read <seq> [--as <member>]", `read 12 --as ${asWord()}`);
      // a member's read is a call of its own (D66); a reader no member answers to reads all the same
      let by: Participant | undefined;
      try {
        by = await caller();
      } catch (e) {
        if (!(e instanceof CliError)) throw e;
      }
      if (by && (await answeredClosed(by))) break;
      const m = await board.read(seq, by);
      // the phase the message's run is in, first; a member owing the open phase is told to do it, last
      if (by) emitAnswer({ ...m }, answer({ verb: "read", shown: { text: fullText(m) }, member: true }, await situation(by, true)));
      else {
        // a reader no member answers to: the message's run's phase, whole
        const ph = await board.currentPhase(m.run);
        const phase = ph ? WORDING.phaseWhole(ph.name, ph.text) : null;
        emitAnswer({ ...m }, { lines: [fullText(m), ...(phase ? [phase] : [])], next: null, phase });
      }
      break;
    }
    case "thread": {
      // --run: a run read from outside it, closed ones too, by no member (G30)
      const outside = args.flag("--run");
      if (outside !== undefined) {
        const run = Number(outside);
        if (!Number.isInteger(run)) usageError(`thread --run takes a run id, got ${outside}`, "thread --run <id> [<phase>]", "thread --run 3");
        const name = args.positional[0];
        const posts = await board.runThread(run, name);
        emit({ run, posts }, () => {
          if (!posts.length) console.log(`no post in run ${run}${name ? ` phase ${name}` : ""}`);
          for (const m of posts) console.log(fullText(m));
        });
        break;
      }
      const me = await caller();
      if (await answeredClosed(me)) break;
      const name = args.positional[0];
      const posts = await board.thread(me, name);
      emitAnswer({ posts }, answer({ verb: "thread", phase: name ?? null, shown: posts.map((m) => ({ text: fullText(m) })) }, await situation(me)));
      break;
    }
    case "deliver": {
      const me = await caller();
      if (await answeredClosed(me)) break;
      // --mentions: only what is for the member (a mention, an urgent post, a subscribed event), never blocking
      const mentionsOnly = args.has("--mentions");
      const d = withNext(me, await (mentionsOnly ? board.deliverMentions(me) : board.deliver(me)));
      // the run's phase heads every delivery that carries something; a member owing the open phase is told to do it, last
      const a = answer({ verb: "deliver", mentionsOnly, shown: shownOf(d), lines: d.lines }, await situation(me, d.full.length > 0 || d.lines.length > 0));
      emitAnswer({ ...d }, a);
      break;
    }
    case "wait": {
      const p = await caller();
      if (await answeredClosed(p)) break;
      const raw = args.flag("--timeout");
      const timeout = raw === undefined ? undefined : Number(raw);
      if (timeout !== undefined && !(timeout >= 0)) usageError(`--timeout takes milliseconds, got ${raw}`, "wait [--mentions] [--timeout <ms>] --as <member>", `wait --mentions --timeout ${FOREGROUND_WAIT_MS} --as ${asWord()}`);
      const mentionsOnly = args.has("--mentions");
      const d = withNext(p, await board.wait(p, { timeoutMs: timeout, mentionsOnly }));
      // the run closed while this wait was pending: the close ended the member
      if (await answeredClosed(p)) break;
      if (d.superseded) {
        // a newer wait of this member gets what arrives (D64)
        emit(d, answer({ verb: "wait", outcome: "superseded" }, await situation(p)).lines[0]);
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
      const foregroundAgain = [...again.filter((w, i) => w !== "--timeout" && again[i - 1] !== "--timeout"), "--timeout", String(FOREGROUND_WAIT_MS)].join(" ");
      if (!d.full.length && !d.lines.length) {
        // a timeout: the line to run again (B7); the member ended: it says so, nothing to re-arm (G26)
        const ended = (await board.participant(p.name))?.ended ?? true;
        if (ended) {
          emit(d, answer({ verb: "wait", outcome: "ended" }, await situation(p)).lines[0]);
          break;
        }
        // a member with nothing to do ends rather than wake every 170 s (tokens); the orchestrator dispatches it again
        const idle = mentionsOnly && (await board.idle(p));
        const a = answer({ verb: "wait", outcome: "empty", idle, again: again.join(" "), foregroundAgain }, await situation(p));
        emit({ ...d, ...(idle ? { idle: true } : {}), next: a.next }, a.next!);
        break;
      }
      const phaseEvent = d.full.some((m) => eventOf(m) === "phase");
      const a = answer({ verb: "wait", outcome: "woke", again: again.join(" "), foregroundAgain, phaseEvent, mentionsOnly, shown: shownOf(d), lines: d.lines }, await situation(p, true));
      // F28: a background listener's end is also announced by the harness; the same event, already delivered here
      emit({ phase: a.phase, next: a.next, ...d, ...(mentionsOnly ? { delivered: WORDING.delivered } : {}) }, () => {
        for (const l of a.lines) console.log(l);
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
      await madeWorktree(p);
      if (!args.positional.length) fail("claim: which path?");
      // every path given is claimed, each answered on its own line (G4)
      const answers: { rel: string; verdict: Awaited<ReturnType<typeof board.checkEdit>>; also: string }[] = [];
      for (const file of args.positional) {
        const abs = resolveClaimPath(file);
        const verdict = await board.checkEdit(p, abs, { interface: args.has("--interface") });
        // held (D41): exit 3, the member posts about the path and claims again
        if (!verdict.allowed) process.exitCode = 3;
        // the other holders are named once per member and path, when the board says so (D40)
        const also =
          verdict.allowed && verdict.notice
            ? (await Promise.all(verdict.sharedWith.map(async (o) => `${o.member} · ${(await board.participant(o.member))?.nick ?? "?"}: ${o.doing}`))).join("; ")
            : "";
        answers.push({ rel: repoRelative(abs), verdict, also });
      }
      // the guides these files fall under that the member has not been told of yet, each once per member
      const told = await guidesToTell(p, answers.filter((a) => a.verdict.allowed).map((a) => a.rel));
      const guidesNow = guidesLine(told);
      const json = answers.length === 1 ? answers[0].verdict : { claims: answers.map((a) => ({ path: a.rel, ...a.verdict })) };
      await emitHeard(p, told.length ? { ...json, guides: told } : json, [
        ...answers.map(({ rel, verdict, also }) => (!verdict.allowed ? verdict.refusal : also ? `claimed ${rel}, also held by ${also}` : `claimed ${rel}`)),
        ...(guidesNow ? [guidesNow] : []),
      ]);
      break;
    }
    case "release": {
      const p = await caller();
      const all = args.has("--all");
      if (!all && !args.positional.length) fail("release: which path? (or --all, every claim you hold)");
      // F15: every path given is released; F27: --all, every claim the caller holds
      const released: string[] = [];
      const targets = all ? (await board.heldBy(p)).map((f) => path.resolve(pathsRoot() ?? process.cwd(), f)) : args.positional.map((f) => resolveClaimPath(f));
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
      await madeWorktree(p);
      // the branch merged into: a worktree does not say which branch it left, so the member names it (D59)
      const onto = need("--onto");
      // a branch checked out in a worktree refuses the push: say where, grant nothing (validation finding 4)
      const holding = p.worktree ? worktreeHolding(p.worktree, onto) : null;
      if (holding) {
        process.exitCode = 5;
        // G36: the member whose worktree holds it, so the orchestrator knows whom to ask
        const holder = (await board.roster(p.repo)).find((r) => r.worktree && path.resolve(r.worktree).toLowerCase() === path.resolve(holding).toLowerCase());
        const line = `${onto} is checked out at ${holding}${holder ? ` (${holder.name}'s worktree)` : ""}: ask the orchestrator to detach it, then run merge-lock again`;
        emit({ member: p.name, granted: false, checkedOutAt: holding, next: line }, line);
        break;
      }
      // what the branch wrote without a claim, committed or not, before the lock; a flag informs, never blocks
      // V8: a base only on origin is read as origin's, as the worktree was made from it (G36)
      const ontoRef = p.worktree && fs.existsSync(p.worktree) ? baseRef(p.worktree, onto) : onto;
      const reconciled = p.worktree ? branchChangedIn(p.worktree, ontoRef) : [];
      // what it held before the reconcile claims the rest: only those written without a claim are told
      const held = new Set(await board.heldBy(p));
      // G28: build outputs are claimed like any file, never exempted, and never flagged: whoever merges second rebuilds them
      const generated = p.worktree ? generatedAmong(p.worktree, reconciled) : [];
      const unclaimed = reconciled.filter((f) => !held.has(f) && !generated.includes(f));
      const flags = reconciled.length ? await board.reconcileWrites(p, reconciled, generated) : [];
      const renames = p.worktree && unclaimed.length ? renamesIn(p.worktree, git(p.worktree, "merge-base", ontoRef, "HEAD") ?? "HEAD") : [];
      // where the worktree's HEAD reflog stands: merged replays only a rebase past it (D36)
      const reflogMark = p.worktree ? (headReflogLength(p.worktree) ?? undefined) : undefined;
      // the guides the branch's changes fall under: merged refuses until each is settled
      const guides = guidesFor(guidesHere(p, ontoRef), reconciled);
      const r = await board.lockMerge(p, onto, reflogMark, guides.map((g) => g.name));
      emit({ member: p.name, ...r, reconciled, flags, ...(r.granted && guides.length ? { guides } : {}) }, () => {
        printReconciled(unclaimed, flags, renames);
        if (r.granted && guides.length) console.log(WORDING.mergeGuides(guides.map((g) => `${g.name} (${g.skill})`).join(", ")));
        console.log(r.granted ? WORDING.mergeGranted(self().join(" "), shellWord(p.name), guides.length ? WORDING.guidesForm(guides.map((g) => g.name)) : null) : WORDING.mergeHeld(r.holder!, waitCommand(p.name, true)));
      });
      break;
    }
    case "merged": {
      const p = await caller();
      const sha = args.positional[0] ?? fail("merged: which sha?");
      // the report rides on the merge: one post, the orchestrator's one wake; "-" merges silently, recorded in the run only
      // G25: a long report comes from a file
      const reportFile = args.flag("--report-file");
      let fromFile: string | undefined;
      if (reportFile !== undefined) {
        try {
          fromFile = fs.readFileSync(path.resolve(reportFile), "utf8").trim();
        } catch {
          fail(`merged: --report-file ${reportFile} cannot be read`);
        }
      }
      const report = fromFile || args.flag("--report")?.trim() || fail('merged: --report "<what you did>" is your report to the orchestrator, its one wake (--report-file <path> for a long one); --report - merges silently');
      const files = args.list("--files");
      // what a rebase since the lock's grant met, read before the lock goes (D3, D25, D36); no worktree, no lock or no mark: unknown (D33)
      const lock = await board.heldMergeLock(p);
      // a code run merges one at a time: no lock, no merged; the orchestrator alone may merge past it, saying why
      const unlocked = args.flag("--unlocked")?.trim();
      if (!lock && p.kindPack !== null) {
        if (unlocked === undefined) {
          return fail(`merged: you do not hold the merge lock; run ${[...self(), "merge-lock", "--onto", "<branch>", "--as", shellWord(p.name)].join(" ")} first, then merge, then merged again`);
        }
        if (!p.name.endsWith("/orchestrator")) fail("merged: --unlocked is the orchestrator's alone; take the merge lock: merge-lock --onto <branch>");
        if (!unlocked) fail('merged: --unlocked "<why>" says why the merge skipped the lock');
      }
      // every guide merge-lock listed is settled, ok or n/a with why, before the merge is recorded
      const guidesArg = args.flag("--guides")?.trim();
      const listed = lock?.guides ?? [];
      const settled = guidesSettlement(guidesArg ?? "", listed);
      const form = WORDING.guidesForm(listed);
      if (settled.separator) fail(WORDING.guidesRefused(`separates guides with "${settled.separator}"`, `"${settled.corrected}"`));
      if (settled.malformed.length) fail(WORDING.guidesRefused(`has "${settled.malformed[0]}", which is no <name>:<verdict>`, form));
      if (settled.unknown.length) fail(WORDING.guidesRefused(`names ${settled.unknown.join(", ")}, which merge-lock did not list`, form));
      if (settled.missing.length)
        fail(WORDING.guidesRefused(`leaves out ${settled.missing.join(", ")}, which merge-lock listed`, `"${[guidesArg, ...settled.missing.map((g) => `${g}:ok|n/a <why>`)].filter(Boolean).join(", ")}"`));
      if (settled.unjudged.length) fail(WORDING.guidesRefused(`gives ${settled.unjudged.join(", ")} no verdict: each is "<name>:ok" or "<name>:n/a <why>"`, form));
      // a commit git knows is on the branch the lock names, or it was not merged (V1)
      // V1: a sha git does not know was never merged
      if (lock?.onto && p.worktree && !git(p.worktree, "rev-parse", "--verify", "-q", `${sha}^{commit}`))
        fail(`merged: ${sha} is no commit git knows in ${slashed(p.worktree)}; give the sha you pushed onto ${lock.onto}: git -C ${slashed(p.worktree)} rev-parse --short HEAD`);
      if (lock?.onto && p.worktree && gitAnswer(p.worktree, "merge-base", "--is-ancestor", sha, lock.onto).status !== 0)
        fail(`merged: ${sha} is not on ${lock.onto}; fast-forward it first: git -C ${slashed(p.worktree)} push . HEAD:${lock.onto}, then merged again`);
      const conflicts = p.worktree && lock && lock.reflogMark !== null ? conflictsOf(p.worktree, lock.onto ?? "", lock.reflogMark) : undefined;
      const sharers = await board.merged(p, sha, files.map((f) => path.resolve(f)), conflicts);
      const reported = report === "-" ? null : await board.post(p, `@orchestrator merged ${sha}: ${report}${guidesArg ? `\nguides: ${guidesArg}` : ""}`, { kind: "msg" });
      // a silent merge still records how it settled its guides, in the run, waking no one (V3)
      const guidesRecord = report === "-" && guidesArg ? await board.post(p, `merged ${sha}, guides: ${guidesArg}`, { kind: "msg" }) : null;
      // a merge past the lock is recorded in the run, with its why
      if (!lock && unlocked) await board.post(p, `merged ${sha} without the merge lock: ${unlocked}`, { kind: "msg" });
      // the post after a resolved conflict, prompted by the command just run (D63)
      const ended = new Set(await board.endedMembers(p.repo));
      const tell = sharers.map((o) =>
        ended.has(o.member)
          ? `if you resolved a conflict in ${o.path}: ${o.member} has ended, so say how in your report`
          : `if you resolved a conflict in ${o.path}, tell them: swarm post "@${o.member} I resolved ${o.path}: <how>" --about ${o.path}`,
      );
      // the worktree stays for the seat's next task; end, close and prune remove it
      emit({ member: p.name, sha, files, tell, ...(reported ? { reported: reported.seq } : {}) }, () => {
        console.log(`merged ${sha}: lock released${reported ? `; reported as #${reported.seq}` : guidesRecord ? `; guides recorded as #${guidesRecord.seq}` : ""}`);
        for (const line of tell) console.log(line);
      });
      break;
    }
    case "end": {
      const p = await caller();
      // its run closed: the close ended it; end answers what the closed line promised, the summary to return
      if ((await board.runs()).every((r) => r.id !== p.run)) {
        const line = `run ${p.run} closed: ${p.name} ended; return your summary now (your link and listener background tasks end on their own, and their end notices are not news)`;
        // ended: no link to start
        linkToStart = null;
        emit({ member: p.name, ended: true, closed: true, next: line }, line);
        break;
      }
      // a member already ended: nothing to do, nothing to say
      if (p.ended) break;
      // a mention landed since its last look: it reads it before it ends
      const unread = await board.unreadMentions(p);
      if (unread > 0) fail(`you have ${unread} unread mention${unread === 1 ? "" : "s"}: run \`${[...self(), "deliver", "--as", shellWord(p.name)].join(" ")}\` first`);
      // the board's worktree with work not merged: end refuses, naming it and the merge
      const base = (await runOf(p.run))?.base ?? null;
      const seatTrees = worktrees(p.repo);
      const mine = seatTrees.owns(p.worktree) && fs.existsSync(p.worktree) ? slashed(p.worktree) : null;
      const left = mine ? seatTrees.unmerged(mine, base) : null;
      if (mine && left) {
        const who = `--as ${shellWord(p.name)}`;
        fail(
          `end: your worktree ${mine} holds work not merged: ${left}. ${/uncommitted/.test(left) ? "Commit it, then merge it" : "Merge it"}: ${self().join(" ")} merge-lock --onto ${base ?? "<branch>"} ${who}; rebase onto ${base ?? "it"} and push; ${self().join(" ")} merged <sha> --files <path>... --report "<what you did>" ${who}; then end again`,
        );
      }
      // what the member wrote without claiming it, once, before its claims go (D58)
      const reconciled = p.worktree ? changedIn(p.worktree) : [];
      // what it held before the reconcile claims the rest: only those written without a claim are told
      const held = new Set(await board.heldBy(p));
      const unclaimed = reconciled.filter((f) => !held.has(f));
      const flags = reconciled.length ? await board.reconcileWrites(p, reconciled) : [];
      const renames = p.worktree && unclaimed.length ? renamesIn(p.worktree, "HEAD") : [];
      await board.end(p);
      // ended: no link to start
      linkToStart = null;
      // its link goes first, inside release: Windows holds a folder a live process is in
      const removal = mine ? seatTrees.release({ run: p.run, member: p.name, worktree: mine }, base).why : null;
      emit({ member: p.name, ended: true, reconciled, flags, ...(mine ? { worktree: mine, removed: removal === null } : {}) }, () => {
        printReconciled(unclaimed, flags, renames);
        console.log(`${p.name} ended`);
        if (mine) console.log(removal === null ? `worktree ${mine} removed (branch kept)` : `worktree ${mine} kept: ${removal}; the orchestrator's close sweeps it`);
      });
      break;
    }
    case "worktree": {
      if (args.positional[0] !== "prune") fail(`worktree: the one subcommand is prune\n${verbHelp()}`);
      const known = await board.worktrees();
      // each repository the board knows a run of: its worktrees folder is the only one walked
      const fold = (s: string) => (process.platform === "win32" ? path.resolve(s).toLowerCase() : path.resolve(s));
      // the latest member to join from it says which run it belongs to
      const recordOf = (dir: string) => known.filter((k) => fold(k.worktree) === fold(dir)).at(-1) ?? null;
      const out = sweepAll([...known.map((k) => k.repo), ...(await board.runs()).map((r) => r.repo)], recordOf).map((o) => ({ ...o, worktree: slashed(o.worktree) }));
      const kept = out.filter((o) => !o.removed);
      emit({ removed: out.filter((o) => o.removed).map((o) => o.worktree), kept }, () => {
        console.log(`${out.length - kept.length} worktree${out.length - kept.length === 1 ? "" : "s"} removed (branches kept)`);
        for (const k of kept) console.log(`kept ${k.worktree}: ${k.why}`);
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
      const name = args.positional[0] ?? fail(`lock: which resource? port:<n>, app:<name>, db:<name>, browser:<profile>\n${verbHelp()}`);
      const r = await board.lock(p, name, args.flag("--note"));
      const cli = self().join(" ");
      const who = shellWord(p.name);
      if (!r.granted) {
        // held: who holds it, then how to wait for its unlocked event (exit 3, as a held claim)
        process.exitCode = 3;
        const h = r.holder;
        const held = `held by ${h.nick} (${h.code}·${h.member.split("/").pop()}, ${h.state}) since ${h.since}${h.doing ? `, doing: ${h.doing}` : ""}`;
        const next = WORDING.lockHeldNext(cli, shellWord(name), who, waitCommand(p.name, true));
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
      const name = args.positional[0] ?? fail(`unlock: which resource?\n${verbHelp()}`);
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
      ? `usage: ${CLI} serve [stop]   # the board server of the data home, started on demand by any verb; \`serve stop\` ends it`
      : `usage: ${CLI} link --run <id> --as <member>   # a member's link, started by its agent from the line join or open prints`,
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
    // V11: a link that starts clears its member's told mark, so a link lost later is told once more
    clearLinkTold(member);
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
    // V11: once per member, not on every call: told until its link starts, which clears the mark
    if (linkToStart && !linkTold(linkToStart)) {
      (asJson ? console.error : console.log)(startLinkLine(linkToStart));
      markLinkTold(linkToStart);
    }
  } catch (e) {
    const said = (e as Error).message;
    console.error(e instanceof CliError || said.startsWith("swarm: ") ? said : `swarm: ${said}`);
    process.exitCode = 1;
  } finally {
    board?.close();
  }
}
