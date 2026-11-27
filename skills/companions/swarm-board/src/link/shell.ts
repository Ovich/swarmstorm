// What a shell command a member ran says to the board (codebase-rework#D15): whether it runs the binding verb, the
// board's own wait or link, a listener, or a kill not by PID. Two tokenizers, kept apart on purpose: the binding and
// verb matcher reads words as a shell would (quotes removed, `\` escaping in a POSIX shell), the kill classifier
// reads command segments (quoted code inside `-Command "…"` scanned too).
import type { RunId } from "../contract/board.ts";
import type { MemberActivity } from "../contract/wire.ts";

/** The verb a member's CLI ran that the link stands for: a member's `join`, an orchestrator's `open`. */
export type Binding = { verb: "join"; run: RunId; seat: string } | { verb: "open"; group: string };

/** What one shell command does, as the board reads it. A board call `--as` another member does none of the first three. */
export type CommandFacts = {
  /** it runs the board's `wait` verb: the one call that is waiting (swarm-relay D45) */
  boardWait: boolean;
  /** it runs the board's `wait` or `link`: never a member's background task (idea 1, §2) */
  boardsOwn: boolean;
  /** it runs `wait --mentions`: a listener when run in the background (D4) */
  listener: boolean;
  /** how it kills, when not by PID (idea 4) */
  kill: { kind: NonNullable<MemberActivity["breach"]>["kind"]; ports?: number[] } | null;
};

/** The facts of `command`, run by the shell tool named `tool`, for the member `binding` stands for. */
export function commandFacts(command: string, tool: string | undefined, binding?: Binding): CommandFacts {
  const escapes = toolEscapesBackslash(tool);
  const other = binding !== undefined && actsAsOther(command, binding, escapes);
  const waits = !other && runsVerb(command, "wait", escapes);
  return {
    boardWait: waits,
    boardsOwn: !other && (waits || runsVerb(command, "link", escapes)),
    listener: waits && /\s--mentions(?!\S)/.test(command),
    kill: classifyKill(command),
  };
}

/** Whether `command`, run by the shell tool named `tool`, runs the binding verb, matched word by word, flags in any order. */
export function runsBinding(command: string, binding: Binding, tool?: string): boolean {
  const words = shellWords(command, toolEscapesBackslash(tool));
  let start = 0;
  for (let i = 0; i <= words.length; i++) {
    if (i < words.length && !SEPARATORS.has(words[i])) continue;
    const segment = words.slice(start, i);
    start = i + 1;
    const at = segment.indexOf(binding.verb);
    if (at < 1 || !isSwarmTool(segment[at - 1])) continue;
    const args = segment.slice(at + 1);
    if (binding.verb === "join") {
      if (optionValue(args, ["--run"]) === String(binding.run) && optionValue(args, ["--seat"]) === binding.seat) return true;
    } else if (optionValue(args, ["--group", "--plan"]) === binding.group) return true;
  }
  return false;
}

// ── words: the binding and verb matcher's tokenizer ──

const SEPARATORS = new Set([";", "&&", "||", "|", "&", "\n"]);

/** A shell command split into words and separators, quotes removed; `;`, `&&`, `|` split even when glued to a word (§7 E8).
 * `backslashEscapes`: in a POSIX shell `\` escapes the next character; in any other (PowerShell, cmd) it is a path character. */
function shellWords(command: string, backslashEscapes: boolean): string[] {
  const words: string[] = [];
  let word = "";
  let inWord = false;
  const flush = () => {
    if (inWord) words.push(word);
    word = "";
    inWord = false;
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === "'" || c === '"') {
      const close = command.indexOf(c, i + 1);
      const end = close < 0 ? command.length : close;
      word += command.slice(i + 1, end);
      inWord = true;
      i = end;
    } else if (backslashEscapes && c === "\\" && i + 1 < command.length && command[i + 1] !== "\n") {
      word += command[++i];
      inWord = true;
    } else if (c === ";" || c === "\n" || c === "|" || c === "&") {
      flush();
      const two = command.slice(i, i + 2);
      if (two === "&&" || two === "||") {
        words.push(two);
        i++;
      } else words.push(c);
    } else if (/\s/.test(c)) flush();
    else {
      word += c;
      inWord = true;
    }
  }
  flush();
  return words;
}

/** A word that invokes the swarm tool: `swarm`, `…/swarm.mjs`, or a variable holding it (`$S`). */
const isSwarmTool = (word: string): boolean => /(^|[\\/])swarm(\.mjs)?$/i.test(word) || /^\$\{?\w+\}?$/.test(word);

/** The value of `--name v` or `--name=v` among a command's words. */
function optionValue(words: string[], names: string[]): string | undefined {
  for (let i = 0; i < words.length; i++) {
    for (const n of names) {
      if (words[i] === n && i + 1 < words.length) return words[i + 1];
      if (words[i].startsWith(n + "=")) return words[i].slice(n.length + 1);
    }
  }
  return undefined;
}

/** Whether a shell tool of this name treats `\` as an escape: only Bash; PowerShell and the rest keep it as a path character. */
const toolEscapesBackslash = (toolName: string | undefined): boolean => toolName === undefined || toolName === "Bash";

/** Whether this command text runs one swarm verb, the word right after the tool's. */
function runsVerb(command: string, verb: string, backslashEscapes: boolean): boolean {
  const words = shellWords(command, backslashEscapes);
  return words.some((w, i) => w === verb && i > 0 && isSwarmTool(words[i - 1]));
}

/** Whether a board call names another member with `--as` than the one this binding stands for (S27, board-split D25):
 *  a session driving a second seat's waits is working for this one, never waiting. No `--as`: its own. */
function actsAsOther(command: string, binding: Binding, backslashEscapes: boolean): boolean {
  const as = optionValue(shellWords(command, backslashEscapes), ["--as"]);
  if (as === undefined) return false;
  const slash = as.lastIndexOf("/");
  const group = slash < 0 ? null : as.slice(0, slash);
  const seat = as.slice(slash + 1);
  return binding.verb === "join" ? seat !== binding.seat : seat !== "orchestrator" || (group !== null && group !== binding.group);
}

// ── kills (idea 4): the patterns are data, Claude Code's shells' words; a kill by PID is never a breach ──

/** The verbs that stop a process, at the head of a command segment. */
const KILL_HEADS = new Set(["taskkill", "kill", "pkill", "killall", "stop-process", "spps", "wmic", "invoke-cimmethod", "fuser"]);
/** Words before the real head that only wrap it: `sudo kill`, `xargs kill`, `cmd /c taskkill`, `% { Stop-Process … }`. */
const WRAPPER = /^(sudo|xargs|cmd(\.exe)?|\/c|start|call|exec|nohup|foreach-object|%|do|then|-\S+|\d+)$/i;
/** A process list filtered by name or command line feeding the kill: the kill is by pattern. */
const PATTERN_FEED = /\b(Get-Process|gps|Get-CimInstance|Get-WmiObject|gwmi|tasklist|pgrep|wmic)\b|(^|[\s|;&(])ps(\s|$)/i;
/** A port lookup feeding the kill: the kill is by port. */
const PORT_FEED = /\b(Get-NetTCPConnection|netstat|lsof|fuser)\b|(^|[\s|;&(])ss\s/i;
/** A segment that is code inside quotes: `powershell -Command "…"`, `bash -c '…'`. */
const RUNS_QUOTED = /(?:-command|-c|(?:^|\s)(?:powershell|pwsh|bash|sh|cmd)(?:\.exe)?(?:\s+-\S+)*)\s*$/i;

/** The command segments of a shell line, each as it would run: split on separators and subshells, with the code
 *  inside a `-Command "…"` scanned too and any other quoted text kept as a literal, never a segment's head. */
function commandSegments(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  const flush = () => {
    if (cur.trim()) out.push(cur.trim());
    cur = "";
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const close = text.indexOf(c, i + 1);
      const end = close < 0 ? text.length : close;
      const inner = text.slice(i + 1, end);
      if (RUNS_QUOTED.test(cur)) {
        flush();
        out.push(...commandSegments(inner));
      } else cur += ` "${inner.replace(/\s+/g, " ")}" `;
      i = end;
    } else if (";|&\n(){}`".includes(c) || (c === "$" && text[i + 1] === "(")) flush();
    else cur += c;
  }
  flush();
  return out;
}

/** A segment's head word, its wrappers stripped and its path and `.exe` dropped, lower case. */
function headOf(segment: string): { head: string; rest: string } | null {
  const words = segment.split(/\s+/).filter(Boolean);
  while (words.length > 1 && WRAPPER.test(words[0])) words.shift();
  if (!words.length) return null;
  const head = words[0].replace(/^.*[\\/]/, "").replace(/\.exe$/i, "").toLowerCase();
  return { head, rest: words.slice(1).join(" ") };
}

/** The ports a port-lookup kill names: `-LocalPort 3000,4200`, `:3000`, `-iTCP:3000`, `3000/tcp`. */
function portsOf(command: string): number[] {
  const found = new Set<number>();
  for (const m of command.matchAll(/-LocalPort\s+([\d,\s]+)/gi)) for (const n of m[1].split(/[,\s]+/)) if (n) found.add(Number(n));
  for (const m of command.matchAll(/(?::|-iTCP:)(\d{2,5})\b|\b(\d{2,5})\/tcp\b/gi)) found.add(Number(m[1] ?? m[2]));
  return [...found].filter((n) => n > 0 && n < 65536).sort((a, b) => a - b);
}

/** How one kill head kills, given how the segments before it killed: by name, fed a list, or as before. */
type KillWay = "name" | "fed" | null;
const KILL_WAYS: Record<string, (rest: string, before: KillWay) => KillWay> = {
  pkill: () => "name",
  killall: () => "name",
  taskkill: (rest, before) => (/\/IM\b/i.test(rest) ? "name" : /\/PID\s+\d+(\s|$)/i.test(rest) && !/[$%]/.test(rest) ? before : "fed"),
  "stop-process": (rest, before) => (/-Name\b|-ProcessName\b/i.test(rest) ? "name" : /-Id\s+[\d,\s]+$/i.test(rest) ? before : "fed"),
  kill: (rest, before) => (rest.split(/\s+/).every((w) => /^(-\d+|-[A-Z]+|-s|\d+)$/.test(w)) ? before : "fed"),
  wmic: (rest, before) => (/\b(delete|terminate)\b/i.test(rest) ? "name" : before),
  "invoke-cimmethod": (rest, before) => (/terminate/i.test(rest) ? "fed" : before),
  fuser: (rest, before) => (/(^|\s)-k\b/.test(rest) ? "fed" : before),
};
KILL_WAYS.spps = KILL_WAYS["stop-process"];

/** How a shell command kills, when it does: by name or pattern, by a port lookup, or null (by PID, or no kill).
 *  A call of the swarm tool itself (a post quoting a kill) is never one. */
function classifyKill(command: string): CommandFacts["kill"] {
  if (/(^|[\s\\/"'])swarm(\.mjs)?(["'\s]|$)/i.test(command)) return null;
  let kill: KillWay = null;
  for (const segment of commandSegments(command)) {
    const h = headOf(segment);
    if (!h || !KILL_HEADS.has(h.head)) continue;
    kill = KILL_WAYS[h.head](h.rest, kill);
    if (kill === "name") break;
  }
  if (kill === "name") return { kind: "pattern" };
  if (kill !== "fed") return null;
  if (PATTERN_FEED.test(command)) return { kind: "pattern" };
  if (PORT_FEED.test(command)) return { kind: "port", ports: portsOf(command) };
  return null; // a PID from a variable the line does not show how it found: read as by PID
}
