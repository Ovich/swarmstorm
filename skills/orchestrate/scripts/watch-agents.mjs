#!/usr/bin/env node
/**
 * One status line per running subagent, for an orchestrator watching a delegated slice.
 *
 * A subagent's transcript is written as it works and is the only live feed there is: the
 * Agent tool returns once, at the end. The transcript is also hundreds of kilobytes
 * within minutes, so it is digested here and never read into the session.
 *
 *   node watch-agents.mjs <dir-or-file...> [--idle 300] [--forbidden '<regex>'] [--json]
 *                          [--label <id>=<name> ...]
 *
 * Several subagents at once: pass the directory and every live one is reported, one line
 * each. Name them with --label so the lines read as slices rather than as hex. A boundary
 * belongs to a brief, not to a run, so when two slices forbid different things, invoke it
 * once per transcript with that slice's own --forbidden rather than a union of both.
 *
 * Prints, per live subagent:
 *   <id> calls=<n> idle=<s>[ BREACH xN] | <last tool>:<hint> | <what it last said>
 *
 * --forbidden is the brief's boundary as a regex. Heredoc bodies are stripped before it
 * is applied, because a subagent WRITING a file that mentions a forbidden command is not
 * running it, and matching raw command text reports that as a breach.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const idleLimit = Number(flag("idle", 300));
const forbiddenSource = flag("forbidden", "");
const forbidden = forbiddenSource ? new RegExp(forbiddenSource, "i") : null;
const asJson = args.includes("--json");
/** --label <id>=<name>, repeatable: what to call each agent instead of its hex id. */
const labels = new Map(
  args
    .map((a, i) => (args[i - 1] === "--label" ? a : null))
    .filter(Boolean)
    .map((pair) => {
      const at = pair.indexOf("=");
      return [pair.slice(0, at), pair.slice(at + 1)];
    }),
);
/** Idle beyond this and the subagent is not working, it is stuck or waiting. */
const STALL_SECONDS = 120;
const inputs = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));

/** Every transcript under the given paths, a directory standing for the files in it. */
const transcripts = inputs.flatMap((input) => {
  let stat;
  try {
    stat = statSync(input);
  } catch {
    return [];
  }
  if (!stat.isDirectory()) return [input];
  return readdirSync(input)
    .filter((name) => name.startsWith("agent-") && name.endsWith(".jsonl"))
    .map((name) => join(input, name));
});

/** The most identifying string in a tool's input, short enough for one line. */
const hint = (input) => {
  for (const key of ["file_path", "path", "command", "description"]) {
    const value = input[key];
    if (typeof value === "string") {
      const tail = value.split("&&").at(-1).trim();
      return basename(tail).replace(/\s+/g, " ").slice(0, 44);
    }
  }
  return "";
};

/** Heredoc bodies are file content, not commands: a boundary check must not see them. */
const executedPart = (command) =>
  command.replace(/<<\s*'?(\w+)'?[\s\S]*?^\1\s*$/gm, " ");

for (const path of transcripts) {
  let age;
  try {
    age = Math.round((Date.now() - statSync(path).mtimeMs) / 1000);
  } catch {
    continue;
  }
  if (age > idleLimit) continue; // finished or abandoned, not a live subagent

  let calls = 0;
  let breaches = 0;
  let last = "";
  let said = "";

  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const message = entry.message;
    if (!message || message.role !== "assistant") continue;
    for (const block of message.content ?? []) {
      if (block?.type === "tool_use") {
        calls += 1;
        const input = block.input ?? {};
        last = `${block.name ?? "?"}:${hint(input)}`;
        if (forbidden && typeof input.command === "string" && input.command) {
          if (forbidden.test(executedPart(input.command))) breaches += 1;
        }
      } else if (block?.type === "text" && block.text?.trim()) {
        said = block.text.trim().replace(/\s+/g, " ");
      }
    }
  }

  const id = basename(path).replace(/^agent-/, "").replace(/\.jsonl$/, "").slice(0, 8);
  const name = labels.get(id) ?? id;
  // A signal, not a verdict: whether the run needs a human look is the orchestrator's call.
  const signal = breaches ? "BREACH" : age > STALL_SECONDS ? "STALLED" : "WORKING";
  if (asJson) {
    console.log(JSON.stringify({ id, name, calls, idle: age, breaches, signal, last, said: said.slice(0, 160) }));
    continue;
  }
  const breach = breaches ? ` BREACH x${breaches}` : "";
  // Folded to ASCII: a legacy console code page throws on the glyphs a subagent writes,
  // and a watch that dies is worse than a line that is plain.
  const line = `${name} calls=${calls} idle=${age}s${breach} | ${last} | ${said.slice(0, 110)}`;
  console.log([...line].map((c) => (c.codePointAt(0) < 128 ? c : ".")).join(""));
}
