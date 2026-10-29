// Finding and reading a member's transcript (swarm-relay#D8, #D10): the link finds, in its caller's
// session, the harness transcript whose Bash tool call ran the binding verb, then reads from it, a
// growing file at a time, what the board needs to tell the member's state. The token sum stays
// liveness.ts's adapter: one owner. Adding a harness is one entry in LOCATORS.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RunId } from "../board/board.ts";
import { claudeCodeJsonl } from "../board/liveness.ts";
import type { MemberActivity } from "../wire.ts";

/** The verb a member's CLI ran that the link stands for: a member's `join`, an orchestrator's `open`. */
export type Binding = { verb: "join"; run: RunId; seat: string } | { verb: "open"; group: string };

/** Where a read of a transcript stopped, and what the lines before it said. */
export type TranscriptCursor = {
  offset: number;
  tokens: number;
  open: Map<string, { name: string; target: string; since: number; boardWait?: boolean; shell?: boolean }>;
  lastTool: string | null;
  context: number | null;
  grewAt: number | null;
  /** the last assistant text (50 chars), or "<tool> <target>" */
  lastLine: string | null;
  /** the last user/assistant line was not an assistant line ending the turn */
  inTurn: boolean;
  /** how many turns have ended so far: a background task belongs to the turn it opened in */
  endedTurns: number;
  /** background tasks not yet notified, by tool_use id; the board's own wait and link never enter */
  background: Map<string, BackgroundTask>;
  /** open calls running the board's own `wait` or `link`, by tool_use id: never a background task, whichever way they go there */
  boardsOwn: Set<string>;
  /** the last kill seen that was not by PID (idea 4) */
  breach: NonNullable<MemberActivity["breach"]> | null;
  /** background `wait --mentions` calls not yet notified, by tool_use id: the member's listeners (D4) */
  listeners: Set<string>;
  /** when the last listener's notification came */
  listenerEndedAt: number | null;
};

/** A background task the agent started: its output file, once the harness named it, and the turn it opened in. */
type BackgroundTask = { target: string; since: number; turn: number; output: string | null };

export interface HarnessLocator {
  name: string;
  /** The transcript holding the tool call that ran this binding verb, newest first, a finished one skipped; null when not (yet) found. */
  locate(binding: Binding, env: NodeJS.ProcessEnv): string | null;
  /** The harness's own word that the agent ended; null when it keeps none. */
  finished(transcript: string): boolean | null;
}

const TARGET_CHARS = 50;
const SEPARATORS = new Set([";", "&&", "||", "|", "&", "\n"]);

/** A shell command split into words and separators, quotes removed; `;`, `&&`, `|` split even when glued to a word (§7 E8).
 * `backslashEscapes`: in a POSIX shell `\` escapes the next character; in any other (PowerShell, cmd) it is a path character. */
function shellWords(command: string, backslashEscapes = true): string[] {
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

/** Whether this command text runs the swarm tool's `wait` verb (swarm-relay D45). */
export function commandRunsWait(command: string, backslashEscapes = true): boolean {
  return commandRunsVerb(command, "wait", backslashEscapes);
}

/** Whether a shell tool of this name treats `\` as an escape: only Bash; PowerShell and the rest keep it as a path character. */
const toolEscapesBackslash = (toolName: string | undefined): boolean => toolName === undefined || toolName === "Bash";

/** Whether this command text runs one swarm verb, the word right after the tool's. */
function commandRunsVerb(command: string, verb: string, backslashEscapes: boolean): boolean {
  const words = shellWords(command, backslashEscapes);
  return words.some((w, i) => w === verb && i > 0 && isSwarmTool(words[i - 1]));
}

/** The board's own background calls, its `wait` and its `link`, never make a member busy (idea 1, §2). */
const commandIsBoardsOwn = (command: string, backslashEscapes: boolean): boolean =>
  commandRunsVerb(command, "wait", backslashEscapes) || commandRunsVerb(command, "link", backslashEscapes);

/** Whether this command text runs the binding verb, matched word by word, flags in any order. */
export function commandRunsBinding(command: string, binding: Binding, backslashEscapes = true): boolean {
  const words = shellWords(command, backslashEscapes);
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

/** Whether a transcript holds a shell tool_use (any tool whose input has a string `command`) that runs the binding verb. */
function transcriptRunsBinding(file: string, binding: Binding): boolean {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return false; // unreadable: skipped
  }
  // The cheap test before any parsing: the verb and its distinguishing value appear somewhere.
  const value = binding.verb === "join" ? binding.seat : binding.group;
  if (!text.includes(binding.verb) || !text.includes(value) || !text.includes('"tool_use"')) return false;
  for (const line of text.split("\n")) {
    if (!line.includes('"tool_use"') || !line.includes(binding.verb)) continue;
    let obj: { type?: string; message?: { content?: unknown } };
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type !== "assistant" || !Array.isArray(obj.message?.content)) continue;
    for (const part of obj.message.content as { type?: string; name?: string; input?: { command?: unknown } }[]) {
      if (part?.type === "tool_use" && typeof part.input?.command === "string" && commandRunsBinding(part.input.command, binding, toolEscapesBackslash(part.name))) return true;
    }
  }
  return false;
}

/** The metadata file the harness keeps beside a transcript. */
const metaFileOf = (transcript: string): string => transcript.replace(/\.jsonl$/, ".meta.json");

const mtimeOf = (file: string): number => {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
};

/** Claude Code: `<root>/<project>/<session>.jsonl` and `<root>/<project>/<session>/subagents/agent-*.jsonl`, each with its `.meta.json` beside. */
const claudeCode: HarnessLocator = {
  name: "claude-code",
  locate(binding, env) {
    const session = env.CLAUDE_CODE_SESSION_ID;
    if (!session) return null;
    const root = env.SWARM_TRANSCRIPTS_ROOT || path.join(env.USERPROFILE || env.HOME || os.homedir(), ".claude", "projects");
    let projects: string[];
    try {
      projects = fs.readdirSync(root);
    } catch {
      return null;
    }
    const candidates: string[] = [];
    for (const project of projects) {
      const main = path.join(root, project, `${session}.jsonl`);
      if (fs.existsSync(main)) candidates.push(main);
      const subagents = path.join(root, project, session, "subagents");
      let names: string[] = [];
      try {
        names = fs.readdirSync(subagents);
      } catch {
        // no subagents in this project's session
      }
      for (const n of names) if (/^agent-.*\.jsonl$/.test(n)) candidates.push(path.join(subagents, n));
    }
    const newestFirst = candidates.map((file) => ({ file, mtime: mtimeOf(file) })).sort((a, b) => b.mtime - a.mtime);
    for (const { file } of newestFirst) {
      if (this.finished(file) === true) continue;
      if (transcriptRunsBinding(file, binding)) return file;
    }
    return null;
  },
  finished(transcript) {
    let text: string;
    try {
      text = fs.readFileSync(metaFileOf(transcript), "utf8");
    } catch {
      return null; // no meta.json: the harness keeps no word on this one
    }
    try {
      return (JSON.parse(text) as { finished?: unknown }).finished === true;
    } catch {
      return false;
    }
  },
};

/** Every harness the link knows, tried in order. */
export const LOCATORS: HarnessLocator[] = [claudeCode];

/** The first harness's transcript of the call that ran this binding; null when none holds it (yet): the link retries each second. */
export function locate(binding: Binding, env: NodeJS.ProcessEnv): string | null {
  for (const l of LOCATORS) {
    const found = l.locate(binding, env);
    if (found) return found;
  }
  return null;
}

/** A tool call's target, as one short line: the command, the file, the pattern… */
function toolTarget(input: unknown): string {
  let text = "";
  if (input && typeof input === "object") {
    const fields = input as Record<string, unknown>;
    for (const k of ["command", "file_path", "path", "pattern", "url", "query", "description", "prompt"]) {
      if (typeof fields[k] === "string") {
        text = fields[k] as string;
        break;
      }
    }
    if (!text) text = JSON.stringify(input);
  } else if (input !== undefined) text = String(input);
  return text.replace(/\s+/g, " ").trim().slice(0, TARGET_CHARS);
}

const timeOf = (line: { timestamp?: unknown }, fallback: number): number => {
  const t = typeof line.timestamp === "string" ? Date.parse(line.timestamp) : NaN;
  return Number.isFinite(t) ? t : fallback;
};

const freshCursor = (): TranscriptCursor => ({
  offset: 0,
  tokens: 0,
  open: new Map(),
  lastTool: null,
  context: null,
  grewAt: null,
  lastLine: null,
  inTurn: false,
  endedTurns: 0,
  background: new Map(),
  boardsOwn: new Set(),
  breach: null,
  listeners: new Set(),
  listenerEndedAt: null,
});

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

/** How a shell command kills, when it does: by name or pattern, by a port lookup, or null (by PID, or no kill).
 *  A call of the swarm tool itself (a post quoting a kill) is never one. */
export function classifyKill(command: string): { kind: "pattern" | "port"; ports?: number[] } | null {
  if (/(^|[\s\\/"'])swarm(\.mjs)?(["'\s]|$)/i.test(command)) return null;
  let kill: "name" | "fed" | null = null;
  for (const segment of commandSegments(command)) {
    const h = headOf(segment);
    if (!h || !KILL_HEADS.has(h.head)) continue;
    const { head, rest } = h;
    if (head === "pkill" || head === "killall") kill = "name";
    else if (head === "taskkill") kill = /\/IM\b/i.test(rest) ? "name" : /\/PID\s+\d+(\s|$)/i.test(rest) && !/[$%]/.test(rest) ? (kill ?? null) : "fed";
    else if (head === "stop-process" || head === "spps") kill = /-Name\b|-ProcessName\b/i.test(rest) ? "name" : /-Id\s+[\d,\s]+$/i.test(rest) ? (kill ?? null) : "fed";
    else if (head === "kill") kill = rest.split(/\s+/).every((w) => /^(-\d+|-[A-Z]+|-s|\d+)$/.test(w)) ? (kill ?? null) : "fed";
    else if (head === "wmic") kill = /\b(delete|terminate)\b/i.test(rest) ? "name" : kill;
    else if (head === "invoke-cimmethod") kill = /terminate/i.test(rest) ? "fed" : kill;
    else if (head === "fuser") kill = /(^|\s)-k\b/.test(rest) ? "fed" : kill;
    if (kill === "name") break;
  }
  if (kill === "name") return { kind: "pattern" };
  if (kill !== "fed") return null;
  if (PATTERN_FEED.test(command)) return { kind: "pattern" };
  if (PORT_FEED.test(command)) return { kind: "port", ports: portsOf(command) };
  return null; // a PID from a variable the line does not show how it found: read as by PID
}

// Claude Code's own wording, read here only (idea 1, Risks): if it drifts, a task reads quiet, never missed.
// Anchored at the result's start: a result that only quotes these words (a grep, a cat) opens nothing.
const MOVED_TO_BACKGROUND = /^\s*(Command running in background with ID:|Command did not complete within its .{0,40}?moved to the background \(ID:)/;
const OUTPUT_FILE = /Output is being written to: (.+?)(?=\.\s|\.?\s*$)/m;
const NOTIFIED_TOOL_USE = /<task-notification>[\s\S]*?<tool-use-id>([^<\s]+)<\/tool-use-id>/g;

/** The text of a tool_result's or user line's content, string or parts. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((p) => (typeof p === "string" ? p : p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : "")).join("\n");
}

/** Closes every background task a `<task-notification>` in this text names (either notification form, addendum F1). */
function closeNotified(cursor: TranscriptCursor, text: string, at: number): void {
  if (!text.includes("<task-notification>")) return;
  for (const m of text.matchAll(NOTIFIED_TOOL_USE)) {
    cursor.background.delete(m[1]);
    if (cursor.listeners.delete(m[1])) cursor.listenerEndedAt = at;
  }
}

/** Whether this command runs the board's `wait --mentions`: a listener when run in the background (D4). */
const commandRunsListener = (command: string, backslashEscapes: boolean): boolean => commandRunsWait(command, backslashEscapes) && /\s--mentions(?!\S)/.test(command);

/** The latest turn's oldest awaited background task, its output stat'd now; a task from an earlier turn is a service, never awaited. */
function awaitedBackground(cursor: TranscriptCursor): MemberActivity["background"] {
  const latestTurn = cursor.inTurn ? cursor.endedTurns : cursor.endedTurns - 1;
  let oldest: BackgroundTask | null = null;
  for (const t of cursor.background.values()) if (t.turn === latestTurn && (!oldest || t.since < oldest.since)) oldest = t;
  if (!oldest) return null;
  let outputGrewAt: number | null = null;
  if (oldest.output) {
    try {
      outputGrewAt = fs.statSync(oldest.output).mtimeMs;
    } catch {
      // not written yet, or gone: unknown
    }
  }
  return { target: oldest.target, since: oldest.since, outputGrewAt };
}

type TranscriptLine = {
  type?: string;
  timestamp?: unknown;
  message?: { content?: unknown; usage?: Record<string, unknown>; stop_reason?: unknown };
  attachment?: { commandMode?: unknown; prompt?: unknown };
};
type ContentPart = { type?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; text?: unknown; content?: unknown };

/** Whether a board call names another member with `--as` than the one this binding stands for (S27, board-split D25):
 *  a session driving a second seat's waits is working for this one, never waiting. No `--as`: its own. */
export function commandActsAsOther(command: string, binding: Binding, backslashEscapes = true): boolean {
  const as = optionValue(shellWords(command, backslashEscapes), ["--as"]);
  if (as === undefined) return false;
  const slash = as.lastIndexOf("/");
  const group = slash < 0 ? null : as.slice(0, slash);
  const seat = as.slice(slash + 1);
  return binding.verb === "join" ? seat !== binding.seat : seat !== "orchestrator" || (group !== null && group !== binding.group);
}

/** Reads what was appended to the transcript since `from` (all of it when null); a vanished or truncated file starts over from 0.
 *  `binding`: the member this link stands for; a board call `--as` another member is that member's, plain work here (S27). */
export function observe(transcript: string, from: TranscriptCursor | null, binding?: Binding): { activity: MemberActivity; cursor: TranscriptCursor } {
  let cursor: TranscriptCursor = from ? { ...from, open: new Map(from.open), background: new Map(from.background), boardsOwn: new Set(from.boardsOwn), breach: from.breach ?? null, listeners: new Set(from.listeners ?? []), listenerEndedAt: from.listenerEndedAt ?? null } : freshCursor();
  let chunk = Buffer.alloc(0);
  let mtime = Date.now();
  try {
    const fd = fs.openSync(transcript, "r");
    try {
      const stat = fs.fstatSync(fd);
      mtime = stat.mtimeMs;
      if (stat.size < cursor.offset) cursor = freshCursor();
      chunk = Buffer.alloc(stat.size - cursor.offset);
      fs.readSync(fd, chunk, 0, chunk.length, cursor.offset);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    cursor = freshCursor();
  }
  const counted = claudeCodeJsonl.read(chunk, { offset: cursor.offset, tokens: cursor.tokens });
  const consumed = (counted?.offset ?? cursor.offset) - cursor.offset;
  if (consumed > 0) {
    for (const raw of chunk.subarray(0, consumed).toString("utf8").split("\n")) {
      if (!raw.trim()) continue;
      let line: TranscriptLine;
      try {
        line = JSON.parse(raw);
      } catch {
        continue;
      }
      // a mid-turn notification arrives as an attachment line: it closes its task, never counts for the turn (F1)
      if (line.attachment?.commandMode === "task-notification" && typeof line.attachment.prompt === "string") closeNotified(cursor, line.attachment.prompt, timeOf(line, mtime));
      if (line.type !== "assistant" && line.type !== "user") continue;
      const at = timeOf(line, mtime);
      const content = Array.isArray(line.message?.content) ? (line.message.content as ContentPart[]) : [];
      if (line.type === "assistant") {
        const usage = line.message?.usage;
        if (usage) {
          const n = (k: string) => (typeof usage[k] === "number" ? (usage[k] as number) : 0);
          cursor.context = n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens");
        }
        for (const part of content) {
          if (part?.type === "text" && typeof part.text === "string" && part.text.trim()) cursor.lastLine = part.text.replace(/\s+/g, " ").trim().slice(0, TARGET_CHARS);
          if (part?.type !== "tool_use" || typeof part.id !== "string") continue;
          const name = part.name ?? "?";
          const target = toolTarget(part.input);
          const input = part.input as { command?: unknown; run_in_background?: unknown } | undefined;
          const command = input?.command;
          const escapes = toolEscapesBackslash(name);
          const other = typeof command === "string" && binding !== undefined && commandActsAsOther(command, binding, escapes);
          // D45: only a shell call running the board's `wait` verb is waiting; a browser's wait_for, a sleep, are work
          const boardWait = typeof command === "string" && !other && commandRunsWait(command, escapes);
          // a shell call (any tool whose input holds a string command, idea 1 §3's test) has its own timeout; idea 5 bounds the rest
          const shell = typeof command === "string";
          cursor.open.set(part.id, { name, target, since: at, ...(boardWait ? { boardWait } : {}), ...(shell ? { shell } : {}) });
          cursor.lastTool = target ? `${name} ${target}` : name;
          cursor.lastLine = cursor.lastTool;
          const boardsOwn = typeof command === "string" && !other && commandIsBoardsOwn(command, escapes);
          if (boardsOwn) cursor.boardsOwn.add(part.id);
          else if (input?.run_in_background === true) cursor.background.set(part.id, { target, since: at, turn: cursor.endedTurns, output: null });
          if (input?.run_in_background === true && typeof command === "string" && !other && commandRunsListener(command, escapes)) cursor.listeners.add(part.id);
          // a kill not by PID: the board checks a port kill against the member's locks (idea 4)
          const kill = typeof command === "string" ? classifyKill(command) : null;
          if (kill) cursor.breach = { command: (command as string).replace(/\s+/g, " ").trim(), ...kill, at };
        }
        // the turn ends on an assistant line not asking for a tool; a line without stop_reason reads as ended (detection first)
        const inTurn = line.message?.stop_reason === "tool_use";
        if (cursor.inTurn && !inTurn) cursor.endedTurns++;
        cursor.inTurn = inTurn;
      } else {
        if (typeof line.message?.content === "string") closeNotified(cursor, line.message.content, at);
        for (const part of content) {
          if (part?.type === "text" && typeof part.text === "string") closeNotified(cursor, part.text, at);
          if (part?.type !== "tool_result" || typeof part.tool_use_id !== "string") continue;
          const result = textOf(part.content);
          const call = cursor.open.get(part.tool_use_id);
          if (MOVED_TO_BACKGROUND.test(result)) {
            const output = OUTPUT_FILE.exec(result)?.[1]?.trim() ?? null;
            const task = cursor.background.get(part.tool_use_id);
            if (task) cursor.background.set(part.tool_use_id, { ...task, output });
            else if (call && !cursor.boardsOwn.has(part.tool_use_id))
              // a foreground call the harness moved to the background: it belongs to the turn it was called in
              cursor.background.set(part.tool_use_id, { target: call.target, since: call.since, turn: cursor.endedTurns, output });
          }
          cursor.open.delete(part.tool_use_id);
          cursor.boardsOwn.delete(part.tool_use_id);
        }
        cursor.inTurn = true;
      }
    }
    cursor.offset += consumed;
    cursor.tokens = counted!.tokens;
    cursor.grewAt = mtime;
  }
  let openTool: MemberActivity["openTool"] = null;
  for (const t of cursor.open.values()) if (!openTool || t.since < openTool.since) openTool = t;
  let finished = false;
  for (const l of LOCATORS) {
    const said = l.finished(transcript);
    if (said !== null) {
      finished = said;
      break;
    }
  }
  return {
    activity: {
      grewAt: cursor.grewAt,
      tokens: cursor.tokens,
      context: cursor.context,
      openTool: openTool && { ...openTool },
      lastTool: cursor.lastTool,
      finished,
      inTurn: cursor.inTurn,
      lastLine: cursor.lastLine,
      background: awaitedBackground(cursor),
      breach: cursor.breach,
      listener: { running: cursor.listeners.size > 0, endedAt: cursor.listenerEndedAt },
    },
    cursor,
  };
}
