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
  "--repo", // board-split D47: the old name of --project, read as it
  "--project",
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
  "--report",
  "--report-file",
  "--unlocked",
]);
/** Flags taking every value up to the next flag: `--files a b c`, or `--files "a,b,c"`. */
// V-27: --for takes seats like --files takes paths; read as a value, never as part of the phase text
const LIST_FLAGS = new Set(["--files", "--for"]);

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
      const value = i >= 0 ? rest[i + 1] : undefined;
      // a flag followed by another flag has no value: `pause "x" --person --as g/o` (board-split F2)
      return value === undefined || value.startsWith("--") ? undefined : value;
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
