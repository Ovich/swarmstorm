// A post's body: aiview's markdown, diagrams and code, with mentions and `#<seq>` links on top. jsdom
// cannot lay mermaid out: it is mocked, its render resolving an svg or rejecting.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { seqRefs } from "./lib/board/post.ts";

const mermaidMock = vi.hoisted(() => ({
  imported: 0,
  render: (async () => ({ svg: "" })) as (id: string, src: string) => Promise<{ svg: string }>,
}));
vi.mock("mermaid", () => {
  mermaidMock.imported++;
  return {
    default: {
      initialize: () => {},
      render: (id: string, src: string) => mermaidMock.render(id, src),
    },
  };
});

import { PostBody } from "./components/viewers/board/PostBody.tsx";

afterEach(cleanup);
// MermaidView picks its theme from the OS scheme; jsdom has no matchMedia.
vi.stubGlobal("matchMedia", () => ({ matches: false }));

const FENCE = "```";

describe("seqRefs", () => {
  test("finds #42, ignores #abc and a#42", () => {
    expect(seqRefs("see #42 and #7, not #abc nor a#42")).toEqual([42, 7]);
  });
});

// SL4: a post renders through aiview's own markdown (MermaidView, CodeView), the board's decorations on top.
describe("PostBody", () => {
  test("a mermaid fence renders as a diagram", async () => {
    mermaidMock.render = async () => ({ svg: '<svg data-testid="drawn"></svg>' });
    const { container } = render(<PostBody body={`see below\n${FENCE}mermaid\nflowchart LR\n A-->B\n${FENCE}`} shown={new Set()} />);
    expect(screen.getByText("see below")).toBeTruthy();
    await screen.findByTestId("drawn");
    expect(container.querySelector('[data-component="MermaidView"]')).toBeTruthy();
    expect(container.querySelector("pre code.language-mermaid")).toBeNull();
  });

  test("a mermaid fence that fails shows mermaid failed and the source", async () => {
    mermaidMock.render = async () => {
      throw new Error("Parse error on line 1");
    };
    const { container } = render(<PostBody body={`${FENCE}mermaid\nnot a diagram\n${FENCE}`} shown={new Set()} />);
    await screen.findByText("mermaid failed: Parse error on line 1");
    expect(container.querySelector('[data-component="MermaidView"] pre')!.textContent).toBe("not a diagram\n");
  });

  test("a code fence renders as code", () => {
    const { container } = render(<PostBody body={`${FENCE}ts\nconst a = 1;\n${FENCE}`} shown={new Set()} />);
    expect(container.querySelector('[data-component="CodeView"]')!.textContent).toBe("const a = 1;\n");
  });

  test("#seq links to a shown post, plain text when not shown", () => {
    render(<PostBody body="settled in #42" shown={new Set([42])} />);
    const link = screen.getByRole("link", { name: "#42" });
    expect(link.getAttribute("href")).toBe("#seq-42");
    cleanup();
    render(<PostBody body="settled in #42" shown={new Set([7])} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("settled in #42")).toBeTruthy();
  });
});

// SL1 (posts): a body is GitHub-flavoured markdown.
describe("PostBody markdown", () => {
  // The trial's pasted 4-column table: its first two rows as the slice gives them, eleven more alike.
  const TRIAL_TABLE = [
    "| input | today | R (regex) | S (strip) |",
    "|---|---|---|---|",
    "| word, word. word | word, / word. / word | word:3 | word:3 |",
    "| don't / don’t | 2 keys | don't:2 (’ folded) | 2 keys unless folded too |",
    ...Array.from({ length: 11 }, (_, i) => `| case ${i + 3} | t${i} | r${i} | s${i} |`),
  ].join("\n");

  test("the trial's pasted table renders as a table with 13 body rows", () => {
    const { container } = render(<PostBody body={`results:\n\n${TRIAL_TABLE}`} shown={new Set()} />);
    const table = container.querySelector("table")!;
    expect(table.querySelectorAll("thead th")).toHaveLength(4);
    expect(table.querySelectorAll("tbody tr")).toHaveLength(13);
    expect(table.querySelector("tbody tr td")!.textContent).toBe("word, word. word");
  });

  test("a list, inline code, a js fence (as code), bold and a link each render as their element", () => {
    const body = ["- one", "- two", "", "run `npm ci` **now**, see [docs](https://example.com)", "", `${FENCE}js`, "const a = 1;", FENCE].join("\n");
    const { container } = render(<PostBody body={body} shown={new Set()} />);
    expect(container.querySelectorAll("ul > li")).toHaveLength(2);
    expect(container.querySelector("p code")!.textContent).toBe("npm ci");
    expect(container.querySelector("strong")!.textContent).toBe("now");
    expect(screen.getByRole("link", { name: "docs" }).getAttribute("href")).toBe("https://example.com");
    expect(container.querySelector('[data-component="CodeView"]')!.textContent).toBe("const a = 1;\n");
  });

  test("a mermaid fence inside markdown is drawn by MermaidView, the text around as markdown", async () => {
    mermaidMock.render = async () => ({ svg: '<svg data-testid="drawn-md"></svg>' });
    const body = ["**before**", "", `${FENCE}mermaid`, "flowchart LR", " A-->B", FENCE, "", "- after"].join("\n");
    const { container } = render(<PostBody body={body} shown={new Set()} />);
    await screen.findByTestId("drawn-md");
    expect(container.querySelector('[data-component="MermaidView"]')).toBeTruthy();
    expect(container.querySelector("strong")!.textContent).toBe("before");
    expect(container.querySelector("li")!.textContent).toBe("after");
    expect(container.querySelector("pre code.language-mermaid")).toBeNull();
  });

  test("mentions highlighted outside code only: a table cell and a list item, never inline code or a fence", () => {
    const body = [
      "| who | ref |",
      "|---|---|",
      "| @swarm-kinds/SL2 @HumblePanda | #43 |",
      "",
      "- ask @HumblePanda about #43",
      "",
      "`@HumblePanda #43`",
      "",
      `${FENCE}`,
      "@swarm-kinds/SL2 #43",
      FENCE,
    ].join("\n");
    const { container } = render(<PostBody body={body} shown={new Set([43])} />);
    const cellMentions = [...container.querySelectorAll("td .mention")].map((m) => m.textContent);
    expect(cellMentions).toEqual(["@swarm-kinds/SL2", "@HumblePanda"]);
    expect(container.querySelector("td a")!.getAttribute("href")).toBe("#seq-43");
    expect(container.querySelector("li .mention")!.textContent).toBe("@HumblePanda");
    expect(container.querySelector("li a")!.getAttribute("href")).toBe("#seq-43");
    expect(container.querySelector("p code")!.textContent).toBe("@HumblePanda #43");
    expect(container.querySelector("p code .mention, p code a")).toBeNull();
    expect(container.querySelector("pre .mention, pre a")).toBeNull();
    expect(container.querySelector("pre")!.textContent).toBe("@swarm-kinds/SL2 #43\n");
  });

  test("raw html is text, never rendered", () => {
    const body = 'look <img src=x onerror="alert(1)"> here\n\n<script>alert(2)</script>';
    const { container } = render(<PostBody body={body} shown={new Set()} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(container.textContent).toContain("<script>alert(2)</script>");
  });
});

// The board draws diagrams only through aiview's MermaidView: nothing under its folders imports mermaid.
test("nothing of the board imports mermaid itself", () => {
  const roots = [join(__dirname, "components/viewers/board"), join(__dirname, "lib/board")];
  const files = roots.flatMap((dir) => readdirSync(dir).filter((f) => /\.tsx?$/.test(f)).map((f) => join(dir, f)));
  expect(files.length).toBeGreaterThan(0);
  const importing = files.filter((f) => /from\s+["']mermaid["']|import\(\s*["']mermaid["']\s*\)/.test(readFileSync(f, "utf8")));
  expect(importing).toEqual([]);
  expect(safeExists(join(__dirname, "components/viewers/board/PostDiagram.tsx"))).toBe(false);
});

// Kept last in the file and isolated by module: mermaid is imported only once a block needs it.
test("a body without a block never imports mermaid", async () => {
  vi.resetModules();
  mermaidMock.imported = 0;
  const { PostBody: Fresh } = await import("./components/viewers/board/PostBody.tsx");
  render(<Fresh body="no diagram here @S3" shown={new Set()} />);
  await new Promise((r) => setTimeout(r, 20));
  expect(mermaidMock.imported).toBe(0);
});

// The build leaves mermaid in chunks of its own, apart from the page's entry.
test.skipIf(!safeExists(join(__dirname, "../dist/assets")))("dist carries no mermaid: it loads from the CDN", () => {
  const dir = join(__dirname, "../dist/assets");
  const js = readdirSync(dir).filter((f) => f.endsWith(".js"));
  expect(js.filter((f) => /mermaid|Diagram/.test(f))).toEqual([]);
});

function safeExists(p: string) {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}
