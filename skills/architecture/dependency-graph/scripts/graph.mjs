#!/usr/bin/env node
// A project's dependency graph, parsed, never guessed: dependency-cruiser over the code, as Mermaid.
//   node graph.mjs --root <folder holding the tsconfig or package.json> [options] [--out <file.md>]
// Options, combinable:
//   --from <path>     what this module or folder depends on (the cruise starts there; default: the root's src, else the root)
//   --to <path>       only what leads to this module or folder (who depends on it)
//   --focus <path>    this module and its neighbours both ways; --depth <n> hops (default 1)
//   --steps <n>       follow imports only n steps from --from
//   --level <n>       fold files into folders n levels deep (2: src/area); default: files
//   --only <regex>    keep only paths matching; --exclude <regex> drop paths matching (tests, generated code)
//   --title <text>    the document's title
// Prints one JSON line: the output file, the node and edge counts, the time taken. Without --out, the Mermaid
// goes to stdout. dependency-cruiser and the project's TypeScript are installed once, together, into a cache.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { npmInstallArgs, npmInvocation, projectTypescriptVersion } from "./cruiser-install.mjs";

const cruiserVersion = "18.5.0";
const core =
  "^(node:)?(assert|async_hooks|buffer|child_process|cluster|crypto|dgram|dns|events|fs|http|http2|https|module|net|os|path|perf_hooks|process|querystring|readline|stream|string_decoder|timers|tls|url|util|v8|vm|worker_threads|zlib)(/|$)";

const fail = (error, fix) => {
  console.log(JSON.stringify({ error, fix }));
  process.exit(1);
};

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};

const root = resolve(option("root") ?? ".");
if (!existsSync(join(root, "package.json")) && !existsSync(join(root, "tsconfig.json")))
  fail(`no package.json or tsconfig.json in ${root}`, "--root <the folder of the package to graph>");

const cruiser = () => {
  const ts = projectTypescriptVersion(root);
  if (ts.refused) fail(ts.refused, "fix or reinstall the project's typescript package, then run again");
  const cache = join(homedir(), ".cache", "swarmstorm-depgraph", `${cruiserVersion}-ts${ts.version}`);
  const bin = join(cache, "node_modules", "dependency-cruiser", "bin", "dependency-cruiser.mjs");
  if (!existsSync(bin)) {
    const installArgs = npmInstallArgs(cache, cruiserVersion, ts.version);
    const npm = npmInvocation(installArgs);
    if (npm.refused) fail(`could not find npm to install dependency-cruiser: ${npm.refused}`, `install it by hand, then run again: npm ${installArgs.join(" ")}`);
    mkdirSync(cache, { recursive: true });
    try {
      execFileSync(npm.program, npm.argv, { stdio: ["ignore", "ignore", "pipe"] });
    } catch (error) {
      fail(`could not install dependency-cruiser: ${String(error.stderr ?? error).split("\n")[0]}`, "check the network, then run again");
    }
  }
  return bin;
};

const from = option("from") ?? (existsSync(join(root, "src")) ? "src" : ".");
const exclude = ["node_modules", core, option("exclude")].filter(Boolean).join("|");
const cruiseArgs = [relative(root, resolve(root, from)) || ".", "--no-config", "--do-not-follow", "node_modules", "--exclude", exclude, "--output-type", "mermaid"];
if (existsSync(join(root, "tsconfig.json"))) cruiseArgs.push("--ts-config", "tsconfig.json");
if (option("to")) cruiseArgs.push("--reaches", option("to"));
if (option("focus")) cruiseArgs.push("--focus", option("focus"), "--focus-depth", option("depth") ?? "1");
if (option("steps")) cruiseArgs.push("--max-depth", option("steps"));
if (option("level")) cruiseArgs.push("--collapse", option("level"));
if (option("only")) cruiseArgs.push("--include-only", option("only"));

const began = performance.now();
let mermaid;
try {
  mermaid = execFileSync(process.execPath, [cruiser(), ...cruiseArgs], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (error) {
  fail(`dependency-cruiser failed: ${String(error.stderr ?? error).trim().split("\n")[0]}`, "check --root, --from and the regexes");
}
const edges = (mermaid.match(/-->/g) ?? []).length;
const nodes = (mermaid.match(/^\s*\w+\["[^"]*"\]\s*$/gm) ?? []).length;
if (nodes === 0) fail("the graph is empty", "--from must hold source files; widen --only or narrow --exclude");

const out = option("out");
if (!out) {
  process.stdout.write(mermaid);
  process.exit(0);
}
const commit = (() => {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "no git";
  }
})();
const shown = args.filter((each) => each !== "--out" && each !== out).join(" ");
writeFileSync(
  out,
  `# ${option("title") ?? `Dependency graph · ${from}`}\n\nParsed at \`${commit}\` with dependency-cruiser ${cruiserVersion}: ${nodes} modules, ${edges} dependencies. Made again with:\n\n\`\`\`sh\nnode graph.mjs ${shown}\n\`\`\`\n\n\`\`\`mermaid\n${mermaid.trim()}\n\`\`\`\n`,
);
console.log(JSON.stringify({ out, nodes, edges, ms: Math.round(performance.now() - began) }));
