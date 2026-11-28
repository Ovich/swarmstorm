// What every verb is handed: its arguments, how it answers, how it refuses, and the
// index lookups more than one verb makes.
import path from "node:path";
import { openIndex, type Document, type Index, type RegisterOptions } from "../core/db.ts";
import { projectForCwd } from "../core/projects.ts";
import type { ParsedArgs } from "./args.ts";

/** A refusal: its message is printed as is, and the verb exits 1. */
export class Refusal extends Error {}

/** Refuse: the message goes to stderr as is, the verb exits 1, nothing is notified. */
export function fail(message: string): never {
  throw new Refusal(message);
}

export interface VerbContext {
  args: ParsedArgs;
  asJson: boolean;
  /** The index of a verb that `needs` one, opened on this first call, after the verb's own
   *  refusals, so a refused verb leaves the data home as it found it; the dispatcher closes it. */
  index(): Index;
  /** One answer: the JSON under `--json`, else the human text, or a printer of it. */
  emit(json: unknown, human: string | (() => void)): void;
  /** The flags `open`, `add` and `serve` register a document with. */
  registerOpts(): RegisterOptions;
}

export function contextFor(args: ParsedArgs, index: (() => Index) | undefined, verb: string): VerbContext {
  const asJson = args.has("--json");
  return {
    args,
    asJson,
    index: () => {
      if (!index) throw new Error(`verb ${verb} declares no need of the index`);
      return index();
    },
    emit: (json, human) => {
      if (asJson) console.log(JSON.stringify(json));
      else if (typeof human === "string") console.log(human);
      else human();
    },
    registerOpts: () => ({
      kind: args.flag("--kind") ?? "",
      tags: args.flags("--tag"),
      started: args.flag("--started") ?? "",
      group: args.flag("--group") ?? "",
      groupTitle: args.flag("--group-title") ?? "",
      project: args.flag("--project") ?? "",
    }),
  };
}

/** Open an index for `use` alone, closed whatever it does. */
export function withIndex<T>(use: (index: Index) => T): T {
  const index = openIndex();
  try {
    return use(index);
  } finally {
    index.close();
  }
}

/** A registered document by `#id`, a bare id, or its path. */
export const resolveRef = (ref: string): Document | undefined => withIndex((index) => rowOf(index, ref));

/** The same lookup, in an index the caller holds. */
export const rowOf = (index: Index, ref: string): Document | undefined =>
  /^#?\d+$/.test(ref) ? index.get(Number(ref.replace("#", ""))) : index.getByPath(path.resolve(ref));

/** The project a verb works in (D41): `--project`, else the one claiming this directory; null when neither. */
export const projectOfVerb = (args: ParsedArgs, index: Index): string | null =>
  args.flag("--project") ?? projectForCwd(process.cwd(), index.allProjects())?.slug ?? null;

/** The project the agent works in (board-split#D41): the one claiming the CLI's working directory, else `fallback`
 *  (the document's own). Its tabs are the only ones the agent's open or pointer moves. */
export const agentProject = (fallback: string): string =>
  withIndex((index) => projectForCwd(process.cwd(), index.allProjects())?.slug ?? fallback);

/** The refusal of a verb with no project: where to take one from. */
export function noProjectLine(known: string[]): string {
  return `no aiview project for ${process.cwd()}: pass --project <slug>, or declare one with aiview project add <slug> --path <dir>${known.length ? `\nknown: ${known.join(", ")}` : ""}`;
}

/** `no such project`, with the known ones listed. */
export const noSuchProjectLine = (slug: string, known: string[]): string =>
  `no such project: ${slug}${known.length ? `\nknown: ${known.join(", ")}` : ""}`;
