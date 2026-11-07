// Mermaid loads from the CDN at package.json's exact version: the two never drift.
import { expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MERMAID_URL } from "./components/viewers/MermaidView";

test("the CDN's mermaid is package.json's version", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  expect(MERMAID_URL).toContain(`/mermaid@${pkg.dependencies?.mermaid ?? pkg.devDependencies?.mermaid}/`);
});
