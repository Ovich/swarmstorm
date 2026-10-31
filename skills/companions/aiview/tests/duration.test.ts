// How the merge lock writes a duration: seconds under a minute, minutes and seconds under ten, floored past.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDuration } from "../app/lib/board/duration.ts";

test("formatDuration floors, never rounds up", () => {
  const S = 1000, M = 60 * S;
  assert.equal(formatDuration(40 * S), "40s");
  assert.equal(formatDuration(5 * M + 30 * S), "5m 30s");
  assert.equal(formatDuration(5 * M), "5m");
  assert.equal(formatDuration(14 * M + 47 * S), "14m");
  assert.equal(formatDuration(125 * M + 10 * S), "2h 05m");
});
