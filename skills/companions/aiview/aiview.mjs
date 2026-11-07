#!/usr/bin/env node
// aiview launcher — the ONLY public entry point; its path never changes.
// Runs the built CLI bundle (dist-cli/cli.mjs); prints the build command if missing.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// respect a pre-set AIVIEW_ROOT (tests, demo indexes); default to the tool's home
process.env.AIVIEW_ROOT ??= here;

const bundle = path.join(here, "dist-cli", "cli.mjs");
if (!existsSync(bundle)) {
  console.error(`aiview: not built. Run: npm install && npm run build  (in ${here})`);
  process.exit(1);
}
await import(pathToFileURL(bundle).href);
