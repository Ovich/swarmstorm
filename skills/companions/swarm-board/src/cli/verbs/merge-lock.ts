import fs from "node:fs";
import path from "node:path";
import type { Conflicts, Participant } from "../../contract/board.ts";
import type { HeldMergeLock } from "../../contract/code.ts";
import { FOREGROUND_WAIT_MS } from "../../contract/events.ts";
import { baseRef, git, worktreeHolding } from "../../host/git.ts";
import { hiddenSpawnSync } from "../../host/proc.ts";
import { headReflogLength, MERGE_CONFLICTS_ENV } from "../conflicts.ts";
import { CODE_WORDING, shellWord, WORDING } from "../answer/index.ts";
import * as rules from "../answer/rules.ts";
import { EXIT, type VerbContext } from "../context.ts";
import { fail } from "../fail.ts";
import { branchChangedIn } from "../paths.ts";
import { madeWorktree, packVerb, reportGiven } from "../pack-calls.ts";

export async function mergeLockVerb(ctx: VerbContext, p: Participant): Promise<void> {
  // the branch merged into: --onto, else the branch the run was opened onto (board-split F3, D2); required only when neither says
  const onto = ctx.args.flag("--onto") ?? (await ctx.runOf(p.run))?.base ?? ctx.need("--onto");
  await madeWorktree(ctx, p, "merge-lock");
  // a branch checked out in a worktree refuses the push: say where, grant nothing (validation finding 4)
  const holding = p.place ? worktreeHolding(p.place, onto) : null;
  if (holding) {
    ctx.exitCode = EXIT.ontoCheckedOut;
    // G36: the member whose worktree holds it, so the orchestrator knows whom to ask
    const holder = (await ctx.board.roster(p.repo)).find((r) => r.worktree && path.resolve(r.worktree).toLowerCase() === path.resolve(holding).toLowerCase());
    const line = CODE_WORDING.ontoCheckedOutAtMerge(onto, holding, holder?.name ?? null, CODE_WORDING.detach(shellWord(holding)));
    ctx.emit({ member: p.name, granted: false, checkedOutAt: holding, next: line }, line);
    return;
  }
  // the target as the worktree reads it (V8: a base only on origin is read as origin's, as the worktree was made
  // from it, G36)
  const ontoRef = p.place && fs.existsSync(p.place) ? baseRef(p.place, onto) : onto;
  // the delivery: a member in its board worktree calls merge-lock and the whole merge is run here; --lock-only takes
  // the lock alone, for a merge made by hand, as a member with no worktree always does
  const deliver = !!p.place && !ctx.args.has("--lock-only");
  // its report, when it gives one, checked here as merged checks it: what would be refused is refused before the
  // lock and before anything is pushed. None given: the subjects of the commits delivered, read once rebased
  if (deliver) reportGiven(ctx);
  const piped = deliver && ctx.args.has("--report-stdin") ? reportGiven(ctx)! : undefined;
  const reportArgs = piped !== undefined ? ["--report", piped] : ctx.args.flag("--report-file") !== undefined ? ["--report-file", path.resolve(ctx.args.flag("--report-file")!)] : ctx.args.flag("--report") !== undefined ? ["--report", ctx.args.flag("--report")!] : [];
  /** The same call, as the member runs it again once what was handed back is fixed. */
  const again = (): string => CODE_WORDING.mergeLockAgain(ctx.cli, shellWord(onto), piped !== undefined ? ["--report-stdin"] : reportArgs.map(shellWord), shellWord(p.name));
  const unmergedIn = (wt: string): string[] => (git(wt, "diff", "--name-only", "--diff-filter=U") ?? "").split("\n").filter(Boolean);
  const rebasingIn = (wt: string): boolean => ["rebase-merge", "rebase-apply"].some((dir) => {
    const at = git(wt, "rev-parse", "--git-path", dir);
    return !!at && fs.existsSync(path.resolve(wt, at));
  });
  /** The conflicted files this delivery handed back, kept in the worktree's git dir until it lands: whom merged tells (D63). */
  const handedBackFile = (wt: string): string | null => {
    const at = git(wt, "rev-parse", "--git-path", "swarm-handed-back");
    return at ? path.resolve(wt, at) : null;
  };
  const handedBack = (wt: string): string[] => {
    try {
      return JSON.parse(fs.readFileSync(handedBackFile(wt)!, "utf8")) as string[];
    } catch {
      return [];
    }
  };
  const handBack = (wt: string, files: string[]): void => {
    const at = handedBackFile(wt);
    if (at) fs.writeFileSync(at, JSON.stringify([...new Set([...handedBack(wt), ...files])]));
  };
  /** The line of a conflict handed back: nothing merged, no lock held, the files open in the member's worktree. */
  const conflictHandedBack = (wt: string, files: string[], granted: boolean): void => {
    handBack(wt, files);
    ctx.exitCode = EXIT.conflict;
    const line = CODE_WORDING.autoConflict(onto, files, again());
    ctx.emit({ member: p.name, granted, merged: false, conflicts: files, next: line }, line);
  };
  // a rebase handed back on a conflict and still open in the worktree: the member edited the files, nothing else.
  // Here they are staged and the rebase goes on, before the lock, which a conflict never holds; a file that still
  // carries a conflict marker is refused again
  if (deliver && p.place && rebasingIn(p.place)) {
    const wt = p.place;
    const open = unmergedIn(wt);
    const marked = open.filter((f) => {
      try {
        return /^(<<<<<<<|>>>>>>>)( |$)/m.test(fs.readFileSync(path.join(wt, f), "utf8"));
      } catch {
        return false; // a file the member removed: its removal is the resolution
      }
    });
    if (marked.length) {
      ctx.exitCode = EXIT.conflict;
      const line = CODE_WORDING.autoStillConflicted(marked, again());
      ctx.emit({ member: p.name, granted: false, merged: false, conflicts: marked, next: line }, line);
      return;
    }
    if (open.length) hiddenSpawnSync("git", ["add", "-A", "--end-of-options", ...open], { cwd: wt, encoding: "utf8" });
    const on = hiddenSpawnSync("git", ["-c", "core.editor=true", "rebase", "--continue"], { cwd: wt, encoding: "utf8" });
    if (on.status !== 0) {
      const next = unmergedIn(wt);
      // the next of its commits conflicts too: handed back the same way
      if (next.length) {
        conflictHandedBack(wt, next, false);
        return;
      }
      fail(CODE_WORDING.autoRebaseFailed(onto, `${on.stderr ?? ""}${on.stdout ?? ""}`.trim().split("\n").at(-1) ?? "git refused"));
    }
  }
  const changed = p.place ? branchChangedIn(p.place, ontoRef) : [];
  // where the worktree's HEAD reflog stands: merged replays only a rebase past it (D36)
  const reflogMark = p.place ? (headReflogLength(p.place) ?? undefined) : undefined;
  // the lock it already holds as it calls: a delivery pushed whose record never landed (it failed, or the call was
  // cut), or a lock taken alone. Read before the ask, which a holder is always granted
  const heldBefore = deliver ? ((await packVerb(ctx, p, "held-merge-lock", {})) as HeldMergeLock | null) : null;
  // what the branch changed rides on the lock: the files of its merge, read from git here, never typed by the member
  const r = (await packVerb(ctx, p, "lock-merge", { onto, reflogMark, ...(p.place ? { files: changed } : {}) })) as { granted: true; holder?: undefined } | { granted: false; holder: string };
  // the delivery, granted: the board rebases and fast-forwards, and only a clean merge passes. What does not pass is
  // handed back with the lock released: nobody waits on a member fixing its branch
  if (deliver && r.granted && p.place) {
    const wt = p.place;
    const out = (line: string, code: number, extra: Record<string, unknown> = {}) => {
      ctx.exitCode = code;
      ctx.emit({ member: p.name, granted: true, merged: false, ...extra, next: line }, line);
    };
    const freeLock = async (): Promise<void> => {
      const freed = (await packVerb(ctx, p, "release-merge-lock", {})) as { waiters: string[] } | null;
      if (freed?.waiters.length) await ctx.board.post(p, CODE_WORDING.autoFreed(freed.waiters, p.name), { kind: "msg" });
    };
    const release = async (line: string, code: number) => {
      await freeLock();
      out(line, code);
    };
    const sh = (argv: string[], opts: { shell?: boolean } = {}) =>
      hiddenSpawnSync(argv[0], argv.slice(1), { cwd: wt, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
    const rb = sh(["git", "rebase", "--end-of-options", ontoRef]);
    if (rb.status !== 0) {
      const unmerged = unmergedIn(wt);
      if (unmerged.length) {
        // the rebase stays open in the member's own worktree, stopped at the conflict: it edits the files and calls again
        await freeLock();
        conflictHandedBack(wt, unmerged, true);
        return;
      }
      if (rebasingIn(wt)) sh(["git", "rebase", "--abort"]);
      await release(CODE_WORDING.autoRebaseFailed(onto, `${rb.stderr ?? ""}${rb.stdout ?? ""}`.trim().split("\n").at(-1) ?? "git refused"), 1);
      return;
    }
    // what it delivers: its commits the target lacks; none, and there is nothing to merge
    const subjects = (git(wt, "log", "--reverse", "--format=%s", "--end-of-options", `${ontoRef}..HEAD`) ?? "").split("\n").filter(Boolean);
    // nothing left to push, yet it held the lock on files of its own as it called: an earlier call pushed them and
    // its record never landed. The record is all that is owed, and is made now, never lost to "nothing to deliver"
    const unrecorded = !subjects.length && !!heldBefore?.files?.length;
    if (!subjects.length && !unrecorded) {
      await release(CODE_WORDING.autoNothing(onto), 0);
      return;
    }
    const report = reportArgs.length ? reportArgs : ["--report", subjects.length ? `delivered: ${subjects.join("; ")}` : "delivered"];
    const ff = sh(["git", "push", ".", `HEAD:${onto}`]);
    if (ff.status !== 0) {
      await release(CODE_WORDING.autoPushFailed(onto, `${ff.stderr ?? ""}`.trim().split("\n").at(-1) ?? "git refused"), 1);
      return;
    }
    // the conflicts the member resolved to get here, on this call or the ones before it: whom merged tells (D63)
    const resolved: Conflicts = { files: handedBack(wt) };
    // the merged step, as the worker would have called it: its checks, report, notices and next line, unchanged
    const sha = git(wt, "rev-parse", "HEAD") ?? fail("merge-lock: no HEAD after the fast-forward");
    const m = hiddenSpawnSync(process.execPath, [...process.execArgv, process.argv[1], "merged", sha, ...report, "--as", p.name, ...(ctx.args.has("--json") ? ["--json"] : [])], { cwd: wt, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, [MERGE_CONFLICTS_ENV]: JSON.stringify(resolved) } });
    process.stdout.write(m.stdout ?? "");
    process.stderr.write(m.stderr ?? "");
    ctx.exitCode = m.status ?? 1;
    // recorded: the handed-back list has served. Not recorded: it is kept, with the lock, for the call that resumes
    const kept = handedBackFile(wt);
    if (m.status === 0 && kept) fs.rmSync(kept, { force: true });
    return;
  }
  // a worker whose listener lapsed hears of its undelivered messages here too, before the lock step
  const unreadAtLock = rules.unreadLine(await ctx.situation(p), "merge-lock");
  ctx.emit({ member: p.name, ...r }, () => {
    if (r.granted) console.log(CODE_WORDING.conflictsInReport);
    if (unreadAtLock) console.log(unreadAtLock);
    console.log(r.granted ? CODE_WORDING.mergeGranted(ctx.cli, shellWord(p.name)) : CODE_WORDING.mergeHeld(r.holder!, WORDING.wait(ctx.cli, shellWord(p.name), FOREGROUND_WAIT_MS)));
  });
}
