// The version the collection ships as, from its plugin manifest: what the server tells
// the page, and what `open` compares a running server against.
import fs from "node:fs";
import path from "node:path";

/** `.claude-plugin/plugin.json` in the nearest folder above the skill that holds one, in a
 *  checkout and in the plugin cache alike, whatever depth the skill sits at. Null when no
 *  ancestor has a manifest, or the nearest one is unreadable or carries no version. */
export function collectionVersion(toolRoot: string): string | null {
  for (let dir = path.dirname(path.resolve(toolRoot)); ; dir = path.dirname(dir)) {
    const manifest = path.join(dir, ".claude-plugin", "plugin.json");
    if (fs.existsSync(manifest)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(manifest, "utf8")) as { version?: unknown };
        return typeof parsed.version === "string" ? parsed.version : null;
      } catch {
        return null;
      }
    }
    if (path.dirname(dir) === dir) return null;
  }
}
