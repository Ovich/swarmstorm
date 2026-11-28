// A document's markdown (SL4 shaping): the rendering drawn out into RenderedMarkdown leaves a
// document as it was. jsdom cannot lay mermaid out: it is mocked.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("mermaid", () => ({
  default: { initialize: () => {}, render: async () => ({ svg: '<svg data-testid="doc-drawn"></svg>' }) },
}));

import { MarkdownView } from "./ui/viewers/MarkdownView.tsx";

afterEach(cleanup);
// MermaidView picks its theme from the OS scheme; jsdom has no matchMedia.
vi.stubGlobal("matchMedia", () => ({ matches: false }));

const FENCE = "```";

describe("MarkdownView", () => {
  test("a mermaid fence renders through MermaidView, without its <pre>", async () => {
    const { container } = render(<MarkdownView content={`${FENCE}mermaid\nflowchart LR\n A-->B\n${FENCE}`} docId={7} />);
    await screen.findByTestId("doc-drawn");
    expect(container.querySelector('[data-component="MermaidView"]')).toBeTruthy();
    expect(container.querySelector("pre code.language-mermaid")).toBeNull();
  });

  test("a language fence renders through CodeView", () => {
    const { container } = render(<MarkdownView content={`${FENCE}ts\nconst a = 1;\n${FENCE}`} docId={7} />);
    const code = container.querySelector('[data-component="CodeView"]')!;
    expect(code.textContent).toBe("const a = 1;\n");
  });

  test("an unfenced code block stays a plain <pre>", () => {
    const { container } = render(<MarkdownView content={"text\n\n    indented code\n"} docId={7} />);
    expect(container.querySelector('[data-component="CodeView"]')).toBeNull();
    expect(container.querySelector("pre code")!.textContent).toBe("indented code\n");
  });

  test("a relative image resolves to the document's assets, an absolute one is kept", () => {
    const { container } = render(<MarkdownView content={"![a](img/a.png) ![b](https://example.com/b.png)"} docId={7} />);
    const [a, b] = [...container.querySelectorAll("img")];
    expect(a.getAttribute("src")).toContain("7");
    expect(a.getAttribute("src")).toContain("img/a.png");
    expect(b.getAttribute("src")).toBe("https://example.com/b.png");
  });

  test("GitHub-flavoured: a table renders", () => {
    const { container } = render(<MarkdownView content={"| a | b |\n|---|---|\n| 1 | 2 |"} docId={7} />);
    expect(container.querySelectorAll("tbody td")).toHaveLength(2);
  });
});
