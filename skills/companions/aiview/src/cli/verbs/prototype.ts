// The verbs of a prototype's bindings: what it offers and pulls, whether they resolve, and
// pointing the person's viewer at its components.
import fs from "node:fs";
import path from "node:path";
import { listComponents, resolveBindings } from "../../core/bind.ts";
import { isHtml, readDoc } from "../../core/paths.ts";
import { pointerHash, isName, unknownNames } from "../../core/pointer.ts";
import type { ShowResponse } from "../../core/api.ts";
import type { ParsedArgs } from "../args.ts";
import { agentProject, fail, resolveRef, type VerbContext } from "../context.ts";
import { askServer, askServerToMove, ensureDist, movedLine, portOfInstalledServer } from "../server.ts";
import { verbUsage, type ListedVerb } from "../usage.ts";
import type { Verb } from "../dispatch.ts";

/** An html prototype by registered ref or by path, for the binding verbs. */
function prototypeArg(args: ParsedArgs, verb: ListedVerb): string {
  const ref = args.positional[0] || fail(verbUsage(verb));
  const abs = resolveRef(ref)?.abs_path ?? path.resolve(ref);
  if (!fs.existsSync(abs)) fail(`no such file: ${abs}`);
  if (!isHtml(abs)) fail(`not an html prototype: ${abs}`);
  return abs;
}

/** A prototype composed the way the server composes it: `data-bind` placeholders replaced
 *  from sibling files of the same folder, bare names only. */
function composed(abs: string): ReturnType<typeof resolveBindings> {
  const dir = path.dirname(abs);
  const reader = (name: string): string | undefined => {
    if (/[\\/]/.test(name) || name.includes("..")) return undefined;
    const f = path.join(dir, name);
    return fs.existsSync(f) && fs.statSync(f).isFile() ? readDoc(f) : undefined;
  };
  return resolveBindings(readDoc(abs), reader);
}

/** What the person sees on a prototype's page and can be pointed at: every component name
 *  once composed, the bound ones and what they hold included, and the variants declared.
 *  `components` prints it and `show` holds names to it, so the two never disagree. */
function pageVocabulary(abs: string): { page: string[]; variants: string[] } {
  const raw = readDoc(abs);
  const html = composed(abs).html;
  const names = [...listComponents(html).offers, ...listComponents(raw).pulls].map((c) => c.name).filter(Boolean);
  return {
    page: [...new Set(names)],
    variants: [...new Set([...html.matchAll(/data-aiview-variant="([^"]+)"/g)].map((m) => m[1]))],
  };
}

/** What a prototype offers to its siblings and what it pulls from them, so an agent never
 *  greps a 90 KB file for data-component before writing a placeholder. */
function runComponents({ args, emit }: VerbContext): void {
  const abs = prototypeArg(args, "components");
  const r = listComponents(readDoc(abs));
  const vocabulary = pageVocabulary(abs);
  emit({ file: path.basename(abs), ...r, ...vocabulary }, () => {
    if (!r.offers.length) console.log("offers   nothing: no data-component in this file");
    for (const o of r.offers)
      console.log(
        `offers   ${o.name}  <${o.tag}>${o.within ? `  within ${o.within}` : ""}${o.warnings.length ? `  !! ${o.warnings.join(", ")}` : ""}`,
      );
    for (const x of r.pulls) console.log(`pulls    ${x.name || x.ref}  from ${x.file || "(invalid ref)"}`);
    if (!r.pulls.length) console.log("pulls    nothing: no data-bind in this file");
    console.log(`page     ${vocabulary.page.join(", ") || "no component"}`);
    console.log(`variants ${vocabulary.variants.join(", ") || "none declared"}`);
  });
}

/** Resolve a host the way the server does and say what went wrong, as text. Exit 1 on errors. */
function runCheck({ args, emit }: VerbContext): number {
  const abs = prototypeArg(args, "check");
  const r = composed(abs);
  emit({ file: path.basename(abs), bound: r.bound, sources: r.sources, errors: r.errors, warnings: r.warnings }, () => {
    console.log(`${r.bound} bound from ${r.sources.length} source${r.sources.length === 1 ? "" : "s"}${r.sources.length ? `: ${r.sources.join(", ")}` : ""}`);
    for (const e of r.errors) console.log(`error    ${e.ref}: ${e.message}`);
    for (const w of r.warnings) console.log(`warning  ${w.ref}: ${w.message}`);
    if (!r.errors.length && !r.warnings.length) console.log("ok");
  });
  return r.errors.length ? 1 : 0;
}

/** The pointing is over. The tabs remember where they were; the agent only says so. */
function showDone({ emit }: VerbContext): void {
  const answer = askServer("/api/show-done", {});
  const tabs = answer === null ? 0 : (JSON.parse(answer) as ShowResponse).tabs;
  emit({ done: true, tabs }, tabs ? `${tabs} open tab${tabs > 1 ? "s" : ""} sent back to what the person was reading` : "no tab is open: nothing to send back");
}

/** Why these names cannot be pointed at on this page, or undefined when they all can. */
function wrongName(abs: string, components: string[], variant: string | undefined): string | undefined {
  if ([...components, ...(variant ? [variant] : [])].some((n) => !isName(n))) return "a name holds letters, digits, dot, dash and underscore only";
  const { page: known, variants } = pageVocabulary(abs);
  return unknownNames(components, known, "component") ?? (variant ? unknownNames([variant], variants, "variant") : undefined);
}

/** Point the person's viewer at components of a prototype, before asking them about it.
 *  The names are held to the page as the person sees it, bound components included, so
 *  a region named in the agent's own words stops here. The link is the pointer: it is
 *  printed whether or not a tab heard the broadcast. */
function runShow(ctx: VerbContext): void {
  const { args, emit } = ctx;
  if (args.has("--done")) return showDone(ctx);
  const abs = prototypeArg(args, "show");
  const doc = resolveRef(args.positional[0]) ?? fail(`not registered: ${abs}. Register and serve it with: aiview open <file>`);
  const components = args.flags("--component");
  const variant = args.flag("--variant");
  const wrong = wrongName(abs, components, variant);
  if (wrong) fail(wrong);

  ensureDist();
  const port = portOfInstalledServer(args.flag("--port"));
  const pointer = { id: doc.id, components, ...(variant ? { variant } : {}) };
  const url = `http://localhost:${port}/#${pointerHash(pointer)}`;
  const project = agentProject(doc.project);
  const moved = askServerToMove("/api/show", { ...pointer, project });
  emit({ id: doc.id, url, components, variant: variant ?? null, project, tabs: moved?.tabs ?? 0, opened: moved?.opened ?? false, browserRefusal: moved?.browserRefusal ?? null }, () => {
    console.log(url);
    console.log(moved ? movedLine(moved, project, "shown") : "no aiview server answered: give the person the link");
  });
}

export const PROTOTYPE_VERBS: Verb[] = [
  { name: "components", help: "listed", run: runComponents },
  { name: "check", help: "listed", run: runCheck },
  { name: "show", help: "listed", run: runShow },
];
