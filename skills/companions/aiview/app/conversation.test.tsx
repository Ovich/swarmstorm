// The conversation, rendered (plan D8, D9): the item's edge and tint by tier, every special word
// and board event carrying its tip on hover and keyboard focus.
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BoardSnapshot, RunSummary, SnapshotEvent, SnapshotMember } from "../../swarm-board/src/client/reader.ts";
import { conversation, TIPS } from "./lib/board/view.ts";
import { Conversation } from "./components/viewers/board/Conversation.tsx";
import { TipLayer } from "./components/viewers/board/Tip.tsx";
import { PHASED } from "./board-fixtures.ts";

// jsdom cannot lay mermaid out: it is mocked, its render resolving an svg
vi.mock("mermaid", () => ({
  default: { initialize: () => {}, render: async () => ({ svg: '<svg data-testid="drawn"></svg>' }) },
}));

afterEach(cleanup);
// aiview's MermaidView picks its theme from the OS scheme; jsdom has no matchMedia
vi.stubGlobal("matchMedia", () => ({ matches: false }));

const AT = "2026-10-14T10:00:00Z";
const RUN: RunSummary = { run: 1, kind: "plan", plan: "alpha", group: "alpha", code: "AL", title: "Alpha", link: null, open: true, members: 2, done: 0, of: 2 };
const member = (seat: string, nick: string): SnapshotMember => ({
  badge: null,
  member: `alpha/${seat}`, nick, plan: "alpha", seat, role: seat, doing: "", state: "working", stale: false,
  files: [], joined: AT, ended: null, calls: 0, listening: false, on: [], lastCall: AT,
});
let seq = 0;
const item = (from: string, body: string, over: Partial<SnapshotEvent> = {}): SnapshotEvent => ({
  seq: ++seq, at: AT, kind: "msg", from, body, about: null, run: 1, channel: 1, ...over,
});
const EVENTS = [
  item("alpha/orchestrator", "do this first", { kind: "urgent" }),
  item("alpha/S1", "flag", { kind: "event", event: "flag", about: "b.ts", mentions: ["alpha/S2", "alpha/S1"] }),
  item("alpha/S2", "@S1 I add a call in a.ts", { about: "a.ts" }),
  item("alpha/S1", "@orchestrator new question: keep the old route?"),
  item("alpha/orchestrator", "quiet 12 min", { kind: "event", event: "quiet" } as unknown as Partial<SnapshotEvent>),
  item("alpha/S2", "@S1 S1 the top", { kind: "agreement", about: "c.ts" }),
  item("alpha/S1", "just talk"),
  item("alpha/S1", "merged abc: rebase your branch onto it.", { kind: "event", event: "merged" }),
  item("alpha/S1", "joined: the page", { kind: "event", event: "joined" }),
];
const SNAP: BoardSnapshot = {
  repo: "/r/.git", name: "r", runs: [RUN], lock: null, lockHistory: [], roster: [member("S1", "Sleepy Otter"), member("S2", "Brave Badger"), member("orchestrator", "Calm Owl")],
  events: EVENTS, queues: {}, files: [{ path: "a.ts", holders: ["alpha/S1"], interface: false }], flags: [],
};

const show = () => {
  const r = render(
    <>
      <TipLayer />
      <Conversation items={conversation(SNAP, { run: null, follow: null })} archived={null} fresh={new Set()} />
    </>,
  );
  const li = (text: string | RegExp) => screen.getByText(text).closest("li") as HTMLElement;
  return { ...r, li };
};

test("act now (urgent, an open flag): a red edge class; the open flag alone its tint class", () => {
  const { li } = show();
  const urgent = li("do this first");
  expect([...urgent.classList]).toEqual(expect.arrayContaining(["item", "act", "urgent"]));
  expect(urgent.classList.contains("open")).toBe(false);
  const flag = li("flag");
  expect([...flag.classList]).toEqual(expect.arrayContaining(["item", "act", "flag", "open"]));
});

test("waiting (a held file, a question, quiet): the dashed edge class", () => {
  const { li } = show();
  for (const text of [/I add a call in a\.ts/, /new question/, "quiet 12 min"]) {
    expect(li(text).classList.contains("wait"), String(text)).toBe(true);
  }
});

test("decided and talk carry no edge class; a plain message no word", () => {
  const { li } = show();
  const agreed = li(/S1 the top/);
  expect(agreed.classList.contains("decided")).toBe(true);
  const talk = li("just talk");
  expect(["act", "wait", "decided"].some((c) => talk.classList.contains(c))).toBe(false);
  expect(talk.querySelector(".what")).toBeNull();
});

test("the stylesheet: an item has no fill but the open flag's tint and act's; act a red edge, wait an amber one", () => {
  const css = readFileSync(join(__dirname, "components/viewers/board/board.css"), "utf8");
  // every rule whose selector is the item itself, with any of its classes, under the board's root
  const itemRules = [...css.matchAll(/^\.board (\.item(?:\.[\w-]+)*)\s*\{([^}]*)\}/gm)].map((m) => ({ selector: m[1], body: m[2] }));
  expect(itemRules.filter((r) => /background/.test(r.body)).map((r) => r.selector)).toEqual([".item.flag.open", ".item.act"]);
  expect(css).toContain(".board .item.act { box-shadow: inset 3px 0 0 var(--danger);");
  expect(css).toContain(".board .item.wait { box-shadow: inset 3px 0 0 var(--warn);");
});

test("every special word carries its tip, focusable (D9)", () => {
  show();
  const tipOf = (word: string | RegExp) => {
    const el = screen.getByText(word);
    expect(el.getAttribute("tabindex"), String(word)).toBe("0");
    return el.getAttribute("data-tip");
  };
  expect(tipOf("! urgent")).toBe(TIPS.urgent);
  expect(tipOf("⚑ flag · open")).toBe(TIPS.flag);
  expect(tipOf("held file")).toBe(TIPS.held);
  expect(tipOf(/^\? question for/)).toBe(TIPS.question);
  expect(tipOf("◷ quiet 12 min")).toBe(TIPS.quiet);
  expect(tipOf(/^✔ agreed with/)).toBe(TIPS.agreement);
});

test("a board event says what happened in one coloured word beside the role, its tip on hover and focus (D9)", () => {
  const { li } = show();
  const merged = li(/^abc/).querySelector("[data-tip]") as HTMLElement;
  expect(merged.textContent).toBe("merged");
  expect(merged.closest(".head")).not.toBeNull();
  expect(merged.className).toContain("ok");
  expect(merged.dataset.tip).toBe(TIPS.merged);
  expect(merged.getAttribute("tabindex")).toBe("0");
  expect((li(/^the page/).querySelector("[data-tip]") as HTMLElement).dataset.tip).toBe(TIPS.joined);
  const box = screen.getByRole("tooltip", { hidden: true });
  fireEvent.mouseOver(merged);
  expect(box.hidden).toBe(false);
  expect(box.textContent).toBe(TIPS.merged);
  fireEvent.focusOut(merged);
  expect(box.hidden).toBe(true);
  fireEvent.focusIn(screen.getByText("! urgent"));
  expect(box.textContent).toBe(TIPS.urgent);
});

test("a message carrying a mermaid fence shows it as a diagram in the conversation", async () => {
  const FENCE = "```";
  const said = item("alpha/S1", `the flow\n${FENCE}mermaid\nflowchart LR\n A-->B\n${FENCE}`);
  const snap = { ...SNAP, events: [said] };
  const { container } = render(<Conversation items={conversation(snap, { run: null, follow: null })} archived={null} fresh={new Set()} />);
  await screen.findByTestId("drawn");
  const diagram = container.querySelector('[data-component="ConversationItem"] [data-component="MermaidView"]');
  expect(diagram).not.toBeNull();
  expect(screen.getByText("the flow")).toBeTruthy();
});

test("a member reads its mark, then its nick and role, code·seat on hover; the agreement word names the other member by code and nick", () => {
  const { li } = show();
  const agreed = li(/S1 the top/);
  expect(agreed.querySelector('[data-component="AgentMark"]')?.textContent).toBe("S2");
  expect(agreed.querySelector('[data-component="AgentLabel"]')?.getAttribute("title")).toBe("AL·S2");
  expect(agreed.querySelector('[data-component="MemberTag"]')).toBeNull();
  expect(screen.getByText("✔ agreed with AL·S1 Sleepy Otter")).toBeTruthy();
});

// ── What the board looked like before the move, kept (plan D9): board.css's source, and the DOM ──

const boardCss = () => readFileSync(join(__dirname, "components/viewers/board/board.css"), "utf8");
const ruleOf = (css: string, selector: string): string => {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return css.slice(at + selector.length + 3, css.indexOf("}", at));
};

test("a post's diagram box and code box are drawn by board.css's rules, inside the board", async () => {
  const FENCE = "```";
  const said = item("alpha/S1", `the flow\n${FENCE}mermaid\nflowchart LR\n A-->B\n${FENCE}\n\n${FENCE}ts\nconst a = 1;\n${FENCE}`);
  const { container } = render(
    <div className="board">
      <Conversation items={conversation({ ...SNAP, events: [said] }, { run: null, follow: null })} archived={null} fresh={new Set()} />
    </div>,
  );
  await screen.findByTestId("drawn");
  const shiki = await waitFor(
    () => {
      const box = container.querySelector(".shiki-box");
      if (!box) throw new Error("not highlighted yet");
      return box;
    },
    { timeout: 10_000 },
  );
  expect(shiki).not.toBeNull();
  const css = boardCss();
  // the selectors of board.css's rules for each box, every one matching the box as rendered
  const selectorsFor = (box: string) =>
    [...css.matchAll(/^([^{}\n@][^{}\n]*)\{/gm)].map((m) => m[1].trim()).filter((s) => s.includes(box) && !s.includes(" svg") && !s.includes(" span") && !s.includes(" pre") && !s.includes(" code"));
  const mermaid = container.querySelector('[data-component="MermaidView"]')!;
  expect(selectorsFor(".mermaid-box")).toEqual([".board .post-md .mermaid-box"]);
  expect(mermaid.matches(".board .post-md .mermaid-box")).toBe(true);
  expect(ruleOf(css, ".board .post-md .mermaid-box")).toContain("border: 1px solid var(--border)");
  expect(shiki.querySelector("pre")!.matches(".board .post-md .shiki-box pre")).toBe(true);
  expect(ruleOf(css, ".board .post-md .shiki-box span")).toContain("color: var(--shiki-light)");
  expect(css).toContain("@media (prefers-color-scheme: dark) { .board .post-md .shiki-box span { color: var(--shiki-dark); } }");
}, 20_000);

test("the agent roster: a column left of the conversation, its own scroll, the conversation the rest of the width", () => {
  const css = boardCss();
  expect(ruleOf(css, ".board .run-body.with-roster")).toContain("grid-template-columns: minmax(240px, 300px) minmax(0, 1fr)");
  const roster = ruleOf(css, ".board .agent-strip");
  expect(roster).toContain("min-height: 0");
  expect(roster).toContain("overflow-y: auto");
  expect(roster).not.toMatch(/overflow-x/);
  expect(ruleOf(css, ".board .agent-strip .row")).toContain("content-visibility: auto");
});

test("messages run the full width: no measure caps a message's text", () => {
  const css = boardCss();
  expect(css).not.toMatch(/\d+ch\b/);
  expect(ruleOf(css, ".board .item .text")).not.toMatch(/max-width/);
});

test("a board event's text sits below its author line, as a message's does", () => {
  const { li } = show();
  const event = li(/^abc/);
  const head = event.querySelector(":scope > .head")!;
  const text = event.querySelector(":scope > .text")!;
  expect(head.querySelector('[data-component="AgentLabel"]')).not.toBeNull();
  expect(head.contains(text)).toBe(false);
  expect(head.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(ruleOf(boardCss(), ".board .event .text")).toContain("grid-column: 2");
});

test("the time is centred on the head's 18px line, a message's and an event's", () => {
  const css = boardCss();
  expect(ruleOf(css, ".board .item .time")).toContain("padding-top: 0; line-height: 18px");
  expect(ruleOf(css, ".board .event .time")).toContain("padding-top: 0; line-height: 18px");
  expect(ruleOf(css, ".board .event .head")).toContain("min-height: 18px");
});

test("a phase is a line cut by its name, its text on hover; neither a post nor an event line", () => {
  const nm = PHASED.runs.find((r) => r.code === "NM")!;
  render(<Conversation items={conversation(PHASED, { run: nm.run, follow: null })} archived={null} fresh={new Set()} />);
  const sep = screen.getByRole("separator", { name: "Phase diverge: every name a run could carry, no judgment yet" });
  expect(sep.getAttribute("data-component")).toBe("PhaseSeparator");
  expect(sep.className).toBe("phase");
  expect(sep.querySelector(".name")?.textContent).toBe("diverge");
  expect(sep.querySelector(".said")?.textContent).toBe("every name a run could carry, no judgment yet");
  expect(sep.querySelector(".head, .time")).toBeNull();
  const css = readFileSync(join(import.meta.dirname, "components/viewers/board/board.css"), "utf8");
  expect(css).toMatch(/\.board \.phase::before, \.board \.phase::after \{[^}]*border-top: 1px solid/);
  expect(css).toMatch(/\.board \.phase \.label \{[^}]*white-space: nowrap/);
  expect(css).toMatch(/\.board \.phase \.said \{ display: none; \}/);
  expect(sep.getAttribute("title")).toContain("diverge: every name a run could carry");
});
