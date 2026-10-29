// Centralized flag parsing — one place knows which flags take values.
const VALUE_FLAGS = new Set([
  "--plan",
  "--title",
  "--run",
  "--area",
  "--state",
  "--doing",
  "--file",
  "--as",
  "--about",
  "--with",
  "--timeout",
  "--repo",
  "--port",
  "--onto",
  "--kind",
  "--group",
  "--seats",
  "--seat",
  "--on",
  "--blockers",
  "--role",
  "--link",
  "--since",
  "--watch",
  "--person",
  "--note",
  "--busy-max",
  "--report",
  "--report-file",
  "--unlocked",
]);
/** Flags taking every value up to the next flag: `--files a b c`, or `--files "a,b,c"`. */
const LIST_FLAGS = new Set(["--files"]);

export interface ParsedArgs {
  verb: string | undefined;
  rest: string[];
  positional: string[];
  flag(name: string): string | undefined;
  flags(name: string): string[];
  /** A list flag's values, comma-separated values split. */
  list(name: string): string[];
  has(name: string): boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const [verb, ...rest] = argv;
  const listed = new Set<number>();
  let inList = false;
  rest.forEach((a, i) => {
    if (a.startsWith("--")) inList = LIST_FLAGS.has(a);
    else if (inList) listed.add(i);
  });
  return {
    verb,
    rest,
    positional: rest.filter((a, i) => !a.startsWith("--") && !VALUE_FLAGS.has(rest[i - 1] ?? "") && !listed.has(i)),
    flag: (name) => {
      const i = rest.indexOf(name);
      return i >= 0 ? rest[i + 1] : undefined;
    },
    flags: (name) => rest.flatMap((a, i) => (a === name && rest[i + 1] ? [rest[i + 1]] : [])),
    list: (name) => {
      const out: string[] = [];
      let on = false;
      for (const a of rest) {
        if (a.startsWith("--")) on = a === name;
        else if (on) out.push(...a.split(",").map((x) => x.trim()).filter(Boolean));
      }
      return out;
    },
    has: (name) => rest.includes(name),
  };
}
