// Every document fills the right panel (decided 2026-08-27): the reading pane caps no format's width.
import { expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

test("the document pane has no max width for any format", () => {
  const app = fs.readFileSync(path.join(__dirname, "App.tsx"), "utf8");
  const main = app.match(/<main\s+className=\{([\s\S]*?)\}\s*>/)?.[1] ?? "";
  expect(main).toContain("flex-1");
  expect(main).not.toMatch(/max-w-|mx-auto/);
});
