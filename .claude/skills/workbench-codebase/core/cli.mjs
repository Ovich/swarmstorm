#!/usr/bin/env node
// The codebase bench's one door: `code <verb> [scope] [flags]`, run from anywhere inside a git
// repository. Every call is recorded in the current run's trace (trace.mjs); the caller does nothing
// for it. `open` starts the page's server if none runs and prints its address.
import { flagsOf, positionalOf, print } from "./output.mjs";
import { repoRoot } from "./repo.mjs";
import { record } from "./trace.mjs";
import { VERBS } from "./verbs.mjs";

const [verb, ...args] = process.argv.slice(2);
const flags = flagsOf(args);
const help = () => `code <verb> [scope] [flags]   a scope: a folder, a file, a package name, or all (default)

${Object.values(VERBS).map((v) => `  ${v.help}`).join("\n")}
  open [view]   the page in a browser: map, insights, the runs (starts its server)

Every verb: a short answer, --full every line, --json the data, --md a phone file; overview and deps also --mermaid.`;

if (!verb || verb === "help" || verb === "--help") {
  console.log(help());
  process.exit(0);
}
let root;
try {
  root = repoRoot(process.cwd());
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
if (verb === "open") {
  const { opened } = await import("./server.mjs");
  try {
    console.log(await opened(root, positionalOf(args)[0]));
    process.exit(0);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
const entry = VERBS[verb];
if (!entry) {
  console.error(`no verb ${verb}: code help lists them`);
  process.exit(2);
}
const started = Date.now();
try {
  const answer = entry.run(root, positionalOf(args), flags);
  print(answer, flags);
  if (verb !== "runs") record(root, { argv: [verb, ...args], ms: Date.now() - started, count: answer.count, exit: answer.exit ?? 0, answer: answer.data });
  const { ensureServed } = await import("./server.mjs");
  ensureServed(root); // the person's page follows the work: up and on the current code, the verb not waiting for it
  process.exit(answer.exit ?? 0);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
