// Claude Code, the one harness the link reads (codebase-rework#D15, swarm-relay#D8, #D10): where its transcripts
// live, its word that an agent finished, and its JSONL lines decoded into transcript events. One adapter counts the
// tokens and decodes the lines, so both read the same lines. Claude Code's own wording is read here only: if it
// drifts, a task reads quiet, never missed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TranscriptEvent } from "../activity.ts";
import { runsBinding, type Binding } from "../shell.ts";

export interface Harness {
  /** The transcript holding the tool call that ran this binding verb, newest first, a finished one skipped; null when not (yet) found. */
  locate(b: Binding, env: NodeJS.ProcessEnv): string | null;
  /** The harness's own word that the agent ended; null when it keeps none. */
  finished(t: string): boolean | null;
  /** One complete line of a transcript as events; `fallbackAt` dates a line that carries no time. */
  decode(line: string, fallbackAt: number): TranscriptEvent[];
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
      if (part?.type === "tool_use" && typeof part.input?.command === "string" && runsBinding(part.input.command, binding, part.name)) return true;
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

// ── a line's wording ──

const MOVED_TO_BACKGROUND = /^\s*(Command running in background with ID:|Command did not complete within its .{0,40}?moved to the background \(ID:|Command was moved to the background \(ID:)/;
/** U-F30: the harness's id of a background task, as its result names it; a stop names the same id. */
const BACKGROUND_ID = /(?:with ID:|\(ID:)\s*([\w-]+)/;
/** U-F30: the calls that stop a background task by its id (no `<task-notification>` follows one). */
const STOPS_TASK = new Set(["TaskStop", "KillShell", "KillBash"]);
const OUTPUT_FILE = /Output is being written to: (.+?)(?=\.\s|\.?\s*$)/m;
const NOTIFIED_TOOL_USE = /<task-notification>[\s\S]*?<tool-use-id>([^<\s]+)<\/tool-use-id>/g;
const USAGE_COUNTS = ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"];
const LABEL_CHARS = 80;
const COMMAND_CHARS = 500;

type TranscriptLine = {
  type?: string;
  timestamp?: unknown;
  message?: { content?: unknown; usage?: Record<string, unknown>; stop_reason?: unknown };
  attachment?: { commandMode?: unknown; prompt?: unknown };
};
type ContentPart = { type?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; text?: unknown; content?: unknown };

const timeOf = (line: { timestamp?: unknown }, fallback: number): number => {
  const t = typeof line.timestamp === "string" ? Date.parse(line.timestamp) : NaN;
  return Number.isFinite(t) ? t : fallback;
};

/** The text of a tool_result's or user line's content, string or parts. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((p) => (typeof p === "string" ? p : p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : "")).join("\n");
}

/** The background tasks a `<task-notification>` in this text names (either notification form, addendum F1). */
function notified(text: string, at: number): TranscriptEvent[] {
  if (!text.includes("<task-notification>")) return [];
  return [{ kind: "notified", toolUseIds: [...text.matchAll(NOTIFIED_TOOL_USE)].map((m) => m[1]), at }];
}

/** A tool call's main input as text: the command, the file, the pattern… */
function toolTarget(input: unknown): string {
  if (input && typeof input === "object") {
    const fields = input as Record<string, unknown>;
    const named = ["command", "file_path", "path", "pattern", "url", "query", "description", "prompt"].find((k) => typeof fields[k] === "string");
    return (named && (fields[named] as string)) || JSON.stringify(input);
  }
  return input !== undefined ? String(input) : "";
}

/** board-split D45: the call's own `description` and its whole command or input, for the card. */
function callWordsOf(input: unknown): { label: string | null; command: string | null } {
  const fields = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const label = typeof fields.description === "string" && fields.description.trim() ? fields.description.replace(/\s+/g, " ").trim().slice(0, LABEL_CHARS) : null;
  const raw = typeof fields.command === "string" ? fields.command : typeof fields.file_path === "string" ? fields.file_path : null;
  return { label, command: raw === null ? null : raw.trim().slice(0, COMMAND_CHARS) };
}

/** The four usage counts of a line, summed: the counter that moves while the member works. */
function tokensOf(usage: Record<string, unknown>): number {
  let tokens = 0;
  for (const k of USAGE_COUNTS) {
    const n = usage[k];
    if (typeof n === "number" && Number.isFinite(n)) tokens += n;
  }
  return tokens;
}

function assistantEvents(line: TranscriptLine, content: ContentPart[], at: number): TranscriptEvent[] {
  const events: TranscriptEvent[] = [];
  const usage = line.message?.usage;
  if (usage) {
    const n = (k: string) => (typeof usage[k] === "number" ? (usage[k] as number) : 0);
    events.push({ kind: "context", tokens: n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens") });
  }
  for (const part of content) {
    if (part?.type === "text" && typeof part.text === "string" && part.text.trim()) events.push({ kind: "said", text: part.text });
    if (part?.type !== "tool_use" || typeof part.id !== "string") continue;
    const name = part.name ?? "?";
    const input = part.input as { command?: unknown; run_in_background?: unknown; task_id?: unknown; shell_id?: unknown } | undefined;
    const stopped = STOPS_TASK.has(name) ? (input ?? {}) : {};
    const stopsTask = typeof stopped.task_id === "string" ? stopped.task_id : typeof stopped.shell_id === "string" ? stopped.shell_id : null;
    const command = typeof input?.command === "string" ? input.command : null;
    events.push({ kind: "called", id: part.id, tool: name, target: toolTarget(part.input), words: callWordsOf(part.input), command, background: input?.run_in_background === true, stopsTask, at });
  }
  events.push({ kind: "assistantEnded", asksForTool: line.message?.stop_reason === "tool_use" });
  return events;
}

function userEvents(line: TranscriptLine, content: ContentPart[], at: number): TranscriptEvent[] {
  const events: TranscriptEvent[] = typeof line.message?.content === "string" ? notified(line.message.content, at) : [];
  for (const part of content) {
    if (part?.type === "text" && typeof part.text === "string") events.push(...notified(part.text, at));
    if (part?.type !== "tool_result" || typeof part.tool_use_id !== "string") continue;
    const result = textOf(part.content);
    const movedToBackground = MOVED_TO_BACKGROUND.test(result) ? { output: OUTPUT_FILE.exec(result)?.[1]?.trim() ?? null, taskId: BACKGROUND_ID.exec(result)?.[1] ?? null } : null;
    events.push({ kind: "answered", toolUseId: part.tool_use_id, movedToBackground });
  }
  events.push({ kind: "userSpoke" });
  return events;
}

/** Claude Code: `<root>/<project>/<session>.jsonl` and `<root>/<project>/<session>/subagents/agent-*.jsonl`, each with its `.meta.json` beside. */
export const claudeCode: Harness = {
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
  /** One JSON object per line; any line's `message.usage` counts, an assistant or user line says more. */
  decode(text, fallbackAt) {
    let line: unknown;
    try {
      line = JSON.parse(text);
    } catch {
      return [{ kind: "foreign" }];
    }
    if (!line || typeof line !== "object" || Array.isArray(line)) return [{ kind: "foreign" }];
    const read = line as TranscriptLine;
    const events: TranscriptEvent[] = read.message?.usage ? [{ kind: "tokens", tokens: tokensOf(read.message.usage) }] : [];
    // a mid-turn notification arrives as an attachment line: it closes its task, never counts for the turn (F1)
    if (read.attachment?.commandMode === "task-notification" && typeof read.attachment.prompt === "string") events.push(...notified(read.attachment.prompt, timeOf(read, fallbackAt)));
    if (read.type !== "assistant" && read.type !== "user") return events;
    const at = timeOf(read, fallbackAt);
    const content = Array.isArray(read.message?.content) ? (read.message.content as ContentPart[]) : [];
    return [...events, ...(read.type === "assistant" ? assistantEvents(read, content, at) : userEvents(read, content, at))];
  },
};
