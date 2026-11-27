// The verbs of projects: declaring, listing and removing them.
import fs from "node:fs";
import path from "node:path";
import { projectForCwd } from "../../core/projects.ts";
import { docsDirFor } from "../../core/home.ts";
import { fail, type VerbContext } from "../context.ts";
import { projectSlugUsage, verbUsage } from "../usage.ts";
import type { Verb } from "../dispatch.ts";

function listProjects({ index, emit }: VerbContext): void {
  const projects = index.allProjects();
  const docs = index.all();
  // `*` marks the project of this directory (D41), the one a verb here works in
  const here = projectForCwd(process.cwd(), projects)?.slug ?? null;
  const count = (slug: string) => docs.filter((d) => d.project === slug).length;
  emit(
    projects.map((p) => ({ ...p, documents: count(p.slug), here: p.slug === here })),
    () => {
      for (const p of projects)
        console.log(
          `${p.slug === here ? "*" : " "} ${p.slug.padEnd(14)} ${String(count(p.slug)).padStart(3)} docs  ${docsDirFor(p.slug)}${p.paths.length ? `\n    covers ${p.paths.join(", ")}` : ""}`,
        );
    },
  );
}

function addProject({ args, index, emit }: VerbContext, slug: string): void {
  const p = index.upsertProject(slug, { title: args.flag("--title"), addPaths: args.flags("--path").map((p) => path.resolve(p)) });
  fs.mkdirSync(docsDirFor(slug), { recursive: true });
  emit({ ...p, docs: docsDirFor(slug) }, `${p.slug}  ${docsDirFor(slug)}${p.paths.length ? `\n  covers ${p.paths.join(", ")}` : ""}`);
}

function removeProject({ index, emit }: VerbContext, slug: string): void {
  const r = index.removeProject(slug);
  if (!r.removed)
    fail(r.documents > 0 ? `${slug} still has ${r.documents} document${r.documents === 1 ? "" : "s"}. Move or remove them first.` : `no such project: ${slug}`);
  emit(r, `removed project ${slug}  (its directory is left on disk)`);
}

/** The `project` sub-verbs that take a slug. */
const SLUG_SUB_VERBS: Record<string, (ctx: VerbContext, slug: string) => void> = { add: addProject, rm: removeProject };

function runProject(ctx: VerbContext): void {
  const sub = ctx.args.positional[0] ?? "list";
  if (sub === "list") return listProjects(ctx);
  const slug = ctx.args.positional[1] || fail(projectSlugUsage(sub));
  const subVerb = Object.hasOwn(SLUG_SUB_VERBS, sub) ? SLUG_SUB_VERBS[sub] : fail(verbUsage("project"));
  subVerb(ctx, slug);
}

/** board-split D41: no global active project; a verb takes its project from its directory or --project. */
function runUse(): never {
  return fail("aiview use is gone: each verb takes its project from this directory or --project <slug>, and each tab keeps its own");
}

export const PROJECT_VERBS: Verb[] = [
  { name: "project", help: "listed", needs: { index: true }, mutatesIndex: true, run: runProject },
  { name: "use", help: "hidden", run: runUse },
];
