// Every verb of the swarm CLI, in help order (codebase-rework#D11): what it needs before it runs, never its text,
// which is VERB_USAGE's under the same names (D12).
import type { Verb } from "../dispatch.ts";
import { closeVerb } from "./run/close.ts";
import { doingVerb } from "./members/doing.ts";
import { doneVerb } from "./phases/done.ts";
import { endVerb } from "./members/end.ts";
import { endorseVerb } from "./conversation/endorse.ts";
import { joinVerb } from "./members/join.ts";
import { linkVerb } from "./members/link.ts";
import { logLevelVerb } from "./log-level.ts";
import { mergeLockVerb } from "./code/merge-lock.ts";
import { mergedVerb } from "./code/merged.ts";
import { openVerb } from "./run/open.ts";
import { pauseVerb } from "./run/pause.ts";
import { phaseVerb } from "./phases/phase.ts";
import { phasesVerb } from "./phases/phases.ts";
import { postVerb } from "./conversation/post.ts";
import { readVerb } from "./conversation/read.ts";
import { rosterVerb } from "./members/roster.ts";
import { seatVerb } from "./run/seat.ts";
import { serveVerb } from "./serve.ts";
import { statusVerb } from "./run/status.ts";
import { threadVerb } from "./conversation/thread.ts";
import { waitVerb } from "./conversation/wait.ts";
import { worktreeVerb } from "./code/worktree.ts";

export const VERBS: readonly Verb[] = [
  { names: ["open"], server: "board", help: "core", who: "anyone", run: openVerb },
  { names: ["seat"], server: "board", help: "core", who: "anyone", run: seatVerb },
  { names: ["phase"], server: "board", help: "core", who: "caller", run: phaseVerb },
  { names: ["pause", "resume"], server: "board", help: "core", who: "caller", run: pauseVerb },
  { names: ["done"], server: "board", help: "core", who: "member", run: doneVerb },
  // its refusal of the orchestrators board comes before the orchestrator check, so it is the handler's
  { names: ["close"], server: "board", help: "core", who: "anyone", run: closeVerb },
  { names: ["join"], server: "board", help: "core", who: "anyone", run: joinVerb },
  { names: ["doing"], server: "board", help: "core", who: "member", refusedPaused: true, run: doingVerb },
  { names: ["post", "agree"], server: "board", help: "core", who: "member", run: postVerb },
  { names: ["endorse"], server: "board", help: "core", who: "member", run: endorseVerb },
  { names: ["wait"], server: "board", help: "core", who: "listener", run: waitVerb },
  { names: ["roster"], server: "board", help: "core", who: "member-if-as", run: rosterVerb },
  { names: ["phases"], server: "board", help: "core", who: "anyone", run: phasesVerb },
  { names: ["thread"], server: "board", help: "core", who: "anyone", run: threadVerb },
  { names: ["read"], server: "board", help: "core", who: "anyone", run: readVerb },
  { names: ["end"], server: "board", help: "core", who: "caller", run: endVerb },
  { names: ["log-level"], server: "none", help: "core", who: "anyone", run: logLevelVerb },
  { names: ["status"], server: "board", help: "core", who: "anyone", run: statusVerb },
  { names: ["worktree"], server: "board", help: "core", who: "anyone", run: worktreeVerb },
  { names: ["merge-lock"], server: "board", help: "code", who: "member", refusedPaused: true, run: mergeLockVerb },
  { names: ["merged"], server: "board", help: "code", who: "member", run: mergedVerb },
  { names: ["serve"], server: "self", help: "hidden", who: "anyone", run: serveVerb },
  { names: ["link"], server: "self", help: "hidden", who: "anyone", run: linkVerb },
];
