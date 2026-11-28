// What the CLI asks of a run's pack through the board (board-split D9, D12): a pack verb and its refusal, the member's
// worktree made at join or delivery, the merge locks held, and the report a merge carries.
import fs from "node:fs";
import path from "node:path";
import type { PackRefusal } from "../board/board.ts";
import type { Participant } from "../contract/board.ts";
import { baseAt } from "../host/git.ts";
import { worktreeOf } from "../host/place.ts";
import { CODE_WORDING, WORDING } from "./answer/index.ts";
import type { VerbContext } from "./context.ts";
import { fail } from "./fail.ts";
import { repoOf } from "./paths.ts";

/** A pack verb's refusal (board-split#D12, D19): a member whose pack lacks the verb, or a git failure making its
 *  worktree; nothing was written. */
const isPackRefusal = (fact: unknown): fact is PackRefusal => typeof fact === "object" && fact !== null && "refused" in fact;
function refusedCodeVerb(fact: PackRefusal): never {
  const r = fact.refused;
  // D12: one answer-module line naming the verb and the caller's seat kind; thrown, as the board's own refusals are,
  // so the answer reads as one (`swarm: …`)
  throw new Error(r.reason === "git" ? `worktree: ${r.detail}` : WORDING.packVerbRefused(r.verb, r.seatKind));
}
/** D12: a code verb the board gates itself (release, merged) refused up front to a member with no pack, in the same line. */
export function refuseWithoutPack(p: Participant, verb: string): void {
  if (p.pack === null) refusedCodeVerb({ refused: { reason: "no-pack", verb, seatKind: p.verify ? "verifier" : "seat" } });
}
/** The server side of a code verb, its refusal failing the verb before anything else runs (D9). */
export async function packVerb(ctx: VerbContext, p: Participant, verb: string, input: Record<string, unknown> = {}): Promise<unknown> {
  const fact = await ctx.board.packCall(p, verb, input);
  return isPackRefusal(fact) ? refusedCodeVerb(fact) : fact;
}

/** A code-pack member gets the board's worktree, named and made at join (spec §7; G20, D19), reused when there; a seat
 *  with no pack (a verifier, a brainswarm seat), an undeclared seat, or a caller already in a worktree of its own (one it
 *  made, or its harness did) gets none. */
export async function memberWorktree(ctx: VerbContext, runId: number, seat: string): Promise<{ path: string; branch: string; base: string; reused: boolean } | null> {
  const run = await ctx.runOf(runId);
  if (!run || !run.seats.some((s) => s.id === seat)) return null;
  const cwd = process.cwd();
  // outside a repository, or in one with no commit yet: nothing to branch from
  const base = run.base ?? baseAt(cwd);
  if (!base || !worktreeOf(cwd)) return null;
  const place = (await ctx.board.packCall(null, "place", { run: run.id, seat, cwd })) as { path: string; branch: string; reused: boolean } | null;
  if (!place) return null;
  if (repoOf(cwd) !== run.repo) fail(`join: run ${runId} is on ${run.repo}; join from a checkout of that repository`);
  return { ...place, base };
}

/** The caller's board worktree, made by its pack in the board server when its join only named it (G20, D19): a
 *  member that never claims or merges gets none; a member with no pack is refused the verb. */
export async function madeWorktree(ctx: VerbContext, p: Participant, verb: "join" | "merge-lock"): Promise<void> {
  // there already: nothing for the pack to make, and the verb's own gate stands
  if (p.place && fs.existsSync(p.place)) return;
  // any checkout of the repository gives the base: the caller's, else the repository's own beside its git dir
  const cwd = worktreeOf(process.cwd()) && repoOf(process.cwd()) === p.repo ? process.cwd() : path.dirname(p.repo);
  const made = (await packVerb(ctx, p, verb, { cwd })) as { made: boolean } | null;
  if (made?.made) ctx.callerWorktree = p.place;
}

/** board-split D52 (U-F18): the merge lock of each project with an open run, its holder and since; none held: empty. */
export async function mergeLocksHeld(ctx: VerbContext): Promise<{ project: string; holder: string; since: string; waiters: string[] }[]> {
  const projects = [...new Set((await ctx.board.runs()).map((r) => r.repo))];
  // a project whose snapshot cannot be read (a broken store setting) names no merge lock; the verb still answers
  const lockOf = async (project: string) => {
    try {
      return (await ctx.board.snapshot(project)).lock ?? null;
    } catch {
      return null;
    }
  };
  const held = await Promise.all(projects.map(async (project) => ({ project, lock: await lockOf(project) })));
  return held.flatMap((h) => (h.lock ? [{ project: h.project, holder: h.lock.holder, since: h.lock.since, waiters: h.lock.waiters ?? [] }] : []));
}

/** The report a merge carries, read and checked the same way wherever it is given: by `merged`, and by `merge-lock`
 *  delivering, before anything is pushed. A file's text, else the text given; undefined when neither. Refused: a file
 *  that cannot be read (G25), and a `--report` naming a file (V-32, D69). */
let stdinReport: string | undefined;
export function reportGiven(ctx: VerbContext): string | undefined {
  // a long report piped in (a heredoc): no quoting to break, and no file left behind to be read again stale
  if (ctx.args.has("--report-stdin")) {
    if (stdinReport === undefined) {
      try {
        stdinReport = fs.readFileSync(0, "utf8").trim();
      } catch {
        stdinReport = "";
      }
    }
    return stdinReport || fail(CODE_WORDING.reportStdinEmpty);
  }
  const reportFile = ctx.args.flag("--report-file");
  let fromFile: string | undefined;
  if (reportFile !== undefined) {
    try {
      fromFile = fs.readFileSync(path.resolve(reportFile), "utf8").trim();
    } catch {
      fail(CODE_WORDING.reportFileUnreadable(reportFile));
    }
  }
  const given = ctx.args.flag("--report")?.trim();
  if (given && given !== "-" && fs.existsSync(path.resolve(given)) && fs.statSync(path.resolve(given)).isFile()) fail(CODE_WORDING.reportIsAFile(given));
  return fromFile || given || undefined;
}
