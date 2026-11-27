// The one context every verb runs in (codebase-rework#D11, plan §3.4): the call's arguments, the board it talks to,
// who is calling, the gates before a member verb, and how an answer prints. The dispatcher builds one per call.
import fs from "node:fs";
import path from "node:path";
import type { Participant } from "../board/board.ts";
import { HOME_OVERRIDE } from "../board/home.ts";
import { connectBoard, connectDirectBoard, linkVerbArgs, type BoardMember, type ConnectedBoard } from "../client/remote.ts";
import { DATA_ROOT } from "../host/home.ts";
import { repoOf as placeRepoOf, worktreeOf } from "../host/place.ts";
import { pausedMergingStep } from "./answer/code-rules.ts";
import { answer, CODE_WORDING, ORCHESTRATORS_GROUP, readSituation, shellWord, verbHelp, WORDING, type Situation } from "./answer/index.ts";
import * as rules from "./answer/rules.ts";
import { projectPaths } from "./aiview-board.ts";
import { parseArgs, type ParsedArgs } from "./args.ts";
import { fail } from "./fail.ts";
import { fwd, repoOf, toolRoot } from "./paths.ts";

/** A verb's exit: what each code means to the agent reading it. */
export const EXIT = { ok: 0, error: 1, conflict: 2, paused: 4, ontoCheckedOut: 5 } as const;

/** An answer of the cluster (board-rework D1): its lines, its next step and phase as --json carries them. */
type ClusterAnswer = { lines: string[]; next: string | null; phase?: string | null; paused?: string };

export interface VerbContext {
  readonly args: ParsedArgs;
  /** the verb as called (`pause` or `resume` for their one entry) */
  readonly verb: string;
  readonly asJson: boolean;
  /** V1, G3: this CLI as every printed command runs it: the data home when not the default, node and this script,
   *  forward slashes, quoted when needed */
  readonly cli: string;
  /** The board the verb talks to: straight to the server until `caller` binds it to the caller's link (D29); the
   *  dispatcher closes the current one */
  board: ConnectedBoard;
  /** The caller whose link did not answer in a harness session: the verb ends on the line that starts it (D39) */
  linkToStart: BoardMember | null;
  /** The worktree a member's paths are relative to, once known */
  callerWorktree: string | null;
  exitCode: number;
  emit(json: unknown, human: string | (() => void)): void;
  emitAnswer(json: Record<string, unknown>, a: ClusterAnswer, withPhase?: boolean): void;
  emitHeard(p: Participant, json: object, result: string | string[]): Promise<void>;
  need(flag: string): string;
  runArg(): number;
  seqFlag(flag: string): number | undefined;
  readRun(verb: string): Promise<number>;
  projectRepo(): string;
  /** The --as a corrected form carries: the caller's own, else the placeholder */
  asWord(): string;
  /** V9: the usage of the verb being called alone, and one corrected form; never the whole help */
  verbHelp(): string;
  usageError(what: string, usage: string, example: string): never;
  caller(): Promise<Participant>;
  placedCaller(): Promise<Participant | null>;
  orchestratorOf(verb: "close" | "seat add", run: number, rerun: (as: string) => string): Promise<void>;
  situation(p: Participant, show?: boolean): Promise<Situation>;
  answeredGate(p: Participant, listener?: boolean): Promise<boolean>;
  refusedPaused(p: Participant): Promise<boolean>;
  startLinkLine(member: BoardMember): string;
  tellLinkToStart(print: (line: string) => void): void;
  runOf(id: number): Promise<Awaited<ReturnType<ConnectedBoard["runs"]>>[number] | null>;
  pathsRoot(): string | null;
}

export function contextFor(argv: string[]): VerbContext {
  const args = parseArgs(argv);
  const asJson = args.has("--json");
  const cli = [...(HOME_OVERRIDE ? [`SWARMSTORM_HOME=${shellWord(fwd(HOME_OVERRIDE))}`] : []), "node", shellWord(fwd(process.argv[1]))].join(" ");
  const ctx: VerbContext = {
    args,
    verb: args.verb ?? "",
    asJson,
    cli,
    board: undefined as unknown as ConnectedBoard,
    linkToStart: null,
    callerWorktree: null,
    exitCode: EXIT.ok,

    emit(json, human) {
      if (asJson) console.log(JSON.stringify(json));
      else if (typeof human === "string") {
        if (human) console.log(human);
      } else human();
    },
    emitAnswer(json, a, withPhase = true) {
      ctx.emit({ ...json, ...(withPhase ? { phase: a.phase ?? null } : {}), ...(a.next ? { next: a.next } : {}), ...(a.paused ? { paused: a.paused } : {}) }, () => {
        for (const l of a.lines) console.log(l);
      });
    },
    /** A verb that heard from the member (D9): its result lines, then the step the answer rules give (D1). */
    async emitHeard(p, json, result) {
      const lines = typeof result === "string" ? [result] : result;
      const a = answer({ verb: "heard", lines }, await ctx.situation(p));
      ctx.emit({ ...json, ...(a.next ? { next: a.next } : {}), ...(a.paused ? { paused: a.paused } : {}) }, () => {
        for (const l of lines) console.log(l);
        // S29: a member whose link does not run yet starts it before its listener, as join orders them
        ctx.tellLinkToStart(console.log);
        for (const l of a.lines.slice(lines.length)) console.log(l);
      });
    },

    need: (flag) => args.flag(flag) ?? fail(`${flag} is required\n${ctx.verbHelp()}`),
    runArg() {
      const raw = ctx.need("--run");
      const id = Number(raw);
      if (!Number.isInteger(id)) fail(`--run takes a run id, got ${raw}`);
      return id;
    },
    /** A positive whole number flag (a seq, a limit); undefined when absent. */
    seqFlag(flag) {
      const raw = args.flag(flag);
      if (raw === undefined) return undefined;
      const n = Number(raw.replace(/^#/, ""));
      return Number.isInteger(n) && n > 0 ? n : fail(`${flag} takes a positive number, got ${raw}`);
    },
    /** The run a read names: --run, else the caller's own (--as, or the member joined from this worktree). */
    readRun: async (verb) => (args.flag("--run") !== undefined ? ctx.runArg() : ((await ctx.placedCaller())?.run ?? fail(WORDING.readWhichRun(verb)))),
    /** The repository `--project` names (D47, verify 3 F15): a path inside one, else an aiview project's name, the first
     *  of its paths that is a repository; the cwd's without the flag. An unknown one fails `no project <name>`. */
    projectRepo() {
      const asked = args.flag("--project");
      if (asked === undefined) return placeRepoOf(process.cwd()) ?? fail(WORDING.notInRepository(process.cwd()));
      if (fs.existsSync(asked)) return repoOf(path.resolve(asked)) ?? fail(WORDING.noProject(asked));
      const covered = projectPaths({ toolRoot: toolRoot(), cwd: process.cwd(), name: asked }) ?? [];
      const repo = covered.filter((p) => fs.existsSync(p)).map((p) => repoOf(p)).find((r) => r !== null);
      return repo ?? fail(WORDING.noProject(asked));
    },
    asWord: () => shellWord(args.flag("--as") ?? "<group>/<seat>"),
    verbHelp: () => verbHelp(cli, ctx.verb, ctx.asWord()),
    /** V1: an argument error: what is wrong, the verb's usage, and one corrected form to copy. */
    usageError: (what, usage, example) => fail(`${what}\nusage: ${cli} ${usage}\ne.g. ${cli} ${example}`),

    /** The caller: --as names it; otherwise the member that joined from this worktree, asked of the server
     *  directly (D29). From then on the verb's calls go through that member's link. */
    async caller() {
      const p = (await ctx.placedCaller()) ?? fail(CODE_WORDING.whoIsCalling);
      const direct = ctx.board;
      if (p.place && fs.existsSync(p.place)) ctx.callerWorktree = p.place;
      const member = { name: p.name, run: p.run };
      // S62: a member ended, or of a closed run, has no link: its verb stays on the server, waits for no link and never
      // prints the link line; it answers the closed line, or end its summary prompt. Its calls still declare it (D5).
      ctx.board = p.ended || !(await direct.runs()).some((r) => r.id === p.run) ? await connectDirectBoard(DATA_ROOT, member) : await connectBoard({ dataRoot: DATA_ROOT, member });
      if (ctx.board.linkMissing) ctx.linkToStart = member;
      direct.close();
      return p;
    },
    /** Who is calling, from --as and from the worktree the command runs in (trust-adaptations#D23): a live member's worktree
     *  acts only as that member; `identify` never returns an ended one, so a fresh agent taking a seat back passes. Null:
     *  no --as, and no member joined from here. */
    async placedCaller() {
      const as = args.flag("--as");
      const wt = worktreeOf(process.cwd());
      const owner = wt ? await ctx.board.identify({ place: wt }) : null;
      if (!as) return owner;
      const p = (await ctx.board.participant(as, placeRepoOf(process.cwd()))) ?? fail(`unknown member ${as}`);
      if (owner && owner.name !== p.name) fail(WORDING.asAnotherMember(cli, process.argv.slice(2).map(shellWord), as, owner.name));
      return p;
    },
    /** `close` and `seat add` (trust-adaptations#D5): the run's orchestrator alone, its calls declared on a direct connection
     *  (a closing run's link is told to stop); the orchestrators board stays open to every team orchestrator. */
    async orchestratorOf(verb, run, rerun) {
      const group = (await ctx.board.runs()).find((r) => r.id === run)?.group ?? null;
      if (group === ORCHESTRATORS_GROUP) return;
      const orchestrator = group ? `${group}/orchestrator` : "<group>/orchestrator";
      const p = await ctx.placedCaller();
      if (!p || p.seat !== "orchestrator" || p.run !== run) fail(WORDING.orchestratorOnly(verb, run, p?.name ?? null, rerun(orchestrator)));
      const direct = ctx.board;
      ctx.board = await connectDirectBoard(DATA_ROOT, { name: p!.name, run });
      direct.close();
    },

    /** The member's situation, read once per verb, for the answer rules (board-rework D1). `show`: the verb shows the phase. */
    async situation(p, show = false) {
      const s = await readSituation(ctx.board, p, { cli, word: shellWord, show });
      // board-split V-36 (D71): in a pause, the merge lock's holder finishes that merge, then stops
      const merging = s.pause && p.pack != null && p.seat !== "orchestrator" && (await ctx.board.packCall(p, "held-merge-lock", {})) != null;
      return merging ? { ...s, pauseStep: pausedMergingStep(s) } : s;
    },
    /** break-flow D61: the gate before every member verb, core and code pack. True, having printed the closed or ended
     *  line, when `p`'s run is closed or `p` has ended: the verb writes nothing more. */
    async answeredGate(p, listener = false) {
      const s = await ctx.situation(p);
      const line = rules.gateLine(s, listener);
      if (!line) return false;
      ctx.emit({ run: p.run, ...(s.closed ? { closed: true } : { ended: true }), next: line }, line);
      return true;
    },
    /** True, having printed the paused line with exit 4, when `p`'s run is paused: the verb does nothing. */
    async refusedPaused(p) {
      const line = rules.pausedLine(await ctx.situation(p));
      if (!line) return false;
      ctx.exitCode = EXIT.paused;
      ctx.emit({ run: p.run, paused: true, refused: ctx.verb, next: line }, WORDING.verbRefused(ctx.verb, line));
      return true;
    },

    /** The link line of join and open, before any listener or wait line (D32, swarm-relay D33, AGENTS rule 10): the member's
     *  link, run as its agent's own background task, so a stopped agent takes it down; a verb that finds none spawns one
     *  detached outside a harness session, and inside one ends on this line (D39). */
    startLinkLine: (member) => WORDING.linkStart([cli, ...linkVerbArgs(member).map(shellWord)].join(" ")),
    /** The link line, printed once per answer wherever it first fits (v1-F6), then forgotten. */
    tellLinkToStart(print) {
      if (!ctx.linkToStart) return;
      print(ctx.startLinkLine(ctx.linkToStart));
      ctx.linkToStart = null;
    },
    /** An open run by id; null when closed or unknown. */
    runOf: async (id) => (await ctx.board.runs()).find((r) => r.id === id) ?? null,
    pathsRoot: () => ctx.callerWorktree ?? worktreeOf(process.cwd()),
  };
  return ctx;
}
