// How graph.mjs installs dependency-cruiser and the project's TypeScript into its cache, with no shell
// (trust-adaptations#D10): the version read from the target project is checked before it reaches npm, and npm
// is run as a program, its argv data.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, win32 } from "node:path";

/** A TypeScript version npm may be given: plain semver, an optional prerelease, nothing a shell would read. */
export const TYPESCRIPT_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/**
 * The TypeScript version of the project at `root` (its nearest node_modules/typescript), so the parse matches
 * its compiler; "5" when it has none. Returns `{ refused }` when the version found is not plain semver.
 */
export function projectTypescriptVersion(root) {
  for (let dir = root; ; dir = resolve(dir, "..")) {
    const pkg = join(dir, "node_modules", "typescript", "package.json");
    if (existsSync(pkg)) {
      const version = String(JSON.parse(readFileSync(pkg, "utf8")).version);
      return TYPESCRIPT_VERSION.test(version) ? { version } : { refused: `${pkg} declares TypeScript version ${JSON.stringify(version)}, not a plain semver` };
    }
    if (resolve(dir, "..") === dir) return { version: "5" };
  }
}

/** The npm arguments that install the cruiser and `typescript@<version>` into `cache`. */
export const npmInstallArgs = (cache, cruiserVersion, typescriptVersion) => [
  "install", "--silent", "--no-audit", "--no-fund", "--prefix", cache, `dependency-cruiser@${cruiserVersion}`, `typescript@${typescriptVersion}`,
];

/**
 * The program and argv that run npm with `npmArgs`, never through a shell: on Windows the running node on
 * npm's own npm-cli.js beside it (npm.cmd needs cmd), elsewhere `npm`. Returns `{ refused }` when that npm-cli.js
 * is missing.
 */
export function npmInvocation(npmArgs, { platform = process.platform, execPath = process.execPath, exists = existsSync } = {}) {
  if (platform !== "win32") return { program: "npm", argv: npmArgs };
  const npmCli = win32.join(win32.dirname(execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (!exists(npmCli)) return { refused: `no npm-cli.js at ${npmCli}` };
  return { program: execPath, argv: [npmCli, ...npmArgs] };
}
