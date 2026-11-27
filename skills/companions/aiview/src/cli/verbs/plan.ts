// The verbs of a plan: its tracker judged and synced, its approval checked.
import fs from "node:fs";
import path from "node:path";
import { check as trackerCheck, findTracker, sync as trackerSync } from "../../core/tracker.ts";
import { check as planCheck, readApproval } from "../../core/plan.ts";
import { fail, resolveRef, type VerbContext } from "../context.ts";
import { verbUsage } from "../usage.ts";
import type { Verb } from "../dispatch.ts";

/** A tracker as `findTracker` reads it. */
type Tracker = NonNullable<ReturnType<typeof findTracker>>;

/** Line endings, named rather than written inline: a plan on Windows is CRLF and the
 *  tracker parser works in LF, so the file is normalised in and restored out. */
const LF = String.fromCharCode(10);
const CRLF = String.fromCharCode(13, 10);

/** A plan by registered ref or by path, that must exist. */
function planFile(ref: string): string {
  const abs = resolveRef(ref)?.abs_path ?? path.resolve(ref);
  if (!fs.existsSync(abs)) fail(`no such file: ${abs}`);
  return abs;
}

/** Read and write in one breath, and replace the file rather than truncate it: a plan is
 *  edited by whoever is running it, and a half-written tracker is worse than a stale one. */
function syncTracker({ emit }: VerbContext, abs: string, raw: string, body: string, tracker: Tracker): number {
  const crlf = raw.includes(CRLF);
  const { text, changed } = trackerSync(body, tracker);
  if (changed) {
    const tmp = `${abs}.aiview-${process.pid}`;
    fs.writeFileSync(tmp, crlf ? text.split(LF).join(CRLF) : text, "utf8");
    fs.renameSync(tmp, abs);
  }
  const after = findTracker(text);
  const left = after ? trackerCheck(after) : [];
  emit({ file: path.basename(abs), changed, findings: left.length }, () =>
    console.log(
      changed
        ? `synced ${path.basename(abs)}: the class lines now follow the glyphs${left.length ? `, ${left.length} finding(s) remain` : ""}`
        : `nothing to sync: the class lines already follow the glyphs`,
    ),
  );
  return left.length ? 1 : 0;
}

function checkTracker({ emit }: VerbContext, abs: string, tracker: Tracker): number {
  const findings = trackerCheck(tracker);
  emit({ file: path.basename(abs), nodes: tracker.nodes.length, findings }, () => {
    if (!findings.length) return console.log(`ok  ${tracker.nodes.length} steps, glyphs and classes agree`);
    for (const f of findings) console.log(`line ${f.line}  ${f.text}`);
    console.log(`${findings.length} finding(s) in ${tracker.nodes.length} steps`);
  });
  return findings.length ? 1 : 0;
}

function runTracker(ctx: VerbContext): number {
  const [first, second] = ctx.args.positional;
  const mode = first === "sync" ? "sync" : "check";
  const ref = second ?? (first === "check" || first === "sync" ? undefined : first);
  const abs = planFile(ref || fail(verbUsage("tracker")));
  const raw = fs.readFileSync(abs, "utf8");
  const body = raw.split(CRLF).join(LF);
  const tracker = findTracker(body) ?? fail(`no tracker in ${path.basename(abs)}: no mermaid block whose nodes open with ✅ ▶ ⏸ ⬜ ✖`);
  return mode === "sync" ? syncTracker(ctx, abs, raw, body, tracker) : checkTracker(ctx, abs, tracker);
}

function runPlan({ args, emit }: VerbContext): void {
  const ref = args.positional[0] === "check" ? args.positional[1] : args.positional[0];
  const abs = planFile(ref || fail(verbUsage("plan")));
  const plan = readApproval(fs.readFileSync(abs, "utf8").split(CRLF).join(LF));
  const findings = planCheck(plan);
  emit(
    {
      file: path.basename(abs),
      approved: plan.approved,
      decisions: plan.decisions.length,
      defaults: plan.defaults.map((d) => ({ id: d.id, kind: d.kind, line: d.line })),
      confirmed: plan.confirmed ?? null,
      findings,
      walkthrough: plan.walkthrough.map((w) => ({ id: w.id, unit: w.unit, decisions: w.decisions, answer: w.answer, line: w.line })),
    },
    () => {
      for (const f of findings) console.log(`warn  line ${f.line}  ${f.text}`);
      const walked = plan.walkthrough;
      if (walked.length) {
        const ids = (answer: string) => walked.filter((w) => w.answer === answer).map((w) => w.id);
        const open = (["need more", "disagree", "not walked"] as const)
          .map((answer) => ({ answer, ids: ids(answer) }))
          .filter((g) => g.ids.length)
          .map((g) => `; ${g.answer}: ${g.ids.join(", ")}`)
          .join("");
        console.log(`info  walkthrough: ${ids("understood").length} of ${walked.length} units understood${open}`);
      }
      const state = plan.approved ? "approved" : "not approved";
      const tail = !plan.defaults.length
        ? "no agent defaults"
        : plan.approved
          ? `${plan.defaults.length} agent default(s), ${findings.length ? "not all confirmed" : "all confirmed"}`
          : `${plan.defaults.length} agent default(s) to list at approval: ${plan.defaults.map((d) => d.id).join(", ")}`;
      console.log(`${findings.length ? "warn" : "ok"}  ${state}, ${plan.decisions.length} decisions, ${tail}`);
    },
  );
}

export const PLAN_VERBS: Verb[] = [
  { name: "tracker", help: "listed", run: runTracker },
  { name: "plan", help: "listed", run: runPlan },
];
