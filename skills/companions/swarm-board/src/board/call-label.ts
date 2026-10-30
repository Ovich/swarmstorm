// board-split D45: a call as the card names it. The snapshot serves it, so every reader of the board gets the same
// line: the call's own description, else a short form of its command, else `<Tool> · <file>`.

const fileName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/** A command's short form, when the call gave no description: no `VAR=…` prefix and no `cd … &&`, a board call
 *  `board <verb>`, a script its file name, else the program and its first two arguments. */
export function shortCommand(command: string): string {
  const line = command.trim().replace(/^cd\s+\S+\s*(&&|;)\s*/, "");
  const words = line.split(/\s+/).filter(Boolean);
  while (words.length > 1 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift();
  const board = words.findIndex((w) => /(^|[\\/])swarm(\.mjs)?$/.test(w));
  if (board >= 0) return `board ${words[board + 1] ?? ""}`.trim();
  const script = words.findIndex((w, i) => i > 0 && /\.(m?[jt]s|py|sh|ps1|cjs)$/.test(w));
  if (script >= 0 && /^(node|python3?|bash|sh|pwsh|powershell|tsx|deno|bun)(\.exe)?$/i.test(fileName(words[0]))) return fileName(words[script]);
  return [fileName(words[0] ?? ""), ...words.slice(1, 3)].join(" ");
}

/** The card's label of one call: `description` when the transcript gave one; null only when nothing names it. */
export function callLabel(call: { name?: string; target: string; label: string | null; command: string | null }): string | null {
  if (call.label) return call.label;
  const command = (call.command ?? call.target).trim();
  if (!command) return null;
  if (!call.name || call.name === "Bash" || call.name === "PowerShell" || /\s/.test(command)) return shortCommand(command);
  return `${call.name} · ${fileName(command)}`;
}
