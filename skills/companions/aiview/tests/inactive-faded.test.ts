// break-flow T72: every inactive state a member card can carry (away, lost, ended) is faded in board.css.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BOARD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "app", "components", "viewers", "board");
const css = fs.readFileSync(path.join(BOARD, "board.css"), "utf8");

/** A member's states (liveness.ts); working and idle are the active ones. */
const INACTIVE = ["away", "lost", "ended"];
/** True when a rule whose selector list names `selector` sets `property`. */
const ruled = (selector: string, property: string): boolean =>
  [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].some(([, sel, body]) => sel.split(",").some((s) => s.trim() === selector) && body.includes(property));

test("every inactive state a card can carry is faded: card, strip card, strip row and rail agent", () => {
  for (const state of INACTIVE) {
    assert.ok(ruled(`.board .card.${state}`, "background"), `.card.${state} has no surface rule`);
    assert.ok(ruled(`.board .agent-strip .card.${state}`, "opacity"), `.agent-strip .card.${state} not faded`);
    assert.ok(ruled(`.board .agent-strip .row.${state}`, "opacity"), `.agent-strip .row.${state} not faded`);
    assert.ok(ruled(`.board .rail-agent.${state}`, "opacity"), `.rail-agent.${state} not faded`);
  }
});

test("no selector targets the old state names done, gone or parked on a card", () => {
  assert.doesNotMatch(css, /\.(card|rail-agent|row)\.(done|gone|parked)\b/);
});
