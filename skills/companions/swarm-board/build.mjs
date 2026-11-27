import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";

/** codebase-rework#D10: the board's migrations inlined in place of `store/migrations.ts`, which reads them from disk in
 *  source, so the bundle stays one file. The same files, in the same name order. */
const inlineMigrations = {
  name: "inline-migrations",
  setup(b) {
    b.onLoad({ filter: /[\\/]board[\\/]store[\\/]migrations\.ts$/ }, (args) => {
      const dir = path.join(path.dirname(args.path), "migrations");
      const texts = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
      return { contents: `export const MIGRATIONS = ${JSON.stringify(texts)};`, loader: "js" };
    });
  },
};

// CLI bundle. No runtime TS loader and no node_modules at runtime: swarm.mjs execs this output.
// `--outfile <path>` writes it elsewhere (the test that runs the bundle alone).
const at = process.argv.indexOf("--outfile");
await build({
  entryPoints: ["src/cli/index.ts"],
  outfile: at > 0 ? process.argv[at + 1] : "dist-cli/cli.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // ws is CommonJS: its require() of node builtins needs a real require in the ESM bundle (D18)
  banner: { js: 'import { createRequire as __swarmRequire } from "node:module"; const require = __swarmRequire(import.meta.url);' },
  plugins: [inlineMigrations],
  sourcemap: false,
  logLevel: "info",
});
