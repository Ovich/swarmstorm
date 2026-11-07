#!/usr/bin/env node
// The thread openers of a repository's pull request reviews, by people.
// Usage: node comments.mjs <owner/repo> [--since ISO] [--json]
// Prints one line per opener, "<pr> <date> <author> <path>: <body>", or JSON with --json.
// Replies and bots are dropped: the person's opening remark is the finding, the reply is its evidence.
import { execFileSync } from "node:child_process";

/** Keep the openers by people. Exported for the test; pure. */
export function openers(comments, since = "") {
  return comments
    .filter((c) => !c.in_reply_to_id)
    .filter((c) => c.user?.type !== "Bot" && !/\[bot\]$/.test(c.user?.login ?? ""))
    .filter((c) => !since || c.created_at >= since)
    .map((c) => ({
      pr: Number(String(c.pull_request_url ?? "").split("/").pop()),
      date: c.created_at.slice(0, 10),
      author: c.user.login,
      path: c.path,
      body: c.body.trim(),
      url: c.html_url,
    }))
    .sort((a, b) => a.pr - b.pr || a.date.localeCompare(b.date));
}

/** Every review comment of the repository, through gh, paginated. */
function fetchAll(repo) {
  const out = execFileSync(
    "gh",
    ["api", `repos/${repo}/pulls/comments?per_page=100&sort=created&direction=asc`, "--paginate"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  // --paginate concatenates one JSON array per page.
  return out
    .split(/\]\s*\[/)
    .map((chunk, i, all) => (all.length === 1 ? chunk : (i > 0 ? "[" : "") + chunk + (i < all.length - 1 ? "]" : "")))
    .flatMap((chunk) => JSON.parse(chunk));
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").replace(/^.*\//, ""));
if (isMain) {
  const args = process.argv.slice(2);
  const repo = args.find((a) => !a.startsWith("--"));
  const json = args.includes("--json");
  const sinceAt = args.indexOf("--since");
  const since = sinceAt >= 0 ? args[sinceAt + 1] : "";
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    console.error("usage: comments.mjs <owner/repo> [--since ISO] [--json]");
    process.exit(2);
  }
  const rows = openers(fetchAll(repo), since);
  if (json) console.log(JSON.stringify(rows, null, 2));
  else for (const r of rows) console.log(`#${r.pr} ${r.date} ${r.author} ${r.path}: ${r.body.replace(/\s+/g, " ")}`);
}
