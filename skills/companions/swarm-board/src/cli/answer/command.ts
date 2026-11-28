// A command as the answer module prints it (product-shape#D20): its type, how one word of it is quoted, and the note
// every foreground wait carries. The leaf of the answer module: wording.ts and each feature's wording build on it.
import { FOREGROUND_WAIT_MS } from "../../contract/events.ts";
export const FOREGROUND_NOTE = `it holds ${FOREGROUND_WAIT_MS / 1000} s, as Claude Code detaches a foreground command that runs past 180 s; run it again when it returns empty`;

/** A command as printed: the words joined, ready to copy. */
export type Command = string;

/** A verb's entry in VERB_USAGE (usage.ts): its help lines, and the corrected form an argument error offers to copy,
 *  `as` the caller's --as. */
export type VerbUsage = { lines: (cli: Command) => readonly string[]; example?: (as: string) => string };

/** A POSIX shell word, double-quoted when it holds anything else than plain characters: a command runs as printed. */
export const shellWord = (w: string): string => (/^[\w@%+=:,./-]+$/.test(w) ? w : `"${w.replace(/(["\\$`])/g, "\\$1")}"`);
