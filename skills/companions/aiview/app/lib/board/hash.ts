// The board's field in the page's URL: `run=<id>` names the run the board opens on. Pure: no DOM.
import type { RunId } from "./view.ts";

/** The run the hash names, `run=13`; null when it names none. */
export function readRunInHash(hash: string): RunId | null {
  const field = hash
    .replace(/^#/, "")
    .split("&")
    .find((part) => part.startsWith("run="));
  const run = Number(field ? decodeURIComponent(field.slice(4)) : NaN);
  return Number.isInteger(run) && run > 0 ? run : null;
}
