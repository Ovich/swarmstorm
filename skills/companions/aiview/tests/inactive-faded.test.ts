// break-flow T72: every inactive state a member card can carry is faded in board.css. The states are boardStateOf's
// (AgentStrip.tsx), plus the `lost` class a card takes from its badge; working, waiting and merging are the active ones.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BOARD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "app", "components", "viewers", "board");
const css = fs.readFileSync(path.join(BOARD, "board.css"), "utf8");
const strip = fs.readFileSync(path.join(BOARD, "AgentStrip.tsx"), "utf8");

/** The states boardStateOf's return type names, as written in its signature. */
const boardStates = (): string[] => {
  const sig = /export function boardStateOf\([^)]*\):\s*([^{]+)\{/.exec(strip)?.[1] ?? "";
  return [...sig.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
};
const ACTIVE = new Set(["working", "waiting", "merging"]);
/** True when a rule whose selector list names `selector` sets `property`. */
const ruled = (selector: string, property: string): boolean =>
  [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].some(([, sel, body]) => sel.split(",").some((s) => s.trim() === selector) && body.includes(property));

test("every inactive state a card can carry is faded: card, strip card, strip row and rail agent", () => {
  const inactive = [...boardStates().filter((s) => !ACTIVE.has(s)), "lost"];
  assert.ok(inactive.includes("parked") && inactive.includes("ended"), `states read: ${inactive}`);
  for (const state of inactive) {
    assert.ok(ruled(`.board .card.${state}`, "background"), `.card.${state} has no surface rule`);
    assert.ok(ruled(`.board .agent-strip .card.${state}`, "opacity"), `.agent-strip .card.${state} not faded`);
    assert.ok(ruled(`.board .agent-strip .row.${state}`, "opacity"), `.agent-strip .row.${state} not faded`);
    assert.ok(ruled(`.board .rail-agent.${state}`, "opacity"), `.rail-agent.${state} not faded`);
  }
});

test("no selector targets the old state names done or gone on a card", () => {
  assert.doesNotMatch(css, /\.(card|rail-agent|row)\.(done|gone)\b/);
});
