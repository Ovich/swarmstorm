// aiview's usage, one record (codebase-rework#D20): the top-level usage and every verb's
// refusal render from it, so the two never drift apart again.

/** Each listed verb, in the order the top-level usage shows it: its lines there, and its
 *  refusal when that says more than its first line's synopsis. */
export const VERB_USAGE = {
  open: { lines: ["open <file> [--kind k] [--tag t]... [--group g [--group-title T]] [--started ISO] [--port p] [--open]"] },
  add: { lines: ["add <file> [--kind k] [--tag t]... [--group g [--group-title T]] [--started ISO]"] },
  update: { lines: ["update <file|#id> [--kind k] [--tag t]... [--untag t]... [--group g|--ungroup] [--group-title T] [--started ISO]"] },
  list: { lines: ["list [--kind k] [--tag t]... [--project p]   # the project of this directory, else --project"] },
  project: { lines: ["project <add|list|rm> [slug] [--title T] [--path P]..."] },
  remove: { lines: ["remove <file|#id>..."] },
  move: { lines: ["move <file|#id>... [--project <slug>]    # refile: file + index together"] },
  serve: { lines: ["serve [file] [--port <n>, default 4321, another data home its own] [--open] [--detach]"] },
  pending: {
    lines: [
      "pending add <file|#id> --label L [--note N]   # work the reader is waiting on",
      "pending done <#pendingId>                     # the work landed; the card goes away",
      "pending list [<file|#id>] | clear <file|#id>",
    ],
    refusal: "pending <add|done|list|clear> ...",
  },
  status: { lines: ["status"] },
  path: {
    lines: ["path <filename> [--project <slug>]       # where this document belongs, joined for this OS"],
    refusal: "path <filename> [--project <slug>] | aiview path #<id>",
  },
  components: { lines: ["components <file|#id>                    # what this prototype offers to siblings, what it pulls, every name on its page and its variants"] },
  check: { lines: ["check <file|#id>                         # do this prototype's bindings resolve? errors as text, exit 1 if any"] },
  show: {
    lines: [
      "show <file|#id> [--component Name]... [--variant v]   # point the person's viewer at these components of a prototype; prints the link",
      "show --done                              # the question is answered: every tab goes back to what the person was reading",
    ],
    refusal: "show <file|#id> [--component Name]... [--variant v]  |  aiview show --done",
  },
  tracker: {
    lines: [
      "tracker check <file|#id>                 # a plan's tracker judged against itself; exit 1 if anything disagrees",
      "tracker sync <file|#id>                  # rewrite the class lines from the glyphs, the one place a step's state is written twice",
    ],
    refusal: "tracker <check|sync> <file|#id>",
  },
  plan: { lines: ["plan check <file|#id>                    # a plan's approval against its decisions: warns on agent defaults never confirmed; always exit 0"] },
  board: { lines: ["board [--project <name>] [--open]   # the project's board page: its repositories; prints the link"] },
  init: { lines: ["init                                     # create the data home; report where everything lives"] },
} satisfies Record<string, { lines: string[]; refusal?: string }>;

export type ListedVerb = keyof typeof VERB_USAGE;

/** What `aiview` with no verb, or an unknown one, answers. */
export const TOP_USAGE = ["usage: aiview <verb> [--json]", ...Object.values(VERB_USAGE).flatMap((u) => u.lines.map((l) => `  ${l}`))].join("\n");

/** A usage line without its trailing `# comment`. */
const synopsis = (line: string): string => line.replace(/\s+# .*$/, "");

/** The refusal of a verb called without what it needs: its own, else its first line's synopsis. */
export function verbUsage(verb: ListedVerb): string {
  const usage: { lines: string[]; refusal?: string } = VERB_USAGE[verb];
  return `usage: aiview ${usage.refusal ?? synopsis(usage.lines[0])}`;
}

/** The refusal of one sub-verb, from the line of the record that starts with it. */
export function subVerbUsage(verb: ListedVerb, sub: string): string {
  const line = VERB_USAGE[verb].lines.find((l) => l.startsWith(`${verb} ${sub} `))!;
  return `usage: aiview ${synopsis(line)}`;
}

/** The refusal of a `project` sub-verb called without its slug. */
export const projectSlugUsage = (sub: string): string => `usage: aiview project ${sub} <slug>`;
