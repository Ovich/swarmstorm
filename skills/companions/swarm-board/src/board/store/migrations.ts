// The board's schema as ordered migrations (codebase-rework#D10): `migrations/NNN-<what>.sql`, in name order, each the
// DDL of one step. From source they are read beside this file; the bundle (build.mjs) inlines them in its place, so
// `cli.mjs` stays one file.
import fs from "node:fs";

const DIR = new URL("./migrations/", import.meta.url);

/** Every migration's text, in order: a store at `user_version` n runs those from index n on. */
export const MIGRATIONS: readonly string[] = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => fs.readFileSync(new URL(f, DIR), "utf8"));
