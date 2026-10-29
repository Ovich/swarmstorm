// The board's address in a tab (board-split#D41): `#board&repo=<key>[&run=<id>]`. The key names the tab's project: a
// project's slug, or the name of a repository on its board, which the server maps to the project. Pure text, no node
// and no DOM: the CLI and the app both read it.

/** The board's hash for `repo`, a run's tab in it when `run` is given; with its leading `#`. */
export function boardHash(repo: string, run?: number | null): string {
  return `#board&repo=${encodeURIComponent(repo)}${run ? `&run=${run}` : ""}`;
}

/** What a hash says of the board: null when it does not open the board; `repo` null when it names no project yet. */
export function readBoardHash(hash: string): { repo: string | null } | null {
  const parts = hash.replace(/^#/, "").split("&");
  if (!parts.includes("board")) return null;
  const field = parts.find((p) => p.startsWith("repo="));
  const repo = field ? decodeURIComponent(field.slice("repo=".length)) : "";
  return { repo: repo || null };
}

/** The hash with the board's project written in (D41: a tab without one takes one once), every other field kept. */
export function hashWithBoardRepo(hash: string, repo: string): string {
  const kept = hash.replace(/^#/, "").split("&").filter((p) => p && p !== "board" && !p.startsWith("repo="));
  return boardHash(repo) + (kept.length ? `&${kept.join("&")}` : "");
}
