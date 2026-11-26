// The board's address in a tab (board-split#D41, D47): `#board&project=<name>[&run=<id>]`. The name is the tab's
// project: a project's slug, or the name the board keys it by, which the server maps to the project. Pure text, no node and no DOM: the
// CLI and the app both read it.

/** The field a board hash names its project by (D47). */
const PROJECT_FIELDS = ["project="];

/** The board's hash for `project`, a run's tab in it when `run` is given; with its leading `#`. */
export function boardHash(project: string, run?: number | null): string {
  return `#board&project=${encodeURIComponent(project)}${run ? `&run=${run}` : ""}`;
}

/** What a hash says of the board: null when it does not open the board; `project` null when it names none yet. */
export function readBoardHash(hash: string): { project: string | null } | null {
  const parts = hash.replace(/^#/, "").split("&");
  if (!parts.includes("board")) return null;
  for (const prefix of PROJECT_FIELDS) {
    const field = parts.find((p) => p.startsWith(prefix));
    const project = field ? decodeURIComponent(field.slice(prefix.length)) : "";
    if (project) return { project };
  }
  return { project: null };
}

/** The hash with the board's project written in (D41: a tab without one takes one once), every other field kept. */
export function hashWithBoardProject(hash: string, project: string): string {
  const kept = hash
    .replace(/^#/, "")
    .split("&")
    .filter((p) => p && p !== "board" && !PROJECT_FIELDS.some((prefix) => p.startsWith(prefix)));
  return boardHash(project) + (kept.length ? `&${kept.join("&")}` : "");
}
